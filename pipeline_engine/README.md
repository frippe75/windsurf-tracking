# pipeline_engine

Self-contained, vendor-neutral engine that runs classification / metadata-extraction as
a **configurable series of typed stages**. Design + rationale:
[`docs/PIPELINE_ARCHITECTURE.md`](../docs/PIPELINE_ARCHITECTURE.md).

**Core deps:** `pydantic` + `pyyaml` + `networkx`. Nothing else — no torch, DB, FastAPI,
Celery, or ClearML in the core. Heavy libraries enter only as *plugins*, lazily.

## Concepts

- **Artifacts** (`artifacts.py`) — the ~9 typed things stages pass around
  (`Image, Point, BBox, Mask, Crop, Label, Metadata, Embedding, Track`).
- **Stage** (`stage.py`) — a named step declaring `inputs`/`outputs` artifact types.
- **PipelineDef** (`pipeline.py`) — YAML → pydantic → validated networkx DAG.
- **Runner** (`runner.py`) — `BuiltinRunner` is the default; optional runners (e.g. a
  distributed/remote executor) are pluggable and only *add* options. ClearML is not a
  runner.
- **ModelHandle / ModelConfig** (`models.py`) — one `infer(**inputs)->dict` interface per
  served model; a logical model name resolves through a `ModelConfig` to a handle, so lab
  GPU / RunPod / any OpenAI-compatible endpoint is a config flip. Built-in
  `openai-compat-http` handle (`handles/`) speaks OpenAI chat + `json_schema` over stdlib
  `urllib`. Secrets via `auth_env` (env-var name), never inline. See design doc §5b.
- **Registry** (`registry.py`) — stdlib entry-point discovery + a decorator for built-ins.

## Run a pipeline

```python
import pipeline_engine as pe
from pipeline_engine.pipeline import PipelineDef
from pipeline_engine.runner import BuiltinRunner
from pipeline_engine.stage import RunContext

defn = PipelineDef.from_yaml_path("pipeline_engine/pipelines/sail_brand_model.yaml")
ctx = RunContext(extra={"load_image": my_loader})     # inject pixel access / clients
out = BuiltinRunner().run(defn, {
    "image": pe.Image(uri="frame://1", width=1920, height=1080),
    "point": pe.Point(x=900, y=500, label=1),
}, ctx=ctx)
metadata = out["metadata"]["metadata"]                # pe.Metadata
```

Model handles (`sam2`, the VLM) are backed by the GPU worker on the platform and faked
in tests — the engine core never imports an ML stack.

## Test

```bash
python -m pytest pipeline_engine/tests -q
```

`test_import_boundary.py` enforces the dependency-light rule: no module-level import of
an ML stack, the backend app, or an orchestrator anywhere in the core.

## Status

Phase 1 (walking skeleton, YAML end-to-end) complete: engine core + `sam2` / `crop_mask`
/ `vlm_extract` stages + the `sail-brand-model` pipeline, all tested. Next: a second
pipeline (detect→segment→track), freeze the protocols, add entry-point discovery, then
the app adapter. See the design doc §7.
