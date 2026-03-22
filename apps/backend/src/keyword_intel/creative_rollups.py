from __future__ import annotations

import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from statistics import median
from typing import Any
from urllib.parse import urlparse

from .creative_library_storage import _connect, _ensure_schema


DEFAULT_METRIC_KEYS = ("spend", "roas", "orders", "ctr", "hook_rate")
METRIC_COLUMN_MAP = {
    "spend": "median_spend",
    "roas": "median_roas",
    "orders": "median_orders",
    "ctr": "median_ctr",
    "hook_rate": "median_hook_rate",
}


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _cutoff_date(lookback_days: int) -> str:
    days = max(1, int(lookback_days))
    return (datetime.now(UTC).date() - timedelta(days=days - 1)).isoformat()


def _safe_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: object) -> int | None:
    parsed = _safe_float(value)
    if parsed is None:
        return None
    return int(round(parsed))


def _median(values: list[float]) -> float | None:
    filtered = [value for value in values if value is not None]
    if not filtered:
        return None
    return float(median(filtered))


def _quartiles(values: list[float]) -> tuple[float, float] | None:
    ordered = sorted(values)
    if len(ordered) < 4:
        return None
    mid = len(ordered) // 2
    if len(ordered) % 2 == 0:
        lower = ordered[:mid]
        upper = ordered[mid:]
    else:
        lower = ordered[:mid]
        upper = ordered[mid + 1 :]
    if not lower or not upper:
        return None
    return float(median(lower)), float(median(upper))


def _metric_outlier_bounds(values: list[float]) -> tuple[float, float] | None:
    quartiles = _quartiles(values)
    if quartiles is None:
        return None
    q1, q3 = quartiles
    iqr = q3 - q1
    return q1 - (1.5 * iqr), q3 + (1.5 * iqr)


def _hook_rate(impressions: int | None, video_3s_views: int | None) -> float | None:
    if not impressions or impressions <= 0:
        return None
    if video_3s_views is None:
        return None
    return (float(video_3s_views) / float(impressions)) * 100.0


def _candidate_store_keys(store_key: str) -> list[str]:
    raw = str(store_key or "").strip().lower()
    if not raw:
        return []

    candidates: list[str] = []

    def _add(value: str) -> None:
        text = str(value or "").strip().lower()
        if text and text not in candidates:
            candidates.append(text)

    _add(raw)

    try:
        parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    except Exception:
        parsed = None

    hostname = str(parsed.hostname or "").strip().lower() if parsed is not None else ""
    if hostname:
        _add(hostname)
        if hostname.startswith("www."):
            _add(hostname[4:])
            hostname = hostname[4:]
        if "." in hostname:
            _add(hostname.split(".", 1)[0])

    return candidates


def _resolve_existing_store_key(
    conn: sqlite3.Connection,
    *,
    tenant_key: str,
    requested_store_key: str,
    tables: tuple[str, ...],
) -> str:
    candidates = _candidate_store_keys(requested_store_key)
    if not candidates:
        return requested_store_key

    placeholder = ",".join("?" for _ in candidates)
    matches: set[str] = set()
    for table in tables:
        rows = conn.execute(
            f"""
            SELECT DISTINCT store_key
            FROM {table}
            WHERE tenant_key = ?
              AND store_key IN ({placeholder})
            """,
            (tenant_key, *candidates),
        ).fetchall()
        matches.update(str(row["store_key"]) for row in rows if row["store_key"])

    requested = str(requested_store_key or "").strip().lower()
    if requested in matches:
        return requested
    if len(matches) == 1:
        return next(iter(matches))
    return requested_store_key


def normalize_metric_keys(metric_keys: list[str] | tuple[str, ...] | None) -> list[str]:
    requested = [str(item or "").strip().lower() for item in (metric_keys or DEFAULT_METRIC_KEYS)]
    normalized: list[str] = []
    for key in requested:
        if not key:
            continue
        if key not in METRIC_COLUMN_MAP:
            raise ValueError(f"unsupported metric key: {key}")
        if key in normalized:
            continue
        normalized.append(key)
    return normalized or list(DEFAULT_METRIC_KEYS)


