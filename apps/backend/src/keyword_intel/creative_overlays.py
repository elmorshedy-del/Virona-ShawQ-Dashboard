from __future__ import annotations

import base64
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field

DEFAULT_REEL_DURATION_SEC = 15.0
OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"

ALLOWED_POSITIONS = {
    "center",
    "top",
    "bottom",
    "left",
    "right",
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
}
ALLOWED_ANIMATIONS = {
    "fade",
    "fade-up",
    "fade-down",
    "slide-left",
    "slide-right",
    "pop",
    "none",
}
NOISE_LINES = {
    "cart",
    "menu",
    "home",
    "search",
    "account",
    "log in",
    "sign in",
    "shop",
}


class VideoMetadata(BaseModel):
    duration_sec: float = DEFAULT_REEL_DURATION_SEC
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    has_audio: bool = False


class TimingWindow(BaseModel):
    start_sec: float
    end_sec: float


class OverlaySuggestion(BaseModel):
    start_sec: float
    end_sec: float
    text: str
    position: str = "center"
    animation: str = "fade-up"
    cta: bool = False
    rationale: str = ""


class BrandIntelligence(BaseModel):
    source_url: str = ""
    site_title: str = ""
    site_description: str = ""
    key_messages: list[str] = Field(default_factory=list)
    audience_responses: list[str] = Field(default_factory=list)
    brand_notes: str = ""


class ReelOverlayPlan(BaseModel):
    provider: str
    reel_path: str
    summary: str
    hooks: list[str] = Field(default_factory=list)
    primary_cta: str = "Shop now"
    overlays: list[OverlaySuggestion] = Field(default_factory=list)
    metadata: VideoMetadata
    brand_intelligence: BrandIntelligence = Field(default_factory=BrandIntelligence)


ProviderMode = str
PROVIDER_MODE_AUTO = "auto"
PROVIDER_MODE_OPENAI_ONLY = "openai-only"
PROVIDER_MODE_TEMPLATE_ONLY = "template-only"
ALLOWED_PROVIDER_MODES = {
    PROVIDER_MODE_AUTO,
    PROVIDER_MODE_OPENAI_ONLY,
    PROVIDER_MODE_TEMPLATE_ONLY,
}


def probe_video_metadata(reel_path: Path) -> VideoMetadata:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        str(reel_path),
    ]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return VideoMetadata(duration_sec=DEFAULT_REEL_DURATION_SEC)

    if completed.returncode != 0:
        return VideoMetadata(duration_sec=DEFAULT_REEL_DURATION_SEC)

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return VideoMetadata(duration_sec=DEFAULT_REEL_DURATION_SEC)

    streams = payload.get("streams") or []
    format_payload = payload.get("format") or {}
    duration_sec = max(1.0, _safe_float(format_payload.get("duration"), DEFAULT_REEL_DURATION_SEC))

    width: int | None = None
    height: int | None = None
    fps: float | None = None
    has_audio = False

    for stream in streams:
        if not isinstance(stream, dict):
            continue
        codec_type = str(stream.get("codec_type", "")).strip().lower()
        if codec_type == "video" and width is None:
            width = _safe_int(stream.get("width"))
            height = _safe_int(stream.get("height"))
            fps = _parse_fps(
                str(stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "")
            )
        if codec_type == "audio":
            has_audio = True

    return VideoMetadata(
        duration_sec=duration_sec,
        width=width,
        height=height,
        fps=fps,
        has_audio=has_audio,
    )


def build_timing_windows(duration_sec: float, max_overlays: int = 8) -> list[TimingWindow]:
    normalized_duration = max(4.0, float(duration_sec or DEFAULT_REEL_DURATION_SEC))
    normalized_limit = max(1, min(50, max_overlays))

    estimated_count = max(3, int(round(normalized_duration / 2.4)))
    overlay_count = min(normalized_limit, estimated_count)

    spacing = normalized_duration / float(overlay_count + 1)
    overlay_length = min(2.8, max(1.0, spacing * 0.85))
    start_offset = min(0.3, spacing * 0.25)

    windows: list[TimingWindow] = []
    for index in range(overlay_count):
        start_sec = _clamp(
            start_offset + (index * spacing),
            0.0,
            max(0.0, normalized_duration - 0.6),
        )
        end_sec = _clamp(
            start_sec + overlay_length,
            min(normalized_duration, start_sec + 0.6),
            normalized_duration,
        )
        windows.append(
            TimingWindow(
                start_sec=round(start_sec, 2),
                end_sec=round(end_sec, 2),
            )
        )
    return windows


