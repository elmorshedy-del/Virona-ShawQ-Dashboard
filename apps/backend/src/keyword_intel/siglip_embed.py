from __future__ import annotations

from typing import Any

from .hf_endpoints import post_hf_inputs
from .models import SigLIPEmbedResult


def _extract_embedding(payload: dict[str, Any]) -> dict[str, Any]:
    for key in ("embedding", "vector"):
        value = payload.get(key)
        if isinstance(value, list):
            return {
                "embedding": value,
                "dimensions": payload.get("dimensions") or len(value),
                "model_id": payload.get("model_id", ""),
            }

    embeddings = payload.get("embeddings")
    if isinstance(embeddings, list) and embeddings and isinstance(embeddings[0], list):
        vector = embeddings[0]
        return {
            "embedding": vector,
            "dimensions": payload.get("dimensions") or len(vector),
            "model_id": payload.get("model_id", ""),
        }

    raise ValueError("SigLIP endpoint response did not include an embedding vector")


def embed_siglip_image(
    *,
    endpoint_url: str,
    api_token: str = "",
    image_url: str,
    timeout_sec: float = 120.0,
) -> SigLIPEmbedResult:
    resolved_image_url = str(image_url or "").strip()
    if not resolved_image_url:
        raise ValueError("image_url is required")

    payload = post_hf_inputs(
        endpoint_url=endpoint_url,
        api_token=api_token,
        inputs={"image_url": resolved_image_url},
        timeout_sec=timeout_sec,
        endpoint_name="SigLIP",
    )
    normalized = _extract_embedding(payload)
    return SigLIPEmbedResult.model_validate(normalized)
