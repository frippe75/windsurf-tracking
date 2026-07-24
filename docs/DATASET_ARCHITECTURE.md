# Dataset Lifecycle Architecture

> **Status:** Proposed · **Owner:** platform · **Supersedes:** the ad-hoc synchronous export in
> `backend/app/routers/export.py` + `backend/app/export/generator.py`.
>
> **One-line:** Turn dataset export from a disposable, re-extract-everything one-off into a
> **content-addressed frame store + immutable, versioned datasets with full lineage** — built as a
> separated bounded context with a pluggable port/adapter at every seam.

---

## 1. Why (context & problem)

Today (`export_dataset_task` → `generator.build_yolo_dataset`):

- Every export **creates a new backend project**, **re-extracts all annotated frames** from the video
  with one ffmpeg call each, zips, uploads, and **discards the frames**.
- There is **no dataset identity** — no version, no snapshot, no reproducibility.
- There is **no lineage** — nothing links a trained model back to the exact data that produced it.
- Re-extraction is O(frames) of ffmpeg work **per export**; it is the direct cause of the export
  slowness and the web-pod OOM we already had to firefight.

This does not scale to a platform whose goal is auto-generated, balanced, continuously-growing
datasets with a training feedback loop.

## 2. Goals / non-goals

**Goals**
1. **Materialize each frame image at most once**, ever, and persist it (idempotent, content-addressed).
2. **Immutable dataset versions**: a version is a frozen, reproducible snapshot addressed by a hash of
   its inputs. Never mutated, never overwritten.
3. **End-to-end lineage**: model ⇒ dataset version ⇒ annotation snapshot ⇒ source frames ⇒ source videos.
4. **Extensible by construction**: new export formats, storage backends, publish targets, frame sources,
   and augmentation steps are added as adapters behind a stable port — **no changes to the core**.
5. **Strict separation of concerns**: a self-contained `datasets` bounded context; routers/workers are
   thin adapters over it; no business logic in HTTP handlers or Celery tasks.
6. **Backwards compatible rollout**: the current `POST /export` contract keeps working throughout.

**Non-goals (for now)**
- In-browser augmentation previews (Roboflow-style) — the *hooks* exist; the UI does not.
- Multi-tenant dataset sharing/marketplace.
- Label-quality / consensus review workflows (separate context).

## 3. Principles

- **Ports & adapters (hexagonal).** The core depends on interfaces (`Protocol`s), never on ffmpeg, boto3,
  SQLAlchemy, or a wire format. Adapters live at the edges and are swappable in tests and in prod.
- **Immutability + content addressing.** Versions and frames are addressed by a hash of their content /
  inputs. Same inputs ⇒ same id ⇒ dedupe + reproducibility for free.
