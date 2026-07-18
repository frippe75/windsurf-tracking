# SAM 3 concept-segmentation serverless worker for RunPod.
# Weights are downloaded at runtime from the gated HF repo (set HF_TOKEN on the endpoint),
# so the image stays lean. For production, bake weights or attach a network volume to
# avoid re-downloading on every scale-from-zero cold start.
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
# sam3's pyproject under-declares runtime deps its code imports (einops, hydra config,
# cv2, ...). Install them explicitly so `import sam3.model_builder` works.
RUN pip install einops hydra-core omegaconf opencv-python-headless pycocotools

COPY handler.py /handler.py
CMD ["python", "-u", "/handler.py"]
