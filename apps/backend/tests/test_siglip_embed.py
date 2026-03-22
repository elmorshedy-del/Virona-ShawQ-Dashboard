import requests
import pytest

from keyword_intel.siglip_embed import embed_siglip_image


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


def test_embed_siglip_image_accepts_vector_key(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(url: str, *, headers: dict, json: dict, timeout: float) -> _FakeResponse:
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return _FakeResponse(
            {
                "vector": [0.1, 0.2, 0.3],
                "model_id": "google/siglip2-so400m-patch14-384",
            }
        )

    monkeypatch.setattr("keyword_intel.hf_endpoints.requests.post", fake_post)

    result = embed_siglip_image(
        endpoint_url="https://siglip.example.test",
        api_token="secret",
        image_url="https://cdn.example.test/thumb.jpg",
        timeout_sec=30,
    )

    assert result.embedding == [0.1, 0.2, 0.3]
    assert result.dimensions == 3
    assert result.model_id == "google/siglip2-so400m-patch14-384"
    assert captured["json"] == {"inputs": {"image_url": "https://cdn.example.test/thumb.jpg"}}


def test_embed_siglip_image_requires_image_url() -> None:
    with pytest.raises(ValueError) as exc_info:
        embed_siglip_image(endpoint_url="https://siglip.example.test", image_url="")

    assert str(exc_info.value) == "image_url is required"
