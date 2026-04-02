from __future__ import annotations

import base64
import hashlib
import importlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import wave
from dataclasses import dataclass
from datetime import UTC, datetime
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import cv2
import numpy as np
import requests

from .creative_library_storage import _connect
from .creative_rollups import _ensure_rollup_schema, _materialize_creative_identity, _resolve_existing_store_key
from .firered_audio import analyze_firered_audio_source
from .models import (
    CreativeLabelEvidence,
    CreativeLabelExtractedTextFrame,
    CreativeLabelMaterializationResult,
    CreativeLabelRecord,
    CreativeStageAVisualLabels,
    CreativeStageBTextLabels,
    CreativeStageCAudioLabels,
    CreativeStageDEvidence,
    CreativeStageDStrategicLabels,
)

QWEN_VISUAL_PROMPT_VERSION = "qwen_visual_structural_doc_v2"
GEMINI_TEXT_PROMPT_VERSION = "gemini_text_layer_doc_v3"
AUDIO_LAYER_PROMPT_VERSION = "audio_layer_doc_v2"
CLAUDE_STRATEGIC_PROMPT_VERSION = "claude_strategic_doc_v2"
LIBROSA_MODEL_VERSION = "audio_energy_doc_v2"

QWEN_STAGE_A_SYSTEM_PROMPT = """
You are a visual creative analyst for e-commerce video ads. You will receive 8 frames from a video ad, extracted at specific timestamps.

Your job is to output a structured JSON with visual properties of this creative. You must select EXACTLY ONE value per field from the allowed values listed below. Do not add commentary, explanation, or any text outside the JSON.

If you are uncertain between two values, choose the one that describes the MAJORITY of the video's screen time based on the frames you see.
""".strip()

QWEN_STAGE_A_USER_PROMPT = """
Analyze these 8 frames from a video ad. The frames are in chronological order from the video.

Frame timestamps: 0s, 1s, 2s, 3s, 5s, 7s, {midpoint}s, {end}s

Output ONLY a JSON object with these fields and ONLY these allowed values:

{{
  "production_feel": "native" | "clean" | "polished",
  "delivery_format": "model_outfit_reveal" | "on_body_showcase" | "problem_solution_reveal" | "hands_product_reveal" | "product_macro_showcase" | "product_flatlay_showcase" | "ugc_testimonial" | "voiceover_demo" | "text_led_showcase" | "mixed_demo",
  "face_presence": "none" | "minor" | "major",
  "body_presence": "none" | "minor" | "major",
  "hands_presence": "none" | "minor" | "major",
  "face_role": "background" | "supporting" | "primary" | "not_applicable",
  "body_role": "background" | "supporting" | "primary" | "not_applicable",
  "hands_role": "background" | "supporting" | "primary" | "not_applicable",
  "on_body_prominence": "none" | "partial" | "dominant",
  "detail_intensity": "low" | "moderate" | "high" | "rich_macro",
  "texture_emphasis": "none" | "subtle" | "moderate" | "strong",
  "product_prominence": "low" | "moderate" | "high" | "dominant",
  "motion_style": "static_showcase" | "slow_detail_pan" | "handheld_reveal" | "guided_demo" | "mixed",
  "opening_focus": "person" | "product" | "text" | "mixed",
  "styling_count": "single" | "multiple"
}}

Rules:
- production_feel: if uncertain between "native" and "clean", default to "native". If uncertain between "clean" and "polished", default to "clean".
- face_role, body_role, hands_role: set to "not_applicable" if the corresponding presence field is "none"
- delivery_format: classify by what dominates >60% of screen time. If truly split, use "mixed_demo"
- motion_style: judge from the DIFFERENCES between consecutive frames, not from any single frame
- opening_focus: judge from the FIRST TWO frames only (0s and 1s)
- styling_count: "multiple" only if the product is shown in 2+ distinctly different outfit combinations

Output ONLY the JSON. No other text.
""".strip()

GEMINI_STAGE_B_SYSTEM_PROMPT = """
You are a text and copy analyst for e-commerce video ads. You will receive 8 frames from a video ad.

Your job is to:
1. Extract ALL visible text from each frame in chronological order
2. Classify the text properties of the creative

Output a structured JSON. Do not add commentary outside the JSON.
""".strip()

GEMINI_STAGE_B_USER_PROMPT = """
Analyze these 8 frames from a video ad for on-screen text content.

Frame timestamps: 0s, 1s, 2s, 3s, 5s, 7s, {midpoint}s, {end}s

Output ONLY a JSON object with these fields:

{{
  "extracted_text_sequence": [
    {{"timestamp": "0s", "text": "exact text visible in this frame, or empty string if none"}},
    {{"timestamp": "1s", "text": "..."}},
    {{"timestamp": "2s", "text": "..."}},
    {{"timestamp": "3s", "text": "..."}},
    {{"timestamp": "5s", "text": "..."}},
    {{"timestamp": "7s", "text": "..."}},
    {{"timestamp": "mid", "text": "..."}},
    {{"timestamp": "end", "text": "..."}}
  ],
  "text_density": "none" | "low" | "medium" | "high",
  "text_role": "none" | "support" | "selling" | "story_led" | "dominant",
  "opening_text_focus": "none" | "support" | "clear" | "dominant"
}}

Rules:
- extracted_text_sequence: transcribe ALL visible text per frame, including Arabic text. If no text is visible, use empty string "".
- text_density: none = 0 frames with text. low = 1-2 frames. medium = 3-5 frames. high = 6+ frames.
- text_role: judge by the PURPOSE of the text across the whole video:
  - "support" = text labels or describes what's shown ("100% cotton", "Embroidered Zaytoon Tree")
  - "selling" = text pushes purchase ("Shop now", "Limited quantity", "Secure yours")
  - "story_led" = text tells a sequential narrative (problem → solution → CTA)
  - "dominant" = text IS the creative, visuals are secondary
- opening_text_focus: judge from the FIRST TWO frames only (0s and 1s):
  - "none" = no text visible in first 2 frames
  - "support" = text present but small or secondary
  - "clear" = text readable and important to the opening
  - "dominant" = text IS the hook, visuals are secondary

Output ONLY the JSON. No other text.
""".strip()

CLAUDE_STAGE_D_SYSTEM_PROMPT = """
You are a senior creative strategist analyzing e-commerce video ads for a brand that sells apparel with cultural and heritage design elements.

You will receive:
1. A structured JSON of visual properties (from a vision model)
2. A structured JSON of text properties and extracted copy (from an OCR model)
3. Audio classification results
4. Four key frames from the video (opening, early, mid, end)

Your job is to score the STRATEGIC and SUBJECTIVE properties of this creative. The visual and text properties are already scored — do not re-score them. Focus only on the fields listed below.

You must select EXACTLY ONE value per field from the allowed values. You must also provide a short evidence string for each property group explaining your reasoning.
""".strip()

CLAUDE_STAGE_D_USER_PROMPT = """
Here are the pre-scored visual properties:
{qwen_output_json}

Here are the pre-scored text properties:
{gemini_output_json}

Audio classification:
- audio_source_type: {audio_source_type}
- voiceover_present: {voiceover_present}
- music_energy: {music_energy}

Four key frames from the video are attached (0s, 3s, 7s, end).

Score ONLY these fields. Output ONLY a JSON object:

{{
  "opening_mechanism": "direct_claim" | "visual_reveal" | "outfit_reveal" | "detail_reveal" | "problem_open" | "offer_open" | "identity_open" | "story_open" | "curiosity_claim" | "social_proof_open" | "scarcity_open" | "mixed",
  "opening_energy": "calm" | "steady" | "punchy" | "aggressive",
  "emotional_angle": "pride_identity" | "urgency" | "warmth_nostalgia" | "aspiration" | "curiosity" | "trust",
  "heritage_emphasis_level": "none" | "subtle" | "moderate" | "strong",
  "cause_product_balance": "cause_led" | "cause_tilted" | "balanced" | "product_tilted" | "product_led",
  "craft_emphasis": "none" | "subtle" | "moderate" | "strong",
  "surprise_detail": "none" | "subtle" | "deliberate",
  "occasion_framing": "none" | "seasonal" | "religious" | "cultural_event" | "everyday",
  "evidence": {{
    "opening": "1-2 sentence rationale for opening_mechanism and opening_energy",
    "emotional": "1-2 sentence rationale for emotional_angle",
    "heritage": "1-2 sentence rationale for heritage_emphasis_level and cause_product_balance",
    "craft": "1-2 sentence rationale for craft_emphasis",
    "surprise": "1-2 sentence rationale for surprise_detail",
    "occasion": "1-2 sentence rationale for occasion_framing"
  }}
}}

Rules:
- opening_mechanism: judge from the FIRST frame (0s) and the extracted text at 0s and 1s. What hook technique does the opening use?
- opening_energy: judge from the pace of change between frames 0s→1s→2s→3s and the text tone (exclamation marks = punchy, ellipsis = steady, etc.)
- emotional_angle: what is the SINGLE PRIMARY emotion this creative evokes? Choose the one the opening most directly triggers.
- heritage_emphasis_level: not whether heritage elements exist in the product, but how much the CREATIVE STRATEGY emphasizes heritage as a selling point. A product with tatreez shown in a pure sale ad = "subtle". The same product in a "Palestinian Inspired Skirt" ad = "strong".
- cause_product_balance: where on the spectrum is the creative's messaging? Pure cause messaging with product secondary = cause_led. Pure product selling with no cause reference = product_led.
- craft_emphasis: how much does the creative highlight the making, quality, or artisanal nature of the product?
- surprise_detail: does the creative contain a choreographed moment where a hidden product feature is revealed? A pocket opening to show hidden embroidery = "deliberate". A brief glimpse of stitching detail = "subtle". Standard product showcase = "none".
- occasion_framing: does the creative tie the product to a specific occasion? "Elegance for Ramadan evenings" = "religious". "Winter Sale" = "seasonal". No occasion reference = "none".

Output ONLY the JSON. No other text.
""".strip()


