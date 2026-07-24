# On-prem YOLO inference server. Serves any trained best.pt by dataset version.
#   docker build -f docker/windsurf-yolo-serve/Dockerfile -t harbor.tclab.org/windsurf/yolo-serve:<tag> docker/windsurf-yolo-serve
# ultralytics base carries torch + PIL; add the web + S3 bits.
FROM harbor.tclab.org/dockerhub/ultralytics/ultralytics:latest

RUN pip install --no-cache-dir fastapi "uvicorn[standard]" boto3

WORKDIR /app
COPY detect_utils.py /app/detect_utils.py
COPY app.py /app/app.py

EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