def build_brand_intelligence(
    *,
    brand_website_url: str = "",
    audience_responses: list[str] | None = None,
    brand_notes: str = "",
) -> BrandIntelligence:
    normalized_url = str(brand_website_url or "").strip()
    if normalized_url and "://" not in normalized_url:
        normalized_url = f"https://{normalized_url}"

    normalized_responses = _dedupe_strings(
        [_normalize_text(item) for item in (audience_responses or [])],
        limit=10,
    )
    normalized_notes = _normalize_text(brand_notes, max_chars=220)

    if not normalized_url:
        return BrandIntelligence(
            audience_responses=normalized_responses,
            brand_notes=normalized_notes,
        )

    try:
        response = requests.get(
            normalized_url,
            headers={"User-Agent": "keyword-intel-overlay-generator/0.1"},
            timeout=12.0,
        )
        response.raise_for_status()
    except requests.RequestException:
        return BrandIntelligence(
            source_url=normalized_url,
            audience_responses=normalized_responses,
            brand_notes=normalized_notes,
        )

    soup = BeautifulSoup(response.text, "html.parser")
    title = _normalize_text(soup.title.get_text(" ", strip=True) if soup.title else "")
    description = ""
    meta_description = soup.find("meta", attrs={"name": "description"})
    if meta_description and hasattr(meta_description, "get"):
        description = _normalize_text(meta_description.get("content"))
    if not description:
        og_description = soup.find("meta", attrs={"property": "og:description"})
        if og_description and hasattr(og_description, "get"):
            description = _normalize_text(og_description.get("content"))

    heading_lines: list[str] = []
    for heading in soup.find_all(["h1", "h2"], limit=8):
        text = _normalize_text(heading.get_text(" ", strip=True))
        if text and not _is_noise_line(text):
            heading_lines.append(text)

    paragraph_lines: list[str] = []
    for paragraph in soup.find_all("p", limit=8):
        text = _normalize_text(paragraph.get_text(" ", strip=True))
        if len(text) >= 25 and not _is_noise_line(text):
            paragraph_lines.append(text)

    key_messages = _dedupe_strings(
        heading_lines + paragraph_lines,
        limit=8,
    )
    return BrandIntelligence(
        source_url=normalized_url,
        site_title=title,
        site_description=description,
        key_messages=key_messages,
        audience_responses=normalized_responses,
        brand_notes=normalized_notes,
    )


def generate_reel_overlay_plan(
    reel_path: str | Path,
    *,
    brand_name: str = "",
    product_name: str = "",
    tone: str = "",
    audience: str = "",
    objective: str = "conversion",
    language: str = "en",
    max_overlays: int = 8,
    brand_website_url: str = "",
    audience_responses: list[str] | None = None,
    brand_notes: str = "",
    provider_mode: ProviderMode = PROVIDER_MODE_AUTO,
    overlay_blind: bool = True,
) -> ReelOverlayPlan:
    path = Path(reel_path).expanduser()
    if not path.exists():
        raise FileNotFoundError(f"reel not found: {path}")
    if max_overlays < 1 or max_overlays > 50:
        raise ValueError("max_overlays must be between 1 and 50")
    normalized_provider_mode = str(provider_mode or PROVIDER_MODE_AUTO).strip().lower()
    if normalized_provider_mode not in ALLOWED_PROVIDER_MODES:
        raise ValueError(
            f"provider_mode must be one of: {', '.join(sorted(ALLOWED_PROVIDER_MODES))}"
        )

    metadata = probe_video_metadata(path)
    windows = build_timing_windows(metadata.duration_sec, max_overlays=max_overlays)
    brand_intelligence = build_brand_intelligence(
        brand_website_url=brand_website_url,
        audience_responses=audience_responses,
        brand_notes=brand_notes,
    )

    provider = "template"
    plan_data: dict[str, Any] | None = None
    openai_enabled = bool(os.getenv("OPENAI_API_KEY", "").strip())
    if normalized_provider_mode != PROVIDER_MODE_TEMPLATE_ONLY and openai_enabled:
        plan_data = _generate_with_openai(
            reel_path=path,
            metadata=metadata,
            windows=windows,
            brand_name=brand_name,
            product_name=product_name,
            tone=tone,
            audience=audience,
            objective=objective,
            language=language,
            brand_intelligence=brand_intelligence,
            overlay_blind=overlay_blind,
        )
        if plan_data:
            provider = "openai"

    if not plan_data and normalized_provider_mode == PROVIDER_MODE_OPENAI_ONLY:
        raise RuntimeError(
            "openai-only mode requested but no OpenAI result was generated. "
            "Set OPENAI_API_KEY and verify ffmpeg/network access."
        )

    if not plan_data:
        plan_data = _generate_template_plan(
            windows=windows,
            brand_name=brand_name,
            product_name=product_name,
            tone=tone,
            audience=audience,
            objective=objective,
            brand_intelligence=brand_intelligence,
        )

    return _normalize_plan(
        plan_data=plan_data,
        provider=provider,
        reel_path=path,
        metadata=metadata,
        windows=windows,
        max_overlays=max_overlays,
        brand_intelligence=brand_intelligence,
    )


