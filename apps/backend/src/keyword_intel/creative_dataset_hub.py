from __future__ import annotations

import csv
import json
import re
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .creative_labels import materialize_creative_labels
from .creative_library_storage import _connect
from .creative_rollups import _ensure_rollup_schema, _normalize_lookback_window, _resolve_existing_store_key


DATASET_FIELD_GROUPS: dict[str, list[str]] = {
    "identity_metadata": [
        "canonical_creative_id",
        "representative_variant_id",
        "family_id",
        "creative_name",
        "geo",
        "lookback_window",
        "media_type",
        "currency",
        "usage_count",
        "variant_count",
        "snapshot_count",
        "active_days",
        "first_active",
        "last_active",
        "is_outlier",
    ],
    "performance_context": [
        "total_spend",
        "total_revenue",
        "total_impressions",
        "blended_roas",
        "log_blended_roas",
        "total_orders",
        "ctr",
        "hook_rate",
    ],
    "visual_structural": [
        "production_feel",
        "delivery_format",
        "face_presence",
        "body_presence",
        "hands_presence",
        "face_role",
        "body_role",
        "hands_role",
        "on_body_prominence",
        "detail_intensity",
        "texture_emphasis",
        "product_prominence",
        "motion_style",
        "opening_focus",
        "styling_count",
    ],
    "text_layer": [
        "text_density",
        "text_role",
        "opening_text_focus",
        "extracted_text_sequence",
    ],
    "audio_layer": [
        "audio_source_type",
        "voiceover_present",
        "music_energy",
    ],
    "strategic_labels": [
        "opening_mechanism",
        "opening_energy",
        "emotional_angle",
        "heritage_emphasis_level",
        "cause_product_balance",
        "craft_emphasis",
        "surprise_detail",
        "occasion_framing",
        "evidence",
    ],
}

