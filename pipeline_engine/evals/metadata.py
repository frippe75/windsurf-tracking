"""Evaluate the metadata-schema *draft* prompt against any model.

The metadata feature asks a model to draft a categorical schema from a dataset's
name / description / classes (`schemaDraftRequest` in the frontend), then later to extract
values from a frame grid against that schema. Today both run on Claude (a Frontier API).
Before trusting a cheaper or self-hosted model, we need to *measure* it — this harness
scores a model's draft output against deterministic checks:

    python -m pipeline_engine.evals.metadata claude
    python -m pipeline_engine.evals.metadata <model> path/to/models.yaml

Any model configured with the ``metadata-extract`` capability is eligible. The checks are
pure (no LLM judge): the schema must be well-formed, categorical (enum-biased), the right
size, *relevant* to the dataset's domain, and — the failure that bit us — free of
cross-domain leakage (a histology dataset must not sprout "weather"/"sail"). The traffic
case proves the point cuts both ways: "weather" there is correct, not leakage.

NB: ``build_draft_prompt`` MIRRORS the frontend source of truth in
``frontend/src/lib/metaSchema.ts`` (``schemaDraftRequest``). Keep the two in sync — the
frontend owns the prompt; this evals the model that answers it.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Any, Callable

from ..models import MODELS

# --- the prompt + tool schema (mirror of metaSchema.ts) -----------------------------

#: The Anthropic tool ``input_schema`` the draft call forces the model into.
DRAFT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "fields": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                    "scope": {"type": "string", "enum": ["scene", "instance", "video"]},
                    "type": {"type": "string", "enum": ["enum", "text"]},
                    "values": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["key", "scope", "type"],
            },
        }
    },
    "required": ["fields"],
    "additionalProperties": False,
}

_SCOPES = {"scene", "instance", "video"}
_TYPES = {"enum", "text"}


def build_draft_prompt(name: str, description: str, class_names: list[str]) -> str:
    """Reconstruct the schema-draft prompt. Mirror of metaSchema.ts:schemaDraftRequest."""
    parts = [
        "Create a metadata schema for a machine-vision dataset so we can measure class balance/imbalance.",
        f'Dataset name: "{name}".',
        f"Purpose: {description}." if description else "",
        f"Object classes: {', '.join(class_names)}." if class_names else "",
        "Infer the dataset's domain strictly from the name, purpose, and object classes given above.",
        "Propose 4-8 CATEGORICAL fields (prefer enum value-sets over free text) that capture the real",
        "sources of visual variation for THIS domain specifically — the scene conditions and object",
        "attributes whose imbalance would most bias a model trained on this data. Do NOT assume any",
        "particular subject matter; if the context is thin, propose only fields the classes clearly justify.",
        "Use scope 'scene' for whole-image conditions, 'instance' for per-object attributes, 'video' for clip-level.",
        "For each field give: key (snake_case), scope (scene | instance | video), type (enum | text), and values (for enum).",
    ]
    return " ".join(p for p in parts if p)


# --- checks -------------------------------------------------------------------------


@dataclass
class CheckResult:
    label: str
    passed: bool
    detail: str = ""


Check = Callable[[dict[str, Any]], CheckResult]


def _fields(out: dict[str, Any]) -> list[dict[str, Any]]:
    fs = out.get("fields") if isinstance(out, dict) else None
    return [f for f in fs if isinstance(f, dict)] if isinstance(fs, list) else []


def _field_text(f: dict[str, Any]) -> str:
    """Searchable text of one field — its key plus any enum values, lowercased."""
    vals = f.get("values") or []
    return " ".join([str(f.get("key", ""))] + [str(v) for v in vals]).lower()


def well_formed() -> Check:
    """Every field has a usable key, a valid scope/type, and enums carry values."""

    def check(out: dict[str, Any]) -> CheckResult:
        fs = _fields(out)
        if not fs:
            return CheckResult("well_formed", False, "no fields returned")
        bad: list[str] = []
        for f in fs:
            key = f.get("key")
            if not isinstance(key, str) or not key.strip():
                bad.append(f"missing key: {f!r}")
                continue
            if f.get("scope") not in _SCOPES:
                bad.append(f"{key}: bad scope {f.get('scope')!r}")
            if f.get("type") not in _TYPES:
                bad.append(f"{key}: bad type {f.get('type')!r}")
            if f.get("type") == "enum" and not (f.get("values") or []):
                bad.append(f"{key}: enum with no values")
        return CheckResult("well_formed", not bad, "; ".join(bad))

    return check


def count_between(lo: int, hi: int) -> Check:
    def check(out: dict[str, Any]) -> CheckResult:
        n = len(_fields(out))
        return CheckResult(f"count_{lo}_{hi}", lo <= n <= hi, f"{n} fields")

    return check


def mostly_categorical(min_frac: float = 0.5) -> Check:
    def check(out: dict[str, Any]) -> CheckResult:
        fs = _fields(out)
        if not fs:
            return CheckResult("mostly_categorical", False, "no fields")
        enum = sum(1 for f in fs if f.get("type") == "enum")
        frac = enum / len(fs)
        return CheckResult("mostly_categorical", frac >= min_frac, f"{enum}/{len(fs)} enum ({frac:.0%})")

    return check


def mentions_any(keywords: list[str]) -> Check:
    """Relevance: at least one field's key/values touches the domain vocabulary."""
    kw = [k.lower() for k in keywords]

    def check(out: dict[str, Any]) -> CheckResult:
        hits = sorted({k for f in _fields(out) for k in kw if k in _field_text(f)})
        return CheckResult("relevant", bool(hits), f"matched {hits}" if hits else f"none of {kw}")

    return check


