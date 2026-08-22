from __future__ import annotations

import base64
import hashlib
import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

import requests

from .creative_library_storage import _connect
from .creative_rollups import get_usa_creative_rollup_detail
from .models import ClaudeSubjectiveScore, ClaudeSubjectiveScoreResult


CLAUDE_SUBJECTIVE_PROMPT_VERSION = "claude_subjective_v1"
CLAUDE_SUBJECTIVE_SYSTEM_PROMPT = """
You are evaluating the inherent properties of an ad creative, not its delivery performance.
Use only the supplied copy, the representative creative image if present, and stable creative metadata.
Do not infer that strong performance means strong creative quality. Ignore spend, ROAS, orders, and CTR when choosing labels.
Return a single JSON object that exactly matches the requested schema. Do not add prose.
When evidence is weak, choose the least-assumptive valid label.
""".strip()

CLAUDE_SUBJECTIVE_USER_PROMPT = """
Classify this creative on stable subjective properties.

Schema:
{
  "emotional_angle": "urgency | pride | warmth | nostalgia | aspiration | calm | tension | playfulness | trust | curiosity",
  "heritage_vibe": "none | subtle | moderate | strong",
  "premium_vs_casual": "casual | balanced | premium",
  "ugc_vs_polished": "ugc | hybrid | polished",
  "hook_type": "question | direct_statement | visual_reveal | product_demo | offer | story | other",
  "opening_style": "punch_first | direct_statement | story_open | tension_open | question_open | slow_build",
  "cta_style": "direct_command | urgency | soft_invitation | identity_extension | none",
  "cause_vs_product": "cause_led | balanced | product_led",
  "text_density": "none | low | medium | high",
  "face_presence": "none | some | dominant",
  "evidence": {
    "emotional_angle": "brief evidence",
    "heritage_vibe": "brief evidence",
    "premium_vs_casual": "brief evidence",
    "ugc_vs_polished": "brief evidence",
    "hook_type": "brief evidence",
    "opening_style": "brief evidence",
    "cta_style": "brief evidence",
    "cause_vs_product": "brief evidence",
    "text_density": "brief evidence",
    "face_presence": "brief evidence"
  }
}

Definitions:
- heritage_vibe measures visible or textual cues of cultural memory, heritage, home, or identity continuity.
- premium_vs_casual is about styling and finish, not price claims.
- ugc_vs_polished is about production feel.
- face_presence is about visible human face prominence in the representative creative image.

Creative payload:
__PAYLOAD_JSON__
""".strip()


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS creative_model_scores (
            tenant_key TEXT NOT NULL,
            store_key TEXT NOT NULL,
            scope_type TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            model_provider TEXT NOT NULL,
            model_id TEXT NOT NULL,
            prompt_version TEXT NOT NULL,
            input_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ready',
            is_model_rejected INTEGER NOT NULL DEFAULT 0,
            request_json TEXT NOT NULL DEFAULT '{}',
            response_json TEXT NOT NULL DEFAULT '{}',
            raw_response_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (
                tenant_key, store_key, scope_type, scope_id,
                model_provider, model_id, prompt_version, input_hash
            )
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_creative_model_scores_lookup
        ON creative_model_scores(
            tenant_key, store_key, scope_type, scope_id,
            model_provider, model_id, prompt_version, is_model_rejected
        )
        """
    )
    conn.commit()


def _json_text(value: dict[str, Any]) -> str:
    return json.dumps(value or {}, ensure_ascii=False, sort_keys=True)


def _input_hash(payload: dict[str, Any]) -> str:
    normalized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _extract_json_object(text: str) -> dict[str, Any]:
    candidate = str(text or "").strip()
    if not candidate:
        raise RuntimeError("claude returned empty response")
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise RuntimeError("claude did not return valid json")
        return json.loads(candidate[start : end + 1])


def _fetch_image_part(image_url: str, *, timeout_sec: float) -> dict[str, Any] | None:
    url = str(image_url or "").strip()
    if not url:
        return None
    response = requests.get(url, timeout=timeout_sec)
    response.raise_for_status()
    content_type = str(response.headers.get("content-type", "")).split(";")[0].strip().lower()
    media_type = {
        "image/jpeg": "image/jpeg",
        "image/jpg": "image/jpeg",
        "image/png": "image/png",
        "image/webp": "image/webp",
        "image/gif": "image/gif",
    }.get(content_type)
    if not media_type:
        return None
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": base64.b64encode(response.content).decode("ascii"),
        },
    }


def _build_prompt_payload(detail: dict[str, Any]) -> dict[str, Any]:
    return {
        "creative_name": detail.get("creative_name") or "",
        "headline": detail.get("headline") or "",
        "body_text": detail.get("body_text") or "",
        "asset_type": detail.get("asset_type") or "",
        "usage_count": detail.get("usage_count") or 0,
        "thumbnail_url": detail.get("thumbnail_url") or "",
        "preview_url": detail.get("preview_url") or "",
    }


def _cached_result(
    *,
    conn: sqlite3.Connection,
    tenant_key: str,
    store_key: str,
    rollup_id: str,
    model_id: str,
    input_hash: str,
) -> ClaudeSubjectiveScoreResult | None:
    row = conn.execute(
        """
        SELECT response_json
        FROM creative_model_scores
        WHERE tenant_key = ?
          AND store_key = ?
          AND scope_type = 'usa_rollup'
          AND scope_id = ?
          AND model_provider = 'anthropic'
          AND model_id = ?
          AND prompt_version = ?
          AND input_hash = ?
          AND is_model_rejected = 0
          AND status = 'ready'
        """,
        (
            tenant_key,
            store_key,
            rollup_id,
            model_id,
            CLAUDE_SUBJECTIVE_PROMPT_VERSION,
            input_hash,
        ),
    ).fetchone()
    if row is None:
        return None
    payload = json.loads(str(row["response_json"]))
    payload["cache_hit"] = True
    return ClaudeSubjectiveScoreResult.model_validate(payload)


def _store_result(
    *,
    conn: sqlite3.Connection,
    tenant_key: str,
    store_key: str,
    rollup_id: str,
    model_id: str,
    input_hash: str,
    request_payload: dict[str, Any],
    response_payload: dict[str, Any],
    raw_response: dict[str, Any],
) -> None:
    timestamp = _utc_now_iso()
    conn.execute(
        """
        INSERT INTO creative_model_scores (
            tenant_key, store_key, scope_type, scope_id, model_provider, model_id,
            prompt_version, input_hash, status, is_model_rejected,
            request_json, response_json, raw_response_json, created_at, updated_at
        ) VALUES (?, ?, 'usa_rollup', ?, 'anthropic', ?, ?, ?, 'ready', 0, ?, ?, ?, ?, ?)
        ON CONFLICT(
            tenant_key, store_key, scope_type, scope_id,
            model_provider, model_id, prompt_version, input_hash
        )
        DO UPDATE SET
            status = excluded.status,
            is_model_rejected = excluded.is_model_rejected,
            request_json = excluded.request_json,
            response_json = excluded.response_json,
            raw_response_json = excluded.raw_response_json,
            updated_at = excluded.updated_at
        """,
        (
            tenant_key,
            store_key,
            rollup_id,
            model_id,
            CLAUDE_SUBJECTIVE_PROMPT_VERSION,
            input_hash,
            _json_text(request_payload),
            _json_text(response_payload),
            _json_text(raw_response),
            timestamp,
            timestamp,
        ),
    )
    conn.commit()


def score_usa_rollup_with_claude(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    rollup_id: str,
    anthropic_api_key: str,
    anthropic_model: str,
    anthropic_base_url: str,
    timeout_sec: float,
    force_refresh: bool = False,
) -> ClaudeSubjectiveScoreResult:
    detail = get_usa_creative_rollup_detail(
        db_path=db_path,
        tenant_key=tenant_key,
        store_key=store_key,
        rollup_id=rollup_id,
    )
    if detail is None:
        raise RuntimeError("usa creative rollup not found")

    prompt_payload = _build_prompt_payload(detail)
    input_hash = _input_hash(prompt_payload)

    conn = _connect(db_path)
    try:
        _ensure_schema(conn)
        if not force_refresh:
            cached = _cached_result(
                conn=conn,
                tenant_key=tenant_key,
                store_key=detail["resolved_store_key"],
                rollup_id=rollup_id,
                model_id=anthropic_model,
                input_hash=input_hash,
            )
            if cached is not None:
                return cached
    finally:
        conn.close()

    content: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": CLAUDE_SUBJECTIVE_USER_PROMPT.replace(
                    "__PAYLOAD_JSON__",
                    json.dumps(prompt_payload, ensure_ascii=False, indent=2),
                ),
            }
        ]
    image_part = _fetch_image_part(
        str(detail.get("thumbnail_url") or detail.get("preview_url") or "").strip(),
        timeout_sec=timeout_sec,
    )
    if image_part is not None:
        content.insert(0, image_part)

    request_payload = {
        "model": anthropic_model,
        "max_tokens": 900,
        "temperature": 0.1,
        "system": CLAUDE_SUBJECTIVE_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": content}],
    }
    response = requests.post(
        anthropic_base_url,
        headers={
            "x-api-key": anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json=request_payload,
        timeout=timeout_sec,
    )
    response.raise_for_status()
    raw_response = response.json()
    text_blocks = raw_response.get("content") or []
    text = "\n".join(
        str(block.get("text", "")).strip()
        for block in text_blocks
        if isinstance(block, dict) and block.get("type") == "text"
    ).strip()
    parsed = _extract_json_object(text)
    score = ClaudeSubjectiveScore.model_validate(parsed)
    result = ClaudeSubjectiveScoreResult(
        rollup_id=rollup_id,
        variant_id=str(detail.get("variant_id") or rollup_id),
        model_id=anthropic_model,
        prompt_version=CLAUDE_SUBJECTIVE_PROMPT_VERSION,
        input_hash=input_hash,
        cache_hit=False,
        score=score,
    )

    conn = _connect(db_path)
    try:
        _ensure_schema(conn)
        _store_result(
            conn=conn,
            tenant_key=tenant_key,
            store_key=detail["resolved_store_key"],
            rollup_id=rollup_id,
            model_id=anthropic_model,
            input_hash=input_hash,
            request_payload=prompt_payload,
            response_payload=result.model_dump(),
            raw_response=raw_response,
        )
    finally:
        conn.close()

    return result
