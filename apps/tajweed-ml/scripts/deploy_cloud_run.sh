#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${APP_ROOT}"

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-us-east4}"
REPOSITORY="${REPOSITORY:-quran-ai}"
GPU_TYPE="${GPU_TYPE:-nvidia-l4}"
CPU="${CPU:-8}"
MEMORY="${MEMORY:-32Gi}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
MAX_INSTANCES="${MAX_INSTANCES:-1}"
BACKEND_SERVICE="${BACKEND_SERVICE:-quran-ai-backend}"
BACKEND_IMAGE="${BACKEND_IMAGE:-quran-ai-backend}"
BACKEND_DOCKERFILE="${BACKEND_DOCKERFILE:-Dockerfile}"
SEGMENTER_SERVICE="${SEGMENTER_SERVICE:-quran-ai-segmenter}"
SEGMENTER_IMAGE="${SEGMENTER_IMAGE:-quran-ai-segmenter}"
SEGMENTER_DOCKERFILE="${SEGMENTER_DOCKERFILE:-Dockerfile.segmenter}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "PROJECT_ID is empty. Run 'gcloud config set project <id>' or export PROJECT_ID."
  exit 1
fi

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com

gcloud artifacts repositories create "${REPOSITORY}" \
  --repository-format=docker \
  --location="${REGION}" >/dev/null 2>&1 || true

deploy_service() {
  local service="$1"
  local image="$2"
  local dockerfile="$3"

  gcloud builds submit . \
    --config cloudbuild.cloudrun.yaml \
    --substitutions="_REGION=${REGION},_SERVICE=${service},_REPOSITORY=${REPOSITORY},_IMAGE=${image},_DOCKERFILE=${dockerfile},_GPU_TYPE=${GPU_TYPE},_CPU=${CPU},_MEMORY=${MEMORY},_MIN_INSTANCES=${MIN_INSTANCES},_MAX_INSTANCES=${MAX_INSTANCES}"

  local url
  url="$(gcloud run services describe "${service}" --region "${REGION}" --format='value(status.url)')"
  echo "${service} -> ${url}"
}

deploy_service "${BACKEND_SERVICE}" "${BACKEND_IMAGE}" "${BACKEND_DOCKERFILE}"
deploy_service "${SEGMENTER_SERVICE}" "${SEGMENTER_IMAGE}" "${SEGMENTER_DOCKERFILE}"

echo
echo "Cloud Run deploy complete."
echo "Backend service: ${BACKEND_SERVICE}"
echo "Segmenter service: ${SEGMENTER_SERVICE}"
echo "Region: ${REGION}"
