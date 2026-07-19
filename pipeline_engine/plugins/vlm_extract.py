"""VLM metadata-extraction stage.

Looks up a structured-output schema by name, hands the crop + the schema's JSON-Schema
to a registered VLM model handle (which does guided/constrained JSON decoding on the
worker), validates the returned fields against the schema, and emits a ``Metadata``
artifact. No ML dependency lives here — only the artifact<->dict mapping.
"""
from __future__ import annotations

from typing import Any, ClassVar

from ..artifacts import Artifact, Crop, Metadata
from ..errors import RunError
from ..models import MODELS
from ..schemas import SCHEMAS
from ..stage import RunContext, STAGES


def _build_prompt(schema, gazetteer, instructions) -> str:
    """Task-agnostic extraction prompt. The schema (field names/descriptions + enums)
    carries the specifics; the handle just relays this + the image + the JSON schema."""
    fields = ", ".join(schema.model_fields.keys())
    base = instructions or (
        f"Read the object in the image and extract these fields as JSON: {fields}. "
        'Only use values you can actually see; use "unknown" or null when not determinable. '
        "Do not guess."
    )
    if gazetteer:
        base += f" Constrain categorical fields to their allowed values (hint set: {gazetteer})."
    return base


@STAGES.register
class VlmExtract:
    name: ClassVar[str] = "vlm_extract"
    inputs: ClassVar[dict[str, type[Artifact]]] = {"crop": Crop}
    outputs: ClassVar[dict[str, type[Artifact]]] = {"metadata": Metadata}

    def run(
        self,
        *,
        inputs: dict[str, Artifact],
        params: dict[str, Any],
        ctx: RunContext,
    ) -> dict[str, Artifact]:
        crop: Crop = inputs["crop"]  # type: ignore[assignment]

        schema_name = params.get("schema")
        if schema_name not in SCHEMAS:
            raise RunError(
                f"vlm_extract: unknown schema '{schema_name}' (have: {sorted(SCHEMAS)})"
            )
        schema = SCHEMAS[schema_name]

        model = MODELS.get(params.get("model", "sail-vlm"))
        raw = model.infer(
            image_png_base64=crop.png_base64,
            json_schema=schema.model_json_schema(),
            prompt=_build_prompt(schema, params.get("gazetteer"), params.get("instructions")),
        )
        if not isinstance(raw, dict):
            raise RunError(f"vlm_extract: model returned {type(raw).__name__}, expected dict")

        confidence = raw.pop("_confidence", {}) if isinstance(raw.get("_confidence"), dict) else {}
        try:
            validated = schema.model_validate(raw)
        except Exception as exc:  # pydantic ValidationError -> surface as a run error
            raise RunError(f"vlm_extract: model output failed schema '{schema_name}': {exc}") from exc

        return {
            "metadata": Metadata(
                fields=validated.model_dump(mode="json"),
                confidence={k: float(v) for k, v in confidence.items()},
            )
        }
