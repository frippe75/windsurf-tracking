# YOLO training job image — run as a k8s Job on a GPU node.
#   docker build -f docker/windsurf-train/Dockerfile -t harbor.tclab.org/windsurf/train:<tag> docker/windsurf-train
# The ultralytics image already carries torch + CUDA + ultralytics; we add boto3 for S3.
FROM harbor.tclab.org/dockerhub/ultralytics/ultralytics:latest

RUN pip install --no-cache-dir boto3

WORKDIR /app
COPY train_entry.py /app/train_entry.py

CMD ["python", "/app/train_entry.py"]
