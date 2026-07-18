# Pipeline Engine — Design Doc

> **Purpose.** Classification (and metadata extraction) on this platform is a
> *configurable series of steps*, not a single hardcoded model call. This doc
> defines a small, **self-contained, vendor-neutral** engine that runs those steps,
> plus a **model/stage/runner registry** so the platform can grow to "any dataset
> use case" without the core learning about any specific model or orchestrator.
>
> **The contract (read this if nothing else).** The engine core depends only on
> `pydantic` + `pyyaml` + `networkx` — **no torch, no DB, no FastAPI, no Celery, no
> ClearML.** Heavy things (models, orchestrators) enter only as *plugins* the core
> discovers by name. Dependency direction is **app → engine, never engine → app.**
> Every predefined pipeline must run end-to-end on a fresh install with **no external
> service configured**. If one can't, it has leaked a dependency into the core.

---

## 0. Decisions (locked)

- **Engine:** tiny **pydantic + networkx** built-in executor (no external framework).
- **Definition format:** **YAML DSL from day one** — pipelines are YAML, validated by
  pydantic, built into a networkx DAG. (Python construction still exists under the
  hood, but YAML is the authored surface from Phase 1.)
- **Metadata extraction:** **VLM + guided-JSON schema** on the high-res masked crop,
  brand gazetteer to constrain. Not OCR-only, not an ensemble yet.
  - **Default model: InternVL3.5-8B (AWQ 4-bit), served via LMDeploy TurboMind** with
    `response_format=json_schema`. Fallback: Qwen2.5-VL-7B-Instruct-AWQ (LMDeploy).
  - **T4/Turing caveat (important):** vLLM's Qwen-/Qwen3-VL vision-attention path is
    **not** Turing-supported (vllm#29743) — on our T4s serve via **LMDeploy**, not vLLM.
    Skip all `-FP8` checkpoints (need Ada/Hopper). Qwen3-VL-8B has the best OCR numbers
    but no fast T4 serving path yet — revisit later. These choices live only in the
    `vlm_extract` model handle, so swapping them touches one plugin.
- **Registry:** stdlib `importlib.metadata` entry points + a small decorator registry.
- **Runners:** built-in default is mandatory; optional runners (e.g. distributed/remote)
  are pluggable. **ClearML is NOT a runner** — it's a user's own dataset/export tool,
  external to the engine.

---

## 1. Non-goals (what keeps this from becoming the "universal platform" trap)

- **Not** a general workflow engine competing with Prefect/Dagster/Airflow.
- **Not** coupled to ClearML or any orchestrator. ClearML is a user's own dataset/export
  tool, external to the engine — never a core dependency, and not a pipeline runner.
- **Not** woven into the existing annotation/DB/router code — it is a standalone
  package with a single adapter as its only touch-point with the app.
- **Not** speculative: generality is invested in *one* place (the typed artifact
  set); everything else stays concrete until a second real pipeline forces it open.

---

## 2. Principles (dev-excellence)

1. **Dependency-light core.** `pipeline_engine/` imports `pydantic`, `pyyaml`,
   `networkx` and stdlib only. It is importable and testable on a laptop with no GPU.
2. **One-way coupling.** The app depends on the engine; the engine never imports app
   code. A thin **adapter** maps platform concepts (video frame, annotation,
   instance.metadata) ↔ engine artifacts. That adapter is the *only* seam.
3. **Everything pluggable by name.** Stages, models, and runners are registered
   implementations discovered via a tiny decorator registry + stdlib entry points.
   Adding one is a new plugin, never an edit to the core.
4. **Built-in runner is mandatory and default.** Optional runners (e.g. a
   distributed/remote executor) are pluggable and only *add* options; they never gate
   execution.
5. **Typed artifacts are the contract.** Stages compose only through a small set of
   `pydantic` artifact types. Get these right and stages snap together; skip them and
   every pipeline is bespoke glue.
6. **Lazy heavy imports.** A stage plugin imports torch/vLLM/open-clip *inside* its
   `run()`, so importing the engine (or a CPU-only pipeline) never drags in 4 GB of
   CUDA. (Mirrors the existing backend `Dockerfile` minimal-`__init__` practice.)

---

## 3. Library choices — less code, same flexibility

| Concern | Use | Why | Rejected |
|---|---|---|---|
| Artifact + pipeline-def **contracts, validation, JSON-schema** | **Pydantic v2** (already in stack via FastAPI) | Typed artifacts *are* models; `.model_json_schema()` feeds LLM structured output for free; YAML→object validation in a few lines | hand-rolled dataclasses (no validation/schema) |
| **DAG** topo-order + cycle detection | **networkx** | `topological_sort` + cycle check + graph viz for free; ~30 fewer bug-prone lines than hand-rolling | writing our own toposort |
| **YAML** parsing | **PyYAML** | ubiquitous; pydantic validates the parsed dict | — |
| **Plugin registry** (stages/models/runners) | **stdlib `importlib.metadata` entry points** + a ~20-line decorator `Registry` | zero extra dependency; external packages register via entry points; built-ins via decorator | `pluggy`/`stevedore` — fine, but more machinery than name→impl needs (keep as a later option if we want hook-style multi-impl) |
| **Structured LLM output** (metadata schema) | **vLLM `guided_json`** (or **outlines**/**xgrammar**) — *in the VLM stage plugin only* | pydantic schema → constrained decoding → no hallucinated fields; self-hostable on T4 | free-text parsing / regex |
| **Encoder stages** (if/when needed) | **open_clip** / **transformers** / **sentence-transformers** — *in the plugin only* | one-liners for CLIP/SigLIP/DINOv2 embeddings + similarity | custom model code |

**Considered and rejected as the engine framework:** Prefect/Dagster (server + heavy
deps + their own runtime = coupling), Kedro (opinionated project layout), Hamilton
(elegant but Python-function-defined DAGs, and we need YAML-defined custom pipelines).
A pydantic-typed YAML def + networkx executor + name registry is less surface area and
keeps the YAML-first requirement.

**Net core dependency footprint:** `pydantic`, `pyyaml`, `networkx`. That's it.

---

## 4. Architecture

```
pipeline_engine/                     # self-contained package, app-agnostic
  artifacts.py     # pydantic artifact types (the contract)
  stage.py         # Stage protocol + Registry + entry-point discovery
  pipeline.py      # PipelineDef (pydantic) + YAML loader + networkx build/validate
  runner.py        # Runner protocol + BuiltinRunner (default)
  models.py        # ModelHandle protocol (uniform infer())  + model registry
  errors.py
  plugins/         # built-in stages (segment, crop_mask, vlm_extract, ...)
  tests/           # CPU-only; stages mocked; no GPU, no DB
```

**Artifacts** — the ~8 types everything composes through:

```python
# artifacts.py
class Artifact(BaseModel):
    model_config = ConfigDict(frozen=True)

class Image(Artifact):    uri: str; width: int; height: int      # frame reference, not bytes
class BBox(Artifact):     x: float; y: float; w: float; h: float # native px
class Mask(Artifact):     png_base64: str; bbox: BBox
class Crop(Artifact):     png_base64: str; source_bbox: BBox
class Label(Artifact):    value: str; score: float
class Metadata(Artifact): fields: dict[str, object]; confidence: dict[str, float]
class Embedding(Artifact):vector: list[float]; dim: int
class Track(Artifact):    frames: list[tuple[int, BBox]]
```

**Stage** — a named, typed, pluggable step:

```python
# stage.py
class Stage(Protocol):
    name: ClassVar[str]
    inputs:  ClassVar[dict[str, type[Artifact]]]
    outputs: ClassVar[dict[str, type[Artifact]]]
    def run(self, ctx: "RunContext", **inputs: Artifact) -> dict[str, Artifact]: ...

STAGES = Registry[Stage]()          # decorator + importlib.metadata entry points
@STAGES.register
class CropMask: name = "crop_mask"; ...
```

**Pipeline def** — YAML validated into pydantic, built into a networkx DAG, I/O types
checked at every edge *before* running:

```python
# pipeline.py
class StageRef(BaseModel):
    id: str; uses: str; params: dict = {}; wire: dict[str, str] = {}  # input -> "stage.output"
class PipelineDef(BaseModel):
    name: str; stages: list[StageRef]
    @classmethod
    def from_yaml(cls, text: str) -> "PipelineDef": ...
    def build(self) -> "nx.DiGraph": ...   # topo-sort + cycle + type-compat validation
```

**Runner** — pluggable; built-in is default and dependency-free:

```python
# runner.py
class Runner(Protocol):
    def run(self, dag, inputs: dict[str, Artifact]) -> dict[str, Artifact]: ...

class BuiltinRunner:                # default: topo order, in-process or via app's worker
    def run(self, dag, inputs): ...
RUNNERS = Registry[Runner]()        # optional distributed/remote runners register here
```

**Model handle** — the "smorgasbord" behind one interface; loaded once, lazily:

```python
# models.py
class ModelHandle(Protocol):
    name: ClassVar[str]
    def infer(self, **inputs) -> dict: ...   # torch/vLLM imported inside load()/infer()
MODELS = Registry[ModelHandle]()
```

---

## 5. Worked example #1 — sail brand/model metadata

Class is fixed (`SAIL`); the value is **brand + model**, so pipeline #1 is a metadata
extractor. Because brand/model is usually *printed text + graphics* on the sail, the
metadata stage is an OCR-strong VLM with a **pydantic schema → guided JSON**.

```yaml
# pipelines/sail_brand_model.yaml   (a shipped, tested "predefined" pipeline)
name: sail-brand-model
stages:
  - id: segment   { uses: sam2,        wire: { image: "@input.image", point: "@input.point" } }
  - id: crop      { uses: crop_mask,   wire: { image: "@input.image", mask: "segment.mask" },
                    params: { margin_pct: 20, suppress_background: true, min_px: 768 } }
  - id: metadata  { uses: vlm_extract, wire: { crop: "crop.crop" },
                    params: { model: "internvl3.5-8b", schema: "SailMeta", gazetteer: "sail_brands" } }
```

> **Status:** this pipeline is implemented and tested — see
> `pipeline_engine/pipelines/sail_brand_model.yaml` and `pipeline_engine/tests/`. The
> code sketches above are illustrative; the shipped signatures live in `pipeline_engine/`.

```python
# the schema IS the prompt contract; .model_json_schema() drives guided decoding
class SailMeta(BaseModel):
    brand: Literal["NeilPryde","Duotone","Severne","North","Goya","Point-7","Loft","other","unknown"]
    model: str | None
    size_m2: float | None
    sail_number: str | None
    primary_colors: list[str] = []
```

Output `Metadata.fields` → adapter writes them onto the existing **`instance.metadata`**
object (already present in the data model) → shown as editable tags with confidence in
the inspector → **human confirms/overrides** (suggest-and-confirm; never auto-commit).
Adding a future field ("year", "rig type") = one line in `SailMeta` + nothing else.

---

## 5b. Model serving & BYOM (lab HW, RunPod, bring-your-own-endpoint)

*Where* a model runs is a `ModelHandle`/config concern — the engine, the pipeline YAML,
and the app never learn about it. A pipeline says `model: internvl3.5-8b`; a
**`ModelConfig`** maps that logical name to a served endpoint.

- **Target the contract, not the vendor.** The built-in `openai-compat-http` handle
  speaks OpenAI chat-completions + `response_format: json_schema`. So a **RunPod
  serverless** endpoint, a local **vLLM/LMDeploy** server, or any hosted OpenAI-compatible
  API are the *same handle* with a different `base_url` — no lock-in, lab↔cloud is a
  config flip. (It uses stdlib `urllib`; no new core dependency.)
- **Why RunPod fits:** lab T4s can't serve a good VLM well (Turing serving gaps); RunPod
  gives A100/H100-class GPUs, and **serverless scale-to-zero** matches bursty per-click
  inference (pay per call, not for idle GPU). Trade-offs to weigh: data leaves the lab
  (privacy), per-call latency + possible cold starts, and $/call.
- **Secrets are never inline.** `ModelConfig.auth_env` names an env var; the key is read
  at call time (fits the lab vault/`.env` pattern).

```python
MODELS.configure("internvl3.5-8b", ModelConfig(
    type="openai-compat-http",
    model_name="OpenGVLab/InternVL3_5-8B",
    base_url="https://api.runpod.ai/v2/<endpoint>/openai/v1",
    auth_env="RUNPOD_API_KEY",
))
```

**BYOM has two halves — allow one, restrict the other:**

- ✅ **Bring your own *endpoint* (config, safe).** Register a model = `{type, model_name,
  base_url, auth_env}`, validated against the handle contract. No foreign code runs
  in-process — you call an HTTP endpoint honouring a schema. This *is* the flexibility.
- ⛔ **Bring your own *code/weights in-process* (entry-point plugin).** Shipping a new
  handle *class* is arbitrary Python — keep it to **trusted deployers** via entry points,
  never end-users. That is where the reluctance is justified.

Local execution (lab GPU via Celery) is just another handle — but because it imports
Celery it is registered by the **app**, not shipped in the engine core (see §6).

---

## 6. Boundaries & self-containment (the "not intertwined" requirement)

- **Package isolation.** `pipeline_engine/` has its own deps, its own tests, no import
  of `app.*`. Run its test suite without the backend, DB, or a GPU.
- **The single adapter.** `backend/app/pipelines_adapter.py` is the *only* file that
  imports both worlds: it turns a video frame + click into engine `inputs`, picks a
  runner, and writes `Metadata`/`Label` back onto instances/annotations. Swap the app
  and the engine is untouched.
- **Execution on existing infra without coupling.** The default `BuiltinRunner` can
  dispatch a model stage to the existing `gpu_0_worker` Celery queue — but that Celery
  call lives in the *runner/model plugin*, not the engine core. CPU stages and tests
  run in-process. The core never imports Celery.
- **Reuses a pattern you already shipped.** The pluggable-runner idea reuses the same
  *pattern* as export **sinks** — a declared interface, optional plugins, a built-in/local
  default that works standalone — applied to execution instead of output. (The export
  sink's first impl happens to be ClearML; runners have no ClearML implementation.)

---

## 7. Incremental delivery (YAML-first)

1. **Phase 1 — walking skeleton, YAML end-to-end.** `artifacts.py`, `stage.py`
   (protocol + registry), `pipeline.py` (**`PipelineDef` + YAML loader + networkx
   build/validate**), a ~120-line `BuiltinRunner`, and the `segment` / `crop_mask` /
   `vlm_extract` stages. Deliverable: the **sail brand/model pipeline defined as YAML**
   runs end-to-end (segment → crop → VLM guided-JSON → `Metadata`).
2. **Phase 2 — second pipeline + freeze.** Add `detect→segment→track` **as YAML** to
   shake out the artifact set against a second case; freeze the `Stage` / `Runner` /
   `ModelHandle` protocols; add `importlib.metadata` entry-point discovery for external
   plugins.
3. **Phase 3 — hardening.** Rich edge type-validation errors, a schema registry for
   guided-JSON, and model load-once / LRU-eviction on the worker (T4 memory).
4. **Phase 4 — optional runners (only if needed).** Add a distributed/remote runner
   *only* when a real workload needs one, proving the built-in stays sufficient by
   default. (Not ClearML — ClearML is the user's dataset/export concern, not a runner.)

---

## 8. Risks & guardrails

- **Scope creep → universal platform.** Mitigation: only the artifact set is
  general; add stages/pipelines on real demand.
- **Hidden coupling.** Mitigation: CI check that `pipeline_engine/` imports nothing
  from `app.*` and nothing GPU-heavy at module load.
- **VLM hallucination / small-text illegibility.** Mitigation: `unknown` enum values,
  gazetteer-constrained schema, per-field confidence + threshold, high-res crops,
  human confirm.
- **Runner leakage.** Mitigation: the fresh-install litmus test — every predefined
  pipeline runs with zero external services configured.

---

*Keep this doc aligned with `UX_ARCHITECTURE.md` (pipelines, models, runners are
registries — never chrome) and the export-sink precedent (pluggable, first impl ≠
required dependency).*