DEFAULT_DATASET_GROUPS = [
    "identity_metadata",
    "performance_context",
    "visual_structural",
    "text_layer",
    "audio_layer",
    "strategic_labels",
]
DEFAULT_WORKBENCH_LIMIT = 50


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _slugify(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return text or "dataset"


def _normalize_groups(groups: list[str] | tuple[str, ...] | None) -> list[str]:
    requested = [str(item or "").strip() for item in (groups or DEFAULT_DATASET_GROUPS)]
    selected: list[str] = []
    for item in requested:
        if item not in DATASET_FIELD_GROUPS:
            continue
        if item in selected:
            continue
        selected.append(item)
    return selected or list(DEFAULT_DATASET_GROUPS)


def _normalize_selected_fields(
    *,
    feature_groups: list[str],
    selected_fields: list[str] | tuple[str, ...] | None,
) -> list[str]:
    allowed = [field for group in feature_groups for field in DATASET_FIELD_GROUPS[group]]
    if not selected_fields:
        return allowed
    normalized: list[str] = []
    for field in selected_fields:
        text = str(field or "").strip()
        if not text or text not in allowed or text in normalized:
            continue
        normalized.append(text)
    return normalized or allowed


def _label_status_filters(status: str) -> tuple[str, tuple[Any, ...]]:
    normalized = str(status or "all").strip().lower()
    if normalized == "labeled":
        return "AND cl.canonical_creative_id IS NOT NULL", ()
    if normalized == "unlabeled":
        return "AND cl.canonical_creative_id IS NULL", ()
    return "", ()


def _latest_labels_join() -> str:
    return """
        LEFT JOIN creative_labels cl
          ON cl.tenant_key = p.tenant_key
         AND cl.store_key = p.store_key
         AND cl.canonical_creative_id = p.canonical_creative_id
         AND cl.variant_id = COALESCE(p.representative_variant_id, '')
    """


def list_creative_workbench_queue(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    lookback_days: int = 90,
    lookback_window: str | None = None,
    status: str = "all",
    limit: int = DEFAULT_WORKBENCH_LIMIT,
    offset: int = 0,
) -> dict[str, Any]:
    normalized_window, normalized_days = _normalize_lookback_window(
        lookback_days=lookback_days,
        lookback_window=lookback_window,
    )
    conn = _connect(db_path)
    try:
        _ensure_rollup_schema(conn)
        resolved_store_key = _resolve_existing_store_key(
            conn,
            tenant_key=tenant_key,
            requested_store_key=store_key,
            tables=("creative_performance", "creative_labels", "creative_variants"),
        )
        where_sql, where_params = _label_status_filters(status)
        rows = conn.execute(
            f"""
            SELECT
                p.canonical_creative_id AS rollup_id,
                p.representative_variant_id AS variant_id,
                p.creative_name,
                p.media_type,
                p.preview_url,
                p.thumbnail_url,
                p.total_spend,
                p.blended_roas,
                p.total_orders,
                p.ctr,
                p.hook_rate,
                p.usage_count,
                p.variant_count,
                p.snapshot_count,
                p.active_days,
                p.is_outlier,
                cl.labeled_at,
                CASE WHEN cl.canonical_creative_id IS NULL THEN 'unlabeled' ELSE 'labeled' END AS label_status
            FROM creative_performance p
            {_latest_labels_join()}
            WHERE p.tenant_key = ? AND p.store_key = ? AND p.geo = 'US' AND p.lookback_window = ?
            {where_sql}
            ORDER BY
                CASE WHEN cl.canonical_creative_id IS NULL THEN 0 ELSE 1 END ASC,
                CASE WHEN p.total_spend IS NULL THEN 1 ELSE 0 END,
                p.total_spend DESC,
                p.blended_roas DESC,
                p.creative_name ASC
            LIMIT ? OFFSET ?
            """,
            (tenant_key, resolved_store_key, normalized_window, *where_params, limit, offset),
        ).fetchall()
        total_count = conn.execute(
            f"""
            SELECT COUNT(1) AS count
            FROM creative_performance p
            {_latest_labels_join()}
            WHERE p.tenant_key = ? AND p.store_key = ? AND p.geo = 'US' AND p.lookback_window = ?
            {where_sql}
            """,
            (tenant_key, resolved_store_key, normalized_window, *where_params),
        ).fetchone()
    finally:
        conn.close()

    items = [dict(row) for row in rows]
    return {
        "success": True,
        "requested_store_key": store_key,
        "resolved_store_key": resolved_store_key,
        "lookback_window": normalized_window,
        "lookback_days": normalized_days,
        "status": str(status or "all").strip().lower() or "all",
        "count": int(total_count["count"]) if total_count is not None else len(items),
        "items": items,
    }


def run_creative_label_batch(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    lookback_days: int = 90,
    lookback_window: str | None = None,
    status: str = "unlabeled",
    limit: int = 10,
    force_refresh: bool = False,
    rollup_ids: list[str] | tuple[str, ...] | None = None,
    variant_ids: list[str] | tuple[str, ...] | None = None,
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
) -> dict[str, Any]:
    normalized_ids = [str(item or "").strip() for item in (rollup_ids or []) if str(item or "").strip()]
    normalized_variants = [str(item or "").strip() for item in (variant_ids or []) if str(item or "").strip()]
    queue_payload = list_creative_workbench_queue(
        db_path=db_path,
        tenant_key=tenant_key,
        store_key=store_key,
        lookback_days=lookback_days,
        lookback_window=lookback_window,
        status=status if not normalized_ids else "all",
        limit=max(1, limit),
        offset=0,
    )
    queue_items = queue_payload["items"]
    if normalized_ids:
        filtered = [item for item in queue_items if str(item.get("rollup_id") or "") in normalized_ids]
        if normalized_variants:
            filtered = [item for item in filtered if str(item.get("variant_id") or "") in normalized_variants]
        queue_items = filtered
    else:
        queue_items = queue_items[: max(1, limit)]

    results: list[dict[str, Any]] = []
    success_count = 0
    failure_count = 0
    for item in queue_items:
        try:
            result = materialize_creative_labels(
                db_path=db_path,
                tenant_key=tenant_key,
                store_key=store_key,
                canonical_creative_id=str(item["rollup_id"]),
                variant_id=str(item.get("variant_id") or "").strip() or None,
                dashscope_api_key=dashscope_api_key,
                dashscope_base_url=dashscope_base_url,
                dashscope_model=dashscope_model,
                dashscope_timeout_sec=dashscope_timeout_sec,
                google_ai_api_key=google_ai_api_key,
                gemini_base_url=gemini_base_url,
                gemini_model=gemini_model,
                gemini_timeout_sec=gemini_timeout_sec,
                firered_endpoint_url=firered_endpoint_url,
                firered_api_token=firered_api_token,
                firered_timeout_sec=firered_timeout_sec,
                anthropic_api_key=anthropic_api_key,
                anthropic_model=anthropic_model,
                anthropic_base_url=anthropic_base_url,
                anthropic_timeout_sec=anthropic_timeout_sec,
                force_refresh=force_refresh,
            )
            success_count += 1
            results.append(
                {
                    "rollup_id": item["rollup_id"],
                    "variant_id": item.get("variant_id"),
                    "creative_name": item.get("creative_name"),
                    "status": "success",
                    "cache_hits": result.cache_hits,
                }
            )
        except Exception as exc:  # pragma: no cover
            failure_count += 1
            results.append(
                {
                    "rollup_id": item["rollup_id"],
                    "variant_id": item.get("variant_id"),
                    "creative_name": item.get("creative_name"),
                    "status": "failed",
                    "error": str(exc),
                }
            )
    return {
        "success": True,
        "requested_store_key": store_key,
        "resolved_store_key": queue_payload["resolved_store_key"],
        "lookback_window": queue_payload["lookback_window"],
        "lookback_days": queue_payload["lookback_days"],
        "requested_count": len(queue_items),
        "success_count": success_count,
        "failure_count": failure_count,
        "results": results,
    }


def _fetch_dataset_rows(
    *,
    conn: sqlite3.Connection,
    tenant_key: str,
    store_key: str,
    geo: str,
    lookback_window: str,
    min_spend_threshold: float,
    labeled_only: bool,
) -> list[dict[str, Any]]:
    labeled_sql = "AND cl.canonical_creative_id IS NOT NULL" if labeled_only else ""
    rows = conn.execute(
        f"""
        SELECT
            p.*,
            cl.production_feel,
            cl.delivery_format,
            cl.face_presence,
            cl.body_presence,
            cl.hands_presence,
            cl.face_role,
            cl.body_role,
            cl.hands_role,
            cl.on_body_prominence,
            cl.detail_intensity,
            cl.texture_emphasis,
            cl.product_prominence,
            cl.motion_style,
            cl.opening_focus,
            cl.styling_count,
            cl.text_density,
            cl.text_role,
            cl.opening_text_focus,
            cl.extracted_text_sequence,
            cl.audio_source_type,
            cl.voiceover_present,
            cl.music_energy,
            cl.opening_mechanism,
            cl.opening_energy,
            cl.emotional_angle,
            cl.heritage_emphasis_level,
            cl.cause_product_balance,
            cl.craft_emphasis,
            cl.surprise_detail,
            cl.occasion_framing,
            cl.evidence,
            cl.labeled_at
        FROM creative_performance p
        {_latest_labels_join()}
        WHERE p.tenant_key = ?
          AND p.store_key = ?
          AND p.geo = ?
          AND p.lookback_window = ?
          AND COALESCE(p.total_spend, 0) >= ?
          {labeled_sql}
        ORDER BY
          p.total_spend DESC,
          p.blended_roas DESC,
          p.creative_name ASC
        """,
        (tenant_key, store_key, geo, lookback_window, float(min_spend_threshold)),
    ).fetchall()
    payloads: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        for key in ("extracted_text_sequence", "evidence"):
            raw = item.get(key)
            if raw in (None, ""):
                item[key] = None
            else:
                try:
                    item[key] = json.loads(str(raw))
                except json.JSONDecodeError:
                    item[key] = str(raw)
        payloads.append(item)
    return payloads


def preview_ml_dataset(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    lookback_days: int = 90,
    lookback_window: str | None = None,
    geo: str = "US",
    min_spend_threshold: float = 30.0,
    labeled_only: bool = True,
    feature_groups: list[str] | tuple[str, ...] | None = None,
    selected_fields: list[str] | tuple[str, ...] | None = None,
    target_metric: str = "log_blended_roas",
    sample_limit: int = 5,
) -> dict[str, Any]:
    normalized_window, normalized_days = _normalize_lookback_window(
        lookback_days=lookback_days,
        lookback_window=lookback_window,
    )
    groups = _normalize_groups(feature_groups)
    fields = _normalize_selected_fields(feature_groups=groups, selected_fields=selected_fields)
    conn = _connect(db_path)
    try:
        _ensure_rollup_schema(conn)
        resolved_store_key = _resolve_existing_store_key(
            conn,
            tenant_key=tenant_key,
            requested_store_key=store_key,
            tables=("creative_performance", "creative_labels"),
        )
        rows = _fetch_dataset_rows(
            conn=conn,
            tenant_key=tenant_key,
            store_key=resolved_store_key,
            geo=str(geo or "US").strip().upper() or "US",
            lookback_window=normalized_window,
            min_spend_threshold=float(min_spend_threshold),
            labeled_only=bool(labeled_only),
        )
    finally:
        conn.close()

    selected_rows = [{field: row.get(field) for field in fields} for row in rows]
    non_null_target = sum(1 for row in rows if row.get(target_metric) is not None)
    missing_counts = {
        field: sum(1 for row in selected_rows if row.get(field) in (None, "", []))
        for field in fields
    }
    return {
        "success": True,
        "requested_store_key": store_key,
        "resolved_store_key": resolved_store_key,
        "geo": str(geo or "US").strip().upper() or "US",
        "lookback_window": normalized_window,
        "lookback_days": normalized_days,
        "min_spend_threshold": float(min_spend_threshold),
        "labeled_only": bool(labeled_only),
        "target_metric": target_metric,
        "feature_groups": groups,
        "selected_fields": fields,
        "available_groups": DATASET_FIELD_GROUPS,
        "row_count": len(selected_rows),
        "sample_rows": selected_rows[: max(1, sample_limit)],
        "target_non_null_count": non_null_target,
        "missing_counts": missing_counts,
    }


def build_ml_dataset(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    dataset_name: str,
    lookback_days: int = 90,
    lookback_window: str | None = None,
    geo: str = "US",
    min_spend_threshold: float = 30.0,
    labeled_only: bool = True,
    feature_groups: list[str] | tuple[str, ...] | None = None,
    selected_fields: list[str] | tuple[str, ...] | None = None,
    target_metric: str = "log_blended_roas",
    output_format: str = "csv",
) -> dict[str, Any]:
    preview = preview_ml_dataset(
        db_path=db_path,
        tenant_key=tenant_key,
        store_key=store_key,
        lookback_days=lookback_days,
        lookback_window=lookback_window,
        geo=geo,
        min_spend_threshold=min_spend_threshold,
        labeled_only=labeled_only,
        feature_groups=feature_groups,
        selected_fields=selected_fields,
        target_metric=target_metric,
        sample_limit=5,
    )
    conn = _connect(db_path)
    try:
        rows = _fetch_dataset_rows(
            conn=conn,
            tenant_key=tenant_key,
            store_key=preview["resolved_store_key"],
            geo=preview["geo"],
            lookback_window=preview["lookback_window"],
            min_spend_threshold=float(preview["min_spend_threshold"]),
            labeled_only=bool(preview["labeled_only"]),
        )
    finally:
        conn.close()

    fields = list(preview["selected_fields"])
    output_rows = [{field: row.get(field) for field in fields} for row in rows]
    output_dir = Path("output/creative-datasets")
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    base_name = f"{_slugify(dataset_name)}-{timestamp}"
    recipe_path = output_dir / f"{base_name}.recipe.json"
    recipe_path.write_text(
        json.dumps(
            {
                "dataset_name": dataset_name,
                "created_at": _utc_now_iso(),
                "preview": preview,
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    normalized_format = str(output_format or "csv").strip().lower()
    if normalized_format == "json":
        data_path = output_dir / f"{base_name}.json"
        data_path.write_text(json.dumps(output_rows, ensure_ascii=False, indent=2))
    else:
        normalized_format = "csv"
        data_path = output_dir / f"{base_name}.csv"
        with data_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(output_rows)

    return {
        "success": True,
        "dataset_name": dataset_name,
        "created_at": _utc_now_iso(),
        "output_format": normalized_format,
        "data_path": str(data_path.resolve()),
        "recipe_path": str(recipe_path.resolve()),
        "row_count": len(output_rows),
        "selected_fields": fields,
        "target_metric": target_metric,
        "feature_groups": preview["feature_groups"],
        "resolved_store_key": preview["resolved_store_key"],
        "lookback_window": preview["lookback_window"],
        "geo": preview["geo"],
    }
