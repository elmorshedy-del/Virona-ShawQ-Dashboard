#!/bin/sh
set -eu

mkdir -p weights

SAM2_WEIGHTS_PATH="${SAM2_WEIGHTS_PATH:-weights/sam2_hiera_large.pt}"
SAM2_WEIGHTS_URL="${SAM2_WEIGHTS_URL:-https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_large.pt}"

echo "[photo_magic_ai_service] Ensuring SAM2 weights..."
if [ ! -f "$SAM2_WEIGHTS_PATH" ]; then
  echo "[photo_magic_ai_service] Downloading SAM2 weights..."
  curl -L --retry 3 --retry-delay 2 -o "$SAM2_WEIGHTS_PATH" "$SAM2_WEIGHTS_URL"
fi

if [ "${PHOTO_MAGIC_WARM_LAMA:-1}" = "1" ]; then
  echo "[photo_magic_ai_service] Warming LaMa weights (TorchScript) if needed..."
  python - <<'PY'
from simple_lama_inpainting import SimpleLama
SimpleLama()
print("LaMa ready")
PY
fi

echo "[photo_magic_ai_service] Starting backend..."
exec python backend.py

