# Deployment

This app is prepared for:

- `Railway` for the frontend
- `Cloud Run` for two backend services:
  - `quran-ai-backend`
  - `quran-ai-segmenter`

## 1. Deploy Cloud Run services

From this directory:

```bash
cd /Users/ahmedelmorshedy/Downloads/dashboard-full/virona-shawq-dashboard/apps/tajweed-ml
chmod +x scripts/deploy_cloud_run.sh
./scripts/deploy_cloud_run.sh
```

Defaults:

- Region: `us-east4`
- GPU: `nvidia-l4`
- CPU: `8`
- Memory: `32Gi`
- Min instances: `0`
- Max instances: `1`

Override example:

```bash
REGION=us-east4 \
BACKEND_SERVICE=quran-ai-backend \
SEGMENTER_SERVICE=quran-ai-segmenter \
./scripts/deploy_cloud_run.sh
```

After deploy, the script prints both service URLs.

## 1B. Server-to-server deploy from Cloud Shell

This avoids your Mac disk completely.

```bash
git clone https://github.com/elmorshedy-del/QURAN-AI.git
cd QURAN-AI/apps/tajweed-ml
chmod +x scripts/deploy_cloud_run.sh
./scripts/deploy_cloud_run.sh
```

Important:

- this uses Google-hosted disk and Google-hosted build workers
- it only deploys what is already pushed to GitHub

## 1C. Cloud Build trigger from GitHub

The build config also supports monorepo builds from the repo root.

Use:

- build config path: `apps/tajweed-ml/cloudbuild.cloudrun.yaml`
- context dir substitution:
  - `_CONTEXT_DIR=apps/tajweed-ml`

Backend trigger substitutions:

```text
_CONTEXT_DIR=apps/tajweed-ml
_DOCKERFILE=Dockerfile
_SERVICE=quran-ai-backend
_IMAGE=quran-ai-backend
_REGION=us-east4
_GPU_TYPE=nvidia-l4
_CPU=8
_MEMORY=32Gi
_MIN_INSTANCES=0
_MAX_INSTANCES=1
```

Segmenter trigger substitutions:

```text
_CONTEXT_DIR=apps/tajweed-ml
_DOCKERFILE=Dockerfile.segmenter
_SERVICE=quran-ai-segmenter
_IMAGE=quran-ai-segmenter
_REGION=us-east4
_GPU_TYPE=nvidia-l4
_CPU=8
_MEMORY=32Gi
_MIN_INSTANCES=0
_MAX_INSTANCES=1
```

## 2. Configure Railway frontend

Railway root directory:

```text
frontend
```

Set these Railway variables:

```bash
VITE_API_BASE=https://YOUR_BACKEND_URL
VITE_WS_BASE=wss://YOUR_BACKEND_URL
VITE_SEGMENTER_BASE=https://YOUR_SEGMENTER_URL
```

Map them like this:

- `YOUR_BACKEND_URL` = Cloud Run URL for `quran-ai-backend`
- `YOUR_SEGMENTER_URL` = Cloud Run URL for `quran-ai-segmenter`

## 3. Verify services

Backend:

```bash
curl https://YOUR_BACKEND_URL/api/health
```

Segmenter:

```bash
curl https://YOUR_SEGMENTER_URL/api/health
curl https://YOUR_SEGMENTER_URL/api/segmenter/status
```

## 4. Verify frontend

After Railway deploy:

- open the site
- confirm backend status is connected
- confirm segmenter status is connected
- confirm practice view loads ayah text
- confirm WebSocket recitation connects

## 5. Service ownership

- [server/main.py](./server/main.py): main recitation backend
- [server/segmenter_main.py](./server/segmenter_main.py): segmenter-only backend
- [Dockerfile](./Dockerfile): main backend image
- [Dockerfile.segmenter](./Dockerfile.segmenter): segmenter image
- [scripts/deploy_cloud_run.sh](./scripts/deploy_cloud_run.sh): deploys both Cloud Run services
