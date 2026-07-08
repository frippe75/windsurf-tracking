# Overlay build: the v2-auth base carries the full ML stack (torch, SAM2, DINO —
# ~4.3GB) whose original build context is lost. We only replace the app code.
# The base was built from source newer than windsurf-sail-dataset/backend/ in
# this repo; backend/app/ is that source, recovered from the running image
# (2026-07-07) and maintained here going forward.
FROM harbor.tclab.org/windsurf/annotation-api:v2-auth

RUN pip install --no-cache-dir boto3

COPY app /app/app
