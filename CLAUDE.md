# windsurf-tracking — AI image/video annotation platform

Annotation platform (SAM2 + DINO assisted) producing YOLO datasets. Part of the
surf/windsurf tracking mission — see `~/projects/tracking/CLAUDE.md` for the
umbrella context (tracking-models repo, gimbal app).

## Production deployment (GitOps since 2026-07-07)

- **App**: https://labelbee.tclab.org (frontend SPA; `/api` + `/auth` same-origin to backend).
  **API**: https://windsurf-api.tclab.org (existing contract for ClearML/scripts).
- k8s namespace `windsurf-prod`, managed by **ArgoCD app `windsurf`** from `kubernetes/`
  (kustomize) in this repo. Auto-sync + prune + selfHeal. The old Helm release is gone.
- **Git**: origin = gitlab.tclab.org/frta/windsurf-tracking (CI); push-mirrors to
  github.com/frippe75/windsurf-tracking. GitLab CI builds `frontend/` →
  `harbor.tclab.org/windsurf/frontend:<sha>` and bumps `kubernetes/kustomization.yaml`.
- ⚠️ **backend image `annotation-api:v2-auth` is PINNED** — built from source newer than
  this repo (has JWT auth; `backend/main.py` here has none). Never rebuild it from this repo.
  Note `/api/*` routes are effectively unauthenticated (only `/auth/*` exists).
- Secrets: `.env` symlink → gocryptfs vault (lab-dev-secrets pattern); k8s secrets created
  by `scripts/01_create-secrets.sh` (DB password + JWT rotated from placeholders 2026-07-07).
- `gpu-worker-0/1` at 0 replicas; heavy processing offloads to ClearML (20×T4 cluster).
  cpu-worker + video-storage PVC removed at migration (broken since forever).
- Details: `docs/DEPLOYMENT.md`

## Repo map

- `frontend/` — React/Vite/shadcn UI (Lovable-generated). Key: `VideoPlayer.tsx`
  (canvas, clicks, overlays), `pages/Index.tsx` (~2000-line orchestrator),
  `lib/api.ts` (mock/real switch via `VITE_USE_MOCK_API`), `types/annotation.ts`
- `windsurf-sail-dataset/backend/` — FastAPI: video upload, DINO detect, SAM2 segment,
  tracking jobs, exports
- `windsurf-sail-dataset/windsurf/` — pipeline lib: `coordinate_transform.py`,
  `resolution_manager.py`, `sail_tracking.py`, `ai_models.py`, `grounding_dino.py`
- ⚠️ **Two diverged copies** of the `windsurf/` package: repo root `./windsurf/` and
  `./windsurf-sail-dataset/windsurf/`. Consolidation needed; check both when editing.
- Backend README references `docs/FastAPI_Routes_Planning.md` — does not exist in repo.

## Coordinate systems (the aspect-ratio problem area)

Four systems in play:

1. **Frontend canvas %** — annotations stored as 0–100% of the *displayed* video rect
   (object-contain, same aspect as native). See `VideoPlayer.tsx` (`getDisplayedRect`,
   `screenToCanvas`).
2. **Native video pixels** — backend contract: "Click prompts must use native video
   resolution coordinates" (`GET /videos/{id}` documents this). Frontend converts
   pct→native at `Index.tsx:819` (`(x/100) * videoNativeWidth`).
3. **Standardized target frame** — `resolution_manager.py` letterboxes ANY frame to
   TARGET_WIDTH×TARGET_HEIGHT (default 1280×720) with centered black padding.
4. **SAM2 1024×1024** — SAM2 pads to square internally; `coordinate_transform.py`
   (`CoordinateTransformer`) compensates for that padding.

**Known-fragile seam (audit pending):** native ↔ standardized (2↔3). On non-16:9
video, masks/bboxes computed on the letterboxed 1280×720 frame carry the padding
offset relative to native coords. Scar tissue: `Index.tsx:1447-1468` — `maskIsCropped`
heuristic and `maskWidth || videoNativeWidth || 1280` fallbacks. Also
`CoordinateTransformer` has hardcoded defaults `video_size=(640,360)`, and it is
unverified whether the backend transforms incoming native click coords into
padded-target space before SAM2 in all paths.

## Machine quirk

GitHub SSH auth fails on this laptop — use HTTPS with `gh auth token` for push/pull.
