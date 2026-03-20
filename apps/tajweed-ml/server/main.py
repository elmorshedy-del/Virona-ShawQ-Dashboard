from __future__ import annotations

import json
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

APP_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = APP_ROOT / "src"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from server.muaalem_checker import MuaalemChecker
from tajweed_ml.config import load_config
from tajweed_ml.quran_text import load_quran_text


checker: MuaalemChecker | None = None
quran_data: dict[str, list[str]] = {}


def load_quran_data() -> dict[str, list[str]]:
    return load_quran_text()


def _resolve_manifest_audio_path(path: Path, *, surah: int) -> Path | None:
    config = load_config()
    candidates: list[Path] = []
    if path:
        if path.name:
            candidates.append(config.husary_word_audio_dir / str(surah) / path.name)
        if not path.is_absolute():
            candidates.append(config.audio_dir / path)
        candidates.append(path)

    seen: set[Path] = set()
    for candidate in candidates:
        try:
            normalized = candidate.expanduser()
        except Exception:
            continue
        if normalized in seen:
            continue
        seen.add(normalized)
        if normalized.exists():
            return normalized.resolve()
    return None


def _served_audio_url(surah: int, ayah: int, word_index: int) -> str | None:
    config = load_config()
    preferred = config.served_word_audio_dir / str(surah) / str(ayah) / f"{word_index}.mp3"
    if preferred.exists():
        return f"/audio/words/{surah}/{ayah}/{word_index}.mp3"

    manifest_path = config.husary_word_audio_dir / str(surah) / "manifest.json"
    if not manifest_path.exists():
        return None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    clips = manifest.get(f"{surah}:{ayah}", [])
    for clip in clips:
        if int(clip.get("word_index", -1)) != word_index:
            continue
        path = _resolve_manifest_audio_path(Path(str(clip.get("path", ""))), surah=surah)
        if path is None:
            continue
        try:
            relative = path.resolve().relative_to(config.audio_dir.resolve())
        except ValueError:
            return None
        return f"/audio/{relative.as_posix()}"
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    del app
    global checker, quran_data
    checker = MuaalemChecker(device=load_config().default_device)
    quran_data = load_quran_data()
    yield


app = FastAPI(title="Al-Tarteel API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/audio", StaticFiles(directory=str(load_config().audio_dir)), name="audio")


@app.websocket("/ws/recite")
async def recite_ws(websocket: WebSocket):
    await websocket.accept()
    audio_buffer = np.array([], dtype=np.float32)
    current_surah = 1
    current_ayah = 1
    current_word = 0
    is_active = False

    try:
        while True:
            data = await websocket.receive()
            if data.get("type") == "websocket.disconnect":
                break
            if "text" in data:
                message = json.loads(data["text"])
                if message["type"] == "start":
                    current_surah = int(message.get("surah", 1))
                    current_ayah = int(message.get("ayah", 1))
                    current_word = 0
                    audio_buffer = np.array([], dtype=np.float32)
                    is_active = True
                    words = quran_data.get(f"{current_surah}:{current_ayah}", [])
                    await websocket.send_json(
                        {
                            "type": "ready",
                            "surah": current_surah,
                            "ayah": current_ayah,
                            "words": words,
                            "total_words": len(words),
                        }
                    )
                elif message["type"] == "stop":
                    is_active = False
                    words = quran_data.get(f"{current_surah}:{current_ayah}", [])
                    if len(audio_buffer) > 0 and checker is not None and words:
                        errors = checker.check(
                            audio_buffer,
                            words,
                            surah=current_surah,
                            ayah=current_ayah,
                        )
                        total_phonemes = max(
                            1,
                            len(
                                checker.get_expected_phonemes(
                                    words,
                                    surah=current_surah,
                                    ayah=current_ayah,
                                )
                            ),
                        )
                        error_count = len(errors)
                        score = max(0, int((1 - error_count / total_phonemes) * 100))
                        await websocket.send_json(
                            {
                                "type": "summary",
                                "score": score,
                                "total_errors": error_count,
                                "errors": [
                                    {
                                        "word_index": error.word_index,
                                        "error_type": error.error_type,
                                        "rule": error.rule,
                                        "description": error.description_en,
                                        "severity": error.severity,
                                        "expected": error.expected_phoneme,
                                        "predicted": error.predicted_phoneme,
                                    }
                                    for error in errors
                                ],
                            }
                        )
                    else:
                        await websocket.send_json(
                            {
                                "type": "summary",
                                "score": 100,
                                "total_errors": 0,
                                "errors": [],
                            }
                        )
                    audio_buffer = np.array([], dtype=np.float32)
                elif message["type"] == "next_ayah":
                    current_ayah += 1
                    current_word = 0
                    audio_buffer = np.array([], dtype=np.float32)
                    words = quran_data.get(f"{current_surah}:{current_ayah}", [])
                    await websocket.send_json(
                        {
                            "type": "ready",
                            "surah": current_surah,
                            "ayah": current_ayah,
                            "words": words,
                            "total_words": len(words),
                        }
                    )
            elif "bytes" in data and is_active and checker is not None:
                chunk = np.frombuffer(data["bytes"], dtype=np.int16).astype(np.float32) / 32768.0
                audio_buffer = np.concatenate([audio_buffer, chunk])
                buffer_duration = len(audio_buffer) / load_config().sample_rate
                if buffer_duration < 2.0:
                    continue
                words = quran_data.get(f"{current_surah}:{current_ayah}", [])
                if not words:
                    continue
                errors = checker.check(
                    audio_buffer,
                    words,
                    surah=current_surah,
                    ayah=current_ayah,
                )
                if errors:
                    top_error = errors[0]
                    word_index = top_error.word_index
                    await websocket.send_json(
                        {
                            "type": "correction",
                            "word_index": word_index,
                            "word_ar": words[word_index] if word_index < len(words) else "",
                            "error_type": top_error.error_type,
                            "rule": top_error.rule,
                            "description": top_error.description_en,
                            "severity": top_error.severity,
                            "audio_url": _served_audio_url(current_surah, current_ayah, word_index),
                        }
                    )
                else:
                    await websocket.send_json({"type": "correct", "word_index": current_word})
                    current_word += 1
                overlap = int(0.5 * load_config().sample_rate)
                audio_buffer = audio_buffer[-overlap:]
    except WebSocketDisconnect:
        return


@app.get("/health")
async def health_root():
    return {"status": "ok"}


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": checker is not None,
        "model": load_config().muaalem_model_name,
    }


@app.get("/api/surah/{surah}/ayah/{ayah}")
async def get_ayah(surah: int, ayah: int):
    words = quran_data.get(f"{surah}:{ayah}", [])
    return {
        "surah": surah,
        "ayah": ayah,
        "words": words,
        "word_audio_urls": [
            _served_audio_url(surah, ayah, index)
            for index in range(len(words))
        ],
    }


if __name__ == "__main__":
    import uvicorn

    config = load_config()
    uvicorn.run(app, host=config.server_host, port=config.server_port)
