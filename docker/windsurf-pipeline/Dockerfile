# Windsurf Sail Detection Pipeline Docker Image - 2025 Latest Stack
# CUDA 12.4 + Ubuntu 24.04 + Python 3.13 + PyTorch 2.5.1

FROM nvidia/cuda:12.6.0-runtime-ubuntu24.04

LABEL maintainer="Windsurf Sail Dataset Pipeline"
LABEL description="ClearML worker image with SAM2, GroundingDINO, and video processing tools"

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# Install system dependencies including Python 3.13
RUN apt-get update && apt-get install -y \
    # Essential tools
    software-properties-common \
    # Add deadsnakes PPA for Python 3.13
    && add-apt-repository ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y \
    # Python 3.13 (latest 2025)
    python3.13 python3.13-dev python3.13-venv \
    # Video processing
    ffmpeg \
    # OpenCV system dependencies  
    libsm6 libxext6 libxrender-dev libglib2.0-0t64 \
    libxrandr2 libxss1 libxcursor1 libxcomposite1 \
    libasound2t64 libxi6 libxtst6 \
    # Git for repository cloning
    git git-lfs \
    # System utilities
    wget curl unzip \
    # Cleanup
    && rm -rf /var/lib/apt/lists/*

# Set Python 3.13 as default python
RUN ln -sf /usr/bin/python3.13 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.13 /usr/bin/python

# Install and upgrade pip for Python 3.13
RUN python3.13 -m ensurepip --upgrade
RUN python3.13 -m pip install --upgrade pip setuptools wheel

# Create app directory
WORKDIR /app

# Copy requirements first (for Docker layer caching)
COPY requirements.txt .

# Install Python packages with Python 3.13
RUN python3.13 -m pip install --no-cache-dir -r requirements.txt

# Install additional ClearML packages
RUN python3.13 -m pip install --no-cache-dir \
    clearml>=2.0.2 \
    clearml-agent>=2.0.4

# Create directories for models and weights
RUN mkdir -p /app/weights /app/checkpoints /app/models

# Copy model weights and checkpoints
COPY weights/ /app/weights/
COPY checkpoints/ /app/checkpoints/

# Copy GroundingDINO config and models
COPY GroundingDINO/ /app/GroundingDINO/
COPY groundingdino/ /app/groundingdino/

# Copy SAM2 models  
COPY sam2/ /app/sam2/
COPY facebook-sam2/ /app/facebook-sam2/

# Copy source code
COPY src/ /app/src/
COPY pipeline-stage1/ /app/pipeline-stage1/
COPY pipeline-stage2/ /app/pipeline-stage2/

# Copy configuration files
COPY clearml.conf /app/clearml.conf

# Set environment variables
ENV CLEARML_CONFIG_FILE=/app/clearml.conf
ENV PYTHONPATH=/app:/app/src:/app/pipeline-stage1:/app/pipeline-stage2
ENV CUDA_VISIBLE_DEVICES=all

# Create working directories for ClearML agent
RUN mkdir -p /tmp/clearml-agent /tmp/clearml-cache

# Set permissions
RUN chmod -R 755 /app

# Default command (will be overridden by ClearML)
CMD ["python", "-c", "print('Windsurf Pipeline Docker Image Ready')"]