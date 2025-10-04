#!/bin/bash
set -e

# Windsurf Pipeline Docker Build and Push Script
# Builds image and pushes to Harbor registry

HARBOR_REGISTRY="harbor.tclab.org"
PROJECT_NAME="windsurf"  # Create this project in Harbor first!
IMAGE_NAME="windsurf-pipeline"
TAG="${1:-latest}"

FULL_IMAGE_NAME="${HARBOR_REGISTRY}/${PROJECT_NAME}/${IMAGE_NAME}:${TAG}"

echo "🐳 Building Windsurf Pipeline Docker Image"
echo "📊 Registry: ${HARBOR_REGISTRY}"
echo "📦 Image: ${FULL_IMAGE_NAME}"

# Change to repo root
cd "$(dirname "$0")/.."

echo "📁 Building from: $(pwd)"

# Build the image
echo "🔨 Building Docker image..."
docker build \
    -f docker/windsurf-pipeline/Dockerfile \
    -t "${FULL_IMAGE_NAME}" \
    .

echo "✅ Build complete: ${FULL_IMAGE_NAME}"

# Check image size
IMAGE_SIZE=$(docker images "${FULL_IMAGE_NAME}" --format "table {{.Size}}" | tail -n 1)
echo "📏 Image size: ${IMAGE_SIZE}"

# List what's in the image
echo "🔍 Image contents:"
docker run --rm "${FULL_IMAGE_NAME}" bash -c "
    echo 'Python: $(python --version)'
    echo 'Working dir: $(pwd)'
    echo 'Files: $(ls -la | wc -l) items'
    echo 'Models: $(find /app -name \"*.pth\" | wc -l) .pth files'
    echo 'Packages:'
    pip list | grep -E '(torch|opencv|clearml|sam2)' | head -5
"

# Push to Harbor registry
if [ "$2" = "--push" ]; then
    echo "🚀 Pushing to Harbor registry..."
    
    # Load Harbor robot credentials from .env
    if [ -f ".env" ]; then
        source .env
        if [ -n "$HARBOR_ROBOT_ACCOUNT" ]; then
            echo "🔑 Using Harbor robot account from .env"
            echo "$HARBOR_ROBOT_ACCOUNT" | docker login harbor.tclab.org --username "robot\$windsurf+clearml-windsurf" --password-stdin
        else
            echo "❌ HARBOR_ROBOT_ACCOUNT not found in .env"
            exit 1
        fi
    else
        echo "❌ .env file not found"
        exit 1
    fi
    
    docker push "${FULL_IMAGE_NAME}"
    echo "✅ Pushed: ${FULL_IMAGE_NAME}"
    
    echo "📝 To use in ClearML K8s:"
    echo "   Image: ${FULL_IMAGE_NAME}"
    echo "   Registry: ${HARBOR_REGISTRY}"
    echo "   Project: ${PROJECT_NAME} (PUBLIC ACCESS)"
else
    echo "🔍 Image built but not pushed (use --push to push)"
    echo "   To push: $0 ${TAG} --push"
fi

echo "🎉 Docker build complete!"
echo "🐳 Image: ${FULL_IMAGE_NAME}"