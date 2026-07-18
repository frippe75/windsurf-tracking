#!/usr/bin/env bash
#
# Deploy an on-demand RunPod **Pod** running vLLM's OpenAI-compatible server for a VLM.
# Use this when serverless (create-vlm-endpoint.sh) can't get a GPU — on-demand Pods draw
# from a separate, usually larger capacity pool. A Pod is always-on (no scale-to-zero), so
# STOP it when idle to control cost.
#
# The pod exposes vLLM at:  https://<POD_ID>-8000.proxy.runpod.net/v1   (OpenAI-compatible,
# no auth by default). Wire it into the engine with:
#   MODELS.configure("sail-vlm", ModelConfig(type="openai-compat-http",
#       model_name="$VLM_MODEL", base_url="https://<POD_ID>-8000.proxy.runpod.net/v1"))
# (no auth_env needed — the proxy URL is unauthenticated; keep it secret or add vLLM auth).
#
# Auth for the RunPod API: ~/.runpod/api_key (or $RUNPOD_API_KEY).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/.env" ] && { set -a; . "$SCRIPT_DIR/.env"; set +a; }
KEY="${RUNPOD_API_KEY:-$(cat "${RUNPOD_API_KEY_FILE:-$HOME/.runpod/api_key}" 2>/dev/null || true)}"
[ -n "${KEY:-}" ] || { echo "no RUNPOD_API_KEY / ~/.runpod/api_key" >&2; exit 1; }

POD_NAME="${POD_NAME:-sail-vlm-pod}"
POD_IMAGE="${POD_IMAGE:-vllm/vllm-openai:latest}"   # recent vLLM (>=0.11 for Qwen3-VL)
VLM_MODEL="${VLM_MODEL:-Qwen/Qwen3-VL-8B-Instruct}" # OCRBench 896; A40 48GB fits fp16 easily
# On A40 48GB you can also run the 32B: VLM_MODEL=QuantTrio/Qwen3-VL-32B-Instruct-AWQ + add
# "--quantization awq" to VLM_ARGS.
MAX_MODEL_LEN="${MAX_MODEL_LEN:-8192}"
GPU_TYPE="${GPU_TYPE:-NVIDIA A40}"                  # 48GB, usually High stock. See stock with:
#   gpuTypes { id memoryInGb lowestPrice(input:{gpuCount:1}){ stockStatus } }
CONTAINER_DISK_GB="${CONTAINER_DISK_GB:-60}"
VLM_ARGS="${VLM_ARGS:---model $VLM_MODEL --max-model-len $MAX_MODEL_LEN --trust-remote-code --host 0.0.0.0 --port 8000 --gpu-memory-utilization 0.9}"

gql() { curl -s --request POST --header 'content-type: application/json' \
  --url "https://api.runpod.io/graphql?api_key=${KEY}" --data "$(jq -n --arg q "$1" '{query:$q}')"; }

Q="mutation { podFindAndDeployOnDemand(input: { cloudType: ALL, gpuTypeId: \"$GPU_TYPE\", gpuCount: 1, name: \"$POD_NAME\", imageName: \"$POD_IMAGE\", containerDiskInGb: $CONTAINER_DISK_GB, volumeInGb: 0, ports: \"8000/http\", dockerArgs: \"$VLM_ARGS\" }) { id machineId } }"
RESP="$(gql "$Q")"
PID="$(echo "$RESP" | jq -r '.data.podFindAndDeployOnDemand.id // empty')"
[ -n "$PID" ] || { echo "ERROR: pod deploy failed:" >&2; echo "$RESP" >&2; exit 1; }

BASE="https://${PID}-8000.proxy.runpod.net/v1"
jq -n --arg id "$PID" --arg base "$BASE" --arg model "$VLM_MODEL" \
  '{pod_id:$id, openai_base_url:$base, model:$model}' > "$SCRIPT_DIR/runpod-vlm-pod.json"
cat <<EOF

Pod deployed: $PID  (GPU: $GPU_TYPE, model: $VLM_MODEL)
OpenAI base_url: $BASE
Validate when vLLM finishes loading (~5-10 min):
  ./scripts/runpod/warm-pod.sh $PID $VLM_MODEL
Stop it when idle (it bills continuously):
  # GraphQL: mutation { podStop(input:{podId:"$PID"}) { id } }
EOF
