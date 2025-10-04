# Windsurf Pipeline App Image - Built on ML-Base-Optimized
# Adds: Source code, model weights, configuration

FROM harbor.tclab.org/windsurf/base:v1.0

LABEL org.opencontainers.image.title="Windsurf Pipeline"
LABEL org.opencontainers.image.description="# Windsurf Sail Detection Pipeline\n\n**Purpose:** Complete pipeline for windsurf sail detection and tracking\n\n**Components:**\n- **Stage 1:** Scene detection and segmentation\n- **Stage 2:** DINO detection + SAM2 tracking\n- **Analysis:** Sail orientation analysis for brand identification\n\n**Features:**\n- Facebook SAM2 video tracking with point prompting\n- Grounding DINO object detection\n- Coordinate system transformations\n- ClearML integration for K8s scaling\n\n**Usage:**\n```bash\n# Stage 1: Scene detection\npython stage1_pipeline.py --video video.mp4 --remote --queue gpu-dev\n\n# Stage 2: Clip processing  \npython main_pipeline.py --video clip.mp4\n```\n\n**Built on:** harbor.tclab.org/windsurf/base:v1.0"
LABEL org.opencontainers.image.version="v1.0"
LABEL org.opencontainers.image.created="2025-09-26"
LABEL org.opencontainers.image.vendor="Windsurf Dataset Pipeline"
LABEL org.opencontainers.image.url="harbor.tclab.org/windsurf/pipeline"

# Create directories first
RUN mkdir -p /app/weights /app/checkpoints /app/GroundingDINO /app/groundingdino /app/sam2 /app/facebook-sam2 /app/pipeline-stage2

# Copy files that exist (Docker will fail if they don't exist)
COPY src/ /app/src/
COPY pipeline-stage1/ /app/pipeline-stage1/

# Copy configuration files
COPY clearml.conf /app/clearml.conf
COPY stage1_pipeline.py /app/
COPY requirements.txt /app/

# Set environment variables for the app
ENV CLEARML_CONFIG_FILE=/app/clearml.conf
ENV PYTHONPATH=/app:/app/src:/app/pipeline-stage1:/app/pipeline-stage2
ENV CUDA_VISIBLE_DEVICES=all

# Verify everything works
RUN python -c "print('Windsurf Pipeline App Ready'); import sys; print('Python:', sys.version); import torch; print('PyTorch:', torch.__version__, 'CUDA:', torch.version.cuda); import clearml; print('ClearML:', clearml.__version__); print('All systems ready')"

# Default entrypoint for ClearML tasks
ENTRYPOINT ["python"]
CMD ["/app/stage1_pipeline.py", "--help"]