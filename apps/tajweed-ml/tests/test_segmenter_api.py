from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import server.segmenter_main as segmenter_main


def _patch_runtime(monkeypatch) -> None:
    monkeypatch.setattr(segmenter_main, "load_quran_text", lambda: {"1:1": ["بِسْمِ", "ٱللَّهِ"]})
    monkeypatch.setattr(
        segmenter_main,
        "segmenter_status",
        lambda _device="cpu": {"cached": True, "loaded": False},
    )


def test_segmenter_health_endpoint(monkeypatch) -> None:
    _patch_runtime(monkeypatch)
    with TestClient(segmenter_main.app) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["service"] == "segmenter"


def test_segment_endpoint(monkeypatch) -> None:
    _patch_runtime(monkeypatch)

    class _StubSegmenter:
        @staticmethod
        def segment_audio(audio_path, transcript_words=None, chunk_length_s=15.0, stride_length_s=2.0):
            assert Path(audio_path).exists()
            assert transcript_words == ["بِسْمِ", "ٱللَّهِ"]
            assert chunk_length_s == 15.0
            assert stride_length_s == 2.0
            return {
                "text": "بسم الله",
                "segments": [{"index": 0, "text": "بسم", "start_sec": 0.0, "end_sec": 0.5}],
                "segment_count": 1,
                "segments_available": True,
            }

    monkeypatch.setattr(segmenter_main, "load_segmenter", lambda device="cpu": _StubSegmenter())

    with TestClient(segmenter_main.app) as client:
        response = client.post(
            "/api/segment",
            files={"audio": ("sample.wav", b"fake-audio", "audio/wav")},
            data={"surah": "1", "ayah": "1"},
        )

    assert response.status_code == 200
    assert response.json()["segments_available"] is True
    assert response.json()["segment_count"] == 1
