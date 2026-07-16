# GPU worker overlay image

Overlay on the hand-built `ai-celery-worker` base (whose full ML/CUDA build
context is not in this repo). Restores real SAM2 video tracking that the base
`v2.1-prod` image had stubbed/broken. Keep this source in sync with the
deployed image tag in `kubernetes/gpu-workers.yaml`.

## Build & push (manual — not yet wired into CI)

```sh
# Harbor push robot creds live in the vault .env (HARBOR_ROBOT_USER/SECRET)
set -a; . ../../.env; set +a
echo "$HARBOR_ROBOT_SECRET" | docker login harbor.tclab.org -u "$HARBOR_ROBOT_USER" --password-stdin
docker build -t harbor.tclab.org/windsurf/ai-celery-worker:<tag> .
docker push harbor.tclab.org/windsurf/ai-celery-worker:<tag>
# then bump the image tag in kubernetes/gpu-workers.yaml
```

## What the overlay changes
- `workers/tasks/sam2.py`: un-stubs `track_objects_task` (fetch video from S3,
  run real SAM2 propagation, return per-frame bboxes + base64 masks); both tasks
  return failure payloads instead of `update_state(state='FAILURE')` (a custom
  FAILURE meta can't be decoded and poisons the queue).
- `Dockerfile`: `pip install decord boto3`, bakes the SAM2 tiny checkpoint, and
  fixes `windsurf/sail_tracking.py` (hardcoded dev checkpoint path + SAM2.1
  config vs SAM2.0 checkpoint mismatch).
