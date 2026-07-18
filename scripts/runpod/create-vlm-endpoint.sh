#!/usr/bin/env bash
#
# Create a RunPod *serverless* endpoint that serves an OpenAI-compatible VLM, for
# pipeline_engine's `openai-compat-http` model handle (see docs/PIPELINE_ARCHITECTURE.md
# §5b). Replicates the GraphQL saveTemplate + saveEndpoint pattern from
#   frippe75/aide-poc:faas/pdf-converter/deploy/create-endpoint-only.sh
# but points at RunPod's official vLLM worker image (which exposes /openai/v1), so NO
# custom handler.py and NO Docker build are needed.
#
# The endpoint URL to give the handle is:  https://api.runpod.ai/v2/<ENDPOINT_ID>/openai/v1
#
# Auth: create a key at RunPod dashboard -> Settings -> API Keys, then store it at
#       ~/.runpod/api_key (chmod 600) — the convention used across the FaaS repos — or
#       export RUNPOD_API_KEY. NEVER commit the key.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- config (override via env or a local, git-ignored scripts/runpod/.env) -----------
[ -f "$SCRIPT_DIR/.env" ] && { set -a; . "$SCRIPT_DIR/.env"; set +a; }

# API key: prefer env, else the ~/.runpod/api_key convention (or $RUNPOD_API_KEY_FILE).
RUNPOD_API_KEY="${RUNPOD_API_KEY:-$(cat "${RUNPOD_API_KEY_FILE:-$HOME/.runpod/api_key}" 2>/dev/null || true)}"
if [ -z "${RUNPOD_API_KEY:-}" ]; then
  echo "ERROR: no RunPod API key. Set RUNPOD_API_KEY, or create one at" >&2
  echo "       https://www.runpod.io/console/user/settings and save it to ~/.runpod/api_key" >&2
  exit 1
fi

# What to serve. Defaults chosen for the sail brand/model pipeline.
ENDPOINT_NAME="${ENDPOINT_NAME:-sail-vlm}"
# RunPod's OpenAI-compatible vLLM worker. NB: there is NO 'latest' tag and the API
# validates the image at template-creation time. Find newer stable tags with:
#   curl -s 'https://hub.docker.com/v2/repositories/runpod/worker-v1-vllm/tags?page_size=100' \
#     | jq -r '.results[].name' | grep -E '^v[0-9.]+$' | sort -V | tail
VLM_IMAGE="${VLM_IMAGE:-runpod/worker-v1-vllm:v2.22.5}"
# Best OCR-strong VLM that fits one 80GB GPU (OCRBench 895, Apache-2.0). Fallback if the
# worker's vLLM can't load Qwen3-VL: Benasd/Qwen2.5-VL-72B-Instruct-AWQ (awq).
VLM_MODEL="${VLM_MODEL:-QuantTrio/Qwen3-VL-32B-Instruct-AWQ}"
VLM_QUANTIZATION="${VLM_QUANTIZATION:-awq}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-8192}"

# Serverless GPU + scaling. gpuIds are POOL ids (see the error/docs): AMPERE_16, AMPERE_24,
# ADA_24, AMPERE_48, ADA_48_PRO, AMPERE_80, ADA_80_PRO, BLACKWELL_96, HOPPER_141, ...
# 80GB pool for a 32B: AMPERE_80 (A100 80GB), with HOPPER_141 (H200) as an availability fallback.
GPU_IDS="${GPU_IDS:-AMPERE_80,HOPPER_141}"
WORKERS_MIN="${WORKERS_MIN:-0}"          # 0 = scale to zero when idle (cheapest)
WORKERS_MAX="${WORKERS_MAX:-1}"
IDLE_TIMEOUT="${IDLE_TIMEOUT:-600}"      # seconds a worker stays warm after the last request
# Ephemeral disk must hold the model download each cold start (no network volume yet):
# ~20GB for the 32B AWQ, ~40GB for the 72B fallback. See README for the network-volume TODO.
CONTAINER_DISK_GB="${CONTAINER_DISK_GB:-80}"
LOCATIONS="${LOCATIONS:-EU}"
SCALER_TYPE="${SCALER_TYPE:-QUEUE_DELAY}"
SCALER_VALUE="${SCALER_VALUE:-4}"
HF_TOKEN="${HF_TOKEN:-}"                  # only needed for gated models (InternVL3.5 is not gated)

GQL_URL="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"

gql() {  # $1 = GraphQL query text; wraps it as {"query": "..."} with jq (safe escaping)
  local body; body="$(jq -n --arg q "$1" '{query:$q}')"
  curl -s --request POST --header 'content-type: application/json' --url "$GQL_URL" --data "$body"
}

