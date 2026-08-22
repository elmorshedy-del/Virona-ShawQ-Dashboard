from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import log
from statistics import median
from typing import Any
from urllib.parse import urlparse

from .creative_library_storage import _connect, _ensure_schema


DEFAULT_METRIC_KEYS = ("spend", "roas", "orders", "ctr", "hook_rate")
METRIC_COLUMN_MAP = {
    "spend": "total_spend",
    "roas": "blended_roas",
    "orders": "total_orders",
    "ctr": "ctr",
    "hook_rate": "hook_rate",
}
LOOKBACK_WINDOW_DAYS = {
    "30d": 30,
    "60d": 60,
    "90d": 90,
}
DEFAULT_LOOKBACK_WINDOW = "60d"
DEFAULT_MIN_SPEND_THRESHOLD = 30.0


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _cutoff_date(lookback_days: int) -> str:
    days = max(1, int(lookback_days))
    return (datetime.now(UTC).date() - timedelta(days=days - 1)).isoformat()


def _normalize_lookback_window(
    *,
    lookback_days: int | None = None,
    lookback_window: str | None = None,
) -> tuple[str, int | None]:
    requested_window = str(lookback_window or "").strip().lower()
    if requested_window == "all_time":
        return "all_time", None
    if requested_window in LOOKBACK_WINDOW_DAYS:
        return requested_window, LOOKBACK_WINDOW_DAYS[requested_window]
    days = max(1, int(lookback_days or LOOKBACK_WINDOW_DAYS[DEFAULT_LOOKBACK_WINDOW]))
    if days in (30, 60, 90):
        return f"{days}d", days
    return f"{days}d", days


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
    return q1 - (2.0 * iqr), q3 + (2.0 * iqr)


def _hook_rate(impressions: int | None, video_3s_views: int | None) -> float | None:
    if not impressions or impressions <= 0:
        return None
    if video_3s_views is None:
        return None
    return (float(video_3s_views) / float(impressions)) * 100.0


def _safe_ratio(numerator: float | None, denominator: float | None, *, scale: float = 1.0) -> float | None:
    if numerator is None or denominator is None:
        return None
    if denominator <= 0:
        return None
    return (float(numerator) / float(denominator)) * float(scale)


def _log_blended_roas(blended_roas: float | None) -> float | None:
    if blended_roas is None:
        return None
    if blended_roas <= 0:
        return log(0.01)
    return log(blended_roas)


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


def _ensure_column(conn: sqlite3.Connection, *, table: str, definition: str) -> None:
    column_name = definition.strip().split()[0]
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    existing = {str(row["name"]) for row in rows}
    if column_name in existing:
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


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
    canonical_creative_id: str
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
    revenue: float | None
    purchases: float | None
    clicks: int | None
    ctr: float | None
    roas: float | None
    impressions: int | None
    video_3s_views: int | None
    currency: str

    @property
    def hook_rate(self) -> float | None:
        return _hook_rate(self.impressions, self.video_3s_views)


@dataclass
class _UsageMetricAggregate:
    usage_id: str
    snapshot_id: str
    canonical_creative_id: str
    variant_id: str
    campaign_name: str
    adset_name: str
    ad_name: str
    date_start: str
    date_stop: str
    spend: float | None
    revenue: float | None
    purchases: float | None
    impressions: int | None
    clicks: int | None
    video_3s_views: int | None
    ctr: float | None
    roas: float | None
    hook_rate: float | None
    currency: str


