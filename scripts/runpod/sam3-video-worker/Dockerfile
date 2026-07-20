# SAM 3 VIDEO-tracking serverless worker for RunPod.
# Same base/deps as the image worker (sam3-worker), plus ffmpeg for windowed frame extraction.
# Weights download at runtime from the gated HF repo (set HF_TOKEN on the endpoint).
FROM pytorch/pytorch:2.10.0-cuda12.6-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    git libgl1 libglib2.0-0 ffmpeg \
 && rm -rf /var/lib/apt/lists/*

RUN pip install runpod pillow numpy "huggingface_hub[hf_transfer]"
RUN pip install "git+https://github.com/facebookresearch/sam3.git"
# sam3 under-declares runtime deps its code imports (same set the image worker needed).
RUN pip install einops hydra-core omegaconf opencv-python-headless pycocotools

COPY handler.py /handler.py
CMD ["python", "-u", "/handler.py"]