def _generate_with_openai(
    *,
    reel_path: Path,
    metadata: VideoMetadata,
    windows: list[TimingWindow],
    brand_name: str,
    product_name: str,
    tone: str,
    audience: str,
    objective: str,
    language: str,
    brand_intelligence: BrandIntelligence,
    overlay_blind: bool,
) -> dict[str, Any] | None:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None

    model = os.getenv("KEYWORD_INTEL_REEL_MODEL", "gpt-4.1-mini").strip() or "gpt-4.1-mini"
    timeout_sec = max(10.0, _safe_float(os.getenv("KEYWORD_INTEL_REEL_TIMEOUT_SEC"), 45.0))
    frame_payloads = _extract_frame_payloads(
        reel_path=reel_path,
        windows=windows,
        max_frames=min(6, len(windows)),
    )
    frame_timestamps = [item["timestamp_sec"] for item in frame_payloads]

    prompt_payload = {
        "task": (
            "Generate ad overlays for a short ecommerce reel. "
            "Use emotionally resonant, specific lines grounded in brand and audience cues."
        ),
        "video_file_reference": str(reel_path),
        "video_metadata": metadata.model_dump(),
        "timing_windows": [window.model_dump() for window in windows],
        "keyframe_timestamps_sec": frame_timestamps,
        "brand_context": {
            "brand_name": brand_name,
            "product_name": product_name,
            "tone": tone,
            "audience": audience,
            "objective": objective,
            "language": language,
            "brand_intelligence": brand_intelligence.model_dump(),
        },
        "constraints": {
            "max_text_chars": 60,
            "allowed_positions": sorted(ALLOWED_POSITIONS),
            "allowed_animations": sorted(ALLOWED_ANIMATIONS),
            "never_output_internal_notes": True,
            "ignore_existing_on_screen_text": bool(overlay_blind),
        },
        "output_schema": {
            "summary": "string",
            "hooks": ["string"],
            "primary_cta": "string",
            "overlays": [
                {
                    "start_sec": 0.2,
                    "end_sec": 1.8,
                    "text": "string",
                    "position": "bottom",
                    "animation": "fade-up",
                    "cta": False,
                    "rationale": "string",
                }
            ],
        },
    }

    user_content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": json.dumps(prompt_payload, ensure_ascii=False),
        }
    ]
    for frame in frame_payloads:
        user_content.append(
            {
                "type": "image_url",
                "image_url": {"url": frame["data_url"]},
            }
        )

    request_payload = {
        "model": model,
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a senior direct-response video creative strategist. "
                    "Infer visual context from keyframes. Return only JSON with concise overlays. "
                    "If ignore_existing_on_screen_text is true, do not reuse or paraphrase text already "
                    "visible in the reel (captions, stickers, subtitles, watermarks, prior overlays)."
                ),
            },
            {
                "role": "user",
                "content": user_content,
            },
        ],
    }

    try:
        response = requests.post(
            OPENAI_CHAT_COMPLETIONS_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=request_payload,
            timeout=timeout_sec,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException:
        return None
    except json.JSONDecodeError:
        return None

    choices = payload.get("choices") or []
    if not choices:
        return None

    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    parsed = _extract_json_object(content)
    if not isinstance(parsed, dict):
        return None
    return parsed


def _generate_template_plan(
    *,
    windows: list[TimingWindow],
    brand_name: str,
    product_name: str,
    tone: str,
    audience: str,
    objective: str,
    brand_intelligence: BrandIntelligence,
) -> dict[str, Any]:
    hooks = _template_hooks(
        brand_name=brand_name,
        product_name=product_name,
        objective=objective,
        brand_intelligence=brand_intelligence,
    )
    primary_cta = _template_primary_cta(objective=objective)
    lines = _template_overlay_lines(
        brand_name=brand_name,
        product_name=product_name,
        tone=tone,
        audience=audience,
        objective=objective,
        brand_intelligence=brand_intelligence,
    )

    overlays: list[dict[str, Any]] = []
    position_cycle = [
        "center",
        "bottom",
        "top",
        "bottom-left",
        "bottom-right",
    ]
    for index, window in enumerate(windows):
        text = lines[index % len(lines)]
        if overlays and len(lines) > 1 and text == overlays[-1]["text"]:
            text = lines[(index + 1) % len(lines)]
        overlays.append(
            {
                "start_sec": window.start_sec,
                "end_sec": window.end_sec,
                "text": text,
                "position": position_cycle[index % len(position_cycle)],
                "animation": "fade-up",
                "cta": False,
                "rationale": "Template baseline",
            }
        )

    if overlays:
        overlays[-1]["text"] = primary_cta
        overlays[-1]["cta"] = True

    summary = "Template-generated overlays for quick creative validation."
    if brand_intelligence.source_url:
        summary += f" Site context: {brand_intelligence.source_url}."
    if brand_intelligence.audience_responses:
        summary += " Audience cues: " + ", ".join(brand_intelligence.audience_responses[:3]) + "."
    return {
        "summary": summary,
        "hooks": hooks,
        "primary_cta": primary_cta,
        "overlays": overlays,
    }


def _normalize_plan(
    *,
    plan_data: dict[str, Any],
    provider: str,
    reel_path: Path,
    metadata: VideoMetadata,
    windows: list[TimingWindow],
    max_overlays: int,
    brand_intelligence: BrandIntelligence,
) -> ReelOverlayPlan:
    overlays_payload = plan_data.get("overlays")
    overlays_raw = overlays_payload if isinstance(overlays_payload, list) else []

    normalized: list[OverlaySuggestion] = []
    max_items = min(max_overlays, max(len(overlays_raw), len(windows)))
    for index in range(max_items):
        raw = overlays_raw[index] if index < len(overlays_raw) and isinstance(overlays_raw[index], dict) else {}
        fallback_window = windows[min(index, len(windows) - 1)]

        start_sec = _clamp(
            _safe_float(raw.get("start_sec"), fallback_window.start_sec),
            0.0,
            max(0.0, metadata.duration_sec - 0.6),
        )
        min_end_sec = min(metadata.duration_sec, start_sec + 0.6)
        end_sec = _clamp(
            _safe_float(raw.get("end_sec"), fallback_window.end_sec),
            min_end_sec,
            metadata.duration_sec,
        )

        text = _normalize_text(raw.get("text", ""))
        if not text:
            continue

        position = _normalize_choice(
            raw.get("position"),
            allowed=ALLOWED_POSITIONS,
            fallback="center",
        )
        animation = _normalize_choice(
            raw.get("animation"),
            allowed=ALLOWED_ANIMATIONS,
            fallback="fade-up",
        )

        normalized.append(
            OverlaySuggestion(
                start_sec=round(start_sec, 2),
                end_sec=round(end_sec, 2),
                text=text,
                position=position,
                animation=animation,
                cta=bool(raw.get("cta", False)),
                rationale=str(raw.get("rationale", "")).strip()[:140],
            )
        )

    if not normalized:
        for window in windows[: max(1, min(max_overlays, len(windows)))]:
            normalized.append(
                OverlaySuggestion(
                    start_sec=window.start_sec,
                    end_sec=window.end_sec,
                    text="See the transformation",
                    position="center",
                    animation="fade-up",
                    cta=False,
                )
            )
        normalized[-1].text = "Shop now"
        normalized[-1].cta = True

    if normalized and not any(item.cta for item in normalized):
        normalized[-1].cta = True

    hooks_payload = plan_data.get("hooks")
    hooks_raw = hooks_payload if isinstance(hooks_payload, list) else []
    hooks = [_normalize_text(item) for item in hooks_raw if _normalize_text(item)]

    summary = _normalize_text(plan_data.get("summary", ""), max_chars=320)
    if not summary:
        summary = "Generated overlay plan."

    primary_cta = _normalize_text(plan_data.get("primary_cta", ""), max_chars=80)
    if not primary_cta:
        primary_cta = normalized[-1].text

    return ReelOverlayPlan(
        provider=provider,
        reel_path=str(reel_path),
        summary=summary,
        hooks=hooks[:5],
        primary_cta=primary_cta,
        overlays=normalized,
        metadata=metadata,
        brand_intelligence=brand_intelligence,
    )


def _template_hooks(
    *,
    brand_name: str,
    product_name: str,
    objective: str,
    brand_intelligence: BrandIntelligence,
) -> list[str]:
    focus = product_name.strip() or brand_name.strip() or "this drop"
    leading_message = brand_intelligence.key_messages[0] if brand_intelligence.key_messages else ""
    audience_trigger = (
        brand_intelligence.audience_responses[0]
        if brand_intelligence.audience_responses
        else ""
    )
    objective_key = objective.strip().lower()
    if objective_key == "awareness":
        hooks = [
            f"Meet {focus}",
            "Watch this in 3 seconds",
            "The details are the difference",
        ]
    elif objective_key == "traffic":
        hooks = [
            f"New in: {focus}",
            "Tap to see full details",
            "Your next wardrobe staple",
        ]
    else:
        hooks = [
            f"Stop scrolling: {focus}",
            "See the transformation",
            "This is your sign to try it",
        ]

    if leading_message:
        hooks[1] = leading_message[:60]
    if audience_trigger:
        hooks[2] = f"People loved: {audience_trigger}"[:60]
    return hooks


def _template_primary_cta(*, objective: str) -> str:
    objective_key = objective.strip().lower()
    if objective_key == "awareness":
        return "Follow for more drops"
    if objective_key == "traffic":
        return "Tap to explore"
    return "Shop now"


def _template_overlay_lines(
    *,
    brand_name: str,
    product_name: str,
    tone: str,
    audience: str,
    objective: str,
    brand_intelligence: BrandIntelligence,
) -> list[str]:
    focus = product_name.strip() or brand_name.strip() or "New arrival"
    tone_text = tone.strip() or "premium"
    audience_text = audience.strip()
    audience_suffix = f" for {audience_text}" if audience_text else ""
    site_message = brand_intelligence.key_messages[0] if brand_intelligence.key_messages else ""
    audience_messages = brand_intelligence.audience_responses[:4]

    objective_key = objective.strip().lower()
    if objective_key == "awareness":
        lines = [
            f"{focus}",
            f"{tone_text.capitalize()} design{audience_suffix}",
            "Styled for everyday impact",
            "Close-up details you can feel",
        ]
    elif objective_key == "traffic":
        lines = [
            f"New in: {focus}",
            "Look closer at the texture",
            f"{tone_text.capitalize()} fit{audience_suffix}",
            "Swipe for full collection",
        ]
    else:
        lines = [
            f"Stop scrolling: {focus}",
            "Premium look. Everyday wear.",
            f"{tone_text.capitalize()} styling{audience_suffix}",
            "Designed to carry your story",
        ]

    if site_message:
        lines[1] = site_message[:60]
    if audience_messages:
        lines[2] = f"Crowd response: {audience_messages[0]}"[:60]
    if len(audience_messages) > 1:
        lines[3] = f"Proudly rooted in {_audience_phrase(audience_messages[1])}"[:60]
    if len(audience_messages) > 2:
        lines.append(f"Inspired by {_audience_phrase(audience_messages[2])}"[:60])
    if len(audience_messages) > 3:
        lines.append(f"Made for {_audience_phrase(audience_messages[3])}"[:60])
    if audience_suffix:
        lines.append(f"Designed{audience_suffix}"[:60])
    lines.append(f"{tone_text.capitalize()} finish, meaningful detail"[:60])

    return _dedupe_strings(lines, limit=10)


def _extract_frame_payloads(
    *,
    reel_path: Path,
    windows: list[TimingWindow],
    max_frames: int,
) -> list[dict[str, Any]]:
    if max_frames <= 0:
        return []

    selected_windows = windows[:max_frames]
    frame_payloads: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="reel-frames-") as temp_dir:
        temp_root = Path(temp_dir)
        for index, window in enumerate(selected_windows):
            timestamp = round((window.start_sec + window.end_sec) / 2.0, 2)
            frame_path = temp_root / f"frame-{index:02d}.jpg"
            command = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-ss",
                str(timestamp),
                "-i",
                str(reel_path),
                "-frames:v",
                "1",
                str(frame_path),
            ]
            try:
                completed = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    check=False,
                )
            except FileNotFoundError:
                return []
            if completed.returncode != 0 or not frame_path.exists():
                continue
            try:
                frame_bytes = frame_path.read_bytes()
            except OSError:
                continue
            if not frame_bytes:
                continue
            encoded = base64.b64encode(frame_bytes).decode("ascii")
            frame_payloads.append(
                {
                    "timestamp_sec": timestamp,
                    "data_url": f"data:image/jpeg;base64,{encoded}",
                }
            )
    return frame_payloads


