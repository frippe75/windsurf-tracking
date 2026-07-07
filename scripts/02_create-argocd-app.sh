#!/bin/bash
set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Windsurf: create ArgoCD Application"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

REPO_URL="https://gitlab.tclab.org/frta/windsurf-tracking.git"
NS="windsurf-prod"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── GitLab token from git remote (repo is private) ───────────────────────────
REMOTE_URL=$(git -C "${PROJECT_DIR}" remote get-url origin 2>/dev/null || echo "")
GITLAB_TOKEN=$(echo "$REMOTE_URL" | sed -n 's|https://[^:]*:\([^@]*\)@.*|\1|p')
if [[ -z "$GITLAB_TOKEN" ]]; then
    echo "ERROR: Could not extract GitLab token from origin remote URL"
    exit 1
fi

echo "Creating ArgoCD repo credentials secret..."
kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: gitlab-windsurf-repo
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repository
stringData:
  url: "${REPO_URL}"
  username: "argocd"
  password: "${GITLAB_TOKEN}"
  type: "git"
EOF

# NOTE: created WITHOUT automated sync — cutover from the Helm release is
# verified manually first. Enable auto-sync afterwards with:
#   kubectl patch application windsurf -n argocd --type=merge -p \
#     '{"spec":{"syncPolicy":{"automated":{"prune":true,"selfHeal":true}}}}'
echo "Creating ArgoCD Application (manual sync)..."
kubectl apply -f - <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: windsurf
  namespace: argocd
spec:
  project: default
  source:
    repoURL: ${REPO_URL}
    targetRevision: main
    path: kubernetes
  destination:
    server: https://kubernetes.default.svc
    namespace: ${NS}
EOF

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ArgoCD app 'windsurf' created (sync is MANUAL)."
echo "  UI: https://argocd.tclab.org/applications/windsurf"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
