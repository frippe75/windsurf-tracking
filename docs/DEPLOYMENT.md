# Deployment — windsurf annotation platform (labelbee)

Deployed 2026-07-07, migrated from Helm release `windsurf-prod` (chart `windsurf-ai-2.0.0`)
to GitOps.

## Architecture

```
GitLab (frta/windsurf-tracking) ──push-mirror──> GitHub (frippe75/windsurf-tracking)
   │
   ├─ CI: build frontend/ ──> harbor.tclab.org/windsurf/frontend:<sha>
   │      then yq-bump kubernetes/kustomization.yaml [skip ci]
   │
   └─ ArgoCD app "windsurf" ── kubernetes/ (kustomize) ──> ns windsurf-prod
        auto-sync + prune + selfHeal
```

## URLs

| URL | Serves |
|-----|--------|
| https://labelbee.tclab.org | Frontend SPA; `/api` + `/auth` path-routed to backend (same-origin — deployed backend CORS only allows lovable.app/localhost) |
| https://windsurf-api.tclab.org | Backend API direct (existing contract: ClearML, scripts) |
| https://argocd.tclab.org/applications/windsurf | GitOps status |

DNS: labelbee.tclab.org auto-managed by external-dns (Cloudflare provider) from the
ingress annotation. A stale manual A record (185.158.133.1, created 2025-10-01) was
deleted from Cloudflare on 2026-07-07 to let external-dns take ownership.

## Workloads (ns windsurf-prod)

- `windsurf-prod-backend` — `harbor.tclab.org/windsurf/annotation-api:v2-auth` **PINNED**:
  image built from source newer than this repo (has JWT auth; repo `backend/main.py` does
  not). Do NOT point CI at it until source is reconciled.
- `windsurf-prod-frontend` — nginx + Vite build, CI-managed tag
- `windsurf-prod-postgres` — StatefulSet, postgres:16 (Harbor proxy cache), PVC `postgres-storage-...` (ceph-block, 50Gi)
- `windsurf-prod-redis` — redis:7-alpine (Harbor proxy cache)
- `windsurf-prod-gpu-worker-0/1` — replicas 0 (processing offloaded to ClearML)
- Removed at migration: `cpu-worker` (CrashLooping 272d), `windsurf-prod-config` ConfigMap
  (held plaintext DB password, unused), `windsurf-prod-video-storage` PVC (Pending 273d,
  `longhorn` StorageClass never existed here, mounted by nothing)

## Secrets (lab-dev-secrets pattern)

`.env` → symlink to gocryptfs vault (`~/.secrets/projects/windsurf-tracking/.env`).
Keys: `HARBOR_ROBOT_USER/SECRET` (robot$windsurf-ci, Harbor robot id 15162),
`WINDSURF_DB_*`, `JWT_SECRET_KEY`. DB password and JWT secret were **rotated from
chart placeholders** on 2026-07-07.

K8s secrets (created by `scripts/01_create-secrets.sh`, NOT in git):
- `windsurf-backend-secret` — database-url, jwt-secret-key
- `windsurf-prod-postgres-secret` — password

GitLab CI vars: `HARBOR_USERNAME`, `HARBOR_PASSWORD`, `GITLAB_PUSH_TOKEN`.

## Scripts

- `scripts/01_create-secrets.sh` — rotate postgres password (ALTER USER) + recreate both
  k8s secrets + one-time env→secretKeyRef migration patch
- `scripts/02_create-argocd-app.sh` — ArgoCD repo credential + Application (manual sync;
  auto-sync enabled post-verification)

## Known issues / caveats

- **`/api/*` is effectively unauthenticated** — backend has `/auth/*` JWT endpoints but
  does not enforce auth on API routes (verified 2026-07-07: `GET /api/videos` → 200 anon).
- Backend uploads live in the pod filesystem (no PVC mounted) — videos do NOT survive a
  pod restart; DB restore scans `uploads/` at startup which is ephemeral.
- Backend source for `annotation-api:v2-auth` is not in this repo.
- Two diverged `windsurf/` python packages in repo; root copy has broken imports (see CLAUDE.md).
