from __future__ import annotations

from .hf_endpoints import post_hf_inputs
from .models import FireRedAudioSourceResult


def analyze_firered_audio_source(
    *,
    endpoint_url: str,
    api_token: str = "",
    audio_url: str | None = None,
    video_url: str | None = None,
    timeout_sec: float = 120.0,
) -> FireRedAudioSourceResult:
    resolved_audio_url = str(audio_url or "").strip()
    resolved_video_url = str(video_url or "").strip()
    if not resolved_audio_url and not resolved_video_url:
        raise ValueError("audio_url or video_url is required")

    inputs: dict[str, str] = {}
    if resolved_audio_url:
        inputs["audio_url"] = resolved_audio_url
    if resolved_video_url:
        inputs["video_url"] = resolved_video_url

    payload = post_hf_inputs(
        endpoint_url=endpoint_url,
        api_token=api_token,
        inputs=inputs,
        timeout_sec=timeout_sec,
        endpoint_name="FireRedVAD",
    )
    return FireRedAudioSourceResult.model_validate(payload)
