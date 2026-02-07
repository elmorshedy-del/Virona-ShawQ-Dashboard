# Video Overlay AI Service

Python service used by the dashboard’s **Magical Video Overlay Editor** (Creative Studio).

This service exposes:

- `GET /health`
- `POST /detect` (expects `{ "image": "<base64>" }`)

By default it runs in **strict mode** (`VIDEO_OVERLAY_STRICT=true`) and will return **503** until both **DINO + SAM2** are loaded.

## Run locally

```bash
cd video_overlay_ai_service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Note: SAM 2 is installed from the official GitHub repo (not PyPI), so installs can take longer.
# Model weights are downloaded automatically by `start.sh` on Railway (or manually if running locally).
python backend.py
```

## Weights on Railway

The included `start.sh` downloads weights into `weights/` if they’re missing (DINO + SAM2).
For faster cold-starts, mount a persistent volume for `weights/`.

## Configure the dashboard server

Set this env var on the Node server:

- `VIDEO_OVERLAY_AI_URL=http://localhost:5000`
