#!/usr/bin/env bash
# Deploy the SAM3 VIDEO-tracking worker as a RunPod serverless endpoint.
# Mirrors deploy-sam3.sh: custom image + HF_TOKEN + the all-datacenters fix
# (RunPod defaults to EU-only, which has no 24GB+ capacity).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

KEY="$(cat ~/.runpod/api_key 2>/dev/null || echo "${RUNPOD_API_KEY:-}")"
[ -n "$KEY" ] || { echo "no RUNPOD key"; exit 1; }
HF_TOKEN="${HF_TOKEN:-$(grep -hoE 'HF_TOKEN=.*' /home/frta/.secrets/projects/local-transcribe/.env 2>/dev/null | head -1 | cut -d= -f2)}"
[ -n "$HF_TOKEN" ] || { echo "no HF_TOKEN (needed for gated SAM3 weights)"; exit 1; }

IMAGE="${IMAGE:-frippe75/sam3-video-worker:v1}"
ENDPOINT_NAME="${ENDPOINT_NAME:-labelbee-sam3-video}"
GPU_IDS="${GPU_IDS:-ADA_24,AMPERE_48,AMPERE_80}"   # video predictor holds the window -> 24GB+
WORKERS_MIN="${WORKERS_MIN:-0}"
WORKERS_MAX="${WORKERS_MAX:-1}"
IDLE_TIMEOUT="${IDLE_TIMEOUT:-900}"
CONTAINER_DISK_GB="${CONTAINER_DISK_GB:-40}"

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
jq -n --arg id "$EID" --arg img "$IMAGE" '{endpoint_id:$id, image:$img}' > "$SCRIPT_DIR/sam3-video-endpoint.json"
echo "SAM3-VIDEO endpoint: $EID  (info -> sam3-video-endpoint.json)"
