#!/usr/bin/env bash
# Poll an on-demand RunPod Pod's vLLM OpenAI server until ready, then OCR smoke-test it.
# Usage: warm-pod.sh <POD_ID> <MODEL_NAME>
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID="${1:?pod id}"; MODEL="${2:?model}"
BASE="https://${PID}-8000.proxy.runpod.net/v1"
DEADLINE=$(( $(date +%s) + ${DEADLINE_S:-1500} ))
echo "== pod=$PID base=$BASE model=$MODEL =="
# test image with printed brand/model
python3 - "$SCRIPT_DIR/.test-sail.b64" <<'PY'
import base64,io,sys
from PIL import Image,ImageDraw,ImageFont
img=Image.new("RGB",(640,480),(20,60,160)); d=ImageDraw.Draw(img)
def f(s):
    for p in ("/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf","/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try:return ImageFont.truetype(p,s)
        except:pass
    return ImageFont.load_default()
d.text((60,120),"DUOTONE",fill="white",font=f(90)); d.text((70,240),"Warp",fill=(255,220,0),font=f(70)); d.text((70,330),"5.4",fill="white",font=f(60))
b=io.BytesIO(); img.save(b,"PNG"); open(sys.argv[1],"w").write(base64.b64encode(b.getvalue()).decode())
PY
IMG=$(cat "$SCRIPT_DIR/.test-sail.b64")
echo "-- waiting for vLLM /models --"
until curl -s --max-time 10 "$BASE/models" | grep -q '"id"'; do
  [ "$(date +%s)" -ge "$DEADLINE" ] && { echo "TIMED_OUT"; exit 2; }
  echo "  $(date +%T) not ready yet"; sleep 20
done
echo ">>> vLLM READY: $(curl -s "$BASE/models" | jq -c '.data[].id' 2>/dev/null)"
echo "-- OCR + json_schema completion --"
SCHEMA='{"type":"object","properties":{"brand":{"type":"string"},"model":{"type":"string"},"size_m2":{"type":["number","null"]}},"required":["brand","model"]}'
P=$(jq -n --arg m "$MODEL" --arg img "data:image/png;base64,$IMG" --argjson s "$SCHEMA" '{model:$m,max_tokens:200,temperature:0,messages:[{role:"user",content:[{type:"text",text:"Read the sail. Extract brand, model, size_m2 as JSON from what is printed."},{type:"image_url",image_url:{url:$img}}]}],response_format:{type:"json_schema",json_schema:{name:"sail",schema:$s,strict:true}}}')
curl -s --max-time 120 "$BASE/chat/completions" -H 'Content-Type: application/json' -d "$P" | tee "$SCRIPT_DIR/.pod-smoke.json" | jq -r '.choices[0].message.content // (.|tostring)[0:600]'
echo "-- done --"
