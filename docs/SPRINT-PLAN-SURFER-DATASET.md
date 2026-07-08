# Sprint Plan — SURFER dataset: pluggable tracking init + compound classes

Status: proposal (uncommitted). Written 2026-07-08 from a code-level audit of `main`
plus branch `phase2-hooks` (assumed merged before the sprint starts). All citations
are `file:line` on `main` unless marked `[phase2-hooks]`.

Sprint intent (user's words): building a SURFER dataset needs (a) another way —
allowing multiple ways — to set the initial tracking point (today a single click),
and (b) frontend+backend features like defining a COMPOUND CLASS, e.g.
surfboard+person with an IoU-overlap threshold. Implementation must be PLUGGABLE —
a real extension point, not a slap-on.

---

## 1. How it works today (citation-backed)

### 1.1 Click capture → SAM2 prompt

- `frontend/src/components/VideoPlayer.tsx:662-690` — canvas click handler:
  `screenToCanvas` (419) maps CSS px → canvas bitmap px; divides out DPR×zoom
  (680-681); `getDisplayedRect` (432-445) gives the object-contain video rect; click
  is emitted to the parent as **percent of displayed video (0-100)** plus modifier
  flags (`ctrlKey||metaKey`, `altKey||AltGraph`, 688-689).
- `frontend/src/pages/Index.tsx:1565-1844` (`handleCanvasClick`) — requires a
  modifier (1589); Alt ⇒ negative, Ctrl ⇒ positive (1586).
  - Click **inside an existing annotation's bbox** on the current frame: the +/−
    prompt is appended to that annotation's `sam2Prompts` **in display-% coords**
    (1607-1613) and **SAM2 is NOT re-run** — the added point changes nothing on
    screen until a tracking job later consumes it.
  - Click on empty area with SAM2 on: converts % → native px via `pctToNative`
    (1654, `lib/coordinates.ts`) and calls `segmentWithSAM2` with **exactly one
    positive point** (1666-1670) — negatives can never seed a new object (1627-1634).
- `frontend/src/lib/api.ts:739-804` (`segmentWithSAM2`) — POST
  `/api/ai/sam2/segment` with `{video_id, frame_number, click_prompts[]}`. The
  request type already supports arrays of +/− prompts (`SAM2ClickPrompt`, 539-549);
  the caller just never sends more than one.
- `backend/app/routers/ai.py:84-210` (`sam2_segment`) — splits `click_prompts` into
  `positive_prompts`/`negative_prompts` (149-157), extracts the frame **at native
  resolution** with cv2 (128-137), and dispatches Celery task
  `workers.tasks.sam2.segment_frame_task` to queue `gpu_0_worker` (172-176),
  blocking up to 30 s. Response: native-px `bbox [x1,y1,x2,y2]`, `mask_base64`,
  `score` (183-197). **The multi-point / negative-point capability already exists
  end-to-end on this endpoint; only the UI never exercises it.**
- Back in `Index.tsx`: native bbox → display-% via `nativeBBoxToPct` (1686), a
  rectangle polygon via `bboxToPolygon` (1692), class is **hardcoded `"Sail"`**
  (1705, still present at `[phase2-hooks] Index.tsx:1478`), a new `Instance` +
  `Annotation` are created with `sam2Prompts: [{x, y, type:'positive'}]` in
  display-% (1732-1742).

### 1.2 Data model

`frontend/src/types/annotation.ts`:
- `Class` (3-8): `{id, name, color, colorName}` — flat, no composition concept.
- `Instance` (10-16): `{id, classId, instanceNumber, name?, metadata{}}` — an
  instance is one physical object identity; it persists **across frames** because
  every per-frame `Annotation` points at it via `instanceId`.
- `Annotation` (18-33): one object on one frame — `frameCreated`, display-% `bbox`
  + `points`, `sam2Prompts` (the tracking-init seed), mask fields, and
  `isKeyframe` (true = manual, false = produced by tracking).
- `Keyframe` (35-39): frame-level `START/STOP/SKIP/META` markers — START/STOP pairs
  delimit tracking segments.

`frontend/src/types/project.ts:3-17`: `Project` owns `classes`, `instances`,
`annotations`, `keyframes`, `scenes` for a set of `videoIds`. Persisted to
localStorage + debounced write-only backend `settings` blob (see memory
`project-cache-flow-audit`: backend never hydrates it on `main`;
`[phase2-hooks] useProjects.ts` adds hydration).

### 1.3 Tracking end-to-end

- Job creation (frontend): `Index.tsx:1850-1880` (`handleStartTracking`) builds a
  local pending job from an annotation's `frameCreated` → next STOP keyframe.
  `[phase2-hooks] useTrackingJobs.ts:96+` also auto-creates jobs from START→STOP
  keyframe pairs, collecting all annotations in the range.
- Job execution (frontend): `Index.tsx:1882-2242` (`handleProcessJob`), ported to
  `[phase2-hooks] useTrackingJobs.ts` (`allClickPrompts` flatMap at :209, result
  mapping at :463):
  1. **Flattens ALL prompts of ALL annotations in the segment into one
     `click_prompts` list** (pct→native, 1901-1906) — per-object grouping is lost.
  2. `createTrackingJob` (`lib/api.ts:914-956`) → **POST
     `/api/videos/{id}/tracking/jobs`** with `{segments:[{start_frame, end_frame,
     click_prompts}]}`.
  3. Executes each returned sub-job via POST `/api/tracking/jobs/{id}/execute`,
     polls `/status` 1 Hz, fetches `/results` (api.ts:959-976, 1109-1225).
  4. Maps results back: `object_id - 1` indexes into `segmentAnnotations`
     (Index.tsx:2159) and creates non-keyframe annotations per frame with native→%
     bbox conversion (2179-2197).
- Job creation (backend): **only the legacy monolith has it** —
  `windsurf-sail-dataset/backend/main.py:441-561` (`POST
  /api/videos/{video_id}/tracking/jobs`, docstring mandates native coords,
  auto-splits >12 GB estimates into 100-frame parts with a
  `prompt_source: "propagated"` placeholder that later **raises
  `ValueError("Multi-part job propagation not yet implemented")`** at 779-780).
- Job execution (backend, monolith): `main.py:783-794` converts the flat
  `click_prompts` into `objects_data`, **making every positive click its own
  object** and dropping negatives — `"negative_points": []  # TODO: Support
  negative prompts per object` (792). Then calls `track_objects_in_video`
  (`windsurf-sail-dataset/windsurf/sail_tracking.py:342`), whose contract is
  already per-object multi-point:
  `[{"object_id", "positive_points":[(x,y)...], "negative_points":[(x,y)...]}]`
  (`sail_tracking.py:128-167`, `add_object_prompts`, feeding SAM2's
  `add_new_points_or_box` — box prompts are reachable too).
- The modular backend (`backend/app/routers/tracking.py`, prefix `/api/tracking`)
  has **only** `POST /jobs/{id}/execute`, `GET /jobs/{id}/status|results`,
  `GET /results` (17-94) and forwards to Celery task
  `workers.tasks.sam2.track_objects_task` (110-114). **No creation route.**

### 1.4 Deployed reality (verified 2026-07-08, read-only)

`https://windsurf-api.tclab.org/openapi.json` (the pinned `annotation-api:v2-auth`)
lists **no `POST /api/videos/{video_id}/tracking/jobs`** — only
execute/status/results. The deployed backend is the modular app. Therefore
**tracking-job creation 404s in production today**: the frontend calls a route that
does not exist, and even `/execute` would 404 because `tracking_jobs_db` can never
be populated (`tracking.py:14,21`). The lead is confirmed.

Additionally `kubernetes/gpu-workers.yaml:13,67` pins both Celery GPU workers
(`ai-celery-worker:v2.1-prod`) at **`replicas: 0`**, and every AI route (SAM2
segment, DINO, classify, tracking execute) dispatches to Celery queue
`gpu_0_worker` — with no consumer, **even single-click SAM2 segmentation cannot
complete in prod** unless workers are scaled up. The worker task source
(`workers.tasks.*`) is **not in this repo** (same "image newer than repo" problem
as the backend base image).

### 1.5 Unused capabilities relevant to init methods

- `POST /api/ai/dino/detect` exists on the deployed backend and in
  `backend/app/routers/ai.py:51-82` (Grounding DINO via Celery).
- `frontend/src/lib/api.ts:497-536` (`detectWithDINO`) is fully implemented and
  **imported by nothing** (verified: no callers outside api.ts).
- The "Auto-detect (DINO)" toolbox switch (`Toolbox.tsx:81`) feeds
  `handleAutoDetect` → `detectObjects` (`Index.tsx:2262`) which **throws
  "not configured"** in real-API mode (`api.ts:108-119`). Text-prompt detection is
  therefore a dead feature on both ends of a live endpoint.

### 1.6 Export — the current path to YOLO training data

- `Index.tsx:2427-2453` (`handleSaveProject`) and `2455-2477` (`handleExportData`)
  both download **raw JSON** of `{classes, instances, annotations, keyframes}` with
  display-% bboxes.
- **No YOLO export exists anywhere in the repo** (repo-wide grep: "yolo" appears
  only in markdown). The pipeline's only exporter is
  `windsurf-sail-dataset/windsurf/annotation_manager.py:158-174` —
  `windsurf_native` JSON; COCO raises `NotImplementedError`. The backend README's
  claim of "Export to multiple formats (COCO, Pascal VOC, YOLO)" is aspirational.
- So the mission flow "annotate → export YOLO dataset → train in tracking-models"
  currently ends at a JSON file that some out-of-repo process would have to
  convert. Note the happy accident: display-% bbox ÷ 100 **is already the YOLO
  normalized coordinate space** (x_center/y_center/w/h need only the corner→center
  transform), because canvas % and native px share the same aspect ratio
  (`lib/coordinates.ts`, memory `coordinate-seam-audit`: live paths are all-native,
  no letterbox).

### 1.7 phase2-hooks baseline

Branch `origin/phase2-hooks` (4 commits, +3082/−864): `useProjects` (backend
hydration fix), `useVideoLibrary` (backend merge fix), `useAnnotations` +
`lib/annotationOps` (pure list ops), `useTrackingJobs` (job lifecycle incl. result
normalization/ingestion), with 97 tests; `Index.tsx` drops to ~2246 lines and keeps
only orchestration: `handleCanvasClick`/SAM2 (`[phase2-hooks] Index.tsx:1338`),
export (1722). **The sprint plans on top of this branch**: init methods plug into
the page-level click orchestration + `useTrackingJobs`; compound classes plug into
`useAnnotations`/`annotationOps` + export.

---

## 2. Findings that block or shape the sprint

| # | Finding | Evidence | Impact |
|---|---------|----------|--------|
| F1 | **Tracking-job creation is broken in prod** — frontend POSTs `/api/videos/{id}/tracking/jobs`; deployed backend (and repo `backend/app`) has no such route; only the legacy monolith does. | api.ts:941 vs prod OpenAPI; monolith main.py:441 | Blocker. No init-method work is testable end-to-end until the creation route is ported into `backend/app/routers/tracking.py`. |
| F2 | **No Celery consumers in prod** — gpu-workers at `replicas: 0`; every AI call (incl. single-click SAM2) dispatches to `gpu_0_worker`. | kubernetes/gpu-workers.yaml:13,67; ai.py:172-176 | Blocker for any live annotation session. Sprint needs a worker strategy (scale-up on demand, or rebuild worker from repo code). |
| F3 | **Worker + backend image sources are newer than the repo** (`annotation-api:v2-auth` pinned; `ai-celery-worker:v2.1-prod` tasks not in repo). | CLAUDE.md; DEPLOYMENT.md:80-88 | Any backend contract change requires source reconciliation or a from-repo rebuild of both images. Schedule explicitly; do not "just add a route". |
| F4 | **Negative prompts are silently dropped at tracking time** and every positive click becomes a separate object. | main.py:786-794 (TODO :792) | The per-object multi-point capability of `sail_tracking.py:128-167` is wasted; also produces defect F5. |
| F5 | **object_id ↔ annotation mapping breaks with multi-prompt annotations**: frontend flattens all prompts (Index.tsx:1901-1906), backend creates one object per positive prompt, frontend then maps `object_id-1` to an annotation index (Index.tsx:2159; `[phase2-hooks] useTrackingJobs.ts:209,463`). Two positives on one annotation ⇒ results attributed to the wrong instance. | cited | Must fix as part of the new init contract (per-object grouping). |
| F6 | **Adding +/− prompts never re-runs SAM2** — no visual feedback; prompt coords stored in display-% while the create-call sends native px (two conventions inside one field's lifecycle). | Index.tsx:1607-1619 vs 1654-1669 | The "multi-click" init method is 70% built but inert; finishing it is cheap and high-value. |
| F7 | **DINO endpoint is live but unreachable from the UI**; `detectWithDINO` is dead code; the visible toggle calls a stub that throws. | §1.5 | Text-prompt init ("person", "surfboard") is a near-free capability for the surfer dataset. |
| F8 | **Class is hardcoded to `"Sail"`** on every SAM2-created annotation. | Index.tsx:1705; `[phase2-hooks]`:1478 | Unusable for a surfer dataset (person + surfboard classes). Must become "selected class" at minimum. |
| F9 | **No YOLO export exists**; export is raw JSON; mission requires YOLO. | §1.6 | Compound classes only pay off at export; the exporter must exist for the sprint to deliver mission value. |
| F10 | Multi-part job propagation (`prompt_source: "propagated"`) is unimplemented and raises. | main.py:508-509, 779-780 | Long segments (>~100 frames after split) fail after part 1. Shapes the "propagate-from-previous" init method: same mechanism, two consumers. |

---

## 3. Design — pluggable tracking-initialization methods

### 3.1 Principle

Everything downstream of initialization already converges on **one canonical
per-object seed**: `objects_data = [{object_id, positive_points[], negative_points[]}]`
(`sail_tracking.py:135`), optionally a box (SAM2's `add_new_points_or_box`,
`sail_tracking.py:167`). So the extension point is: *an init method is anything
that produces a `PromptSet` for an instance on a frame*. Methods differ only in UI
interaction and in which backend helper (if any) proposes the seed; the storage,
tracking contract, and rendering are shared and method-agnostic.

### 3.2 Frontend extension point

New file `frontend/src/lib/initMethods/types.ts`:

```ts
/** Canonical, method-agnostic seed for one object on one frame.
 *  Coordinates in display-% (0-100), converted to native px only at the API
 *  boundary — same convention as today's sam2Prompts + lib/coordinates. */
export interface PromptSet {
  points: Array<{ x: number; y: number; type: 'positive' | 'negative' }>;
  box?: { x: number; y: number; w: number; h: number };   // display-%
  source: string;          // init-method id, for provenance/debug/export stats
  textQuery?: string;      // e.g. DINO prompt that proposed it
}

export interface InitMethodContext {
  videoId: string;
  frame: number;
  native: { width: number; height: number };
  api: Pick<Api, 'segmentWithSAM2' | 'detectWithDINO'>;   // injected, testable
  classes: Class[]; selectedClassId?: string;
  /** Create instance+annotation from a seed (runs SAM2 preview, assigns class). */
  commit: (seed: PromptSet, classId?: string) => Promise<void>;
  /** Update an existing annotation's seed (re-runs SAM2 preview). */
  amend: (annotationId: string, seed: PromptSet) => Promise<void>;
  toast: (o: ToastOptions) => void;
}

export interface InitMethod {
  id: string;                       // 'point-prompts' | 'bbox-drag' | 'dino-text' | ...
  label: string; icon: LucideIcon; shortcut?: string;
  /** Pointer-event strategy the canvas delegates to while this method is active. */
  onCanvasEvent(e: CanvasEvent, ctx: InitMethodContext): void | Promise<void>;
  /** Optional side panel (e.g. DINO text box + proposal list). */
  Panel?: React.ComponentType<{ ctx: InitMethodContext }>;
}
```

`frontend/src/lib/initMethods/registry.ts` exports
`registerInitMethod(m: InitMethod)` + `initMethods: InitMethod[]`. The toolbox
renders one button per registered method (replacing the single "annotate" tool
mode); `VideoPlayer` keeps emitting the same normalized `CanvasEvent`
(click/drag/move with display-% coords + modifiers, its current contract at
`VideoPlayer.tsx:15`), and the page routes it to the **active method** instead of
the monolithic `handleCanvasClick`. Adding a method = one new file + one
`registerInitMethod` call — no changes to VideoPlayer, hooks, or backend routing.

Data model change (`types/annotation.ts`): `Annotation.sam2Prompts` is superseded
by `promptSet?: PromptSet` (keep `sam2Prompts` read-compatible in
`lib/projectMigration.ts`, which already exists for this purpose). `commit/amend`
live in the page/`useAnnotations` seam and always follow the same pipeline:
seed → `pctToNative` → `POST /api/ai/sam2/segment` (which already accepts multi
+/− points, ai.py:149-157) → mask/bbox preview → instance+annotation. This
single pipeline is what makes methods slap-on-proof: a method never talks to
SAM2 or state directly.

### 3.3 Backend contract (tracking)

Extend job creation (the route being ported anyway per F1) to accept per-object
grouping, mapping 1:1 onto `objects_data`:

```jsonc
POST /api/videos/{video_id}/tracking/jobs
{
  "segments": [{
    "start_frame": 100, "end_frame": 220,
    "objects": [                       // NEW, preferred
      { "object_key": "inst-123",      // opaque; echoed in results
        "positive_points": [[x,y]], "negative_points": [[x,y]],
        "box": [x1,y1,x2,y2] }         // optional, native px
    ],
    "click_prompts": [ ... ]           // legacy, kept for compat
  }]
}
```

Executor change: build `objects_data` directly from `objects` (no flattening —
fixes F4/F5), pass `negative_points` through, and echo `object_key` in per-frame
results so the frontend maps results by key instead of positional index
(`useTrackingJobs` result normalization already tolerates schema drift, so this is
additive). Single-frame `/api/ai/sam2/segment` needs **no change** for points; box
support is a small worker-task extension (or, fallback, the box is converted to a
center-positive + corner-negatives point pattern client-side until the worker is
rebuilt — keeps the UI shippable independent of F3).

### 3.4 Candidate methods

| Method | UI | Backend need | Effort | Notes |
|---|---|---|---|---|
| **A. Multi +/− clicks per object** | Ctrl/Alt-click, live mask re-preview on every prompt change | none (ai.py already takes arrays) | **S** | Finishes F6; also fixes prompt-coord convention. The current behavior becomes this method's v1. |
| **B. BBox drag** | drag rectangle → SAM2 box seed | worker box support (or point-pattern fallback) | **M** | Natural for surfers (person+board is boxy); `add_new_points_or_box` already reachable in `sail_tracking.py:167`. |
| **C. DINO text propose+confirm** | text field ("person", "surfboard", "person riding surfboard") → proposed boxes overlaid → click to confirm each into an instance (class picked from query) | none (`/api/ai/dino/detect` live; `detectWithDINO` dead code revived) | **M** | Highest leverage for bulk-seeding the surfer dataset; confirm-step keeps human in the loop. Confirmed box feeds method B's pipeline. |
| **D. Propagate-from-previous** | "continue tracking" on an instance: last tracked bbox/mask of the previous segment becomes the seed for the next | shares mechanism with F10 (multi-part propagation) | **L** | Backend must persist last-frame object state or re-derive seed from last result. Same code path later fixes auto-split part 2+. |

**Recommended sprint subset: A + C, with B if time allows.** A is nearly free and
unblocks negatives; C is the qualitatively "other way" the user asked for and
reuses B's commit path; D is the most valuable long-term but touches the
unimplemented propagation machinery (F10) — parking lot, designed-for (the
`PromptSet.source`/`object_key` contract already accommodates it).

---

## 4. Design — compound classes (surfer = person + surfboard @ IoU)

### 4.1 Where class definitions live today

`Class` is a flat frontend type (`types/annotation.ts:3-8`) held in
`useAnnotations` state `[phase2-hooks]`, persisted inside `Project`
(`types/project.ts:11`) to localStorage + backend settings blob. There is no
backend class model to migrate — the definition extends the frontend type and
project (de)serialization only.

### 4.2 Model extension

```ts
export interface CompoundRule {
  components: Array<{ classId: string; min: number; max?: number }>; // e.g. person×1, surfboard×1
  relation: 'iou' | 'containment';   // start with 'iou'
  threshold: number;                  // e.g. 0.10 — person/board overlap is small but nonzero
  boxMode: 'union';                   // future: 'primary-component'
}
export interface Class { /* existing fields */ compound?: CompoundRule; }
```

A class with `compound` set is *derived*: it never gets instances/annotations
directly; membership is evaluated from component annotations. `lib/projectMigration.ts`
gets a version bump (established pattern).

### 4.3 Evaluation point — options and recommendation

| Option | Mechanism | Pros | Cons |
|---|---|---|---|
| (a) Annotation-time instance linking | user (or IoU suggestion) explicitly links person#2+surfboard#1 into a compound *instance*; stored as `Instance.componentInstanceIds` | identity is explicit and stable across frames — survives the frames where boxes momentarily stop overlapping (wipeouts!); auditable | more UI; user effort per pairing |
| (b) Export-time rule | pure function pairs component annotations per frame by IoU at export; emits derived boxes | zero annotation friction; deterministic; no tracking change | pairing errors invisible until training; identity can flicker frame-to-frame |
| (c) Tracking-time fusion | backend merges component masks into one tracked object | one tracked entity | couples class semantics into the SAM2 worker (F3 makes this the worst place to iterate); loses component labels |

**Recommendation: (b) as the rule engine + a thin slice of (a) for identity.**
Concretely: evaluation is a **pure frontend function** `lib/compound.ts` —
`evaluateCompound(rule, annotationsOnFrame, instances): CompoundMatch[]` using
plain bbox IoU (both boxes are display-% of the same frame, so IoU is
coordinate-system-safe; masks are optional refinement later). It is consumed in
two places with identical semantics:
1. **Live overlay**: VideoPlayer draws a dashed union box + compound label when
   the rule fires on the current frame — annotators see pairing mistakes
   immediately (fits the existing overlay toggles, `Index.tsx:2251`).
2. **Export**: the YOLO exporter emits compound labels from the same function.

Because compound *instances* matter across frames (a surfer is the same surfer
during a wipeout), the frame-level match is lifted to identity by grouping
matches on the component `instanceId` pair — i.e., the (person#2, surfboard#1)
pair *is* the compound instance key, no new linking UI needed in v1; explicit
manual linking/unlinking (full option (a)) goes to the parking lot for occlusion
edge cases. This grounds cleanly in the existing model: instances already carry
cross-frame identity (§1.2), so the pair-of-instanceIds key inherits it for free.

### 4.4 YOLO export implications

- Compound classes get their own index in the class map; per matched frame emit
  `class_idx x_c y_c w h` for the union box (`%/100`, corner→center — one small
  pure function next to `lib/coordinates.ts`).
- Config flag per compound class: `emitComponents: boolean` (a surfer detector may
  or may not also want person/surfboard labels — the gimbal model likely wants
  only `surfer`).
- Frames-with-no-match need no special casing: YOLO tolerates empty label files;
  SKIP keyframes and `Scene.quality === 'bad'` ranges should be excluded (fields
  already exist, `types/annotation.ts:35-48`).
- When YOLO export later moves server-side (frame images at scale), the same rule
  is ported to Python — the pure-TS function + fixture tests are the spec.

---

## 5. Sprint backlog

Effort: S ≤ ½ day, M ≈ 1-2 days, L ≥ 3 days. "Hooks" = phase2-hooks merged (precondition, not a backlog item).

| # | Item | User value | Effort | Depends on |
|---|------|-----------|--------|------------|
| 1 | **Port tracking-job creation into `backend/app/routers/tracking.py`** (from monolith main.py:441-561) incl. the new `objects[]` contract (§3.3), and reconcile/rebuild the deployed backend image (F3 plan: diff v2-auth container source vs repo, then unpin) | tracking works at all in prod (F1) | M | — |
| 2 | **Worker strategy**: rebuild `ai-celery-worker` from repo (`windsurf-sail-dataset/windsurf/` has `track_objects_in_video` + segment helpers) or document scale-up runbook; wire negatives + `object_key` echo into `track_objects_task` (F4) | SAM2/DINO/tracking actually execute (F2); negatives honored | L | 1 |
| 3 | **Init-method registry + refactor current Ctrl/Alt-click into `point-prompts` method** (§3.2); replace `sam2Prompts` with `PromptSet` + migration | the extension point exists; zero behavior change | M | Hooks |
| 4 | **Live re-segmentation on prompt add/remove** (send full accumulated +/− set to `/api/ai/sam2/segment`, update mask preview) | multi-point init finally visible (F6); annotators can fix leaky masks on wetsuits/boards | S | 3 (2 for prod) |
| 5 | **Per-object prompt grouping through tracking** (frontend sends `objects[]` keyed by instance; results mapped by `object_key`) — fixes F5 in `useTrackingJobs` | multi-object segments track correctly | M | 1, 3 |
| 6 | **Kill hardcoded "Sail"**: SAM2-created annotations use selected class; quick class picker on commit (F8) | surfer dataset is possible at all | S | Hooks |
| 7 | **DINO text propose+confirm init method** (revive `detectWithDINO`, proposal overlay, confirm→commit pipeline) (§3.4-C) | bulk-seed persons/surfboards by text; the "another way" headline feature | M | 2, 3, 6 |
| 8 | **BBox-drag init method** (SAM2 box seed; point-pattern fallback if worker box support slips) (§3.4-B) | fast manual seeding | M | 3, 6 |
| 9 | **Compound class model + editor UI** (`CompoundRule` on Class, ClassManager dialog: pick components, threshold slider) (§4.2) | can define `surfer = person+surfboard @ IoU` | M | Hooks, 6 |
| 10 | **`lib/compound.ts` IoU pairing + live compound overlay** (§4.3) | annotators see the derived surfer box while working | M | 9 |
| 11 | **YOLO export v1** (client-side: labels zip from project annotations, class map, SKIP/bad-scene exclusion; frames via existing `GET /api/videos/{id}/frame/{n}` for keyframed subset) (§1.6, F9) | the mission's actual output artifact exists | L | Hooks |
| 12 | **Compound classes in YOLO export** (union boxes, `emitComponents` flag) | surfer labels in training data | S | 10, 11 |
| 13 | E2E smoke on prod path: seed → track → export a 10-second surfer clip; record as `docs/` runbook | proves the pipeline before dataset production starts | S | 1-12 subset |

### Cut line (~2 weeks, one developer)

**In:** 1, 2, 3, 4, 5, 6, 7, 9, 10 — unblocked infrastructure, the pluggable
abstraction with two real methods (point-prompts, DINO-text), and compound
definition + live overlay.
**Stretch:** 8 (bbox drag), 11 (YOLO export v1).
**If 11 doesn't fit:** it is the first item of the next sprint — compound overlay
(10) already de-risks the export rule, and JSON export remains as interim.

Items 1+2 are ~40% of the sprint and are not negotiable: every feature above them
is untestable in prod without the route and a worker (F1/F2), and the image-source
reconciliation (F3) is exactly the kind of work that explodes if discovered
mid-feature.

### Parking lot

- Propagate-from-previous init method + multi-part job propagation (F10, §3.4-D — same mechanism, do together).
- Explicit compound-instance linking/unlinking UI for occlusion edge cases (§4.3 option (a) full form).
- SAM2 box support in worker (if the fallback pattern shipped instead).
- Auto-classification ensemble (existing design doc `frontend/docs/AUTO_CLASSIFICATION_ARCHITECTURE.md`) — replaces the class picker in item 6 eventually.
- Server-side YOLO export job (full-video frame extraction at scale; Python port of `lib/compound.ts`).
- Backend annotation persistence (DB `annotations` table has 0 endpoints — memory `project-cache-flow-audit`), COCO export, deletion of the broken root `./windsurf/` package copy.
- Negative prompts allowed when *creating* an object (blocked at Index.tsx:1627 today; rarely needed once amend+re-segment exists).
