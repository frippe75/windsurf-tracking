#!/bin/bash
set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Windsurf: S3 user + bucket + k8s secret"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env"
NS="windsurf-prod"
S3_UID="windsurf"
BUCKET="windsurf-videos"
S3_INTERNAL="http://rook-ceph-rgw-ceph-objectstore.rook-ceph.svc.cluster.local"
S3_PUBLIC="https://s3.tclab.org"

[[ -f "$ENV_FILE" ]] || { echo "ERROR: ${ENV_FILE} not found (vault mounted?)"; exit 1; }

# ── Dedicated S3 user (idempotent) ───────────────────────────────────────────
TOOLS=$(kubectl get pods -n rook-ceph -l app=rook-ceph-tools -o jsonpath='{.items[0].metadata.name}')
echo "Ceph tools pod: $TOOLS"

if kubectl exec -n rook-ceph "$TOOLS" -- radosgw-admin user info --uid=$S3_UID &>/dev/null; then
    echo "S3 user '$S3_UID' exists, reading credentials..."
    USER_JSON=$(kubectl exec -n rook-ceph "$TOOLS" -- radosgw-admin user info --uid=$S3_UID)
else
    echo "Creating S3 user '$S3_UID'..."
    USER_JSON=$(kubectl exec -n rook-ceph "$TOOLS" -- radosgw-admin user create \
        --uid=$S3_UID --display-name="Windsurf annotation platform" --email=windsurf@tclab.org)
fi

ACCESS_KEY=$(echo "$USER_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['keys'][0]['access_key'])")
SECRET_KEY=$(echo "$USER_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['keys'][0]['secret_key'])")
[[ -n "$ACCESS_KEY" && -n "$SECRET_KEY" ]] || { echo "ERROR: could not extract keys"; exit 1; }

# ── Bucket (idempotent) ──────────────────────────────────────────────────────
echo "Creating bucket '$BUCKET'..."
AWS_ACCESS_KEY_ID="$ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
    aws --endpoint-url "$S3_PUBLIC" s3 mb "s3://$BUCKET" 2>&1 | grep -v BucketAlreadyOwnedByYou || true
AWS_ACCESS_KEY_ID="$ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
    aws --endpoint-url "$S3_PUBLIC" s3 ls "s3://$BUCKET" >/dev/null && echo "  bucket OK"

# ── Vault .env ───────────────────────────────────────────────────────────────
if ! grep -q WINDSURF_S3_ACCESS_KEY "$ENV_FILE"; then
    cat >> "$ENV_FILE" <<EOF

# S3 (Ceph RGW) — created by 03_create-s3-storage.sh
WINDSURF_S3_ACCESS_KEY='${ACCESS_KEY}'
WINDSURF_S3_SECRET_KEY='${SECRET_KEY}'
WINDSURF_S3_BUCKET='${BUCKET}'
WINDSURF_S3_ENDPOINT='${S3_INTERNAL}'
WINDSURF_S3_PUBLIC_ENDPOINT='${S3_PUBLIC}'
EOF
    echo "  credentials appended to vault .env"
else
    echo "  vault .env already has S3 credentials"
fi

# ── K8s secret ───────────────────────────────────────────────────────────────
echo "Creating windsurf-s3-secret..."
kubectl delete secret -n $NS windsurf-s3-secret 2>/dev/null || true
kubectl create secret generic -n $NS windsurf-s3-secret \
    --from-literal=access-key="$ACCESS_KEY" \
    --from-literal=secret-key="$SECRET_KEY"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Done. Bucket: s3://$BUCKET  User: $S3_UID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
