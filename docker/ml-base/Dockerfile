# Windsurf ML Base Image - 2025 Latest Stack
# CUDA 12.6.0 + Ubuntu 24.04 + Python 3.13 + PyTorch 2.5.1 + SAM2 + ClearML

FROM nvidia/cuda:12.6.0-runtime-ubuntu24.04

LABEL maintainer="Windsurf ML Base 2025"
LABEL description="ML base image with CUDA 12.6, Python 3.13, PyTorch 2.5.1, SAM2, ClearML"

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

# STOP HERE - ML BASE COMPLETE
# No COPY commands, no app-specific code, no ENTRYPOINT

# Default command for testing
CMD ["python", "--version"]