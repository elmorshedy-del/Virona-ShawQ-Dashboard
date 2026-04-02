import requests
import pytest

from keyword_intel.firered_audio import analyze_firered_audio_source


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


def test_analyze_firered_audio_source_posts_video_url(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(url: str, *, headers: dict, json: dict, timeout: float) -> _FakeResponse:
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return _FakeResponse(
            {
                "voice_music_ratio": "music_dominant",
                "speech_ratio": 0.01,
                "singing_ratio": 0.82,
                "music_ratio": 1.0,
                "model_id": "FireRedTeam/FireRedVAD",
            }
        )

    monkeypatch.setattr("keyword_intel.hf_endpoints.requests.post", fake_post)

    result = analyze_firered_audio_source(
        endpoint_url="https://firered.example.test",
        api_token="secret",
        video_url="https://cdn.example.test/video.mp4",
        timeout_sec=60,
    )

    assert result.voice_music_ratio == "music_dominant"
    assert result.singing_ratio == 0.82
    assert captured["url"] == "https://firered.example.test"
    assert captured["headers"] == {
        "Content-Type": "application/json",
        "Authorization": "Bearer secret",
    }
    assert captured["json"] == {"inputs": {"video_url": "https://cdn.example.test/video.mp4"}}
    assert captured["timeout"] == 60


def test_analyze_firered_audio_source_requires_input_url() -> None:
    with pytest.raises(ValueError) as exc_info:
        analyze_firered_audio_source(endpoint_url="https://firered.example.test")

    assert str(exc_info.value) == "audio_url or video_url or uploaded media is required"


def test_analyze_firered_audio_source_posts_audio_base64(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(url: str, *, headers: dict, json: dict, timeout: float) -> _FakeResponse:
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return _FakeResponse(
            {
                "voice_music_ratio": "music_dominant",
                "speech_ratio": 0.0,
                "singing_ratio": 0.55,
                "music_ratio": 1.0,
                "model_id": "FireRedTeam/FireRedVAD",
            }
        )

    monkeypatch.setattr("keyword_intel.hf_endpoints.requests.post", fake_post)

    result = analyze_firered_audio_source(
        endpoint_url="https://firered.example.test",
        audio_bytes=b"wav-bytes",
        audio_mime_type="audio/wav",
        audio_filename="source.wav",
    )

    assert result.voice_music_ratio == "music_dominant"
    assert captured["json"] == {
        "inputs": {
            "audio_base64": "d2F2LWJ5dGVz",
            "audio_mime_type": "audio/wav",
            "audio_filename": "source.wav",
        }
    }
