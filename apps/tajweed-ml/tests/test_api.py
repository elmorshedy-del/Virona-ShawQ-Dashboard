from __future__ import annotations

import json
from fastapi.testclient import TestClient

import server.main as main
from tajweed_ml import api
from tajweed_ml.config import STORAGE_ROOT_ENV


class _StubError:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class _StubChecker:
    def get_expected_phonemes(self, words):
        return list(words)

    def check(self, _audio, _words, sr=16_000):
        del sr
        return [
            _StubError(
                word_index=0,
                error_type="tafkheem",
                rule="tafkheem/tarqeeq",
                description_en="ص sounds like س",
                severity="high",
                expected_phoneme="sˤ",
                predicted_phoneme="s",
            )
        ]


def _patch_runtime(monkeypatch) -> None:
    monkeypatch.setattr(main, "MuaalemChecker", lambda device="cpu": _StubChecker())
    monkeypatch.setattr(main, "load_quran_data", lambda: {"1:1": ["بِسْمِ", "ٱللَّهِ"]})


def test_health_endpoint(monkeypatch) -> None:
    _patch_runtime(monkeypatch)
    with TestClient(api.app) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_get_ayah_endpoint(monkeypatch) -> None:
    _patch_runtime(monkeypatch)
    with TestClient(api.app) as client:
        response = client.get("/api/surah/1/ayah/1")
    assert response.status_code == 200
    assert response.json()["words"] == ["بِسْمِ", "ٱللَّهِ"]


def test_websocket_summary_flow(monkeypatch) -> None:
    _patch_runtime(monkeypatch)
    with TestClient(api.app) as client:
        with client.websocket_connect("/ws/recite") as websocket:
            websocket.send_json({"type": "start", "surah": 1, "ayah": 1})
            ready = websocket.receive_json()
            assert ready["type"] == "ready"
            websocket.send_json({"type": "stop"})
            summary = websocket.receive_json()
    assert summary["type"] == "summary"
    assert summary["total_errors"] == 0


def test_served_audio_url_rewrites_manifest_absolute_paths(monkeypatch, tmp_path) -> None:
    audio_dir = tmp_path / "audio" / "husary" / "words" / "1"
    audio_dir.mkdir(parents=True)
    clip_path = audio_dir / "001_001_00_بسم.wav"
    clip_path.write_bytes(b"fake")
    manifest_path = audio_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "1:1": [
                    {
                        "word_index": 0,
                        "path": "/Users/ahmedelmorshedy/Downloads/dashboard-full/virona-shawq-dashboard/apps/tajweed-ml/audio/husary/words/1/001_001_00_بسم.wav",
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv(STORAGE_ROOT_ENV, str(tmp_path))

    assert main._served_audio_url(1, 1, 0) == "/audio/husary/words/1/001_001_00_بسم.wav"
