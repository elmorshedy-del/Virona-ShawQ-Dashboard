#!/usr/bin/env sh
set -eu

APP_ROOT="${APP_ROOT:-/app}"
STORAGE_ROOT="${TAJWEED_ML_STORAGE_ROOT:-/data/tajweed-ml}"
SEED_DATA_DIR="/opt/tajweed-seed-data"

mkdir -p \
  "${STORAGE_ROOT}/artifacts" \
  "${STORAGE_ROOT}/audio" \
  "${STORAGE_ROOT}/data" \
  "${HF_HOME:-/data/huggingface}" \
  "${HF_DATASETS_CACHE:-/data/huggingface/datasets}" \
  "${TRANSFORMERS_CACHE:-/data/huggingface/transformers}" \
  "${XDG_CACHE_HOME:-/data/.cache}"

if [ -d "${SEED_DATA_DIR}" ]; then
  cp -n "${SEED_DATA_DIR}"/*.py "${STORAGE_ROOT}/data/" 2>/dev/null || true
fi

for name in artifacts audio data; do
  target="${STORAGE_ROOT}/${name}"
  link="${APP_ROOT}/${name}"
  mkdir -p "${target}"
  if [ ! -L "${link}" ]; then
    rm -rf "${link}"
    ln -s "${target}" "${link}"
  fi
done

exec "$@"
