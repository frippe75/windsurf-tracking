# pipeline_service — FastAPI over pipeline_engine. Build from the REPO ROOT:
#   docker build -f pipeline_service/Dockerfile -t <img> .
FROM harbor.tclab.org/dockerhub/library/python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# ffmpeg for robust server-side frame extraction from presigned video URLs.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pipeline_service/requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY pipeline_engine /app/pipeline_engine
COPY pipeline_service /app/pipeline_service

# Mounted at /pipeline behind the labelbee ingress; model fleet from a ConfigMap.
ENV SERVICE_PREFIX=/pipeline \
    MODELS_YAML=/config/models.yaml

EXPOSE 8080
CMD ["uvicorn", "pipeline_service.app:app", "--host", "0.0.0.0", "--port", "8080"]
