#!/bin/bash
set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Windsurf: create/rotate K8s secrets"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env"
NS="windsurf-prod"

# ── Load .env (vault symlink — see lab-dev-secrets pattern) ──────────────────
if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: ${ENV_FILE} not found (is the secrets vault mounted?)"
    exit 1
fi
set -a; source "$ENV_FILE"; set +a

for var in WINDSURF_DB_USER WINDSURF_DB_PASSWORD WINDSURF_DB_NAME WINDSURF_DB_HOST WINDSURF_DB_PORT JWT_SECRET_KEY; do
    [[ -n "${!var:-}" ]] || { echo "ERROR: $var not set in ${ENV_FILE}"; exit 1; }
done

DATABASE_URL="postgresql://${WINDSURF_DB_USER}:${WINDSURF_DB_PASSWORD}@${WINDSURF_DB_HOST}:${WINDSURF_DB_PORT}/${WINDSURF_DB_NAME}"

# ── Rotate the actual postgres user password (idempotent) ────────────────────
echo "Rotating postgres user password..."
kubectl exec -n ${NS} windsurf-prod-postgres-0 -- \
    psql -U "${WINDSURF_DB_USER}" -d "${WINDSURF_DB_NAME}" \
    -c "ALTER USER ${WINDSURF_DB_USER} WITH PASSWORD '${WINDSURF_DB_PASSWORD}';" >/dev/null
echo "  postgres password updated"

# ── Backend secret (DATABASE_URL + JWT) ──────────────────────────────────────
echo "Creating windsurf-backend-secret..."
kubectl delete secret -n ${NS} windsurf-backend-secret 2>/dev/null || true
kubectl create secret generic -n ${NS} windsurf-backend-secret \
    --from-literal=database-url="${DATABASE_URL}" \
    --from-literal=jwt-secret-key="${JWT_SECRET_KEY}"
echo "  windsurf-backend-secret created"

# ── Postgres secret (used by StatefulSet POSTGRES_PASSWORD) ──────────────────
echo "Updating windsurf-prod-postgres-secret..."
kubectl delete secret -n ${NS} windsurf-prod-postgres-secret 2>/dev/null || true
kubectl create secret generic -n ${NS} windsurf-prod-postgres-secret \
    --from-literal=password="${WINDSURF_DB_PASSWORD}"
echo "  windsurf-prod-postgres-secret updated"

# ── One-time migration: switch backend env from inline values to secretKeyRef ─
# (strategic merge can't replace `value` with `valueFrom`, so patch explicitly;
#  once the live spec matches git, ArgoCD syncs cleanly)
echo "Patching backend deployment env to secretKeyRef..."
DB_IDX=$(kubectl get deploy -n ${NS} windsurf-prod-backend -o json | python3 -c "
import json,sys
env=json.load(sys.stdin)['spec']['template']['spec']['containers'][0]['env']
print(next(i for i,e in enumerate(env) if e['name']=='DATABASE_URL'))")
JWT_IDX=$(kubectl get deploy -n ${NS} windsurf-prod-backend -o json | python3 -c "
import json,sys
env=json.load(sys.stdin)['spec']['template']['spec']['containers'][0]['env']
print(next(i for i,e in enumerate(env) if e['name']=='JWT_SECRET_KEY'))")

kubectl patch deploy -n ${NS} windsurf-prod-backend --type=json -p "[
  {\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/env/${DB_IDX}\",
   \"value\":{\"name\":\"DATABASE_URL\",\"valueFrom\":{\"secretKeyRef\":{\"name\":\"windsurf-backend-secret\",\"key\":\"database-url\"}}}},
  {\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/env/${JWT_IDX}\",
   \"value\":{\"name\":\"JWT_SECRET_KEY\",\"valueFrom\":{\"secretKeyRef\":{\"name\":\"windsurf-backend-secret\",\"key\":\"jwt-secret-key\"}}}}
]"

echo "Waiting for backend rollout..."
kubectl rollout status -n ${NS} deploy/windsurf-prod-backend --timeout=180s

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Done. Secrets rotated, backend on secretKeyRef."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