def _ensure_rollup_schema(conn: sqlite3.Connection) -> None:
    _ensure_schema(conn)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS creative_identity (
            tenant_key TEXT NOT NULL,
            store_key TEXT NOT NULL,
            canonical_creative_id TEXT NOT NULL,
            variant_id TEXT NOT NULL DEFAULT '',
            family_id TEXT NOT NULL DEFAULT '',
            media_hash TEXT NOT NULL DEFAULT '',
            media_url TEXT NOT NULL DEFAULT '',
            media_type TEXT NOT NULL DEFAULT '',
            duration_seconds REAL,
            resolution_width INTEGER,
            resolution_height INTEGER,
            siglip_embedding BLOB,
            first_seen_date TEXT NOT NULL DEFAULT '',
            last_seen_date TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (tenant_key, store_key, canonical_creative_id)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_creative_identity_family
        ON creative_identity(tenant_key, store_key, family_id)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_creative_identity_media_hash
        ON creative_identity(tenant_key, store_key, media_hash)
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS creative_performance (
            tenant_key TEXT NOT NULL,
            store_key TEXT NOT NULL,
            canonical_creative_id TEXT NOT NULL,
            representative_variant_id TEXT NOT NULL DEFAULT '',
            family_id TEXT NOT NULL DEFAULT '',
            geo TEXT NOT NULL,
            lookback_window TEXT NOT NULL,
            computed_at TEXT NOT NULL,
            creative_name TEXT NOT NULL DEFAULT '',
            media_type TEXT NOT NULL DEFAULT '',
            thumbnail_url TEXT NOT NULL DEFAULT '',
            preview_url TEXT NOT NULL DEFAULT '',
            body_text TEXT NOT NULL DEFAULT '',
            headline TEXT NOT NULL DEFAULT '',
            currency TEXT NOT NULL DEFAULT '',
            blended_roas REAL,
            log_blended_roas REAL,
            total_orders INTEGER,
            ctr REAL,
            hook_rate REAL,
            total_spend REAL,
            total_revenue REAL,
            total_impressions INTEGER,
            usage_count INTEGER,
            variant_count INTEGER,
            snapshot_count INTEGER,
            active_days INTEGER,
            first_active TEXT,
            last_active TEXT,
            is_outlier INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (tenant_key, store_key, canonical_creative_id, geo, lookback_window)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_creative_performance_lookup
        ON creative_performance(tenant_key, store_key, geo, lookback_window, blended_roas DESC, total_orders DESC)
        """
    )
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
            currency TEXT NOT NULL DEFAULT '',
            total_spend REAL,
            total_revenue REAL,
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
    _ensure_column(conn, table="creative_usa_rollups", definition="currency TEXT NOT NULL DEFAULT ''")
    _ensure_column(conn, table="creative_usa_rollups", definition="total_revenue REAL")
    conn.commit()


def _materialize_creative_identity(
    conn: sqlite3.Connection,
    *,
    tenant_key: str,
    store_key: str,
) -> int:
    rows = conn.execute(
        """
        SELECT
            a.asset_id AS canonical_creative_id,
            a.creative_family_id AS family_id,
            a.asset_type AS media_type,
            COALESCE(NULLIF(a.asset_fingerprint, ''), NULLIF(a.image_hash, ''), NULLIF(a.source_asset_id, ''), a.asset_signature) AS media_hash,
            COALESCE(NULLIF(a.asset_url, ''), NULLIF(a.preview_url, ''), NULLIF(a.thumbnail_url, ''), '') AS media_url,
            a.first_seen_at,
            a.last_seen_at,
            json_extract(a.metadata_json, '$.duration_seconds') AS duration_seconds,
            json_extract(a.metadata_json, '$.resolution_width') AS resolution_width,
            json_extract(a.metadata_json, '$.resolution_height') AS resolution_height,
            (
                SELECT v.variant_id
                FROM creative_variants v
                WHERE v.tenant_key = a.tenant_key
                  AND v.store_key = a.store_key
                  AND v.asset_id = a.asset_id
                ORDER BY v.last_seen_at DESC, v.variant_id DESC
                LIMIT 1
            ) AS representative_variant_id
        FROM creative_assets a
        WHERE a.tenant_key = ? AND a.store_key = ?
        """,
        (tenant_key, store_key),
    ).fetchall()
    for row in rows:
        conn.execute(
            """
            INSERT INTO creative_identity (
                tenant_key, store_key, canonical_creative_id, variant_id, family_id,
                media_hash, media_url, media_type, duration_seconds,
                resolution_width, resolution_height, siglip_embedding,
                first_seen_date, last_seen_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
            ON CONFLICT(tenant_key, store_key, canonical_creative_id)
            DO UPDATE SET
                variant_id = excluded.variant_id,
                family_id = excluded.family_id,
                media_hash = excluded.media_hash,
                media_url = excluded.media_url,
                media_type = excluded.media_type,
                duration_seconds = excluded.duration_seconds,
                resolution_width = excluded.resolution_width,
                resolution_height = excluded.resolution_height,
                first_seen_date = excluded.first_seen_date,
                last_seen_date = excluded.last_seen_date
            """,
            (
                tenant_key,
                store_key,
                str(row["canonical_creative_id"]),
                str(row["representative_variant_id"] or ""),
                str(row["family_id"] or ""),
                str(row["media_hash"] or ""),
                str(row["media_url"] or ""),
                str(row["media_type"] or ""),
                _safe_float(row["duration_seconds"]),
                _safe_int(row["resolution_width"]),
                _safe_int(row["resolution_height"]),
                str(row["first_seen_at"] or "")[:10],
                str(row["last_seen_at"] or "")[:10],
            ),
        )
    return len(rows)


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
            s.asset_id AS canonical_creative_id,
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
            s.revenue,
            s.purchases,
            s.clicks,
            s.ctr,
            s.roas,
            s.impressions,
            s.video_3s_views,
            COALESCE(
                json_extract(s.metadata_json, '$.account_currency'),
                json_extract(s.raw_json, '$.insight.account_currency'),
                ''
            ) AS currency
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
            canonical_creative_id=str(row["canonical_creative_id"]),
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
            revenue=_safe_float(row["revenue"]),
            purchases=_safe_float(row["purchases"]),
            clicks=_safe_int(row["clicks"]),
            ctr=_safe_float(row["ctr"]),
            roas=_safe_float(row["roas"]),
            impressions=_safe_int(row["impressions"]),
            video_3s_views=_safe_int(row["video_3s_views"]),
            currency=str(row["currency"] or "").strip().upper(),
        )
        for row in rows
    ]


def _aggregate_usage_rows(rows: list[_SnapshotMetricRow]) -> list[_UsageMetricAggregate]:
    grouped: dict[str, list[_SnapshotMetricRow]] = defaultdict(list)
    for row in rows:
        grouped[row.usage_id].append(row)

    aggregates: list[_UsageMetricAggregate] = []
    for usage_id, usage_rows in grouped.items():
        latest = usage_rows[0]
        spend_total = sum(row.spend for row in usage_rows if row.spend is not None)
        revenue_total = sum(row.revenue for row in usage_rows if row.revenue is not None)
        purchases_total = sum(row.purchases for row in usage_rows if row.purchases is not None)
        clicks_total = sum(row.clicks for row in usage_rows if row.clicks is not None)
        impressions_total = sum(row.impressions for row in usage_rows if row.impressions is not None)
        video_3s_total = sum(row.video_3s_views for row in usage_rows if row.video_3s_views is not None)

        has_spend = any(row.spend is not None for row in usage_rows)
        has_revenue = any(row.revenue is not None for row in usage_rows)
        has_purchases = any(row.purchases is not None for row in usage_rows)
        has_clicks = any(row.clicks is not None for row in usage_rows)
        has_impressions = any(row.impressions is not None for row in usage_rows)
        has_video_3s = any(row.video_3s_views is not None for row in usage_rows)

        spend_value = round(spend_total, 2) if has_spend else None
        revenue_value = round(revenue_total, 2) if (has_revenue or has_spend) else None
        purchases_value = purchases_total if (has_purchases or has_spend) else None
        impressions_value = impressions_total if has_impressions else None
        clicks_value = clicks_total if has_clicks else None
        video_3s_value = video_3s_total if has_video_3s else None
        ctr_value = _safe_ratio(clicks_total, impressions_total, scale=100.0) if impressions_total else None
        hook_rate_value = _hook_rate(impressions_total, video_3s_total) if impressions_total else None

        currencies = {row.currency for row in usage_rows if row.currency}
        currency = next(iter(currencies)) if len(currencies) == 1 else ""
        roas_value = None
        if spend_value is not None and spend_value > 0:
            roas_value = _safe_ratio(revenue_value or 0.0, spend_value)

        aggregates.append(
            _UsageMetricAggregate(
                usage_id=usage_id,
                snapshot_id=latest.snapshot_id,
                canonical_creative_id=latest.canonical_creative_id,
                variant_id=latest.variant_id,
                campaign_name=latest.campaign_name,
                adset_name=latest.adset_name,
                ad_name=latest.ad_name,
                date_start=min(row.date_start for row in usage_rows),
                date_stop=max(row.date_stop for row in usage_rows),
                spend=spend_value,
                revenue=revenue_value,
                purchases=purchases_value,
                impressions=impressions_value,
                clicks=clicks_value,
                video_3s_views=video_3s_value,
                ctr=ctr_value,
                roas=roas_value,
                hook_rate=hook_rate_value,
                currency=currency,
            )
        )
    return aggregates


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
                lookback_days, country, usage_count, snapshot_count, outlier_count, currency, total_spend,
                total_revenue, median_spend, median_orders, median_ctr, median_roas, median_hook_rate,
                first_seen_at, last_seen_at, materialized_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                row["currency"],
                row["total_spend"],
                row["total_revenue"],
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


def _replace_performance_rows(
    conn: sqlite3.Connection,
    *,
    tenant_key: str,
    store_key: str,
    geo: str,
    lookback_window: str,
    rows: list[dict[str, Any]],
) -> None:
    with conn:
        conn.execute(
            """
            DELETE FROM creative_performance
            WHERE tenant_key = ? AND store_key = ? AND geo = ? AND lookback_window = ?
            """,
            (tenant_key, store_key, geo, lookback_window),
        )
        for row in rows:
            conn.execute(
                """
                INSERT INTO creative_performance (
                    tenant_key, store_key, canonical_creative_id, representative_variant_id, family_id,
                    geo, lookback_window, computed_at, creative_name, media_type, thumbnail_url, preview_url,
                    body_text, headline, currency, blended_roas, log_blended_roas, total_orders, ctr,
                    hook_rate, total_spend, total_revenue, total_impressions, usage_count, variant_count,
                    snapshot_count, active_days, first_active, last_active, is_outlier
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tenant_key,
                    store_key,
                    row["canonical_creative_id"],
                    row["representative_variant_id"],
                    row["family_id"],
                    geo,
                    lookback_window,
                    row["computed_at"],
                    row["creative_name"],
                    row["media_type"],
                    row["thumbnail_url"],
                    row["preview_url"],
                    row["body_text"],
                    row["headline"],
                    row["currency"],
                    row["blended_roas"],
                    row["log_blended_roas"],
                    row["total_orders"],
                    row["ctr"],
                    row["hook_rate"],
                    row["total_spend"],
                    row["total_revenue"],
                    row["total_impressions"],
                    row["usage_count"],
                    row["variant_count"],
                    row["snapshot_count"],
                    row["active_days"],
                    row["first_active"],
                    row["last_active"],
                    row["is_outlier"],
                ),
            )


def materialize_usa_creative_rollups(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    lookback_days: int = 60,
    lookback_window: str | None = None,
    metric_keys: list[str] | tuple[str, ...] | None = None,
    min_spend_threshold: float = DEFAULT_MIN_SPEND_THRESHOLD,
) -> dict[str, Any]:
    selected_metric_keys = normalize_metric_keys(metric_keys)
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
            tables=("creative_snapshots", "creative_sync_runs", "creative_variants"),
        )
        identity_count = _materialize_creative_identity(
            conn,
            tenant_key=tenant_key,
            store_key=resolved_store_key,
        )
        since_date = _cutoff_date(normalized_days) if normalized_days is not None else "0001-01-01"
        snapshot_rows = _fetch_usa_snapshot_rows(
            conn,
            tenant_key=tenant_key,
            store_key=resolved_store_key,
            since_date=since_date,
        )

        grouped: dict[str, list[_SnapshotMetricRow]] = defaultdict(list)
        for row in snapshot_rows:
            grouped[row.canonical_creative_id].append(row)

        materialized_at = _utc_now_iso()
        performance_rows: list[dict[str, Any]] = []
        excluded_low_spend_count = 0

        for canonical_creative_id, rows in grouped.items():
            first = rows[0]
            usage_aggregates = _aggregate_usage_rows(rows)
            total_spend = round(sum(item.spend or 0.0 for item in usage_aggregates), 2)
            if total_spend < float(min_spend_threshold):
                excluded_low_spend_count += 1
                continue
            total_revenue = round(sum(item.revenue or 0.0 for item in usage_aggregates), 2)
            total_orders = int(round(sum(item.purchases or 0.0 for item in usage_aggregates)))
            total_impressions = int(sum(item.impressions or 0 for item in usage_aggregates))
            total_clicks = int(sum(item.clicks or 0 for item in usage_aggregates))
            total_video_3s_views = int(sum(item.video_3s_views or 0 for item in usage_aggregates))
            blended_roas = _safe_ratio(total_revenue, total_spend)
            ctr_value = _safe_ratio(total_clicks, total_impressions, scale=100.0) if total_impressions > 0 else None
            hook_rate_value = _hook_rate(total_impressions, total_video_3s_views)
            currencies = {row.currency for row in usage_aggregates if row.currency}
            rollup_currency = next(iter(currencies)) if len(currencies) == 1 else ""
            variant_summary: dict[str, dict[str, Any]] = {}
            for row in rows:
                bucket = variant_summary.setdefault(
                    row.variant_id,
                    {"snapshot_count": 0, "last_date": row.date_stop},
                )
                bucket["snapshot_count"] += 1
                if str(row.date_stop) > str(bucket["last_date"]):
                    bucket["last_date"] = row.date_stop
            representative_variant_id = ""
            if variant_summary:
                representative_variant_id = max(
                    variant_summary.items(),
                    key=lambda item: (int(item[1]["snapshot_count"]), str(item[1]["last_date"]), item[0]),
                )[0]
            representative_rows = [row for row in rows if row.variant_id == representative_variant_id] or rows
            representative = representative_rows[0]

            performance_rows.append(
                {
                    "rollup_id": canonical_creative_id,
                    "canonical_creative_id": canonical_creative_id,
                    "representative_variant_id": representative_variant_id,
                    "family_id": first.creative_family_id,
                    "creative_name": representative.creative_name,
                    "media_type": first.asset_type,
                    "thumbnail_url": first.thumbnail_url,
                    "preview_url": first.preview_url,
                    "body_text": representative.body_text,
                    "headline": representative.headline,
                    "usage_count": len(usage_aggregates),
                    "variant_count": len({item.variant_id for item in usage_aggregates}),
                    "snapshot_count": len(rows),
                    "currency": rollup_currency,
                    "blended_roas": blended_roas,
                    "log_blended_roas": _log_blended_roas(blended_roas),
                    "total_orders": total_orders,
                    "ctr": ctr_value,
                    "hook_rate": hook_rate_value,
                    "total_spend": total_spend,
                    "total_revenue": total_revenue,
                    "total_impressions": total_impressions,
                    "active_days": len({row.date_stop for row in rows}),
                    "first_active": min(row.date_start for row in rows),
                    "last_active": max(row.date_stop for row in rows),
                    "computed_at": materialized_at,
                    "is_outlier": 0,
                }
            )

        roas_bounds = _metric_outlier_bounds(
            [row["blended_roas"] for row in performance_rows if row["blended_roas"] is not None]
        )
        outlier_count = 0
        if roas_bounds is not None:
            lower, upper = roas_bounds
            for row in performance_rows:
                value = row["blended_roas"]
                if value is None:
                    continue
                if value < lower or value > upper:
                    row["is_outlier"] = 1
                    outlier_count += 1

        _replace_performance_rows(
            conn,
            tenant_key=tenant_key,
            store_key=resolved_store_key,
            geo="US",
            lookback_window=normalized_window,
            rows=performance_rows,
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "success": True,
        "lookback_days": normalized_days,
        "lookback_window": normalized_window,
        "geo": "US",
        "requested_store_key": store_key,
        "resolved_store_key": resolved_store_key,
        "since_date": since_date,
        "identity_count": identity_count,
        "snapshot_rows": len(snapshot_rows),
        "rollup_count": len(performance_rows),
        "outlier_count": outlier_count,
        "excluded_low_spend_count": excluded_low_spend_count,
        "min_spend_threshold": float(min_spend_threshold),
        "metric_keys": selected_metric_keys,
    }


def list_usa_creative_rollups(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    lookback_days: int = 60,
    lookback_window: str | None = None,
    limit: int = 100,
    offset: int = 0,
    metric_keys: list[str] | tuple[str, ...] | None = None,
) -> dict[str, Any]:
    selected_metric_keys = normalize_metric_keys(metric_keys)
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
            tables=("creative_performance", "creative_snapshots", "creative_variants"),
        )
        rows = conn.execute(
            """
            SELECT *
            FROM creative_performance
            WHERE tenant_key = ? AND store_key = ? AND geo = 'US' AND lookback_window = ?
            ORDER BY
                CASE WHEN blended_roas IS NULL THEN 1 ELSE 0 END,
                blended_roas DESC,
                CASE WHEN total_orders IS NULL THEN 1 ELSE 0 END,
                total_orders DESC,
                CASE WHEN total_spend IS NULL THEN 1 ELSE 0 END,
                total_spend DESC,
                creative_name ASC
            LIMIT ? OFFSET ?
            """,
            (tenant_key, resolved_store_key, normalized_window, limit, offset),
        ).fetchall()
    finally:
        conn.close()

    items = []
    for row in rows:
        item = dict(row)
        item["rollup_id"] = item.get("canonical_creative_id")
        item["variant_id"] = item.get("representative_variant_id") or item.get("canonical_creative_id")
        item["metrics"] = {
            key: item.get(METRIC_COLUMN_MAP[key])
            for key in selected_metric_keys
        }
        item["metric_keys"] = selected_metric_keys
        item["requested_store_key"] = store_key
        item["resolved_store_key"] = resolved_store_key
        item["lookback_window"] = normalized_window
        item["lookback_days"] = normalized_days
        items.append(item)
    return {
        "success": True,
        "count": len(items),
        "metric_keys": selected_metric_keys,
        "lookback_window": normalized_window,
        "lookback_days": normalized_days,
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
    lookback_window: str | None = None,
    lookback_days: int = 60,
    metric_keys: list[str] | tuple[str, ...] | None = None,
) -> dict[str, Any] | None:
    selected_metric_keys = normalize_metric_keys(metric_keys)
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
            tables=("creative_performance", "creative_snapshots", "creative_variants"),
        )
        row = conn.execute(
            """
            SELECT *
            FROM creative_performance
            WHERE tenant_key = ? AND store_key = ? AND canonical_creative_id = ? AND geo = 'US' AND lookback_window = ?
            """,
            (tenant_key, resolved_store_key, rollup_id, normalized_window),
        ).fetchone()
        if row is None:
            return None

        usage_rows = conn.execute(
            """
            SELECT DISTINCT
                u.usage_id,
                v.variant_id,
                u.campaign_name,
                u.adset_name,
                u.ad_name,
                u.publisher_platform,
                u.platform_position,
                u.status,
                u.effective_status
            FROM creative_usages u
            JOIN creative_variants v
              ON v.tenant_key = u.tenant_key
             AND v.store_key = u.store_key
             AND v.variant_id = u.variant_id
            WHERE u.tenant_key = ? AND u.store_key = ?
              AND v.asset_id = ?
            ORDER BY u.campaign_name ASC, u.adset_name ASC, u.ad_name ASC
            """,
            (tenant_key, resolved_store_key, str(row["canonical_creative_id"])),
        ).fetchall()
        variant_rows = conn.execute(
            """
            SELECT
                variant_id,
                creative_name,
                body_text,
                headline,
                last_seen_at
            FROM creative_variants
            WHERE tenant_key = ? AND store_key = ? AND asset_id = ?
            ORDER BY last_seen_at DESC, variant_id DESC
            """,
            (tenant_key, resolved_store_key, str(row["canonical_creative_id"])),
        ).fetchall()
        labels_table_exists = conn.execute(
            """
            SELECT 1
            FROM sqlite_master
            WHERE type = 'table' AND name = 'creative_labels'
            """
        ).fetchone()
        label_row = None
        if labels_table_exists is not None:
            label_row = conn.execute(
                """
                SELECT *
                FROM creative_labels
                WHERE tenant_key = ? AND store_key = ? AND canonical_creative_id = ?
                ORDER BY labeled_at DESC, variant_id DESC
                LIMIT 1
                """,
                (tenant_key, resolved_store_key, str(row["canonical_creative_id"])),
            ).fetchone()
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
    payload["rollup_id"] = payload["canonical_creative_id"]
    payload["variant_id"] = payload.get("representative_variant_id") or payload["canonical_creative_id"]
    payload["lookback_window"] = normalized_window
    payload["lookback_days"] = normalized_days
    payload["usage_members"] = [dict(item) for item in usage_rows]
    payload["variant_members"] = [dict(item) for item in variant_rows]
    payload["outliers"] = []
    if label_row is not None:
        label_payload = dict(label_row)
        label_payload["extracted_text_sequence"] = json.loads(
            str(label_payload.get("extracted_text_sequence") or "[]")
        )
        label_payload["evidence"] = json.loads(str(label_payload.get("evidence") or "{}"))
        payload["creative_labels"] = label_payload
    payload["scoring_status"] = {
        "audio_stack": "ready",
        "siglip": "ready",
        "music_mood": "ready" if label_row is not None else "in_progress",
        "claude_subjective": "ready" if label_row is not None else "pending",
        "prompt_tightening": "ready" if label_row is not None else "pending",
        "creative_labels": "ready" if label_row is not None else "pending",
    }
    return payload
