# Overlay on the existing GPU worker image (build context/ML stack lives only
# in the base). Restores real SAM2 video tracking:
#   1. missing runtime deps (decord video reader, boto3 for S3 video fetch)
#   2. un-stubbed workers.tasks.sam2.track_objects_task
#   3. fix the video tracker's hardcoded dev checkpoint path + SAM2.0/2.1
#      config-vs-checkpoint mismatch (tiny)
FROM harbor.tclab.org/windsurf/ai-celery-worker:v2.1-prod

RUN pip install --no-cache-dir decord boto3

# Bake the SAM2 tiny checkpoint into the image. The base image downloaded it at
# RUNTIME (from_pretrained), so a fresh pod lacks it — and the video tracker
# loads the checkpoint by explicit path (no auto-download). Pre-fetch so tracking
# works on a cold pod.
RUN python -c "from huggingface_hub import hf_hub_download; hf_hub_download('facebook/sam2-hiera-tiny','sam2_hiera_tiny.pt')"

COPY workers/tasks/sam2.py /app/workers/tasks/sam2.py

RUN python - <<'PY'
f = '/app/windsurf/sail_tracking.py'
s = open(f).read()
before = s
# 1) checkpoint: hardcoded laptop path -> the checkpoint actually shipped in the
#    image (HuggingFace cache; snapshot hash resolved at runtime via glob)
s = s.replace(
    '"tiny": "/home/frta/windsurf-sail-dataset/facebook-sam2/checkpoints/sam2.1_hiera_tiny.pt"',
    '"tiny": (__import__("glob").glob("/root/.cache/huggingface/hub/models--facebook--sam2-hiera-tiny/snapshots/*/sam2_hiera_tiny.pt") or ["/root/.cache/huggingface/hub/models--facebook--sam2-hiera-tiny/snapshots/missing/sam2_hiera_tiny.pt"])[0]',
)
# 2) config must match the SAM2.0 checkpoint that ships in the image
s = s.replace(
    '"tiny": "configs/sam2.1/sam2.1_hiera_t.yaml"',
    '"tiny": "configs/sam2/sam2_hiera_t.yaml"',
)
assert s != before, "sail_tracking.py patch matched nothing"
assert 'sam2_hiera_tiny.pt")' in s, "checkpoint patch not applied"
assert '"tiny": "configs/sam2/sam2_hiera_t.yaml"' in s, "config patch not applied"
open(f, 'w').write(s)
print("patched sail_tracking.py OK")
PY
