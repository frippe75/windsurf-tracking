# Overlay build: the v2-auth base carries the full ML stack (torch, SAM2, DINO —
# ~4.3GB) whose original build context is lost. We only replace the app code.
# The base was built from source newer than windsurf-sail-dataset/backend/ in
# this repo; backend/app/ is that source, recovered from the running image
# (2026-07-07) and maintained here going forward.
# Build context is the REPO ROOT (CI: docker build -f backend/Dockerfile .)
FROM harbor.tclab.org/windsurf/annotation-api:v2-auth

RUN pip install --no-cache-dir boto3 yt-dlp

# The base image ships an EMPTY /app/windsurf — upload was broken since
# v2-auth. Ship the real package; minimal __init__ avoids the heavy
# torch/sam2 import chain (backend imports submodules explicitly).
COPY windsurf-sail-dataset/windsurf /app/windsurf
RUN echo '__version__ = "1.0.0"' > /app/windsurf/__init__.py

COPY backend/app /app/app
