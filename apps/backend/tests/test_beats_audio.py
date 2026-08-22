import requests
import pytest

from keyword_intel.beats_audio import analyze_beats_audio


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            response = requests.Response()
            response.status_code = self.status_code
            response._content = b'{"error":"bad upstream"}'
            raise requests.HTTPError(response=response)

    def json(self) -> dict:
        return self._payload


def test_analyze_beats_audio_posts_audio_url_and_validates_response(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(url: str, *, headers: dict, json: dict, timeout: float) -> _FakeResponse:
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return _FakeResponse(
            {
                "audio_mood": "dramatic",
                "energy_level": "high",
                "voice_music_ratio": "balanced",
                "evidence": {"tempo_bpm": 122.4, "top_labels": [{"label": "music", "score": 0.98}]},
                "model_id": "facebook/beats",
            }
        )

    monkeypatch.setattr("keyword_intel.hf_endpoints.requests.post", fake_post)

    result = analyze_beats_audio(
        endpoint_url="https://beats.example.test",
        api_token="secret",
        audio_url="https://cdn.example.test/audio.wav",
        timeout_sec=45,
    )

    assert result.audio_mood == "dramatic"
    assert result.evidence["tempo_bpm"] == 122.4
    assert captured["url"] == "https://beats.example.test"
    assert captured["headers"] == {
        "Content-Type": "application/json",
        "Authorization": "Bearer secret",
    }
    assert captured["json"] == {"inputs": {"audio_url": "https://cdn.example.test/audio.wav"}}
    assert captured["timeout"] == 45


def test_analyze_beats_audio_unwraps_nested_result(monkeypatch) -> None:
    def fake_post(url: str, *, headers: dict, json: dict, timeout: float) -> _FakeResponse:
        del url, headers, json, timeout
        return _FakeResponse(
            {
                "result": {
                    "audio_mood": "emotional",
                    "energy_level": "low",
                    "voice_music_ratio": "music_dominant",
                }
            }
        )

    monkeypatch.setattr("keyword_intel.hf_endpoints.requests.post", fake_post)

    result = analyze_beats_audio(
        endpoint_url="https://beats.example.test",
        video_url="https://cdn.example.test/video.mp4",
    )

    assert result.audio_mood == "emotional"
    assert result.voice_music_ratio == "music_dominant"


def test_analyze_beats_audio_requires_an_input_url() -> None:
    with pytest.raises(ValueError) as exc_info:
        analyze_beats_audio(endpoint_url="https://beats.example.test")

    assert str(exc_info.value) == "audio_url or video_url or uploaded media is required"


def test_analyze_beats_audio_posts_audio_base64(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(url: str, *, headers: dict, json: dict, timeout: float) -> _FakeResponse:
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return _FakeResponse(
            {
                "audio_mood": "upbeat",
                "energy_level": "high",
                "voice_music_ratio": "music_dominant",
            }
        )

    monkeypatch.setattr("keyword_intel.hf_endpoints.requests.post", fake_post)

    result = analyze_beats_audio(
        endpoint_url="https://beats.example.test",
        audio_bytes=b"wav-bytes",
        audio_mime_type="audio/wav",
        audio_filename="source.wav",
    )

    assert result.audio_mood == "upbeat"
    assert captured["json"] == {
        "inputs": {
            "audio_base64": "d2F2LWJ5dGVz",
            "audio_mime_type": "audio/wav",
            "audio_filename": "source.wav",
        }
    }
