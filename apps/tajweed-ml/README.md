# QURAN-AI

Standalone Qur'an recitation coaching app with:

- `Muaalem` phoneme-aware tajweed checking
- optional `recitation-segmenter-v2` word timestamping / alignment support
- DSP checks for `madd`, `ghunnah`, and `qalqalah`
- FastAPI + WebSocket backend for streaming recitation feedback
- React frontend for bilingual Arabic/English guided practice
- Railway-ready frontend deployment files
- Cloud Run oriented backend container setup

The old classifier training pipeline is no longer the active runtime. Small track files and previous experiments are preserved under [Legacy Training](./Legacy%20Training).

Deployment steps are collected in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Active architecture

- [server/main.py](./server/main.py): FastAPI + WebSocket server
- [server/segmenter_main.py](./server/segmenter_main.py): dedicated FastAPI segmenter service
- [server/muaalem_checker.py](./server/muaalem_checker.py): pre-trained Muaalem inference and phoneme comparison
- [src/tajweed_ml/segmenter.py](./src/tajweed_ml/segmenter.py): optional recitation segmenter runtime wrapper
- [src/tajweed_ml/checker.py](./src/tajweed_ml/checker.py): app-facing rule checker
- [src/tajweed_ml/sifaat_checker.py](./src/tajweed_ml/sifaat_checker.py): DSP checks for madd, ghunnah, and qalqalah
- [frontend](./frontend): Vite/React bilingual recitation UI

## Local backend setup

```bash
pip install -r requirements.txt
python ml/setup.py
```

That full setup downloads:

- `Muaalem` for live runtime checks
- `recitation-segmenter-v2` for optional word timestamping
- `Buraaq` word audio assets

The segmenter model is large and is better treated as optional infrastructure. For a lighter runtime-only setup:

```bash
python -c "from ml.setup import setup_runtime_models; setup_runtime_models()"
```

To explicitly cache the segmenter later:

```bash
python -m cli setup-segmenter
```

## Run locally

Backend:

```bash
python -m uvicorn server.main:app --reload --host 0.0.0.0 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Railway frontend

Deploy the [frontend](./frontend) directory to Railway. Set:

```bash
VITE_API_BASE=https://your-cloud-run-backend.run.app
VITE_WS_BASE=wss://your-cloud-run-backend.run.app
VITE_SEGMENTER_BASE=https://your-cloud-run-segmenter.run.app
```

The Railway-specific files are already included:

- [frontend/railway.toml](./frontend/railway.toml)
- [frontend/nixpacks.toml](./frontend/nixpacks.toml)
- [frontend/.env.example](./frontend/.env.example)

After `scripts/deploy_cloud_run.sh` completes, use the printed service URLs for:

- `VITE_API_BASE` -> `quran-ai-backend`
- `VITE_WS_BASE` -> `quran-ai-backend` as `wss://...`
- `VITE_SEGMENTER_BASE` -> `quran-ai-segmenter`

## Cloud Run backend

Cloud Run is now prepared as two services:

- [Dockerfile](./Dockerfile): main `Muaalem + DSP` backend
- [Dockerfile.segmenter](./Dockerfile.segmenter): dedicated segmenter backend
- [cloudbuild.cloudrun.yaml](./cloudbuild.cloudrun.yaml): generic Cloud Build deploy config
- [scripts/deploy_cloud_run.sh](./scripts/deploy_cloud_run.sh): one-command deploy for both services

The split is intentional:

- `quran-ai-backend` stays lean and serves live recitation feedback
- `quran-ai-segmenter` owns `/api/segment`

From the app directory, deploy both:

```bash
chmod +x scripts/deploy_cloud_run.sh
./scripts/deploy_cloud_run.sh
```

If your local machine is low on disk, run the same script from Cloud Shell after cloning the repo there. See [DEPLOYMENT.md](./DEPLOYMENT.md).

Default services:

- `quran-ai-backend`
- `quran-ai-segmenter`

Default resources for each:

- `NVIDIA L4`
- `8 CPU`
- `32Gi`
- `min-instances=0`
- `max-instances=1`

Override values if needed:

```bash
REGION=us-east4 BACKEND_SERVICE=quran-ai-backend SEGMENTER_SERVICE=quran-ai-segmenter ./scripts/deploy_cloud_run.sh
```

## CLI

```bash
python -m cli doctor
python -m cli setup-segmenter
python -m cli segment-audio audio/example.wav --surah 1 --ayah 1
python -m cli test-madd audio/example.wav audio/reference.wav
python -m cli test-ghunnah audio/example.wav audio/reference.wav
python -m cli serve
```