@dataclass
class _SnapshotMetricRow:
    snapshot_id: str
    usage_id: str
    variant_id: str
    creative_family_id: str
    asset_id: str
    creative_name: str
    asset_type: str
    thumbnail_url: str
    preview_url: str
    body_text: str
    headline: str
    campaign_name: str
    adset_name: str
    ad_name: str
    date_start: str
    date_stop: str
    spend: float | None
    purchases: float | None
    ctr: float | None
    roas: float | None
    impressions: int | None
    video_3s_views: int | None

    @property
    def hook_rate(self) -> float | None:
        return _hook_rate(self.impressions, self.video_3s_views)


def _ensure_rollup_schema(conn: sqlite3.Connection) -> None:
    _ensure_schema(conn)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS creative_usa_rollups (
            tenant_key TEXT NOT NULL,
            store_key TEXT NOT NULL,
            rollup_id TEXT NOT NULL,
            variant_id TEXT NOT NULL,
            creative_family_id TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            creative_name TEXT NOT NULL DEFAULT '',
            asset_type TEXT NOT NULL DEFAULT '',
            thumbnail_url TEXT NOT NULL DEFAULT '',
            preview_url TEXT NOT NULL DEFAULT '',
            body_text TEXT NOT NULL DEFAULT '',
            headline TEXT NOT NULL DEFAULT '',
            lookback_days INTEGER NOT NULL,
            country TEXT NOT NULL DEFAULT 'US',
            usage_count INTEGER NOT NULL DEFAULT 0,
            snapshot_count INTEGER NOT NULL DEFAULT 0,
            outlier_count INTEGER NOT NULL DEFAULT 0,
            total_spend REAL,
            median_spend REAL,
            median_orders REAL,
            median_ctr REAL,
            median_roas REAL,
            median_hook_rate REAL,
            first_seen_at TEXT NOT NULL DEFAULT '',
            last_seen_at TEXT NOT NULL DEFAULT '',
            materialized_at TEXT NOT NULL,
            PRIMARY KEY (tenant_key, store_key, rollup_id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS creative_usa_rollup_outliers (
            tenant_key TEXT NOT NULL,
            store_key TEXT NOT NULL,
            outlier_id TEXT NOT NULL,
            rollup_id TEXT NOT NULL,
            snapshot_id TEXT NOT NULL,
            usage_id TEXT NOT NULL,
            metric_key TEXT NOT NULL,
            metric_value REAL,
            metric_median REAL,
            date_start TEXT NOT NULL DEFAULT '',
            date_stop TEXT NOT NULL DEFAULT '',
            campaign_name TEXT NOT NULL DEFAULT '',
            adset_name TEXT NOT NULL DEFAULT '',
            ad_name TEXT NOT NULL DEFAULT '',
            materialized_at TEXT NOT NULL,
            PRIMARY KEY (tenant_key, store_key, outlier_id)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_creative_usa_rollups_lookup
        ON creative_usa_rollups(tenant_key, store_key, lookback_days, median_roas DESC, median_orders DESC)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_creative_usa_rollup_outliers_rollup
        ON creative_usa_rollup_outliers(tenant_key, store_key, rollup_id, metric_key)
        """
    )
    conn.commit()


def _fetch_usa_snapshot_rows(
    conn: sqlite3.Connection,
    *,
    tenant_key: str,
    store_key: str,
    since_date: str,
) -> list[_SnapshotMetricRow]:
    rows = conn.execute(
        """
        SELECT
            s.snapshot_id,
            s.usage_id,
            s.variant_id,
            a.creative_family_id,
            s.asset_id,
            v.creative_name,
            a.asset_type,
            a.thumbnail_url,
            a.preview_url,
            v.body_text,
            v.headline,
            u.campaign_name,
            u.adset_name,
            u.ad_name,
            s.date_start,
            s.date_stop,
            s.spend,
            s.purchases,
            s.ctr,
            s.roas,
            s.impressions,
            s.video_3s_views
        FROM creative_snapshots s
        JOIN creative_usages u
          ON u.tenant_key = s.tenant_key
         AND u.store_key = s.store_key
         AND u.usage_id = s.usage_id
        JOIN creative_variants v
          ON v.tenant_key = s.tenant_key
         AND v.store_key = s.store_key
         AND v.variant_id = s.variant_id
        JOIN creative_assets a
          ON a.tenant_key = s.tenant_key
         AND a.store_key = s.store_key
         AND a.asset_id = s.asset_id
        WHERE s.tenant_key = ?
          AND s.store_key = ?
          AND UPPER(COALESCE(u.country, '')) IN ('US', 'USA', 'UNITED STATES')
          AND s.date_stop >= ?
        ORDER BY s.date_stop DESC, s.snapshot_id DESC
        """,
        (tenant_key, store_key, since_date),
    ).fetchall()
    return [
        _SnapshotMetricRow(
            snapshot_id=str(row["snapshot_id"]),
            usage_id=str(row["usage_id"]),
            variant_id=str(row["variant_id"]),
            creative_family_id=str(row["creative_family_id"]),
            asset_id=str(row["asset_id"]),
            creative_name=str(row["creative_name"]),
            asset_type=str(row["asset_type"]),
            thumbnail_url=str(row["thumbnail_url"]),
            preview_url=str(row["preview_url"]),
            body_text=str(row["body_text"]),
            headline=str(row["headline"]),
            campaign_name=str(row["campaign_name"]),
            adset_name=str(row["adset_name"]),
            ad_name=str(row["ad_name"]),
            date_start=str(row["date_start"]),
            date_stop=str(row["date_stop"]),
            spend=_safe_float(row["spend"]),
            purchases=_safe_float(row["purchases"]),
            ctr=_safe_float(row["ctr"]),
            roas=_safe_float(row["roas"]),
            impressions=_safe_int(row["impressions"]),
            video_3s_views=_safe_int(row["video_3s_views"]),
        )
        for row in rows
    ]


def _replace_rollup_tables(
    conn: sqlite3.Connection,
    *,
    tenant_key: str,
    store_key: str,
    lookback_days: int,
    rows: list[dict[str, Any]],
    outliers: list[dict[str, Any]],
) -> None:
    conn.execute(
        """
        DELETE FROM creative_usa_rollup_outliers
        WHERE tenant_key = ? AND store_key = ?
          AND rollup_id IN (
              SELECT rollup_id
              FROM creative_usa_rollups
              WHERE tenant_key = ? AND store_key = ? AND lookback_days = ?
          )
        """,
        (tenant_key, store_key, tenant_key, store_key, lookback_days),
    )
    conn.execute(
        """
        DELETE FROM creative_usa_rollups
        WHERE tenant_key = ? AND store_key = ? AND lookback_days = ?
        """,
        (tenant_key, store_key, lookback_days),
    )

    for row in rows:
        conn.execute(
            """
            INSERT INTO creative_usa_rollups (
                tenant_key, store_key, rollup_id, variant_id, creative_family_id, asset_id,
                creative_name, asset_type, thumbnail_url, preview_url, body_text, headline,
                lookback_days, country, usage_count, snapshot_count, outlier_count, total_spend,
                median_spend, median_orders, median_ctr, median_roas, median_hook_rate,
                first_seen_at, last_seen_at, materialized_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tenant_key,
                store_key,
                row["rollup_id"],
                row["variant_id"],
                row["creative_family_id"],
                row["asset_id"],
                row["creative_name"],
                row["asset_type"],
                row["thumbnail_url"],
                row["preview_url"],
                row["body_text"],
                row["headline"],
                lookback_days,
                "US",
                row["usage_count"],
                row["snapshot_count"],
                row["outlier_count"],
                row["total_spend"],
                row["median_spend"],
                row["median_orders"],
                row["median_ctr"],
                row["median_roas"],
                row["median_hook_rate"],
                row["first_seen_at"],
                row["last_seen_at"],
                row["materialized_at"],
            ),
        )

    for outlier in outliers:
        conn.execute(
            """
            INSERT INTO creative_usa_rollup_outliers (
                tenant_key, store_key, outlier_id, rollup_id, snapshot_id, usage_id,
                metric_key, metric_value, metric_median, date_start, date_stop,
                campaign_name, adset_name, ad_name, materialized_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tenant_key,
                store_key,
                outlier["outlier_id"],
                outlier["rollup_id"],
                outlier["snapshot_id"],
                outlier["usage_id"],
                outlier["metric_key"],
                outlier["metric_value"],
                outlier["metric_median"],
                outlier["date_start"],
                outlier["date_stop"],
                outlier["campaign_name"],
                outlier["adset_name"],
                outlier["ad_name"],
                outlier["materialized_at"],
            ),
        )


def materialize_usa_creative_rollups(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    lookback_days: int = 60,
    metric_keys: list[str] | tuple[str, ...] | None = None,
) -> dict[str, Any]:
    selected_metric_keys = normalize_metric_keys(metric_keys)
    conn = _connect(db_path)
    try:
        _ensure_rollup_schema(conn)
        resolved_store_key = _resolve_existing_store_key(
            conn,
            tenant_key=tenant_key,
            requested_store_key=store_key,
            tables=("creative_snapshots", "creative_sync_runs", "creative_variants"),
        )
        since_date = _cutoff_date(lookback_days)
        snapshot_rows = _fetch_usa_snapshot_rows(
            conn,
            tenant_key=tenant_key,
            store_key=resolved_store_key,
            since_date=since_date,
        )

        grouped: dict[str, list[_SnapshotMetricRow]] = defaultdict(list)
        for row in snapshot_rows:
            grouped[row.variant_id].append(row)

        materialized_at = _utc_now_iso()
        rollups: list[dict[str, Any]] = []
        outliers: list[dict[str, Any]] = []

        for variant_id, rows in grouped.items():
            first = rows[0]
            spend_values = [row.spend for row in rows if row.spend is not None]
            order_values = [row.purchases for row in rows if row.purchases is not None]
            ctr_values = [row.ctr for row in rows if row.ctr is not None]
            roas_values = [row.roas for row in rows if row.roas is not None]
            hook_values = [row.hook_rate for row in rows if row.hook_rate is not None]

            median_spend = _median(spend_values)
            median_orders = _median(order_values)
            median_ctr = _median(ctr_values)
            median_roas = _median(roas_values)
            median_hook_rate = _median(hook_values)

            bounds = {
                "spend": _metric_outlier_bounds(spend_values),
                "orders": _metric_outlier_bounds(order_values),
                "ctr": _metric_outlier_bounds(ctr_values),
                "roas": _metric_outlier_bounds(roas_values),
                "hook_rate": _metric_outlier_bounds(hook_values),
            }
            metric_medians = {
                "spend": median_spend,
                "orders": median_orders,
                "ctr": median_ctr,
                "roas": median_roas,
                "hook_rate": median_hook_rate,
            }

            rollup_id = variant_id
            per_rollup_outliers = 0
            for row in rows:
                values = {
                    "spend": row.spend,
                    "orders": row.purchases,
                    "ctr": row.ctr,
                    "roas": row.roas,
                    "hook_rate": row.hook_rate,
                }
                for metric_key, metric_value in values.items():
                    if metric_key not in selected_metric_keys:
                        continue
                    limits = bounds.get(metric_key)
                    if metric_value is None or limits is None:
                        continue
                    lower, upper = limits
                    if lower <= metric_value <= upper:
                        continue
                    per_rollup_outliers += 1
                    outliers.append(
                        {
                            "outlier_id": f"{rollup_id}:{row.snapshot_id}:{metric_key}",
                            "rollup_id": rollup_id,
                            "snapshot_id": row.snapshot_id,
                            "usage_id": row.usage_id,
                            "metric_key": metric_key,
                            "metric_value": metric_value,
                            "metric_median": metric_medians.get(metric_key),
                            "date_start": row.date_start,
                            "date_stop": row.date_stop,
                            "campaign_name": row.campaign_name,
                            "adset_name": row.adset_name,
                            "ad_name": row.ad_name,
                            "materialized_at": materialized_at,
                        }
                    )

            usage_ids = {row.usage_id for row in rows}
            rollups.append(
                {
                    "rollup_id": rollup_id,
                    "variant_id": variant_id,
                    "creative_family_id": first.creative_family_id,
                    "asset_id": first.asset_id,
                    "creative_name": first.creative_name,
                    "asset_type": first.asset_type,
                    "thumbnail_url": first.thumbnail_url,
                    "preview_url": first.preview_url,
                    "body_text": first.body_text,
                    "headline": first.headline,
                    "usage_count": len(usage_ids),
                    "snapshot_count": len(rows),
                    "outlier_count": per_rollup_outliers,
                    "total_spend": round(sum(spend_values), 2) if spend_values else None,
                    "median_spend": median_spend,
                    "median_orders": median_orders,
                    "median_ctr": median_ctr,
                    "median_roas": median_roas,
                    "median_hook_rate": median_hook_rate,
                    "first_seen_at": min(row.date_start for row in rows),
                    "last_seen_at": max(row.date_stop for row in rows),
                    "materialized_at": materialized_at,
                }
            )

        _replace_rollup_tables(
            conn,
            tenant_key=tenant_key,
            store_key=resolved_store_key,
            lookback_days=lookback_days,
            rows=rollups,
            outliers=outliers,
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "success": True,
        "lookback_days": lookback_days,
        "country": "US",
        "requested_store_key": store_key,
        "resolved_store_key": resolved_store_key,
        "since_date": since_date,
        "snapshot_rows": len(snapshot_rows),
        "rollup_count": len(rollups),
        "outlier_count": len(outliers),
        "metric_keys": selected_metric_keys,
    }


def list_usa_creative_rollups(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    lookback_days: int = 60,
    limit: int = 100,
    offset: int = 0,
    metric_keys: list[str] | tuple[str, ...] | None = None,
) -> dict[str, Any]:
    selected_metric_keys = normalize_metric_keys(metric_keys)
    conn = _connect(db_path)
    try:
        _ensure_rollup_schema(conn)
        resolved_store_key = _resolve_existing_store_key(
            conn,
            tenant_key=tenant_key,
            requested_store_key=store_key,
            tables=("creative_usa_rollups", "creative_snapshots", "creative_variants"),
        )
        rows = conn.execute(
            """
            SELECT *
            FROM creative_usa_rollups
            WHERE tenant_key = ? AND store_key = ? AND lookback_days = ?
            ORDER BY
                CASE WHEN median_roas IS NULL THEN 1 ELSE 0 END,
                median_roas DESC,
                CASE WHEN median_orders IS NULL THEN 1 ELSE 0 END,
                median_orders DESC,
                creative_name ASC
            LIMIT ? OFFSET ?
            """,
            (tenant_key, resolved_store_key, lookback_days, limit, offset),
        ).fetchall()
    finally:
        conn.close()

    items = []
    for row in rows:
        item = dict(row)
        item["metrics"] = {
            key: item.get(METRIC_COLUMN_MAP[key])
            for key in selected_metric_keys
        }
        item["metric_keys"] = selected_metric_keys
        item["requested_store_key"] = store_key
        item["resolved_store_key"] = resolved_store_key
        items.append(item)
    return {
        "success": True,
        "count": len(items),
        "metric_keys": selected_metric_keys,
        "requested_store_key": store_key,
        "resolved_store_key": resolved_store_key,
        "items": items,
    }


def get_usa_creative_rollup_detail(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    rollup_id: str,
    metric_keys: list[str] | tuple[str, ...] | None = None,
) -> dict[str, Any] | None:
    selected_metric_keys = normalize_metric_keys(metric_keys)
    conn = _connect(db_path)
    try:
        _ensure_rollup_schema(conn)
        resolved_store_key = _resolve_existing_store_key(
            conn,
            tenant_key=tenant_key,
            requested_store_key=store_key,
            tables=("creative_usa_rollups", "creative_snapshots", "creative_variants"),
        )
        row = conn.execute(
            """
            SELECT *
            FROM creative_usa_rollups
            WHERE tenant_key = ? AND store_key = ? AND rollup_id = ?
            """,
            (tenant_key, resolved_store_key, rollup_id),
        ).fetchone()
        if row is None:
            return None

        usage_rows = conn.execute(
            """
            SELECT DISTINCT
                u.usage_id,
                u.campaign_name,
                u.adset_name,
                u.ad_name,
                u.publisher_platform,
                u.platform_position,
                u.status,
                u.effective_status
            FROM creative_usages u
            WHERE u.tenant_key = ? AND u.store_key = ?
              AND u.variant_id = ?
            ORDER BY u.campaign_name ASC, u.adset_name ASC, u.ad_name ASC
            """,
            (tenant_key, resolved_store_key, str(row["variant_id"])),
        ).fetchall()
        outlier_rows = conn.execute(
            """
            SELECT *
            FROM creative_usa_rollup_outliers
            WHERE tenant_key = ? AND store_key = ? AND rollup_id = ?
            ORDER BY date_stop DESC, metric_key ASC
            """,
            (tenant_key, resolved_store_key, rollup_id),
        ).fetchall()
    finally:
        conn.close()

    payload = dict(row)
    payload["metrics"] = {
        key: payload.get(METRIC_COLUMN_MAP[key])
        for key in selected_metric_keys
    }
    payload["metric_keys"] = selected_metric_keys
    payload["requested_store_key"] = store_key
    payload["resolved_store_key"] = resolved_store_key
    payload["usage_members"] = [dict(item) for item in usage_rows]
    payload["outliers"] = [dict(item) for item in outlier_rows]
    payload["scoring_status"] = {
        "audio_stack": "ready",
        "siglip": "ready",
        "music_mood": "in_progress",
        "claude_subjective": "pending",
        "prompt_tightening": "pending",
    }
    return payload