def excludes_all(keywords: list[str]) -> Check:
    """Anti-leak: no field may mention a foreign domain's vocabulary."""
    kw = [k.lower() for k in keywords]

    def check(out: dict[str, Any]) -> CheckResult:
        leaked = sorted({k for f in _fields(out) for k in kw if k in _field_text(f)})
        return CheckResult("no_leak", not leaked, f"leaked {leaked}" if leaked else "clean")

    return check


# --- cases --------------------------------------------------------------------------


@dataclass
class Case:
    id: str
    name: str
    description: str
    class_names: list[str]
    checks: list[Check]

    def prompt(self) -> str:
        return build_draft_prompt(self.name, self.description, self.class_names)


#: Three domains chosen so the eval measures *domain-appropriateness*, not a keyword
#: blocklist: "weather" is expected in traffic, forbidden in histology.
CASES: list[Case] = [
    Case(
        id="windsurf",
        name="Windsurf sail set",
        description="Detection/tracking of a single windsurf sail brand on open water for a commercial.",
        class_names=["sail", "board"],
        checks=[
            well_formed(),
            count_between(4, 8),
            mostly_categorical(),
            mentions_any(["sail", "board", "water", "wave", "weather", "sky", "wind", "color", "light", "spray", "sun", "cloud"]),
            excludes_all(["tumor", "stain", "invoice", "vehicle"]),
        ],
    ),
    Case(
        id="histology",
        name="Histology tiles",
        description="H&E-stained tissue slide tiles for tumor detection.",
        class_names=["tumor", "stroma"],
        checks=[
            well_formed(),
            count_between(4, 8),
            mostly_categorical(),
            mentions_any(["stain", "tissue", "tumor", "cell", "grade", "magnif", "region", "nucle", "gland", "necros", "margin"]),
            excludes_all(["weather", "wave", "sail", "surf", "sky", "wind"]),
        ],
    ),
    Case(
        id="traffic",
        name="Traffic camera dataset",
        description="Roadside camera footage for vehicle and pedestrian detection.",
        class_names=["car", "truck", "pedestrian"],
        checks=[
            well_formed(),
            count_between(4, 8),
            mostly_categorical(),
            mentions_any(["weather", "light", "time", "day", "night", "lane", "road", "occlus", "densit", "rain", "traffic"]),
            excludes_all(["sail", "tumor", "stain", "wave"]),
        ],
    ),
]


# --- runner -------------------------------------------------------------------------


@dataclass
class CaseReport:
    case_id: str
    ok: bool
    results: list[CheckResult] = field(default_factory=list)
    raw: dict[str, Any] | None = None
    error: str | None = None


@dataclass
class EvalReport:
    model: str
    cases: list[CaseReport]

    @property
    def checks_passed(self) -> int:
        return sum(1 for c in self.cases for r in c.results if r.passed)

    @property
    def checks_total(self) -> int:
        return sum(len(c.results) for c in self.cases)

    @property
    def score(self) -> float:
        """Fraction of individual checks passed (0.0 if the model errored on everything)."""
        return self.checks_passed / self.checks_total if self.checks_total else 0.0

    @property
    def cases_ok(self) -> int:
        return sum(1 for c in self.cases if c.ok)


def run_case(handle: Any, case: Case) -> CaseReport:
    try:
        out = handle.infer(prompt=case.prompt(), json_schema=DRAFT_SCHEMA)
    except Exception as exc:  # a model failure is a result, not a crash
        return CaseReport(case.id, ok=False, error=f"{type(exc).__name__}: {exc}")
    results = [chk(out) for chk in case.checks]
    return CaseReport(case.id, ok=all(r.passed for r in results), results=results, raw=out)


def run_eval(model_name: str, cases: list[Case] | None = None) -> EvalReport:
    """Resolve ``model_name`` from the registry and score it over ``cases`` (default CASES)."""
    handle = MODELS.get(model_name)
    return EvalReport(model_name, [run_case(handle, c) for c in (cases or CASES)])


def format_report(rep: EvalReport) -> str:
    lines = [f"metadata-draft eval — model={rep.model}"]
    for c in rep.cases:
        head = "PASS" if c.ok else "FAIL"
        lines.append(f"  [{head}] {c.case_id}")
        if c.error:
            lines.append(f"        error: {c.error}")
        for r in c.results:
            mark = "✓" if r.passed else "✗"
            lines.append(f"        {mark} {r.label}: {r.detail}")
    lines.append(f"score: {rep.checks_passed}/{rep.checks_total} checks  ({rep.score:.0%}), "
                 f"{rep.cases_ok}/{len(rep.cases)} cases clean")
    return "\n".join(lines)


def _main(argv: list[str]) -> int:
    if not argv:
        print("usage: python -m pipeline_engine.evals.metadata <model> [models.yaml]", file=sys.stderr)
        return 2
    model = argv[0]
    from pathlib import Path

    from ..config import load_models_yaml

    cfg = argv[1] if len(argv) > 1 else str(Path(__file__).resolve().parents[1] / "models.example.yaml")
    load_models_yaml(cfg)
    rep = run_eval(model)
    print(format_report(rep))
    return 0 if rep.cases_ok == len(rep.cases) else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(_main(sys.argv[1:]))
