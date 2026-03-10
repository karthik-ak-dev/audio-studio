#!/bin/bash
# Build ffmpeg Lambda layer for arm64
set -euo pipefail

LAYER_DIR="$(dirname "$0")/output"
rm -rf "$LAYER_DIR"
mkdir -p "$LAYER_DIR/bin"

echo "Building ffmpeg layer for arm64..."

docker run --rm --platform linux/arm64 \
  -v "$LAYER_DIR:/output" \
  amazonlinux:2023 bash -c "
    yum install -y tar xz &&
    curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz | tar xJ &&
    cp ffmpeg-*-arm64-static/ffmpeg /output/bin/ &&
    chmod +x /output/bin/ffmpeg
  "

echo "Packaging layer..."
cd "$LAYER_DIR"
zip -r ../ffmpeg-layer.zip bin/

echo "Publishing layer..."
LAYER_ARN=$(aws lambda publish-layer-version \
  --layer-name ffmpeg \
  --zip-file "fileb://$(dirname "$0")/ffmpeg-layer.zip" \
  --compatible-runtimes python3.12 \
  --compatible-architectures arm64 \
  --query LayerVersionArn \
  --output text)

echo "Layer published: $LAYER_ARN"
echo "$LAYER_ARN" > "$(dirname "$0")/layer-arn.txt"
