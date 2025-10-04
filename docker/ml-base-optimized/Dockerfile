# Multi-Stage Optimized ML Base - 2025 Stack
# Target: 6-8GB (vs 14GB single-stage)

# ====================================
# Stage 1: Builder (will be discarded)
# ====================================
FROM nvidia/cuda:12.6.0-devel-ubuntu24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies and Python 3.13
RUN apt-get update && apt-get install -y \
    software-properties-common curl \
    build-essential \
    && add-apt-repository ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y \
    python3.13 python3.13-dev python3.13-venv \
    && rm -rf /var/lib/apt/lists/*

# Install pip
RUN curl -sS https://bootstrap.pypa.io/get-pip.py | python3.13
RUN python3.13 -m pip install --upgrade pip setuptools wheel

# Set working directory
WORKDIR /build

# Copy requirements and install packages (with build artifacts)
COPY requirements.txt .
RUN python3.13 -m pip install --no-cache-dir -r requirements.txt

# Install ClearML and show where packages are installed
RUN python3.13 -m pip install --no-cache-dir clearml>=2.0.2 clearml-agent>=2.0.4
RUN python3.13 -c "import site; print('Python packages location:', site.getsitepackages())"

# ====================================
# Stage 2: Runtime (final optimized image)
# ====================================
FROM nvidia/cuda:12.6.0-runtime-ubuntu24.04 AS final

LABEL org.opencontainers.image.title="Windsurf ML Base"
LABEL org.opencontainers.image.description="# Windsurf ML Base Runtime\n\n**Purpose:** Production ML runtime environment\n\n**2025 Stack:**\n- **CUDA:** 12.6.0 runtime\n- **OS:** Ubuntu 24.04 LTS\n- **Python:** 3.13.7 (latest stable)\n- **PyTorch:** 2.5.1 with CUDA 12.6 support\n- **SAM2:** 1.1.0 (Meta Segment Anything 2)\n- **GroundingDINO:** Latest for object detection\n- **OpenCV:** 4.12.0.88 for computer vision\n- **NumPy:** 2.3.4 for numerical computing\n- **ClearML:** 2.0.2 for MLOps orchestration\n\n**Size:** 10.9GB (27% reduction from single-stage)\n\n**Usage:** Base for windsurf pipeline applications"
LABEL org.opencontainers.image.version="v1.0"
LABEL org.opencontainers.image.created="2025-09-26"
LABEL org.opencontainers.image.vendor="Windsurf Dataset Pipeline"
LABEL org.opencontainers.image.url="harbor.tclab.org/windsurf/base"

ENV DEBIAN_FRONTEND=noninteractive

# Install ONLY runtime dependencies (no build tools)
RUN apt-get update && apt-get install -y \
    software-properties-common \
    && add-apt-repository ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y \
    # Python 3.13 runtime only (no -dev packages)
    python3.13 python3.13-venv \
    # Video processing (critical for your pipeline)
    ffmpeg \
    # OpenCV runtime dependencies only
    libsm6 libxext6 libxrender-dev libglib2.0-0t64 \
    libxrandr2 libxss1 libxcursor1 libxcomposite1 \
    libasound2t64 libxi6 libxtst6 \
    # Git for ClearML repo cloning + curl for pip install
    git curl \
    # Cleanup
    && rm -rf /var/lib/apt/lists/*

# Set Python 3.13 as default
RUN ln -sf /usr/bin/python3.13 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.13 /usr/bin/python

# Install pip (lightweight)
RUN curl -sS https://bootstrap.pypa.io/get-pip.py | python3.13

# Copy ONLY the compiled packages from builder (no build artifacts)
# First check where packages were actually installed in builder
RUN python3.13 -c "import site; print('Target packages location:', site.getsitepackages())"
COPY --from=builder /usr/local/lib/python3.13/dist-packages /usr/local/lib/python3.13/dist-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Create app structure
WORKDIR /app
RUN mkdir -p /app/weights /app/checkpoints /app/models

# Verify installation works
RUN python --version && \
    python -c "import torch; print(f'PyTorch {torch.__version__} CUDA {torch.version.cuda}')" && \
    python -c "import cv2; print(f'OpenCV {cv2.__version__}')" && \
    python -c "import clearml; print(f'ClearML {clearml.__version__}')" && \
    ffmpeg -version | head -1

# Default command for testing
CMD ["python", "--version"]