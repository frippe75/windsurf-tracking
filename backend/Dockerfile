# Overlay build: the :base image carries the full ML stack (torch, SAM2, DINO —
# ~4.3GB) whose original build context is lost. We only replace the app code.
# `:base` replaced the old `:v2-auth` base (which was deleted from Harbor on
# 2026-07-17); it was bootstrapped from the last-good self-built image and is the
# immutable ML-stack base going forward.
# Build context is the REPO ROOT (CI: docker build -f backend/Dockerfile .)
FROM harbor.tclab.org/windsurf/annotation-api:base

RUN pip install --no-cache-dir boto3 yt-dlp

# The base image ships an EMPTY /app/windsurf — upload was broken since
# v2-auth. Ship the real package; minimal __init__ avoids the heavy
# torch/sam2 import chain (backend imports submodules explicitly).
COPY windsurf-sail-dataset/windsurf /app/windsurf
RUN echo '__version__ = "1.0.0"' > /app/windsurf/__init__.py

COPY backend/app /app/app

# Surfaced by GET / and the OpenAPI version; CI passes the commit sha
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
