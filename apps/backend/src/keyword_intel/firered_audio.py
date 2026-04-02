from __future__ import annotations

import base64

from .hf_endpoints import post_hf_inputs
from .models import FireRedAudioSourceResult


def analyze_firered_audio_source(
    *,
    endpoint_url: str,
    api_token: str = "",
    audio_url: str | None = None,
    video_url: str | None = None,
    audio_bytes: bytes | None = None,
    audio_mime_type: str | None = None,
    audio_filename: str | None = None,
    video_bytes: bytes | None = None,
    video_mime_type: str | None = None,
    video_filename: str | None = None,
    timeout_sec: float = 120.0,
) -> FireRedAudioSourceResult:
    resolved_audio_url = str(audio_url or "").strip()
    resolved_video_url = str(video_url or "").strip()
    if (
        not resolved_audio_url
        and not resolved_video_url
        and audio_bytes is None
        and video_bytes is None
    ):
        raise ValueError("audio_url or video_url or uploaded media is required")

    inputs: dict[str, str] = {}
    if audio_bytes is not None:
        inputs["audio_base64"] = base64.b64encode(audio_bytes).decode("ascii")
        if audio_mime_type:
            inputs["audio_mime_type"] = str(audio_mime_type)
        if audio_filename:
            inputs["audio_filename"] = str(audio_filename)
    elif resolved_audio_url:
        inputs["audio_url"] = resolved_audio_url
    if video_bytes is not None:
        inputs["video_base64"] = base64.b64encode(video_bytes).decode("ascii")
        if video_mime_type:
            inputs["video_mime_type"] = str(video_mime_type)
        if video_filename:
            inputs["video_filename"] = str(video_filename)
    elif resolved_video_url:
        inputs["video_url"] = resolved_video_url

    payload = post_hf_inputs(
        endpoint_url=endpoint_url,
        api_token=api_token,
        inputs=inputs,
        timeout_sec=timeout_sec,
        endpoint_name="FireRedVAD",
    )
    return FireRedAudioSourceResult.model_validate(payload)
