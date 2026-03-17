#!/bin/bash
# Download a static ffmpeg binary for Lambda (Amazon Linux arm64).
# Run once before first deploy. The binary is gitignored — CI should run this too.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Downloading static ffmpeg + ffprobe for arm64..."
curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz \
  | tar xJ --strip-components=1 -C "$SCRIPT_DIR" --include='*/ffmpeg' --include='*/ffprobe'

chmod +x "$SCRIPT_DIR/ffmpeg" "$SCRIPT_DIR/ffprobe"
echo "Done: $SCRIPT_DIR/ffmpeg, $SCRIPT_DIR/ffprobe"
