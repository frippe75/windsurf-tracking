# Minimal test image for Harbor registry verification
FROM python:3.12-slim

LABEL maintainer="Windsurf Test"
LABEL description="Minimal test image for Harbor integration"

# Install minimal dependencies
RUN pip install --no-cache-dir clearml

# Create app directory and test script
RUN mkdir -p /app && echo 'print("✅ Minimal ClearML test image working!")' > /app/test.py

WORKDIR /app

CMD ["python", "test.py"]