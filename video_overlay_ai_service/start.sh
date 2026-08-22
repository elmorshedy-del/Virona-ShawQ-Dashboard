#!/bin/sh
set -eu

mkdir -p weights

DINO_WEIGHTS_PATH="${DINO_WEIGHTS_PATH:-weights/groundingdino_swint_ogc.pth}"
SAM2_WEIGHTS_PATH="${SAM2_WEIGHTS_PATH:-weights/sam2_hiera_large.pt}"

DINO_WEIGHTS_URL="${DINO_WEIGHTS_URL:-https://github.com/IDEA-Research/GroundingDINO/releases/download/v0.1.0-alpha/groundingdino_swint_ogc.pth}"
SAM2_WEIGHTS_URL="${SAM2_WEIGHTS_URL:-https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_large.pt}"

echo "[video_overlay_ai_service] Ensuring model weights..."

if [ ! -f "$DINO_WEIGHTS_PATH" ]; then
  echo "[video_overlay_ai_service] Downloading DINO weights..."
  curl -L --retry 3 --retry-delay 2 -o "$DINO_WEIGHTS_PATH" "$DINO_WEIGHTS_URL"
fi

if [ ! -f "$SAM2_WEIGHTS_PATH" ]; then
  echo "[video_overlay_ai_service] Downloading SAM2 weights..."
  curl -L --retry 3 --retry-delay 2 -o "$SAM2_WEIGHTS_PATH" "$SAM2_WEIGHTS_URL"
fi

echo "[video_overlay_ai_service] Starting backend..."
exec python backend.py

