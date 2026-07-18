#!/usr/bin/env bash
# Deploy the SAM3 concept-segmentation worker as a RunPod serverless endpoint.
# Custom worker image (frippe75/sam3-worker) + HF_TOKEN for gated weights + the
# all-datacenters fix (RunPod defaults to EU-only, which has no capacity).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

KEY="$(cat ~/.runpod/api_key 2>/dev/null || echo "${RUNPOD_API_KEY:-}")"
[ -n "$KEY" ] || { echo "no RUNPOD key"; exit 1; }
HF_TOKEN="${HF_TOKEN:-$(grep -hoE 'HF_TOKEN=.*' /home/frta/.secrets/projects/local-transcribe/.env 2>/dev/null | head -1 | cut -d= -f2)}"
[ -n "$HF_TOKEN" ] || { echo "no HF_TOKEN (needed for gated SAM3 weights)"; exit 1; }

IMAGE="${IMAGE:-frippe75/sam3-worker:v1}"
ENDPOINT_NAME="${ENDPOINT_NAME:-sam3}"
GPU_IDS="${GPU_IDS:-ADA_24,AMPERE_48,AMPERE_80}"   # SAM3 image mode ~10-12GB; 24GB+ is plenty
WORKERS_MIN="${WORKERS_MIN:-1}"    # keep 1 warm during eval; set 0 for scale-to-zero after
WORKERS_MAX="${WORKERS_MAX:-1}"
IDLE_TIMEOUT="${IDLE_TIMEOUT:-300}"
CONTAINER_DISK_GB="${CONTAINER_DISK_GB:-40}"   # image + HF weight download

GQL="https://api.runpod.io/graphql?api_key=${KEY}"
gql() { curl -s -X POST -H 'content-type: application/json' --url "$GQL" --data "$(jq -n --arg q "$1" '{query:$q}')"; }

# all datacenters (RunPod defaults to EU-only otherwise -> no capacity)
LOCATIONS="$(gql 'query { dataCenters { id } }' | jq -r '[.data.dataCenters[].id] | join(",")')"

TMPL="${ENDPOINT_NAME}-tmpl-$(date +%s)"
ENVLIT="{ key: \"HF_TOKEN\", value: \"$HF_TOKEN\" }, { key: \"HUGGINGFACE_HUB_TOKEN\", value: \"$HF_TOKEN\" }"
TQ="mutation { saveTemplate(input: { containerDiskInGb: $CONTAINER_DISK_GB, dockerArgs: \"\", env: [ $ENVLIT ], imageName: \"$IMAGE\", isServerless: true, name: \"$TMPL\", volumeInGb: 0 }) { id } }"
TID="$(gql "$TQ" | jq -r '.data.saveTemplate.id // empty')"
[ -n "$TID" ] || { echo "template failed: $(gql "$TQ")"; exit 1; }
echo "template=$TID"

EQ="mutation { saveEndpoint(input: { gpuIds: \"$GPU_IDS\", name: \"$ENDPOINT_NAME\", templateId: \"$TID\", workersMax: $WORKERS_MAX, workersMin: $WORKERS_MIN, idleTimeout: $IDLE_TIMEOUT, locations: \"$LOCATIONS\", scalerType: \"QUEUE_DELAY\", scalerValue: 1 }) { id name } }"
EID="$(gql "$EQ" | jq -r '.data.saveEndpoint.id // empty')"
[ -n "$EID" ] || { echo "endpoint failed: $(gql "$EQ")"; exit 1; }
jq -n --arg id "$EID" --arg img "$IMAGE" '{endpoint_id:$id, image:$img}' > "$SCRIPT_DIR/sam3-endpoint.json"
echo "SAM3 endpoint: $EID  (info -> sam3-endpoint.json)"
echo "eval:  python3 $SCRIPT_DIR/eval_clip.py $EID \"white square\""
