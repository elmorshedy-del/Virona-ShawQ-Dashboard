from __future__ import annotations

import shutil
import sys
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

APP_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = APP_ROOT / "src"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from tajweed_ml.config import load_config
from tajweed_ml.optional import MissingDependencyError
from tajweed_ml.quran_text import load_quran_text
from tajweed_ml.segmenter import SegmenterUnavailableError, load_segmenter, segmenter_status


quran_data: dict[str, list[str]] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    del app
    global quran_data
    quran_data = load_quran_text()
    yield


app = FastAPI(title="Al-Tarteel Segmenter API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_root():
    return {"status": "ok"}


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "service": "segmenter",
        "segmenter": segmenter_status(load_config().default_device),
    }


@app.get("/api/segmenter/status")
async def segmenter_health():
    return segmenter_status(load_config().default_device)


@app.post("/api/segment")
async def segment_audio(
    audio: UploadFile = File(...),
    surah: int | None = Form(None),
    ayah: int | None = Form(None),
    chunk_length_s: float = Form(15.0),
    stride_length_s: float = Form(2.0),
):
    suffix = Path(audio.filename or "recitation.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        shutil.copyfileobj(audio.file, temp_file)
        temp_path = Path(temp_file.name)

    try:
        expected_words = quran_data.get(f"{surah}:{ayah}", []) if surah is not None and ayah is not None else None
        segmenter = load_segmenter(device=load_config().default_device)
        return segmenter.segment_audio(
            temp_path,
            transcript_words=expected_words if expected_words else None,
            chunk_length_s=chunk_length_s,
            stride_length_s=stride_length_s,
        )
    except (MissingDependencyError, SegmenterUnavailableError, RuntimeError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        temp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    import uvicorn

    config = load_config()
    uvicorn.run(app, host=config.server_host, port=config.server_port)