echo "=========================================="
echo "RunPod serverless VLM endpoint"
echo "  name:        $ENDPOINT_NAME"
echo "  image:       $VLM_IMAGE"
echo "  model:       $VLM_MODEL ($VLM_QUANTIZATION, max_model_len=$MAX_MODEL_LEN)"
echo "  gpu:         $GPU_IDS   workers: $WORKERS_MIN-$WORKERS_MAX   idleTimeout: ${IDLE_TIMEOUT}s"
echo "=========================================="

# --- Step 1: template -----------------------------------------------------------------
# vLLM worker is configured entirely via env vars (MODEL_NAME etc.); no dockerArgs needed.
TEMPLATE_NAME="${ENDPOINT_NAME}-tmpl-$(date +%s)"
ENV_LITERAL="{ key: \"MODEL_NAME\", value: \"$VLM_MODEL\" }, { key: \"MAX_MODEL_LEN\", value: \"$MAX_MODEL_LEN\" }, { key: \"TRUST_REMOTE_CODE\", value: \"1\" }"
[ -n "${VLM_QUANTIZATION:-}" ] && ENV_LITERAL="$ENV_LITERAL, { key: \"QUANTIZATION\", value: \"$VLM_QUANTIZATION\" }"
[ -n "$HF_TOKEN" ] && ENV_LITERAL="$ENV_LITERAL, { key: \"HF_TOKEN\", value: \"$HF_TOKEN\" }"

TEMPLATE_QUERY="mutation { saveTemplate(input: { containerDiskInGb: $CONTAINER_DISK_GB, dockerArgs: \"\", env: [ $ENV_LITERAL ], imageName: \"$VLM_IMAGE\", isServerless: true, name: \"$TEMPLATE_NAME\", volumeInGb: 0 }) { id name } }"

echo "Step 1: creating template '$TEMPLATE_NAME'..."
TEMPLATE_RESP="$(gql "$TEMPLATE_QUERY")"
TEMPLATE_ID="$(echo "$TEMPLATE_RESP" | jq -r '.data.saveTemplate.id // empty')"
if [ -z "$TEMPLATE_ID" ]; then
  echo "ERROR: template creation failed:" >&2; echo "$TEMPLATE_RESP" >&2; exit 1
fi
echo "  template id: $TEMPLATE_ID"

# --- Step 2: endpoint -----------------------------------------------------------------
# Include `locations` only when set — an empty value means "any region" (max availability).
LOC_FIELD=""
[ -n "${LOCATIONS:-}" ] && LOC_FIELD="locations: \"$LOCATIONS\", "
ENDPOINT_QUERY="mutation { saveEndpoint(input: { gpuIds: \"$GPU_IDS\", name: \"$ENDPOINT_NAME\", templateId: \"$TEMPLATE_ID\", workersMax: $WORKERS_MAX, workersMin: $WORKERS_MIN, idleTimeout: $IDLE_TIMEOUT, ${LOC_FIELD}scalerType: \"$SCALER_TYPE\", scalerValue: $SCALER_VALUE }) { id name } }"

echo "Step 2: creating endpoint '$ENDPOINT_NAME'..."
ENDPOINT_RESP="$(gql "$ENDPOINT_QUERY")"
ENDPOINT_ID="$(echo "$ENDPOINT_RESP" | jq -r '.data.saveEndpoint.id // empty')"
if [ -z "$ENDPOINT_ID" ]; then
  echo "ERROR: endpoint creation failed:" >&2; echo "$ENDPOINT_RESP" >&2; exit 1
fi

OPENAI_BASE="https://api.runpod.ai/v2/${ENDPOINT_ID}/openai/v1"
INFO="$SCRIPT_DIR/runpod-vlm-endpoint.json"
jq -n --arg tid "$TEMPLATE_ID" --arg eid "$ENDPOINT_ID" --arg base "$OPENAI_BASE" \
      --arg model "$VLM_MODEL" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{template_id:$tid, endpoint_id:$eid, openai_base_url:$base, model:$model, created_at:$ts}' > "$INFO"

cat <<EOF

==========================================
Endpoint created.
  endpoint id:      $ENDPOINT_ID
  OpenAI base_url:  $OPENAI_BASE
  info saved to:    $INFO
==========================================

Wire it into pipeline_engine (auth read from the RUNPOD_API_KEY env var at call time):

  from pipeline_engine.models import MODELS, ModelConfig
  MODELS.configure("sail-vlm", ModelConfig(   # stable logical name the pipeline references
      type="openai-compat-http",
      model_name="$VLM_MODEL",
      base_url="$OPENAI_BASE",
      auth_env="RUNPOD_API_KEY",
  ))

Smoke test:
  curl -s "$OPENAI_BASE/models" -H "Authorization: Bearer \$RUNPOD_API_KEY" | jq .
EOF
