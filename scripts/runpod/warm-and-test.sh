#!/usr/bin/env bash
#
# Warm a RunPod serverless VLM endpoint (cold-start) and smoke-test it end to end:
#   1) poll /health until a worker is ready (or a job completes),
#   2) text-only chat completion (confirms the model serves),
#   3) image + json_schema completion against a generated "sail" image with printed
#      brand/model text (confirms OCR -> structured JSON works).
#
# Usage: ./warm-and-test.sh <ENDPOINT_ID> <MODEL_NAME>
#   (defaults read from runpod-vlm-endpoint.json if present)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFO="$SCRIPT_DIR/runpod-vlm-endpoint.json"
KEY="$(cat ~/.runpod/api_key 2>/dev/null || echo "${RUNPOD_API_KEY:-}")"
[ -n "$KEY" ] || { echo "no RUNPOD_API_KEY / ~/.runpod/api_key"; exit 1; }

EID="${1:-$(jq -r '.endpoint_id // empty' "$INFO" 2>/dev/null)}"
MODEL="${2:-$(jq -r '.model // empty' "$INFO" 2>/dev/null)}"
[ -n "$EID" ] && [ -n "$MODEL" ] || { echo "need <endpoint_id> <model_name>"; exit 1; }

BASE="https://api.runpod.ai/v2/$EID"
OAI="$BASE/openai/v1"
AUTH=(-H "Authorization: Bearer $KEY" -H "Content-Type: application/json")
DEADLINE=$(( $(date +%s) + ${WARM_DEADLINE_S:-1500} ))   # cold-start budget (override via env)

echo "== endpoint=$EID model=$MODEL =="

# --- generate a test "sail" image with printed brand/model text --------------------
IMG_B64_FILE="$SCRIPT_DIR/.test-sail.b64"
python3 - "$IMG_B64_FILE" <<'PY'
import base64, io, sys
from PIL import Image, ImageDraw, ImageFont
img = Image.new("RGB", (640, 480), (20, 60, 160))  # blue "sail"
d = ImageDraw.Draw(img)
def font(sz):
    for p in ("/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try: return ImageFont.truetype(p, sz)
        except Exception: pass
    return ImageFont.load_default()
d.text((60, 120), "DUOTONE", fill="white", font=font(90))
d.text((70, 240), "Warp", fill=(255,220,0), font=font(70))
d.text((70, 330), "5.4", fill="white", font=font(60))
buf = io.BytesIO(); img.save(buf, "PNG")
open(sys.argv[1], "w").write(base64.b64encode(buf.getvalue()).decode())
print("test image generated")
PY
IMG_B64="$(cat "$IMG_B64_FILE")"

# --- 1) poll health while warming --------------------------------------------------
warm_ping() { curl -s --max-time 10 "${AUTH[@]}" "$OAI/models" >/dev/null 2>&1 || true; }
echo "-- warming (polling /health) --"
STATE="timeout"
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  H="$(curl -s --max-time 15 "${AUTH[@]}" "$BASE/health" 2>/dev/null)"
  ready="$(echo "$H" | jq -r '.workers.ready // 0' 2>/dev/null)"
  init="$(echo "$H" | jq -r '.workers.initializing // 0' 2>/dev/null)"
  run="$(echo "$H" | jq -r '.workers.running // 0' 2>/dev/null)"
  unhealthy="$(echo "$H" | jq -r '.workers.unhealthy // 0' 2>/dev/null)"
  failed="$(echo "$H" | jq -r '.jobs.failed // 0' 2>/dev/null)"
  echo "  $(date +%T) workers ready=$ready init=$init running=$run unhealthy=$unhealthy  jobs=$(echo "$H" | jq -c '.jobs' 2>/dev/null)"
  if [ "${ready:-0}" -ge 1 ] || [ "${run:-0}" -ge 1 ]; then STATE="ready"; break; fi
  if [ "${unhealthy:-0}" -ge 1 ] || [ "${failed:-0}" -ge 1 ]; then STATE="loadfail"; break; fi
  warm_ping   # a queued request nudges the scaler to spin a worker
  sleep 20
done
if [ "$STATE" = "loadfail" ]; then
  echo "LOAD_FAILED: worker went unhealthy or a job failed (likely model/quant/vLLM incompatibility)."
  exit 3
fi
if [ "$STATE" = "timeout" ]; then
  echo "TIMED_OUT waiting for a ready worker."
  exit 2
fi

# --- 2) text-only completion -------------------------------------------------------
echo "-- text completion --"
TXT_PAYLOAD="$(jq -n --arg m "$MODEL" '{model:$m, max_tokens:32, temperature:0,
  messages:[{role:"user",content:"Reply with exactly: OK"}]}')"
curl -s --max-time 300 "${AUTH[@]}" "$OAI/chat/completions" -d "$TXT_PAYLOAD" \
  | tee "$SCRIPT_DIR/.smoke-text.json" | jq -r '.choices[0].message.content // (.|tostring)[0:400]' 2>/dev/null

# --- 3) image + json_schema completion ---------------------------------------------
echo "-- image + json_schema completion --"
SCHEMA='{"type":"object","properties":{"brand":{"type":"string"},"model":{"type":"string"},"size_m2":{"type":["number","null"]}},"required":["brand","model"]}'
IMG_PAYLOAD="$(jq -n --arg m "$MODEL" --arg img "data:image/png;base64,$IMG_B64" --argjson schema "$SCHEMA" '{
  model:$m, max_tokens:200, temperature:0,
  messages:[{role:"user",content:[
    {type:"text",text:"Read the sail. Extract brand, model, size_m2 as JSON. Use what is printed."},
    {type:"image_url",image_url:{url:$img}}]}],
  response_format:{type:"json_schema",json_schema:{name:"sail",schema:$schema,strict:true}}}')"
curl -s --max-time 300 "${AUTH[@]}" "$OAI/chat/completions" -d "$IMG_PAYLOAD" \
  | tee "$SCRIPT_DIR/.smoke-image.json" | jq -r '.choices[0].message.content // (.|tostring)[0:600]' 2>/dev/null

echo "-- done --"