def _extract_json_object(content: Any) -> dict[str, Any] | None:
    if isinstance(content, dict):
        return content
    if isinstance(content, list):
        text_chunks: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text_chunks.append(str(item.get("text", "")))
            else:
                text_chunks.append(str(item))
        content = "".join(text_chunks)
    if not isinstance(content, str):
        return None

    raw_text = content.strip()
    if not raw_text:
        return None

    try:
        parsed = json.loads(raw_text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    start = raw_text.find("{")
    end = raw_text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(raw_text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _parse_fps(raw: str) -> float | None:
    text = raw.strip()
    if not text:
        return None
    if "/" in text:
        numerator, denominator = text.split("/", 1)
        num = _safe_float(numerator, 0.0)
        den = _safe_float(denominator, 1.0)
        if den == 0:
            return None
        fps = num / den
        return round(fps, 2) if fps > 0 else None
    fps = _safe_float(text, 0.0)
    return round(fps, 2) if fps > 0 else None


def _normalize_text(value: Any, *, max_chars: int = 120) -> str:
    text = str(value or "").replace("\n", " ").strip()
    return " ".join(text.split())[:max(1, max_chars)]


def _normalize_choice(value: Any, *, allowed: set[str], fallback: str) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in allowed else fallback


def _audience_phrase(value: str) -> str:
    text = _normalize_text(value, max_chars=80)
    lowered = text.lower()
    prefixes = (
        "pride in ",
        "love for ",
        "nostalgia for ",
        "support and solidarity with ",
    )
    for prefix in prefixes:
        if lowered.startswith(prefix):
            stripped = text[len(prefix) :].strip()
            if stripped:
                return stripped
    return text


def _is_noise_line(text: str) -> bool:
    normalized = _normalize_text(text).lower()
    if not normalized:
        return True
    if normalized in NOISE_LINES:
        return True
    if len(normalized) < 4:
        return True
    return False


def _safe_float(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _safe_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _dedupe_strings(values: list[str], *, limit: int) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for raw in values:
        text = _normalize_text(raw)
        if not text:
            continue
        marker = text.lower()
        if marker in seen:
            continue
        deduped.append(text)
        seen.add(marker)
        if len(deduped) >= limit:
            break
    return deduped


def _clamp(value: float, minimum: float, maximum: float) -> float:
    if value < minimum:
        return minimum
    if value > maximum:
        return maximum
    return value