@dataclass
class _FramePayload:
    label: str
    seconds: float
    image_bytes: bytes
    mime_type: str = "image/jpeg"


@dataclass
class _PreparedMedia:
    scope_media_hash: str
    canonical_creative_id: str
    variant_id: str
    creative_name: str
    body_text: str
    headline: str
    media_type: str
    source_media_url: str
    thumbnail_url: str
    preview_url: str
    duration_seconds: float | None
    frames_stage_ab: list[_FramePayload]
    frames_stage_d: list[_FramePayload]
    audio_path: str | None
    local_media_path: str = ""


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _hash_payload(value: Any) -> str:
    normalized = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


_TRACKING_QUERY_KEYS = {
    "fbclid",
    "gclid",
    "msclkid",
    "utm_campaign",
    "utm_content",
    "utm_id",
    "utm_medium",
    "utm_source",
    "utm_term",
}


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _first_non_empty(*values: Any) -> str:
    for value in values:
        text = _clean_text(value)
        if text:
            return text
    return ""


def _mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list_of_dicts(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _meta_access_token_for_store(store_key: Any) -> str:
    raw_store = _clean_text(store_key).lower()
    if not raw_store:
        return _clean_text(os.getenv("META_ACCESS_TOKEN", ""))

    parts = [part for part in re.split(r"[^a-z0-9]+", raw_store) if part]
    prefixes: list[str] = []
    if parts:
        prefixes.append("_".join(part.upper() for part in parts))
        prefixes.append(parts[0].upper())

    seen: set[str] = set()
    env_names: list[str] = []
    for prefix in prefixes:
        env_name = f"{prefix}_META_ACCESS_TOKEN"
        if env_name not in seen:
            seen.add(env_name)
            env_names.append(env_name)
    env_names.append("META_ACCESS_TOKEN")

    for env_name in env_names:
        token = _clean_text(os.getenv(env_name, ""))
        if token:
            return token
    return ""


def _stable_url(value: Any) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    try:
        parsed = urlparse(text)
        if not parsed.scheme:
            return text
        from urllib.parse import parse_qsl, urlencode, urlunparse

        filtered_pairs = [
            (key, item)
            for key, item in parse_qsl(parsed.query, keep_blank_values=True)
            if key.lower() not in _TRACKING_QUERY_KEYS
        ]
        cleaned = parsed._replace(
            scheme=parsed.scheme.lower(),
            netloc=parsed.netloc.lower(),
            query=urlencode(filtered_pairs, doseq=True),
            fragment="",
        )
        return urlunparse(cleaned)
    except Exception:
        return text


def _normalize_media_locator(value: Any) -> str:
    candidate = unescape(_clean_text(value)).replace("&amp;", "&").strip()
    if not candidate:
        return ""
    for _ in range(3):
        decoded = unquote(candidate)
        if decoded == candidate:
            break
        candidate = decoded.strip()
    if candidate.startswith("//"):
        return f"https:{candidate}"
    if candidate.startswith("/"):
        return f"https://www.facebook.com{candidate}"
    return candidate


def _story_parts_from_creative(creative: dict[str, Any]) -> dict[str, Any]:
    story = _mapping(creative.get("object_story_spec"))
    return {
        "story": story,
        "link_data": _mapping(story.get("link_data")),
        "video_data": _mapping(story.get("video_data")),
        "photo_data": _mapping(story.get("photo_data")),
        "template_data": _mapping(story.get("template_data")),
    }


def _extract_video_id_from_creative(creative: dict[str, Any]) -> str:
    if not creative:
        return ""
    parts = _story_parts_from_creative(creative)
    direct_video_id = _first_non_empty(
        parts["video_data"].get("video_id"),
        parts["link_data"].get("video_id"),
    )
    if direct_video_id:
        return direct_video_id

    asset_videos = _list_of_dicts(_mapping(creative.get("asset_feed_spec")).get("videos"))
    first_video = next((item for item in asset_videos if item.get("video_id")), asset_videos[0] if asset_videos else {})
    if first_video:
        return _clean_text(first_video.get("video_id"))

    carousel_cards = _list_of_dicts(parts["link_data"].get("child_attachments"))
    video_card = next((item for item in carousel_cards if item.get("video_id")), {})
    return _clean_text(video_card.get("video_id"))


def _extract_candidate_urls_from_creative(creative: dict[str, Any]) -> list[str]:
    if not creative:
        return []
    parts = _story_parts_from_creative(creative)
    asset_feed_spec = _mapping(creative.get("asset_feed_spec"))
    asset_videos = _list_of_dicts(asset_feed_spec.get("videos"))
    asset_images = _list_of_dicts(asset_feed_spec.get("images"))
    child_attachments = _list_of_dicts(parts["link_data"].get("child_attachments"))
    candidates: list[str] = []
    for value in (
        creative.get("thumbnail_url"),
        creative.get("image_url"),
        parts["video_data"].get("image_url"),
        parts["link_data"].get("image_url"),
        parts["link_data"].get("picture"),
        parts["photo_data"].get("url"),
        parts["photo_data"].get("image_url"),
        asset_videos[0].get("thumbnail_url") if asset_videos else "",
        asset_videos[0].get("picture") if asset_videos else "",
        asset_images[0].get("url") if asset_images else "",
        asset_images[0].get("image_url") if asset_images else "",
        child_attachments[0].get("picture") if child_attachments else "",
        child_attachments[0].get("image_url") if child_attachments else "",
    ):
        url = _stable_url(value)
        if url and url not in candidates:
            candidates.append(url)
    return candidates


def _extract_raw_meta_creative(raw_json_text: str) -> dict[str, Any]:
    try:
        payload = json.loads(str(raw_json_text or "{}"))
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    ad = _mapping(payload.get("ad"))
    creative = _mapping(ad.get("creative"))
    return creative


def _extract_raw_meta_ad_id(raw_json_text: str) -> str:
    try:
        payload = json.loads(str(raw_json_text or "{}"))
    except Exception:
        return ""
    if not isinstance(payload, dict):
        return ""
    ad = _mapping(payload.get("ad"))
    return _clean_text(ad.get("id"))


def _extract_json_object(text: str) -> dict[str, Any]:
    candidate = str(text or "").strip()
    if not candidate:
        raise RuntimeError("model returned empty response")
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise RuntimeError("model did not return valid json")
        return json.loads(candidate[start : end + 1])


def _ensure_label_schema(conn: sqlite3.Connection) -> None:
    _ensure_rollup_schema(conn)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS creative_label_cache (
            tenant_key TEXT NOT NULL,
            store_key TEXT NOT NULL,
            scope_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            model_name TEXT NOT NULL,
            model_version TEXT NOT NULL,
            output_group TEXT NOT NULL,
            input_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ready',
            is_model_rejected INTEGER NOT NULL DEFAULT 0,
            request_json TEXT NOT NULL DEFAULT '{}',
            response_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (
                tenant_key, store_key, scope_type, entity_id,
                model_name, model_version, output_group, input_hash
            )
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS creative_labels (
            tenant_key TEXT NOT NULL,
            store_key TEXT NOT NULL,
            canonical_creative_id TEXT NOT NULL,
            variant_id TEXT NOT NULL,
            labeled_at TEXT NOT NULL,
            production_feel TEXT CHECK(production_feel IN ('native','clean','polished')),
            delivery_format TEXT CHECK(delivery_format IN ('model_outfit_reveal','on_body_showcase','problem_solution_reveal','hands_product_reveal','product_macro_showcase','product_flatlay_showcase','ugc_testimonial','voiceover_demo','text_led_showcase','mixed_demo')),
            face_presence TEXT CHECK(face_presence IN ('none','minor','major')),
            body_presence TEXT CHECK(body_presence IN ('none','minor','major')),
            hands_presence TEXT CHECK(hands_presence IN ('none','minor','major')),
            face_role TEXT,
            body_role TEXT,
            hands_role TEXT,
            on_body_prominence TEXT CHECK(on_body_prominence IN ('none','partial','dominant')),
            detail_intensity TEXT CHECK(detail_intensity IN ('low','moderate','high','rich_macro')),
            texture_emphasis TEXT CHECK(texture_emphasis IN ('none','subtle','moderate','strong')),
            product_prominence TEXT CHECK(product_prominence IN ('low','moderate','high','dominant')),
            motion_style TEXT CHECK(motion_style IN ('static_showcase','slow_detail_pan','handheld_reveal','guided_demo','mixed')),
            opening_focus TEXT CHECK(opening_focus IN ('person','product','text','mixed')),
            styling_count TEXT CHECK(styling_count IN ('single','multiple')),
            text_density TEXT CHECK(text_density IN ('none','low','medium','high')),
            text_role TEXT CHECK(text_role IN ('none','support','selling','story_led','dominant')),
            opening_text_focus TEXT CHECK(opening_text_focus IN ('none','support','clear','dominant')),
            extracted_text_sequence TEXT NOT NULL DEFAULT '[]',
            audio_source_type TEXT CHECK(audio_source_type IN ('speech','singing','music','mixed','silent')),
            voiceover_present TEXT CHECK(voiceover_present IN ('yes','no')),
            music_energy TEXT CHECK(music_energy IN ('calm','moderate','upbeat','not_applicable')),
            opening_mechanism TEXT CHECK(opening_mechanism IN ('direct_claim','visual_reveal','outfit_reveal','detail_reveal','problem_open','offer_open','identity_open','story_open','curiosity_claim','social_proof_open','scarcity_open','mixed')),
            opening_energy TEXT CHECK(opening_energy IN ('calm','steady','punchy','aggressive')),
            emotional_angle TEXT CHECK(emotional_angle IN ('pride_identity','urgency','warmth_nostalgia','aspiration','curiosity','trust')),
            heritage_emphasis_level TEXT CHECK(heritage_emphasis_level IN ('none','subtle','moderate','strong')),
            cause_product_balance TEXT CHECK(cause_product_balance IN ('cause_led','cause_tilted','balanced','product_tilted','product_led')),
            craft_emphasis TEXT CHECK(craft_emphasis IN ('none','subtle','moderate','strong')),
            surprise_detail TEXT CHECK(surprise_detail IN ('none','subtle','deliberate')),
            occasion_framing TEXT CHECK(occasion_framing IN ('none','seasonal','religious','cultural_event','everyday')),
            evidence TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (tenant_key, store_key, canonical_creative_id, variant_id)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_creative_labels_lookup
        ON creative_labels(tenant_key, store_key, canonical_creative_id, variant_id)
        """
    )
    conn.commit()


def _cache_fetch(
    *,
    conn: sqlite3.Connection,
    tenant_key: str,
    store_key: str,
    scope_type: str,
    entity_id: str,
    model_name: str,
    model_version: str,
    output_group: str,
    input_hash: str,
    model_cls: type,
) -> Any | None:
    row = conn.execute(
        """
        SELECT response_json
        FROM creative_label_cache
        WHERE tenant_key = ?
          AND store_key = ?
          AND scope_type = ?
          AND entity_id = ?
          AND model_name = ?
          AND model_version = ?
          AND output_group = ?
          AND input_hash = ?
          AND status = 'ready'
          AND is_model_rejected = 0
        """,
        (
            tenant_key,
            store_key,
            scope_type,
            entity_id,
            model_name,
            model_version,
            output_group,
            input_hash,
        ),
    ).fetchone()
    if row is None:
        return None
    return model_cls.model_validate(json.loads(str(row["response_json"])))


def _cache_store(
    *,
    conn: sqlite3.Connection,
    tenant_key: str,
    store_key: str,
    scope_type: str,
    entity_id: str,
    model_name: str,
    model_version: str,
    output_group: str,
    input_hash: str,
    request_payload: dict[str, Any],
    response_payload: dict[str, Any],
) -> None:
    timestamp = _utc_now_iso()
    conn.execute(
        """
        INSERT INTO creative_label_cache (
            tenant_key, store_key, scope_type, entity_id,
            model_name, model_version, output_group, input_hash,
            status, is_model_rejected, request_json, response_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', 0, ?, ?, ?, ?)
        ON CONFLICT(
            tenant_key, store_key, scope_type, entity_id,
            model_name, model_version, output_group, input_hash
        ) DO UPDATE SET
            status = excluded.status,
            is_model_rejected = excluded.is_model_rejected,
            request_json = excluded.request_json,
            response_json = excluded.response_json,
            updated_at = excluded.updated_at
        """,
        (
            tenant_key,
            store_key,
            scope_type,
            entity_id,
            model_name,
            model_version,
            output_group,
            input_hash,
            _json_text(request_payload),
            _json_text(response_payload),
            timestamp,
            timestamp,
        ),
    )
    conn.commit()


def _row_to_label_record(row: sqlite3.Row) -> CreativeLabelRecord:
    payload = dict(row)
    payload["extracted_text_sequence"] = json.loads(str(payload.get("extracted_text_sequence") or "[]"))
    payload["evidence"] = json.loads(str(payload.get("evidence") or "{}"))
    payload.pop("tenant_key", None)
    payload.pop("store_key", None)
    return CreativeLabelRecord.model_validate(payload)


def _summarize_subject_visibility(qwen_output: CreativeStageAVisualLabels) -> str:
    parts: list[str] = []
    if qwen_output.face_presence != "none":
        parts.append(f"Face is {qwen_output.face_presence} and {qwen_output.face_role}.")
    else:
        parts.append("Face is not shown.")
    if qwen_output.body_presence != "none":
        parts.append(f"Body is {qwen_output.body_presence} and {qwen_output.body_role}.")
    else:
        parts.append("Body is not shown.")
    if qwen_output.hands_presence != "none":
        parts.append(f"Hands are {qwen_output.hands_presence} and {qwen_output.hands_role}.")
    else:
        parts.append("Hands are not shown.")
    return " ".join(parts)


def _summarize_product_presentation(qwen_output: CreativeStageAVisualLabels) -> str:
    return (
        f"On-body prominence is {qwen_output.on_body_prominence}, detail intensity is {qwen_output.detail_intensity}, "
        f"texture emphasis is {qwen_output.texture_emphasis}, product prominence is {qwen_output.product_prominence}, "
        f"and motion style is {qwen_output.motion_style}."
    )


def _summarize_audio_layer(audio_output: CreativeStageCAudioLabels) -> str:
    summary = (
        f"Audio source is {audio_output.audio_source_type}, voiceover is {audio_output.voiceover_present}, "
        f"and music energy is {audio_output.music_energy}."
    )
    speech_ratio = audio_output.evidence.get("speech_ratio")
    singing_ratio = audio_output.evidence.get("singing_ratio")
    music_ratio = audio_output.evidence.get("music_ratio")
    ratios: list[str] = []
    if speech_ratio is not None:
        ratios.append(f"speech_ratio={speech_ratio}")
    if singing_ratio is not None:
        ratios.append(f"singing_ratio={singing_ratio}")
    if music_ratio is not None:
        ratios.append(f"music_ratio={music_ratio}")
    if ratios:
        summary = f"{summary} Evidence: {', '.join(ratios)}."
    return summary


def _assemble_label_evidence(
    *,
    qwen_output: CreativeStageAVisualLabels,
    gemini_output: CreativeStageBTextLabels,
    audio_output: CreativeStageCAudioLabels,
    claude_output: CreativeStageDStrategicLabels,
) -> CreativeLabelEvidence:
    production_feel = (
        f"Production feel is {qwen_output.production_feel}; opening focus is {qwen_output.opening_focus} "
        f"and motion style is {qwen_output.motion_style}."
    )
    delivery_format = (
        f"Delivery format is {qwen_output.delivery_format}; text role is {gemini_output.text_role} "
        f"with text density {gemini_output.text_density}."
    )
    creative_angle = " ".join(
        segment
        for segment in (
            claude_output.evidence.emotional.strip(),
            claude_output.evidence.heritage.strip(),
        )
        if segment
    )
    return CreativeLabelEvidence(
        production_feel=production_feel,
        delivery_format=delivery_format,
        subject_visibility=_summarize_subject_visibility(qwen_output),
        product_presentation=_summarize_product_presentation(qwen_output),
        opening=claude_output.evidence.opening,
        creative_angle=creative_angle,
        audio_layer=_summarize_audio_layer(audio_output),
    )


def get_creative_label_record(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    canonical_creative_id: str,
    variant_id: str | None = None,
) -> CreativeLabelRecord | None:
    conn = _connect(db_path)
    try:
        _ensure_label_schema(conn)
        resolved_store_key = _resolve_existing_store_key(
            conn,
            tenant_key=tenant_key,
            requested_store_key=store_key,
            tables=("creative_labels", "creative_identity", "creative_assets", "creative_variants"),
        )
        if variant_id:
            row = conn.execute(
                """
                SELECT *
                FROM creative_labels
                WHERE tenant_key = ? AND store_key = ? AND canonical_creative_id = ? AND variant_id = ?
                """,
                (tenant_key, resolved_store_key, canonical_creative_id, variant_id),
            ).fetchone()
        else:
            row = conn.execute(
                """
                SELECT *
                FROM creative_labels
                WHERE tenant_key = ? AND store_key = ? AND canonical_creative_id = ?
                ORDER BY labeled_at DESC, variant_id DESC
                LIMIT 1
                """,
                (tenant_key, resolved_store_key, canonical_creative_id),
            ).fetchone()
        if row is None:
            return None
        return _row_to_label_record(row)
    finally:
        conn.close()


def _download_to_path(url: str, *, directory: Path, filename_prefix: str) -> tuple[Path, str]:
    target_url = str(url or "").strip()
    if not target_url:
        raise ValueError("media url is required")
    parsed = urlparse(target_url)
    if parsed.scheme in {"", "file"}:
        local_path = Path(parsed.path or target_url).expanduser()
        if not local_path.exists():
            raise FileNotFoundError(f"media file not found: {local_path}")
        destination = directory / f"{filename_prefix}{local_path.suffix or ''}"
        shutil.copy2(local_path, destination)
        return destination, ""

    response = requests.get(target_url, timeout=60)
    response.raise_for_status()
    content_type = str(response.headers.get("content-type", "")).split(";")[0].strip().lower()
    suffix = Path(parsed.path).suffix
    if not suffix:
        suffix = {
            "video/mp4": ".mp4",
            "video/quicktime": ".mov",
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
        }.get(content_type, ".bin")
    destination = directory / f"{filename_prefix}{suffix}"
    destination.write_bytes(response.content)
    return destination, content_type


def _looks_like_video_url(url: str) -> bool:
    candidate = str(url or "").strip().lower()
    if not candidate:
        return False
    parsed = urlparse(candidate)
    path = parsed.path or candidate
    if Path(path).suffix.lower() in {".mp4", ".mov", ".m4v", ".avi", ".webm", ".mkv"}:
        return True
    return "video" in parsed.netloc or "video" in path


def _looks_like_tiny_fb_thumbnail(url: str) -> bool:
    candidate = str(url or "").strip().lower()
    if not candidate:
        return False
    return "fbcdn.net" in candidate and (
        "p64x64" in candidate
        or "p96x96" in candidate
        or "s160x160" in candidate
        or "dst-jpg_s160x160" in candidate
    )


def _resolve_meta_video_source(*, video_id: str, access_token: str) -> str:
    payload = _resolve_meta_video_payload(video_id=video_id, access_token=access_token)
    return str(payload.get("source") or "").strip()


def _resolve_meta_video_payload(*, video_id: str, access_token: str) -> dict[str, Any]:
    resolved_id = str(video_id or "").strip()
    resolved_token = str(access_token or "").strip()
    if not resolved_id or not resolved_token:
        return {}
    graph_version = _clean_text(os.getenv("META_GRAPH_API_VERSION")) or "v22.0"
    response = requests.get(
        f"https://graph.facebook.com/{graph_version}/{resolved_id}",
        params={
            "fields": "id,source,picture,thumbnails{uri},length,permalink_url,embed_html",
            "access_token": resolved_token,
        },
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, dict) else {}


def _resolve_meta_creative_payload(*, creative_id: str, access_token: str) -> dict[str, Any]:
    resolved_id = _clean_text(creative_id)
    resolved_token = _clean_text(access_token)
    if not resolved_id or not resolved_token:
        return {}
    graph_version = _clean_text(os.getenv("META_GRAPH_API_VERSION")) or "v22.0"
    response = requests.get(
        f"https://graph.facebook.com/{graph_version}/{resolved_id}",
        params={
            "fields": (
                "id,name,image_hash,thumbnail_url,image_url,"
                "object_story_spec{video_data,link_data,photo_data,template_data},"
                "asset_feed_spec{videos{video_id,thumbnail_url,picture},images{url,image_url,hash,picture}}"
            ),
            "access_token": resolved_token,
        },
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, dict) else {}


def _resolve_meta_ad_creative_payload(*, ad_id: str, access_token: str) -> dict[str, Any]:
    resolved_id = _clean_text(ad_id)
    resolved_token = _clean_text(access_token)
    if not resolved_id or not resolved_token:
        return {}
    graph_version = _clean_text(os.getenv("META_GRAPH_API_VERSION")) or "v22.0"
    response = requests.get(
        f"https://graph.facebook.com/{graph_version}/{resolved_id}",
        params={
            "fields": "creative{object_story_spec,asset_feed_spec,image_hash,thumbnail_url,image_url}",
            "access_token": resolved_token,
        },
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    return _mapping(payload.get("creative"))


def _extract_url_from_embed_html(embed_html: str) -> str:
    html = str(embed_html or "").strip()
    if not html:
        return ""
    for pattern in (r'href=([^&"]+)', r'src="([^"]+)"', r"src='([^']+)'"):
        match = re.search(pattern, html)
        if match:
            return _normalize_media_locator(match.group(1))
    return ""


def _yt_dlp_prefix() -> list[str]:
    binary = shutil.which("yt-dlp")
    if binary:
        return [binary]
    try:
        importlib.import_module("yt_dlp")
    except Exception:
        return []
    return [sys.executable, "-m", "yt_dlp"]


def _extract_with_ytdlp_url(target_url: str, retry_count: int = 0) -> str:
    url = _normalize_media_locator(target_url)
    if not url:
        return ""
    prefix = _yt_dlp_prefix()
    if not prefix:
        return ""
    commands = [
        prefix + ["-g", "--no-warnings", url],
        prefix + ["-g", "-f", "best[ext=mp4]", "--no-warnings", url],
        prefix + ["-g", "--extractor-args", "facebook:format=dash", "--no-warnings", url],
    ]
    for command in commands:
        try:
            output = subprocess.check_output(
                command,
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=30,
            ).strip()
        except Exception:
            continue
        for line in output.splitlines():
            candidate = line.strip()
            if candidate.startswith("http"):
                return candidate
    if retry_count < 2:
        return _extract_with_ytdlp_url(url, retry_count + 1)
    return ""


def _extract_with_ytdlp_embed(embed_html: str) -> str:
    candidate = _extract_url_from_embed_html(embed_html)
    if not candidate:
        return ""
    return _extract_with_ytdlp_url(candidate)


def _ffmpeg_binary() -> str:
    return shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"


def _ffprobe_binary() -> str:
    return shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"


def _is_video_path(path: Path, content_type: str) -> bool:
    if content_type.startswith("video/"):
        return True
    return path.suffix.lower() in {".mp4", ".mov", ".m4v", ".avi", ".webm", ".mkv"}


def _frame_time_plan(duration_seconds: float | None) -> list[tuple[str, float]]:
    if not duration_seconds or duration_seconds <= 0:
        return [
            ("0s", 0.0),
            ("1s", 0.0),
            ("2s", 0.0),
            ("3s", 0.0),
            ("5s", 0.0),
            ("7s", 0.0),
            ("mid", 0.0),
            ("end", 0.0),
        ]
    midpoint = max(0.0, duration_seconds / 2.0)
    end_second = max(0.0, duration_seconds - 1.0)
    targets = [
        ("0s", 0.0),
        ("1s", 1.0),
        ("2s", 2.0),
        ("3s", 3.0),
        ("5s", 5.0),
        ("7s", 7.0),
        ("mid", midpoint),
        ("end", end_second),
    ]
    ceiling = max(0.0, duration_seconds - 0.05)
    return [(label, min(seconds, ceiling)) for label, seconds in targets]


def _extract_duration_seconds(video_path: Path) -> float | None:
    cap = cv2.VideoCapture(str(video_path))
    if cap.isOpened():
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        frame_count = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
        cap.release()
        if fps > 0 and frame_count > 0:
            duration = frame_count / fps
            if duration > 0:
                return duration
    ffprobe = _ffprobe_binary()
    if ffprobe and Path(ffprobe).exists():
        try:
            output = subprocess.check_output(
                [
                    ffprobe,
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                    str(video_path),
                ],
                stderr=subprocess.DEVNULL,
                text=True,
            ).strip()
            if output:
                return float(output)
        except Exception:
            return None
    return None


def _encode_jpeg(image) -> bytes:
    success, encoded = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    if not success:
        raise RuntimeError("failed to encode frame")
    return encoded.tobytes()


def _extract_video_frames(video_path: Path) -> tuple[list[_FramePayload], list[_FramePayload], float | None]:
    duration_seconds = _extract_duration_seconds(video_path)
    plan = _frame_time_plan(duration_seconds)
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"unable to open video: {video_path}")

    frames: list[_FramePayload] = []
    for label, seconds in plan:
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, seconds) * 1000.0)
        ok, frame = cap.read()
        if not ok or frame is None:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = cap.read()
        if not ok or frame is None:
            raise RuntimeError(f"unable to extract frame at {label}")
        frames.append(_FramePayload(label=label, seconds=seconds, image_bytes=_encode_jpeg(frame)))
    cap.release()
    stage_d = [frames[0], frames[3], frames[5], frames[-1]]
    return frames, stage_d, duration_seconds


def _extract_image_frames(image_path: Path) -> tuple[list[_FramePayload], list[_FramePayload]]:
    image = cv2.imread(str(image_path))
    if image is None:
        raise RuntimeError(f"unable to open image: {image_path}")
    jpeg = _encode_jpeg(image)
    frames = [
        _FramePayload(label=label, seconds=0.0, image_bytes=jpeg)
        for label in ("0s", "1s", "2s", "3s", "5s", "7s", "mid", "end")
    ]
    stage_d = [frames[0], frames[3], frames[5], frames[-1]]
    return frames, stage_d


def _extract_audio_wav(video_path: Path, *, directory: Path) -> Path | None:
    ffmpeg = _ffmpeg_binary()
    if not ffmpeg or not Path(ffmpeg).exists():
        return None
    output_path = directory / "audio.wav"
    try:
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-i",
                str(video_path),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                str(output_path),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return None
    return output_path if output_path.exists() else None


def _fetch_creative_context(
    conn: sqlite3.Connection,
    *,
    tenant_key: str,
    store_key: str,
    canonical_creative_id: str,
    variant_id: str | None,
) -> dict[str, Any]:
    _materialize_creative_identity(conn, tenant_key=tenant_key, store_key=store_key)
    identity = conn.execute(
        """
        SELECT
            ci.canonical_creative_id,
            ci.variant_id AS representative_variant_id,
            ci.family_id,
            ci.media_hash,
            ci.media_url,
            ci.media_type,
            a.source_creative_id,
            a.source_asset_id,
            a.asset_url,
            a.preview_url,
            a.thumbnail_url,
            a.asset_name,
            a.image_hash
        FROM creative_identity ci
        LEFT JOIN creative_assets a
          ON a.tenant_key = ci.tenant_key
         AND a.store_key = ci.store_key
         AND a.asset_id = ci.canonical_creative_id
        WHERE ci.tenant_key = ? AND ci.store_key = ? AND ci.canonical_creative_id = ?
        """,
        (tenant_key, store_key, canonical_creative_id),
    ).fetchone()
    if identity is None:
        raise RuntimeError(f"canonical creative not found: {canonical_creative_id}")

    chosen_variant_id = str(variant_id or identity["representative_variant_id"] or "").strip()
    if chosen_variant_id:
        variant_row = conn.execute(
            """
            SELECT *
            FROM creative_variants
            WHERE tenant_key = ? AND store_key = ? AND variant_id = ?
            """,
            (tenant_key, store_key, chosen_variant_id),
        ).fetchone()
    else:
        variant_row = conn.execute(
            """
            SELECT *
            FROM creative_variants
            WHERE tenant_key = ? AND store_key = ? AND asset_id = ?
            ORDER BY last_seen_at DESC, variant_id DESC
            LIMIT 1
            """,
            (tenant_key, store_key, canonical_creative_id),
        ).fetchone()
    if variant_row is None:
        raise RuntimeError(f"variant not found for canonical creative: {canonical_creative_id}")

    raw_json_text = str(variant_row["raw_json"] or "")
    raw_creative = _extract_raw_meta_creative(raw_json_text)
    source_ad_id = _extract_raw_meta_ad_id(raw_json_text)
    raw_video_id = _extract_video_id_from_creative(raw_creative)
    raw_candidate_urls = _extract_candidate_urls_from_creative(raw_creative)
    resolved_media_type = "video" if raw_video_id else str(identity["media_type"] or "")
    resolved_source_asset_id = _first_non_empty(raw_video_id, identity["source_asset_id"])

    return {
        "store_key": store_key,
        "canonical_creative_id": str(identity["canonical_creative_id"]),
        "variant_id": str(variant_row["variant_id"]),
        "family_id": str(identity["family_id"] or ""),
        "media_hash": str(identity["media_hash"] or identity["canonical_creative_id"]),
        "media_type": resolved_media_type,
        "media_url": str(identity["media_url"] or ""),
        "source_asset_id": resolved_source_asset_id,
        "source_creative_id": _first_non_empty(variant_row["source_creative_id"], identity["source_creative_id"]),
        "source_ad_id": source_ad_id,
        "asset_url": str(identity["asset_url"] or ""),
        "preview_url": str(identity["preview_url"] or ""),
        "thumbnail_url": str(identity["thumbnail_url"] or ""),
        "image_hash": _first_non_empty(identity["image_hash"]),
        "raw_meta_creative": raw_creative,
        "raw_candidate_urls": raw_candidate_urls,
        "raw_video_id": raw_video_id,
        "creative_name": str(variant_row["creative_name"] or identity["asset_name"] or ""),
        "body_text": str(variant_row["body_text"] or ""),
        "headline": str(variant_row["headline"] or ""),
    }


def _prepare_media(context: dict[str, Any], *, directory: Path) -> _PreparedMedia:
    candidate_urls = []
    raw_meta_creative = _mapping(context.get("raw_meta_creative"))
    raw_video_id = _clean_text(context.get("raw_video_id"))
    is_video_creative = str(context.get("media_type") or "").strip().lower() == "video" or bool(raw_video_id)

    for url in context.get("raw_candidate_urls") or []:
        stable = _stable_url(url)
        if stable and stable not in candidate_urls:
            candidate_urls.append(stable)

    for key in ("preview_url", "asset_url", "media_url", "thumbnail_url"):
        value = str(context.get(key) or "").strip()
        if value and value not in candidate_urls:
            candidate_urls.append(value)

    meta_access_token = _meta_access_token_for_store(context.get("store_key"))
    source_creative_id = _clean_text(context.get("source_creative_id"))
    source_ad_id = _clean_text(context.get("source_ad_id"))
    source_asset_id = _clean_text(context.get("source_asset_id"))

    should_refresh_creative = (
        bool(meta_access_token and (source_creative_id or source_ad_id))
        and (
            not raw_meta_creative
            or not candidate_urls
            or all(_looks_like_tiny_fb_thumbnail(url) for url in candidate_urls)
            or (is_video_creative and not any(_looks_like_video_url(url) for url in candidate_urls))
        )
    )
    if should_refresh_creative:
        refreshed_creative = {}
        if source_ad_id:
            try:
                refreshed_creative = _resolve_meta_ad_creative_payload(
                    ad_id=source_ad_id,
                    access_token=meta_access_token,
                )
            except Exception:
                refreshed_creative = {}
        if not refreshed_creative and source_creative_id:
            try:
                refreshed_creative = _resolve_meta_creative_payload(
                    creative_id=source_creative_id,
                    access_token=meta_access_token,
                )
            except Exception:
                refreshed_creative = {}
        if refreshed_creative:
            raw_meta_creative = refreshed_creative
            raw_video_id = _first_non_empty(raw_video_id, _extract_video_id_from_creative(refreshed_creative))
            if raw_video_id:
                is_video_creative = True
            refreshed_urls = _extract_candidate_urls_from_creative(refreshed_creative)
            for url in reversed(refreshed_urls):
                if url and url not in candidate_urls:
                    candidate_urls.insert(0, url)

    if is_video_creative and not any(_looks_like_video_url(url) for url in candidate_urls):
        resolved_video_id = _first_non_empty(raw_video_id, source_asset_id)
        if meta_access_token and resolved_video_id:
            try:
                video_payload = _resolve_meta_video_payload(
                    video_id=resolved_video_id,
                    access_token=meta_access_token,
                )
            except Exception:
                video_payload = {}
            resolved_video_url = _clean_text(video_payload.get("source"))
            if resolved_video_url and resolved_video_url not in candidate_urls:
                candidate_urls.insert(0, resolved_video_url)
            else:
                extracted_video_url = _extract_with_ytdlp_url(_clean_text(video_payload.get("permalink_url")))
                if not extracted_video_url:
                    extracted_video_url = _extract_with_ytdlp_embed(_clean_text(video_payload.get("embed_html")))
                if extracted_video_url and extracted_video_url not in candidate_urls:
                    candidate_urls.insert(0, extracted_video_url)
            for value in (
                video_payload.get("picture"),
                _mapping(video_payload.get("thumbnails")).get("data", [{}])[0].get("uri")
                if isinstance(_mapping(video_payload.get("thumbnails")).get("data"), list)
                and _mapping(video_payload.get("thumbnails")).get("data")
                else "",
            ):
                stable = _stable_url(value)
                if stable and stable not in candidate_urls:
                    candidate_urls.append(stable)
    last_error: Exception | None = None
    for index, url in enumerate(candidate_urls):
        try:
            downloaded_path, content_type = _download_to_path(
                url,
                directory=directory,
                filename_prefix=f"media_{index}",
            )
            if _is_video_path(downloaded_path, content_type):
                frames_ab, frames_d, duration = _extract_video_frames(downloaded_path)
                audio_path = _extract_audio_wav(downloaded_path, directory=directory)
                return _PreparedMedia(
                    scope_media_hash=str(context["media_hash"]),
                    canonical_creative_id=str(context["canonical_creative_id"]),
                    variant_id=str(context["variant_id"]),
                    creative_name=str(context["creative_name"]),
                    body_text=str(context["body_text"]),
                    headline=str(context["headline"]),
                    media_type="video",
                    source_media_url=url,
                    thumbnail_url=str(context.get("thumbnail_url") or ""),
                    preview_url=str(context.get("preview_url") or ""),
                    duration_seconds=duration,
                    frames_stage_ab=frames_ab,
                    frames_stage_d=frames_d,
                    audio_path=str(audio_path) if audio_path is not None else None,
                    local_media_path=str(downloaded_path),
                )
            frames_ab, frames_d = _extract_image_frames(downloaded_path)
            return _PreparedMedia(
                scope_media_hash=str(context["media_hash"]),
                canonical_creative_id=str(context["canonical_creative_id"]),
                variant_id=str(context["variant_id"]),
                creative_name=str(context["creative_name"]),
                body_text=str(context["body_text"]),
                headline=str(context["headline"]),
                media_type="image",
                source_media_url=url,
                thumbnail_url=str(context.get("thumbnail_url") or ""),
                preview_url=str(context.get("preview_url") or ""),
                duration_seconds=None,
                frames_stage_ab=frames_ab,
                frames_stage_d=frames_d,
                audio_path=None,
                local_media_path=str(downloaded_path),
            )
        except Exception as exc:  # pragma: no cover - remote media failures vary
            last_error = exc
            continue
    if last_error is not None:
        raise RuntimeError(f"unable to prepare creative media: {last_error}") from last_error
    raise RuntimeError("creative has no usable media URL")


def _frame_hashes(frames: list[_FramePayload]) -> list[str]:
    return [hashlib.sha256(frame.image_bytes).hexdigest() for frame in frames]


def _frame_data_url(frame: _FramePayload) -> str:
    return f"data:{frame.mime_type};base64,{base64.b64encode(frame.image_bytes).decode('ascii')}"


def _qwen_endpoint(base_url: str) -> str:
    base = str(base_url or "").strip().rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def _run_qwen_stage(
    *,
    frames: list[_FramePayload],
    api_key: str,
    base_url: str,
    model: str,
    timeout_sec: float,
) -> CreativeStageAVisualLabels:
    midpoint_label = next((frame.seconds for frame in frames if frame.label == "mid"), 0.0)
    end_label = next((frame.seconds for frame in frames if frame.label == "end"), 0.0)
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": QWEN_STAGE_A_USER_PROMPT.format(
                midpoint=int(round(midpoint_label)),
                end=int(round(end_label)),
            ),
        }
    ]
    for frame in frames:
        content.append({"type": "image_url", "image_url": {"url": _frame_data_url(frame)}})

    response = requests.post(
        _qwen_endpoint(base_url),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        json={
            "model": model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": QWEN_STAGE_A_SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
        },
        timeout=max(10.0, float(timeout_sec)),
    )
    response.raise_for_status()
    payload = response.json()
    text = str(payload["choices"][0]["message"]["content"])
    return CreativeStageAVisualLabels.model_validate(_extract_json_object(text))


def _run_gemini_stage(
    *,
    frames: list[_FramePayload],
    api_key: str,
    base_url: str,
    model: str,
    timeout_sec: float,
) -> CreativeStageBTextLabels:
    midpoint_label = next((frame.seconds for frame in frames if frame.label == "mid"), 0.0)
    end_label = next((frame.seconds for frame in frames if frame.label == "end"), 0.0)
    endpoint = f"{str(base_url).rstrip('/')}/models/{model}:generateContent?key={api_key}"
    parts: list[dict[str, Any]] = [
        {
            "text": GEMINI_STAGE_B_USER_PROMPT.format(
                midpoint=int(round(midpoint_label)),
                end=int(round(end_label)),
            )
        }
    ]
    for frame in frames:
        parts.append(
            {
                "inline_data": {
                    "mime_type": frame.mime_type,
                    "data": base64.b64encode(frame.image_bytes).decode("ascii"),
                }
            }
        )
    response = requests.post(
        endpoint,
        headers={"Content-Type": "application/json"},
        json={
            "systemInstruction": {"parts": [{"text": GEMINI_STAGE_B_SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "temperature": 0,
                "responseMimeType": "application/json",
            },
        },
        timeout=max(10.0, float(timeout_sec)),
    )
    response.raise_for_status()
    payload = response.json()
    candidate_text = str(payload["candidates"][0]["content"]["parts"][0]["text"])
    parsed = _extract_json_object(candidate_text)
    parsed = _normalize_gemini_text_output(parsed, frames=frames)
    return CreativeStageBTextLabels.model_validate(parsed)


def _normalize_gemini_text_output(
    parsed: dict[str, Any],
    *,
    frames: list[_FramePayload],
) -> dict[str, Any]:
    sequence = [
        CreativeLabelExtractedTextFrame.model_validate(item).model_dump()
        for item in parsed.get("extracted_text_sequence") or []
    ]
    normalized = dict(parsed)

    if not frames:
        normalized["extracted_text_sequence"] = sequence
        return normalized

    frame_hashes = {hashlib.sha256(frame.image_bytes).hexdigest() for frame in frames}
    is_static_still = len(frame_hashes) == 1
    if not is_static_still:
        normalized["extracted_text_sequence"] = sequence
        return normalized

    first_visible_text = ""
    for item in sequence:
        candidate = str(item.get("text") or "").strip()
        if candidate:
            first_visible_text = candidate
            break

    normalized["extracted_text_sequence"] = [
        CreativeLabelExtractedTextFrame(timestamp="0s", text=first_visible_text).model_dump()
    ]
    if first_visible_text:
        normalized["text_density"] = "low"
        if str(normalized.get("opening_text_focus") or "").strip() == "none":
            normalized["opening_text_focus"] = "clear"
    else:
        normalized["text_density"] = "none"
        normalized["text_role"] = "none"
        normalized["opening_text_focus"] = "none"
    return normalized


def _classify_audio_source(
    speech_ratio: float | None,
    singing_ratio: float | None,
    music_ratio: float | None,
) -> tuple[str, str]:
    speech = float(speech_ratio or 0.0)
    singing = float(singing_ratio or 0.0)
    music = float(music_ratio or 0.0)

    if speech + singing + music < 0.1:
        return "silent", "no"
    voiceover = "yes" if speech > 0.3 else "no"
    if speech > 0.5:
        return "speech", voiceover
    if singing > 0.3:
        return "singing", voiceover
    if music > 0.3:
        return "music", voiceover
    if speech + singing > 0.4:
        return "mixed", voiceover
    if music + singing > 0.4:
        return "mixed", voiceover
    return "music", voiceover


def _load_pcm_wav(audio_path: str) -> tuple[np.ndarray, int]:
    with wave.open(audio_path, "rb") as handle:
        sample_rate = int(handle.getframerate() or 16000)
        channels = max(1, int(handle.getnchannels() or 1))
        sample_width = int(handle.getsampwidth() or 2)
        frame_count = int(handle.getnframes() or 0)
        raw = handle.readframes(frame_count)

    if sample_width == 1:
        data = np.frombuffer(raw, dtype=np.uint8).astype(np.float32)
        data = (data - 128.0) / 128.0
    elif sample_width == 2:
        data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sample_width == 4:
        data = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise RuntimeError(f"unsupported wav sample width: {sample_width}")

    if channels > 1:
        usable = data[: (data.size // channels) * channels]
        data = usable.reshape(-1, channels).mean(axis=1)
    return data.astype(np.float32), sample_rate


def _estimate_tempo_bpm(waveform: np.ndarray, sample_rate: int) -> float:
    if waveform.size == 0 or sample_rate <= 0:
        return 0.0
    frame_size = max(256, int(sample_rate * 0.05))
    hop_size = max(128, int(sample_rate * 0.025))
    if waveform.size < frame_size:
        return 0.0

    envelope: list[float] = []
    for start in range(0, waveform.size - frame_size + 1, hop_size):
        frame = waveform[start : start + frame_size]
        envelope.append(float(np.mean(np.abs(frame))))
    if not envelope:
        return 0.0

    energy = np.asarray(envelope, dtype=np.float32)
    threshold = max(float(np.mean(energy) + np.std(energy) * 0.5), 0.02)
    min_gap = max(1, int(0.18 / (hop_size / sample_rate)))
    peak_indices: list[int] = []
    last_index = -min_gap
    for index in range(1, len(energy) - 1):
        if index - last_index < min_gap:
            continue
        current = float(energy[index])
        if current < threshold:
            continue
        if current >= float(energy[index - 1]) and current >= float(energy[index + 1]):
            peak_indices.append(index)
            last_index = index

    duration_seconds = waveform.size / float(sample_rate)
    if duration_seconds <= 0 or not peak_indices:
        return 0.0
    return float(len(peak_indices) * 60.0 / duration_seconds)


def _compute_music_energy(audio_path: str, *, audio_source_type: str) -> str:
    if audio_source_type in {"silent", "speech"}:
        return "not_applicable"
    y, sr = _load_pcm_wav(audio_path)
    rms = float(np.sqrt(np.mean(np.square(y, dtype=np.float32)))) if y.size else 0.0
    tempo = _estimate_tempo_bpm(y, sr)
    if rms < 0.025:
        return "not_applicable"
    if tempo < 85 or rms < 0.06:
        return "calm"
    if tempo < 120:
        return "moderate"
    return "upbeat"


def _run_audio_stage(
    *,
    audio_path: str | None,
    endpoint_url: str,
    api_token: str,
    timeout_sec: float,
) -> CreativeStageCAudioLabels:
    if not audio_path:
        return CreativeStageCAudioLabels(
            audio_source_type="silent",
            voiceover_present="no",
            music_energy="not_applicable",
            evidence={"reason": "no extractable audio track"},
            model_id="firered+librosa",
        )
    audio_file = Path(audio_path)
    firered = analyze_firered_audio_source(
        endpoint_url=endpoint_url,
        api_token=api_token,
        audio_bytes=audio_file.read_bytes(),
        audio_mime_type="audio/wav",
        audio_filename=audio_file.name,
        timeout_sec=timeout_sec,
    )
    if any(value is not None for value in (firered.speech_ratio, firered.singing_ratio, firered.music_ratio)):
        audio_source_type, voiceover_present = _classify_audio_source(
            firered.speech_ratio,
            firered.singing_ratio,
            firered.music_ratio,
        )
    else:
        if firered.voice_music_ratio == "voice_dominant":
            audio_source_type, voiceover_present = "speech", "yes"
        elif firered.voice_music_ratio == "balanced":
            audio_source_type, voiceover_present = "mixed", "no"
        else:
            audio_source_type, voiceover_present = "music", "no"
    music_energy = _compute_music_energy(audio_path, audio_source_type=audio_source_type)
    return CreativeStageCAudioLabels(
        audio_source_type=audio_source_type,
        voiceover_present=voiceover_present,
        music_energy=music_energy,
        evidence={
            "voice_music_ratio": firered.voice_music_ratio,
            "speech_ratio": firered.speech_ratio,
            "singing_ratio": firered.singing_ratio,
            "music_ratio": firered.music_ratio,
            "firered_evidence": firered.evidence,
        },
        model_id=firered.model_id or "firered+librosa",
    )


def _run_claude_stage(
    *,
    qwen_output: CreativeStageAVisualLabels,
    gemini_output: CreativeStageBTextLabels,
    audio_output: CreativeStageCAudioLabels,
    frames: list[_FramePayload],
    api_key: str,
    model: str,
    base_url: str,
    timeout_sec: float,
) -> CreativeStageDStrategicLabels:
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": CLAUDE_STAGE_D_USER_PROMPT.format(
                qwen_output_json=_json_text(qwen_output.model_dump()),
                gemini_output_json=_json_text(gemini_output.model_dump()),
                audio_source_type=audio_output.audio_source_type,
                voiceover_present=audio_output.voiceover_present,
                music_energy=audio_output.music_energy,
            ),
        }
    ]
    for frame in frames:
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": frame.mime_type,
                    "data": base64.b64encode(frame.image_bytes).decode("ascii"),
                },
            }
        )
    response = requests.post(
        str(base_url or "").strip(),
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        json={
            "model": model,
            "max_tokens": 900,
            "temperature": 0,
            "system": CLAUDE_STAGE_D_SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": content}],
        },
        timeout=max(10.0, float(timeout_sec)),
    )
    response.raise_for_status()
    payload = response.json()
    text_segments = [
        str(item.get("text") or "")
        for item in payload.get("content", [])
        if str(item.get("type") or "") == "text"
    ]
    return CreativeStageDStrategicLabels.model_validate(_extract_json_object("\n".join(text_segments)))


def _store_label_record(
    conn: sqlite3.Connection,
    *,
    tenant_key: str,
    store_key: str,
    record: CreativeLabelRecord,
) -> None:
    payload = record.model_dump()
    conn.execute(
        """
        INSERT INTO creative_labels (
            tenant_key, store_key, canonical_creative_id, variant_id, labeled_at,
            production_feel, delivery_format, face_presence, body_presence, hands_presence,
            face_role, body_role, hands_role, on_body_prominence, detail_intensity,
            texture_emphasis, product_prominence, motion_style, opening_focus, styling_count,
            text_density, text_role, opening_text_focus, extracted_text_sequence,
            audio_source_type, voiceover_present, music_energy, opening_mechanism, opening_energy,
            emotional_angle, heritage_emphasis_level, cause_product_balance, craft_emphasis,
            surprise_detail, occasion_framing, evidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_key, store_key, canonical_creative_id, variant_id)
        DO UPDATE SET
            labeled_at = excluded.labeled_at,
            production_feel = excluded.production_feel,
            delivery_format = excluded.delivery_format,
            face_presence = excluded.face_presence,
            body_presence = excluded.body_presence,
            hands_presence = excluded.hands_presence,
            face_role = excluded.face_role,
            body_role = excluded.body_role,
            hands_role = excluded.hands_role,
            on_body_prominence = excluded.on_body_prominence,
            detail_intensity = excluded.detail_intensity,
            texture_emphasis = excluded.texture_emphasis,
            product_prominence = excluded.product_prominence,
            motion_style = excluded.motion_style,
            opening_focus = excluded.opening_focus,
            styling_count = excluded.styling_count,
            text_density = excluded.text_density,
            text_role = excluded.text_role,
            opening_text_focus = excluded.opening_text_focus,
            extracted_text_sequence = excluded.extracted_text_sequence,
            audio_source_type = excluded.audio_source_type,
            voiceover_present = excluded.voiceover_present,
            music_energy = excluded.music_energy,
            opening_mechanism = excluded.opening_mechanism,
            opening_energy = excluded.opening_energy,
            emotional_angle = excluded.emotional_angle,
            heritage_emphasis_level = excluded.heritage_emphasis_level,
            cause_product_balance = excluded.cause_product_balance,
            craft_emphasis = excluded.craft_emphasis,
            surprise_detail = excluded.surprise_detail,
            occasion_framing = excluded.occasion_framing,
            evidence = excluded.evidence
        """,
        (
            tenant_key,
            store_key,
            payload["canonical_creative_id"],
            payload["variant_id"],
            payload["labeled_at"],
            payload["production_feel"],
            payload["delivery_format"],
            payload["face_presence"],
            payload["body_presence"],
            payload["hands_presence"],
            payload["face_role"],
            payload["body_role"],
            payload["hands_role"],
            payload["on_body_prominence"],
            payload["detail_intensity"],
            payload["texture_emphasis"],
            payload["product_prominence"],
            payload["motion_style"],
            payload["opening_focus"],
            payload["styling_count"],
            payload["text_density"],
            payload["text_role"],
            payload["opening_text_focus"],
            _json_text(payload["extracted_text_sequence"]),
            payload["audio_source_type"],
            payload["voiceover_present"],
            payload["music_energy"],
            payload["opening_mechanism"],
            payload["opening_energy"],
            payload["emotional_angle"],
            payload["heritage_emphasis_level"],
            payload["cause_product_balance"],
            payload["craft_emphasis"],
            payload["surprise_detail"],
            payload["occasion_framing"],
            _json_text(payload["evidence"]),
        ),
    )
    conn.commit()


def materialize_creative_labels(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    canonical_creative_id: str,
    variant_id: str | None = None,
    dashscope_api_key: str,
    dashscope_base_url: str,
    dashscope_model: str,
    dashscope_timeout_sec: float,
    google_ai_api_key: str,
    gemini_base_url: str,
    gemini_model: str,
    gemini_timeout_sec: float,
    firered_endpoint_url: str,
    firered_api_token: str,
    firered_timeout_sec: float,
    anthropic_api_key: str,
    anthropic_model: str,
    anthropic_base_url: str,
    anthropic_timeout_sec: float,
    force_refresh: bool = False,
) -> CreativeLabelMaterializationResult:
    if not dashscope_api_key:
        raise RuntimeError("Qwen/DashScope is not configured")
    if not google_ai_api_key:
        raise RuntimeError("Gemini is not configured")
    if not anthropic_api_key:
        raise RuntimeError("Claude is not configured")

    conn = _connect(db_path)
    try:
        _ensure_label_schema(conn)
        resolved_store_key = _resolve_existing_store_key(
            conn,
            tenant_key=tenant_key,
            requested_store_key=store_key,
            tables=("creative_labels", "creative_identity", "creative_assets", "creative_variants"),
        )
        context = _fetch_creative_context(
            conn,
            tenant_key=tenant_key,
            store_key=resolved_store_key,
            canonical_creative_id=canonical_creative_id,
            variant_id=variant_id,
        )
        with tempfile.TemporaryDirectory(prefix="creative-labels-") as temp_dir:
            prepared = _prepare_media(context, directory=Path(temp_dir))

            frame_hashes_ab = _frame_hashes(prepared.frames_stage_ab)
            qwen_input_hash = _hash_payload(
                {
                    "prompt_version": QWEN_VISUAL_PROMPT_VERSION,
                    "frame_hashes": frame_hashes_ab,
                    "canonical_creative_id": prepared.canonical_creative_id,
                }
            )
            qwen_labels = None if force_refresh else _cache_fetch(
                conn=conn,
                tenant_key=tenant_key,
                store_key=resolved_store_key,
                scope_type="asset",
                entity_id=prepared.scope_media_hash,
                model_name="qwen25vl",
                model_version=dashscope_model,
                output_group="visual_structural",
                input_hash=qwen_input_hash,
                model_cls=CreativeStageAVisualLabels,
            )
            qwen_cache_hit = qwen_labels is not None
            if qwen_labels is None:
                qwen_labels = _run_qwen_stage(
                    frames=prepared.frames_stage_ab,
                    api_key=dashscope_api_key,
                    base_url=dashscope_base_url,
                    model=dashscope_model,
                    timeout_sec=dashscope_timeout_sec,
                )
                _cache_store(
                    conn=conn,
                    tenant_key=tenant_key,
                    store_key=resolved_store_key,
                    scope_type="asset",
                    entity_id=prepared.scope_media_hash,
                    model_name="qwen25vl",
                    model_version=dashscope_model,
                    output_group="visual_structural",
                    input_hash=qwen_input_hash,
                    request_payload={"frame_hashes": frame_hashes_ab},
                    response_payload=qwen_labels.model_dump(),
                )

            gemini_input_hash = _hash_payload(
                {
                    "prompt_version": GEMINI_TEXT_PROMPT_VERSION,
                    "frame_hashes": frame_hashes_ab,
                    "variant_id": prepared.variant_id,
                }
            )
            gemini_labels = None if force_refresh else _cache_fetch(
                conn=conn,
                tenant_key=tenant_key,
                store_key=resolved_store_key,
                scope_type="variant",
                entity_id=prepared.variant_id,
                model_name="gemini",
                model_version=gemini_model,
                output_group="text_layer",
                input_hash=gemini_input_hash,
                model_cls=CreativeStageBTextLabels,
            )
            gemini_cache_hit = gemini_labels is not None
            if gemini_labels is None:
                gemini_labels = _run_gemini_stage(
                    frames=prepared.frames_stage_ab,
                    api_key=google_ai_api_key,
                    base_url=gemini_base_url,
                    model=gemini_model,
                    timeout_sec=gemini_timeout_sec,
                )
                _cache_store(
                    conn=conn,
                    tenant_key=tenant_key,
                    store_key=resolved_store_key,
                    scope_type="variant",
                    entity_id=prepared.variant_id,
                    model_name="gemini",
                    model_version=gemini_model,
                    output_group="text_layer",
                    input_hash=gemini_input_hash,
                    request_payload={"frame_hashes": frame_hashes_ab},
                    response_payload=gemini_labels.model_dump(),
                )

            audio_model_version = f"{firered_endpoint_url or 'disabled'}:{LIBROSA_MODEL_VERSION}"
            audio_sha256 = (
                hashlib.sha256(Path(prepared.audio_path).read_bytes()).hexdigest()
                if prepared.audio_path
                else ""
            )
            audio_input_hash = _hash_payload(
                {
                    "prompt_version": AUDIO_LAYER_PROMPT_VERSION,
                    "media_hash": prepared.scope_media_hash,
                    "audio_sha256": audio_sha256,
                }
            )
            audio_labels = None if force_refresh else _cache_fetch(
                conn=conn,
                tenant_key=tenant_key,
                store_key=resolved_store_key,
                scope_type="asset",
                entity_id=prepared.scope_media_hash,
                model_name="firered_librosa",
                model_version=audio_model_version,
                output_group="audio_layer",
                input_hash=audio_input_hash,
                model_cls=CreativeStageCAudioLabels,
            )
            audio_cache_hit = audio_labels is not None
            if audio_labels is None:
                audio_labels = _run_audio_stage(
                    audio_path=prepared.audio_path,
                    endpoint_url=firered_endpoint_url,
                    api_token=firered_api_token,
                    timeout_sec=firered_timeout_sec,
                )
                _cache_store(
                    conn=conn,
                    tenant_key=tenant_key,
                    store_key=resolved_store_key,
                    scope_type="asset",
                    entity_id=prepared.scope_media_hash,
                    model_name="firered_librosa",
                    model_version=audio_model_version,
                    output_group="audio_layer",
                    input_hash=audio_input_hash,
                    request_payload={"audio_sha256": audio_sha256},
                    response_payload=audio_labels.model_dump(),
                )

            claude_input_hash = _hash_payload(
                {
                    "prompt_version": CLAUDE_STRATEGIC_PROMPT_VERSION,
                    "qwen_output": qwen_labels.model_dump(),
                    "gemini_output": gemini_labels.model_dump(),
                    "audio_output": audio_labels.model_dump(),
                    "frame_hashes": _frame_hashes(prepared.frames_stage_d),
                    "variant_id": prepared.variant_id,
                }
            )
            claude_labels = None if force_refresh else _cache_fetch(
                conn=conn,
                tenant_key=tenant_key,
                store_key=resolved_store_key,
                scope_type="variant",
                entity_id=prepared.variant_id,
                model_name="claude",
                model_version=anthropic_model,
                output_group="strategic_scoring",
                input_hash=claude_input_hash,
                model_cls=CreativeStageDStrategicLabels,
            )
            claude_cache_hit = claude_labels is not None
            if claude_labels is None:
                claude_labels = _run_claude_stage(
                    qwen_output=qwen_labels,
                    gemini_output=gemini_labels,
                    audio_output=audio_labels,
                    frames=prepared.frames_stage_d,
                    api_key=anthropic_api_key,
                    model=anthropic_model,
                    base_url=anthropic_base_url,
                    timeout_sec=anthropic_timeout_sec,
                )
                _cache_store(
                    conn=conn,
                    tenant_key=tenant_key,
                    store_key=resolved_store_key,
                    scope_type="variant",
                    entity_id=prepared.variant_id,
                    model_name="claude",
                    model_version=anthropic_model,
                    output_group="strategic_scoring",
                    input_hash=claude_input_hash,
                    request_payload={
                        "qwen_output": qwen_labels.model_dump(),
                        "gemini_output": gemini_labels.model_dump(),
                        "audio_output": audio_labels.model_dump(),
                    },
                    response_payload=claude_labels.model_dump(),
                )

            record = CreativeLabelRecord(
                canonical_creative_id=prepared.canonical_creative_id,
                variant_id=prepared.variant_id,
                labeled_at=_utc_now_iso(),
                production_feel=qwen_labels.production_feel,
                delivery_format=qwen_labels.delivery_format,
                face_presence=qwen_labels.face_presence,
                body_presence=qwen_labels.body_presence,
                hands_presence=qwen_labels.hands_presence,
                face_role=qwen_labels.face_role,
                body_role=qwen_labels.body_role,
                hands_role=qwen_labels.hands_role,
                on_body_prominence=qwen_labels.on_body_prominence,
                detail_intensity=qwen_labels.detail_intensity,
                texture_emphasis=qwen_labels.texture_emphasis,
                product_prominence=qwen_labels.product_prominence,
                motion_style=qwen_labels.motion_style,
                opening_focus=qwen_labels.opening_focus,
                styling_count=qwen_labels.styling_count,
                text_density=gemini_labels.text_density,
                text_role=gemini_labels.text_role,
                opening_text_focus=gemini_labels.opening_text_focus,
                extracted_text_sequence=gemini_labels.extracted_text_sequence,
                audio_source_type=audio_labels.audio_source_type,
                voiceover_present=audio_labels.voiceover_present,
                music_energy=audio_labels.music_energy,
                opening_mechanism=claude_labels.opening_mechanism,
                opening_energy=claude_labels.opening_energy,
                emotional_angle=claude_labels.emotional_angle,
                heritage_emphasis_level=claude_labels.heritage_emphasis_level,
                cause_product_balance=claude_labels.cause_product_balance,
                craft_emphasis=claude_labels.craft_emphasis,
                surprise_detail=claude_labels.surprise_detail,
                occasion_framing=claude_labels.occasion_framing,
                evidence=_assemble_label_evidence(
                    qwen_output=qwen_labels,
                    gemini_output=gemini_labels,
                    audio_output=audio_labels,
                    claude_output=claude_labels,
                ),
            )
        _store_label_record(
            conn,
            tenant_key=tenant_key,
            store_key=resolved_store_key,
            record=record,
        )
        return CreativeLabelMaterializationResult(
            tenant_key=tenant_key,
            requested_store_key=store_key,
            resolved_store_key=resolved_store_key,
            canonical_creative_id=prepared.canonical_creative_id,
            variant_id=prepared.variant_id,
            cache_hits={
                "stage_a_qwen": qwen_cache_hit,
                "stage_b_gemini": gemini_cache_hit,
                "stage_c_audio": audio_cache_hit,
                "stage_d_claude": claude_cache_hit,
            },
            models={
                "qwen": dashscope_model,
                "gemini": gemini_model,
                "audio": audio_labels.model_id or "firered+librosa",
                "claude": anthropic_model,
            },
            labels=record,
        )
    finally:
        conn.close()