- **Idempotence everywhere.** Re-running any step is safe and cheap (materialize-if-absent, upsert version).
- **Lazy but persistent.** Frames materialize on first *need* and are cached forever — not eagerly on the
  annotation path (keeps labeling fast; never materializes frames we don't ship).
- **The registry pattern already in the repo is the template.** Mirror `pipeline_engine`'s capability
  registry and `export/sinks.py`'s `DatasetSink` protocol — those are the extensibility model.

## 4. Bounded context & package layout

A new, self-contained context under `backend/app/datasets/`. Routers and Celery tasks become thin
adapters that call into it. Nothing here imports FastAPI or Celery.

```
backend/app/datasets/
  __init__.py
  ports.py                # ALL protocols (the seams) in one place — the public contract
  frames/
    extractor.py          # FrameExtractor adapters (ffmpeg, cv2)  [source seam]
    store.py              # FrameStore: S3FrameStore (content-addressed, idempotent)  [storage seam]
  versioning/
    fingerprint.py        # deterministic annotation-set hash
    manifest.py           # DatasetManifest schema (the immutable snapshot descriptor)
    service.py            # DatasetVersioningService (create/get/list versions)
    repository.py         # DatasetVersionRepository (DB)  [persistence seam]
  formats/
    yolo.py               # YoloWriter  [format seam]  (coco.py, etc. later)
  sinks/                  # publish targets (existing ZipSink/ClearMLSink move here)  [publish seam]
  assembly/
    builder.py            # DatasetBuilder: version + frame store + format writer -> staged dir
  lineage/
    models.py             # Lineage records
    service.py            # link version <-> sources <-> trained models  [provenance seam]
  service.py              # DatasetService: the one façade routers/workers call
```

**Rule:** callers (routers, workers, pipeline-service) depend on `datasets.service.DatasetService` and
`datasets.ports` only. Everything else is internal.

## 5. The seams (ports)

All in `datasets/ports.py`. Each has ≥1 adapter today and room for more. Signatures are indicative.

```python
class FrameExtractor(Protocol):
    """Decode a single frame from a source. Adapter chooses the mechanism."""
    def extract(self, source_path: str, frame_number: int, fps: float | None) -> bytes: ...
    # adapters: FfmpegExtractor (seek), Cv2Extractor (fallback)

class FrameStore(Protocol):
    """Content-addressed, idempotent frame image persistence."""
    def ref(self, video_id: str, frame_number: int) -> FrameRef: ...        # deterministic key, no IO
    def exists(self, ref: FrameRef) -> bool: ...
    def materialize(self, video_id: str, frame_number: int,
                    source_path: str, fps: float, extractor: FrameExtractor) -> FrameRef: ...
    def open(self, ref: FrameRef) -> BinaryIO: ...                          # for assembly
    # adapter: S3FrameStore (key = frames/{video_id}/{frame:08d}.jpg); future: local, GCS

class DatasetFormatWriter(Protocol):
    """Write a materialized dataset in a target on-disk layout from a manifest + frame store."""
    name: str                                                              # "yolo", "coco"
    def write(self, manifest: DatasetManifest, store: FrameStore, out_dir: Path) -> DatasetStats: ...

class DatasetSink(Protocol):                                               # already exists — kept
    name: str
    def available(self) -> bool: ...
    def publish(self, dataset_dir: Path, meta: dict) -> dict: ...          # ZipSink, ClearMLSink, future: HFHub

class DatasetVersionRepository(Protocol):
    def upsert(self, version: DatasetVersion) -> DatasetVersion: ...       # idempotent by content hash
    def get(self, version_id: str) -> DatasetVersion | None: ...
    def list_for_project(self, project_id: str) -> list[DatasetVersion]: ...

class LineageRepository(Protocol):
    def record_training(self, version_id: str, model_run: ModelRun) -> None: ...
    def sources_of(self, version_id: str) -> list[SourceRef]: ...
    def models_of(self, version_id: str) -> list[ModelRun]: ...
```

Adding a capability = **new adapter class, registered in a list** (mirroring `sinks._ALL` and the
`pipeline_engine` registry). The core and the API are untouched.

## 6. Domain model

```
DatasetVersion            # immutable snapshot
  id                      # = "dsv_" + fingerprint (content hash) — deterministic, dedupes
  project_id
  fingerprint             # hash(sorted annotations + class map + split params + format)
  format                  # "yolo" (writer name)
  stats                   # images, boxes, per-class counts, splits {train,val}
  manifest_key            # S3 key of the frozen manifest.json
  artifact_key            # S3 key of the published zip (or sink ref)
  created_at, created_by
  status                  # building | ready | failed

DatasetManifest           # the reproducible description (stored as JSON, immutable)
  version_id, project_id, format, split
  classes: [{id, name, index}]
  frames: [{frame_number, split, image_ref, labels: [yolo rows]}]   # references, not pixels
  source_videos: [video_id, ...]

FrameRef                  # {video_id, frame_number, key, sha256?}
ModelRun                  # {id, dataset_version_id, model, epochs, metrics{mAP50,...}, weights_key}
```

**Lineage graph:** `ModelRun.dataset_version_id → DatasetVersion.{fingerprint, source_videos, manifest}`.
Answering "what produced this model?" or "did the data change since v3?" is a lookup + hash compare.

## 7. Storage layout (S3, canonical)

```
frames/{video_id}/{frame:08d}.jpg          # materialized once, reused by every version (the cache)
datasets/{project_id}/{version_id}/manifest.json
datasets/{project_id}/{version_id}/dataset.zip     # published artifact (immutable)
models/{version_id}/{run_id}/best.pt
models/{version_id}/{run_id}/metrics.json
```

Frames are **shared across versions** — a new version that adds 10 frames materializes only those 10.

## 8. Data flow

```
annotate ──(DB is source of truth)──┐
                                     ▼
POST /projects/{id}/dataset-versions ── DatasetService.create_version()
   1. fingerprint(annotations, classes, split, format)         # deterministic id
   2. repo.get(id) exists? → return it (idempotent, instant)   # dedupe
   3. else Celery: build_version_task
        a. for each annotated frame: FrameStore.materialize()  # skips cached → cheap
        b. YoloWriter.write(manifest, store) → staged dir       # references cached frames
        c. sink.publish(dir) → artifact_key
        d. repo.upsert(version=ready); write manifest.json
   ▼
GET  /dataset-versions/{version_id}            # status + stats + artifact url (poll)
POST /pipeline/train {dataset_version_id}      # train references a VERSION, not a URL
   → on success: LineageService.record_training(version_id, ModelRun)
```

The existing `POST /export` becomes a thin shim that creates-or-returns the "current" version.

## 9. API surface (additive; old export kept)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/projects/{id}/dataset-versions` | create-or-get a version (returns `version_id`, dedup by hash) |
| GET | `/api/projects/{id}/dataset-versions` | list versions (lineage overview) |
| GET | `/api/dataset-versions/{version_id}` | status, stats, artifact URL, fingerprint |
| GET | `/api/dataset-versions/{version_id}/lineage` | sources + models trained on it |
| POST | `/api/projects/{id}/export` | **kept** — internally = create-or-get current version |

Frontend `lib/api.ts` gains `createDatasetVersion` / `getDatasetVersion`; `exportDataset` is
re-pointed at versions with the **same `ExportResult` shape** (zero blast radius on the Train tab).

## 10. Extensibility matrix

| Want to add… | Do this | Touches core? |
|---|---|---|
| New export format (COCO, VOC) | add `formats/coco.py` implementing `DatasetFormatWriter`, register | No |
| New publish target (HF Hub, Roboflow, GCS) | add a `DatasetSink` adapter | No |
| New frame source (image folders, RTSP) | add a `FrameExtractor` / source adapter | No |
| Different storage (local, GCS) | add a `FrameStore` adapter | No |
| Augmentation/preprocessing step | insert a `DatasetTransform` port into the assembly pipeline | No (new seam, pre-declared) |
| New trainer (RT-DETR, cloud) | already a `pipeline_engine` capability; link via `ModelRun` | No |

## 11. Migration & backwards compatibility

1. **Phase 1 ships behind the existing contract.** `generator.build_yolo_dataset` is refactored to go
   through `FrameStore` (materialize-if-absent) — same output, but frames now cached. No API change.
2. `POST /export` keeps returning `{result:{url}, stats}`; internally it creates-or-returns a version.
3. Old ephemeral zips continue to work; new zips live under `datasets/{project}/{version}/`.
4. No destructive DB migration — new tables only (`dataset_versions`, `lineage`).

## 12. Phased delivery

| Phase | Scope | Exit criteria |
|---|---|---|
| **P1 — Frame store** | `datasets/frames/*`, refactor generator to materialize-if-absent; ports.py seams | export re-extracts a frame **zero** times if cached; unit tests on store idempotence |
| **P2 — Versions** | `versioning/*`, `assembly/builder.py`, `dataset_versions` table, new endpoints; `/export` shim | a version has a stable id; re-creating with unchanged annotations returns the same id instantly |
| **P3 — Lineage** | `lineage/*`, `ModelRun`, training records `dataset_version_id`; Train tab shows "trained on v3 (hash…)" | model → version → sources is queryable end to end |
| **P4 — Formats/sinks breadth** | COCO writer, HF/Roboflow sink, augmentation seam | a second format + a second sink added with **no core diff** |

Each phase is independently shippable and independently valuable. P1 alone fixes the export perf.

## 13. Testing strategy

- **Core is pure + fully unit-tested** with in-memory fakes (`InMemoryFrameStore`, `FakeExtractor`,
  `InMemoryVersionRepository`) — no S3/DB/ffmpeg needed. Mirrors how `pipeline_service` tests fake handles.
- **Idempotence tests**: materialize twice ⇒ one write; upsert same fingerprint ⇒ one row.
- **Adapter contract tests**: each adapter verified against the port with a shared test suite.
- **Golden E2E** (the harness we already have): annotate → version → train → assert mAP + lineage row.

## 14. Observability & operability

- Structured events per phase: `frame.materialized{video,frame,cached}`, `version.created{id,stats}`,
  `version.reused{id}`, `training.linked{version,run}`.
- Metrics: cache hit-rate, frames materialized/export, version build time, storage bytes/version.
- Jobs already run on Celery (`cpu_worker`) with progress; extend the same status contract.

## 15. Security & data governance

- Version manifests record source video ids + who/when → auditable provenance.
- Frame/version/model keys are project-scoped; presigned URLs time-boxed (existing pattern).
- Immutable artifacts + content hashes give tamper-evidence.
- External sinks (ClearML/HF/Roboflow) remain **opt-in adapters** with credentials server-side only.

## 16. Risks & decisions

- **Frame cache invalidation**: frames are immutable per (video, frame); if a video is re-uploaded under
  the same id, bump a `video_version` into the frame key. *Decision: include video content hash in the
  frame key namespace.*
- **Storage growth**: frames + per-version zips accumulate. *Decision: zips are regenerable from the
  manifest + frame store, so a GC policy can drop old zips while keeping manifests (cheap) — versions stay
  reproducible.*
- **Fingerprint stability**: must be deterministic across processes. *Decision: canonical JSON (sorted
  keys, fixed float formatting) → sha256.*

---

## Appendix A — the one façade

```python
# datasets/service.py  — the ONLY thing routers/workers import
class DatasetService:
    def __init__(self, store: FrameStore, repo: DatasetVersionRepository,
                 writers: dict[str, DatasetFormatWriter], sinks: dict[str, DatasetSink],
                 lineage: LineageRepository): ...
    def create_or_get_version(self, project_id, annotations, classes, *, split, fmt="yolo", sink="zip") -> DatasetVersion: ...
    def get_version(self, version_id) -> DatasetVersion | None: ...
    def build(self, version_id) -> DatasetVersion: ...          # the Celery task calls this
    def record_training(self, version_id, run: ModelRun) -> None: ...
```

Wire-up (adapters chosen) happens once in a composition root; tests inject fakes. That is the whole
extensibility story: **swap adapters, never edit the core.**
