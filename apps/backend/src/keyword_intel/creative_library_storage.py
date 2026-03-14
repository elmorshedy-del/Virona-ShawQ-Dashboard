from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

from .models import (
    CreativeLibraryAsset,
    CreativeLibraryIngestResult,
    CreativeLibrarySnapshot,
    CreativeLibraryUsage,
    CreativeLibraryVariant,
    CreativeLibraryVariantRecord,
)


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _connect(db_path: str) -> sqlite3.Connection:
    path = Path(db_path).expanduser()
    if path.parent and not path.parent.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS creative_sync_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_key TEXT NOT NULL,
            store_key TEXT NOT NULL,
            platform TEXT NOT NULL,
            source_system TEXT NOT NULL,
            sync_label TEXT NOT NULL,
            synced_at TEXT NOT NULL,
            row_count INTEGER NOT NULL DEFAULT 0,
            historical_rows INTEGER NOT NULL DEFAULT 0,
            payload_json TEXT NOT NULL DEFAULT '{}'
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS creative_assets (
            tenant_key TEXT NOT NULL,
            store_key TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            creative_family_id TEXT NOT NULL,
            platform TEXT NOT NULL,
            source_creative_id TEXT NOT NULL DEFAULT '',
            source_asset_id TEXT NOT NULL DEFAULT '',
            asset_type TEXT NOT NULL DEFAULT 'unknown',
            asset_name TEXT NOT NULL DEFAULT '',
            asset_url TEXT NOT NULL DEFAULT '',
            thumbnail_url TEXT NOT NULL DEFAULT '',
            preview_url TEXT NOT NULL DEFAULT '',
            asset_signature TEXT NOT NULL,
            asset_fingerprint TEXT NOT NULL DEFAULT '',
            image_hash TEXT NOT NULL DEFAULT '',
            perceptual_hash TEXT NOT NULL DEFAULT '',
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            raw_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (tenant_key, store_key, asset_id)
        )
        """
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_creative_assets_signature
        ON creative_assets(tenant_key, store_key, platform, asset_signature)
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS creative_variants (
            tenant_key TEXT NOT NULL,
            store_key TEXT NOT NULL,
            variant_id TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            platform TEXT NOT NULL,
            source_creative_id TEXT NOT NULL DEFAULT '',
            creative_name TEXT NOT NULL DEFAULT '',
            body_text TEXT NOT NULL DEFAULT '',
            headline TEXT NOT NULL DEFAULT '',
            link_description TEXT NOT NULL DEFAULT '',
            cta_text TEXT NOT NULL DEFAULT '',
            destination_url TEXT NOT NULL DEFAULT '',
            aspect_ratio TEXT NOT NULL DEFAULT '',
            ad_format TEXT NOT NULL DEFAULT '',
            language TEXT NOT NULL DEFAULT '',
            variant_signature TEXT NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            raw_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (tenant_key, store_key, variant_id)
        )
        """
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_creative_variants_signature
        ON creative_variants(tenant_key, store_key, platform, variant_signature)
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS creative_usages (
            tenant_key TEXT NOT NULL,
            store_key TEXT NOT NULL,
            usage_id TEXT NOT NULL,
            variant_id TEXT NOT NULL,
            platform TEXT NOT NULL,
            account_id TEXT NOT NULL DEFAULT '',
            account_name TEXT NOT NULL DEFAULT '',
            campaign_id TEXT NOT NULL DEFAULT '',
            campaign_name TEXT NOT NULL DEFAULT '',
            adset_id TEXT NOT NULL DEFAULT '',
            adset_name TEXT NOT NULL DEFAULT '',
            ad_id TEXT NOT NULL DEFAULT '',
            ad_name TEXT NOT NULL DEFAULT '',
            country TEXT NOT NULL DEFAULT '',
            region TEXT NOT NULL DEFAULT '',
            geo_bucket TEXT NOT NULL DEFAULT '',
            publisher_platform TEXT NOT NULL DEFAULT '',
            platform_position TEXT NOT NULL DEFAULT '',
            placement TEXT NOT NULL DEFAULT '',
            device_platform TEXT NOT NULL DEFAULT '',
            objective TEXT NOT NULL DEFAULT '',
            buying_type TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT '',
            effective_status TEXT NOT NULL DEFAULT '',
            started_at TEXT NOT NULL DEFAULT '',
            ended_at TEXT NOT NULL DEFAULT '',
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            raw_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (tenant_key, store_key, usage_id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS creative_snapshots (
            tenant_key TEXT NOT NULL,
            store_key TEXT NOT NULL,
            snapshot_id TEXT NOT NULL,
            usage_id TEXT NOT NULL,
            variant_id TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            sync_run_id INTEGER,
            observed_at TEXT NOT NULL,
            date_start TEXT NOT NULL,
            date_stop TEXT NOT NULL,
            spend REAL,
            impressions INTEGER,
            clicks INTEGER,
            link_clicks INTEGER,
            ctr REAL,
            cpc REAL,
            cpm REAL,
            frequency REAL,
            conversions REAL,
            purchases REAL,
            revenue REAL,
            roas REAL,
            hook_hold_rate REAL,
            thumb_stop_rate REAL,
            video_3s_views INTEGER,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            raw_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (tenant_key, store_key, snapshot_id)
        )
        """
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_creative_snapshots_window
        ON creative_snapshots(tenant_key, store_key, usage_id, date_start, date_stop)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_creative_variants_last_seen
        ON creative_variants(tenant_key, store_key, last_seen_at DESC)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_creative_snapshots_variant
        ON creative_snapshots(tenant_key, store_key, variant_id, observed_at DESC, date_stop DESC)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_creative_usages_variant
        ON creative_usages(tenant_key, store_key, variant_id, last_seen_at DESC)
        """
    )
    conn.commit()


def _json_text(value: dict[str, Any]) -> str:
    return json.dumps(value or {}, ensure_ascii=False, sort_keys=True)


def _merge_text(current: str, incoming: str) -> str:
    return incoming or current


def _min_text(current: str, incoming: str) -> str:
    if not current:
        return incoming
    if not incoming:
        return current
    return current if current <= incoming else incoming


def _max_text(current: str, incoming: str) -> str:
    if not current:
        return incoming
    if not incoming:
        return current
    return current if current >= incoming else incoming


def _merge_json_text(current: str, incoming: str) -> str:
    return incoming if incoming and incoming != "{}" else current


def _row_to_asset(row: sqlite3.Row) -> CreativeLibraryAsset:
    return CreativeLibraryAsset(
        tenant_key=str(row["tenant_key"]),
        store_key=str(row["store_key"]),
        asset_id=str(row["asset_id"]),
        creative_family_id=str(row["creative_family_id"]),
        platform=str(row["platform"]),
        source_creative_id=str(row["source_creative_id"]),
        source_asset_id=str(row["source_asset_id"]),
        asset_type=str(row["asset_type"]),
        asset_name=str(row["asset_name"]),
        asset_url=str(row["asset_url"]),
        thumbnail_url=str(row["thumbnail_url"]),
        preview_url=str(row["preview_url"]),
        asset_signature=str(row["asset_signature"]),
        asset_fingerprint=str(row["asset_fingerprint"]),
        image_hash=str(row["image_hash"]),
        perceptual_hash=str(row["perceptual_hash"]),
        first_seen_at=str(row["first_seen_at"]),
        last_seen_at=str(row["last_seen_at"]),
        metadata=json.loads(str(row["metadata_json"])),
        raw=json.loads(str(row["raw_json"])),
    )


def _row_to_variant(row: sqlite3.Row) -> CreativeLibraryVariant:
    return CreativeLibraryVariant(
        tenant_key=str(row["tenant_key"]),
        store_key=str(row["store_key"]),
        variant_id=str(row["variant_id"]),
        asset_id=str(row["asset_id"]),
        platform=str(row["platform"]),
        source_creative_id=str(row["source_creative_id"]),
        creative_name=str(row["creative_name"]),
        body_text=str(row["body_text"]),
        headline=str(row["headline"]),
        link_description=str(row["link_description"]),
        cta_text=str(row["cta_text"]),
        destination_url=str(row["destination_url"]),
        aspect_ratio=str(row["aspect_ratio"]),
        ad_format=str(row["ad_format"]),
        language=str(row["language"]),
        variant_signature=str(row["variant_signature"]),
        first_seen_at=str(row["first_seen_at"]),
        last_seen_at=str(row["last_seen_at"]),
        metadata=json.loads(str(row["metadata_json"])),
        raw=json.loads(str(row["raw_json"])),
    )


def _row_to_usage(row: sqlite3.Row) -> CreativeLibraryUsage:
    return CreativeLibraryUsage(
        tenant_key=str(row["tenant_key"]),
        store_key=str(row["store_key"]),
        usage_id=str(row["usage_id"]),
        variant_id=str(row["variant_id"]),
        platform=str(row["platform"]),
        account_id=str(row["account_id"]),
        account_name=str(row["account_name"]),
        campaign_id=str(row["campaign_id"]),
        campaign_name=str(row["campaign_name"]),
        adset_id=str(row["adset_id"]),
        adset_name=str(row["adset_name"]),
        ad_id=str(row["ad_id"]),
        ad_name=str(row["ad_name"]),
        country=str(row["country"]),
        region=str(row["region"]),
        geo_bucket=str(row["geo_bucket"]),
        publisher_platform=str(row["publisher_platform"]),
        platform_position=str(row["platform_position"]),
        placement=str(row["placement"]),
        device_platform=str(row["device_platform"]),
        objective=str(row["objective"]),
        buying_type=str(row["buying_type"]),
        status=str(row["status"]),
        effective_status=str(row["effective_status"]),
        started_at=str(row["started_at"]),
        ended_at=str(row["ended_at"]),
        first_seen_at=str(row["first_seen_at"]),
        last_seen_at=str(row["last_seen_at"]),
        metadata=json.loads(str(row["metadata_json"])),
        raw=json.loads(str(row["raw_json"])),
    )


def _row_to_snapshot(row: sqlite3.Row) -> CreativeLibrarySnapshot:
    return CreativeLibrarySnapshot(
        tenant_key=str(row["tenant_key"]),
        store_key=str(row["store_key"]),
        snapshot_id=str(row["snapshot_id"]),
        usage_id=str(row["usage_id"]),
        variant_id=str(row["variant_id"]),
        asset_id=str(row["asset_id"]),
        sync_run_id=int(row["sync_run_id"]) if row["sync_run_id"] is not None else None,
        observed_at=str(row["observed_at"]),
        date_start=str(row["date_start"]),
        date_stop=str(row["date_stop"]),
        spend=row["spend"],
        impressions=row["impressions"],
        clicks=row["clicks"],
        link_clicks=row["link_clicks"],
        ctr=row["ctr"],
        cpc=row["cpc"],
        cpm=row["cpm"],
        frequency=row["frequency"],
        conversions=row["conversions"],
        purchases=row["purchases"],
        revenue=row["revenue"],
        roas=row["roas"],
        hook_hold_rate=row["hook_hold_rate"],
        thumb_stop_rate=row["thumb_stop_rate"],
        video_3s_views=row["video_3s_views"],
        metadata=json.loads(str(row["metadata_json"])),
        raw=json.loads(str(row["raw_json"])),
    )


def _insert_sync_run(
    conn: sqlite3.Connection,
    *,
    tenant_key: str,
    store_key: str,
    platform: str,
    source_system: str,
    sync_label: str,
    row_count: int,
    historical_rows: int,
    payload: dict[str, Any],
) -> int:
    cursor = conn.execute(
        """
        INSERT INTO creative_sync_runs (
            tenant_key,
            store_key,
            platform,
            source_system,
            sync_label,
            synced_at,
            row_count,
            historical_rows,
            payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            tenant_key,
            store_key,
            platform,
            source_system,
            sync_label,
            _utc_now_iso(),
            row_count,
            historical_rows,
            _json_text(payload),
        ),
    )
    return int(cursor.lastrowid)


def _upsert_asset(conn: sqlite3.Connection, asset: CreativeLibraryAsset) -> None:
    metadata_json = _json_text(asset.metadata)
    raw_json = _json_text(asset.raw)
    existing = conn.execute(
        """
        SELECT *
        FROM creative_assets
        WHERE tenant_key = ? AND store_key = ? AND asset_id = ?
        """,
        (asset.tenant_key, asset.store_key, asset.asset_id),
    ).fetchone()
    if existing:
        conn.execute(
            """
            UPDATE creative_assets
            SET creative_family_id = ?,
                platform = ?,
                source_creative_id = ?,
                source_asset_id = ?,
                asset_type = ?,
                asset_name = ?,
                asset_url = ?,
                thumbnail_url = ?,
                preview_url = ?,
                asset_signature = ?,
                asset_fingerprint = ?,
                image_hash = ?,
                perceptual_hash = ?,
                first_seen_at = ?,
                last_seen_at = ?,
                metadata_json = ?,
                raw_json = ?
            WHERE tenant_key = ? AND store_key = ? AND asset_id = ?
            """,
            (
                asset.creative_family_id,
                asset.platform,
                _merge_text(str(existing["source_creative_id"]), asset.source_creative_id),
                _merge_text(str(existing["source_asset_id"]), asset.source_asset_id),
                asset.asset_type if asset.asset_type != "unknown" else str(existing["asset_type"]),
                _merge_text(str(existing["asset_name"]), asset.asset_name),
                _merge_text(str(existing["asset_url"]), asset.asset_url),
                _merge_text(str(existing["thumbnail_url"]), asset.thumbnail_url),
                _merge_text(str(existing["preview_url"]), asset.preview_url),
                asset.asset_signature,
                _merge_text(str(existing["asset_fingerprint"]), asset.asset_fingerprint),
                _merge_text(str(existing["image_hash"]), asset.image_hash),
                _merge_text(str(existing["perceptual_hash"]), asset.perceptual_hash),
                _min_text(str(existing["first_seen_at"]), asset.first_seen_at),
                _max_text(str(existing["last_seen_at"]), asset.last_seen_at),
                _merge_json_text(str(existing["metadata_json"]), metadata_json),
                _merge_json_text(str(existing["raw_json"]), raw_json),
                asset.tenant_key,
                asset.store_key,
                asset.asset_id,
            ),
        )
        return

    conn.execute(
        """
        INSERT INTO creative_assets (
            tenant_key,
            store_key,
            asset_id,
            creative_family_id,
            platform,
            source_creative_id,
            source_asset_id,
            asset_type,
            asset_name,
            asset_url,
            thumbnail_url,
            preview_url,
            asset_signature,
            asset_fingerprint,
            image_hash,
            perceptual_hash,
            first_seen_at,
            last_seen_at,
            metadata_json,
            raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            asset.tenant_key,
            asset.store_key,
            asset.asset_id,
            asset.creative_family_id,
            asset.platform,
            asset.source_creative_id,
            asset.source_asset_id,
            asset.asset_type,
            asset.asset_name,
            asset.asset_url,
            asset.thumbnail_url,
            asset.preview_url,
            asset.asset_signature,
            asset.asset_fingerprint,
            asset.image_hash,
            asset.perceptual_hash,
            asset.first_seen_at,
            asset.last_seen_at,
            metadata_json,
            raw_json,
        ),
    )


def _upsert_variant(conn: sqlite3.Connection, variant: CreativeLibraryVariant) -> None:
    metadata_json = _json_text(variant.metadata)
    raw_json = _json_text(variant.raw)
    existing = conn.execute(
        """
        SELECT *
        FROM creative_variants
        WHERE tenant_key = ? AND store_key = ? AND variant_id = ?
        """,
        (variant.tenant_key, variant.store_key, variant.variant_id),
    ).fetchone()
    if existing:
        conn.execute(
            """
            UPDATE creative_variants
            SET asset_id = ?,
                platform = ?,
                source_creative_id = ?,
                creative_name = ?,
                body_text = ?,
                headline = ?,
                link_description = ?,
                cta_text = ?,
                destination_url = ?,
                aspect_ratio = ?,
                ad_format = ?,
                language = ?,
                variant_signature = ?,
                first_seen_at = ?,
                last_seen_at = ?,
                metadata_json = ?,
                raw_json = ?
            WHERE tenant_key = ? AND store_key = ? AND variant_id = ?
            """,
            (
                variant.asset_id,
                variant.platform,
                _merge_text(str(existing["source_creative_id"]), variant.source_creative_id),
                _merge_text(str(existing["creative_name"]), variant.creative_name),
                _merge_text(str(existing["body_text"]), variant.body_text),
                _merge_text(str(existing["headline"]), variant.headline),
                _merge_text(str(existing["link_description"]), variant.link_description),
                _merge_text(str(existing["cta_text"]), variant.cta_text),
                _merge_text(str(existing["destination_url"]), variant.destination_url),
                _merge_text(str(existing["aspect_ratio"]), variant.aspect_ratio),
                _merge_text(str(existing["ad_format"]), variant.ad_format),
                _merge_text(str(existing["language"]), variant.language),
                variant.variant_signature,
                _min_text(str(existing["first_seen_at"]), variant.first_seen_at),
                _max_text(str(existing["last_seen_at"]), variant.last_seen_at),
                _merge_json_text(str(existing["metadata_json"]), metadata_json),
                _merge_json_text(str(existing["raw_json"]), raw_json),
                variant.tenant_key,
                variant.store_key,
                variant.variant_id,
            ),
        )
        return

    conn.execute(
        """
        INSERT INTO creative_variants (
            tenant_key,
            store_key,
            variant_id,
            asset_id,
            platform,
            source_creative_id,
            creative_name,
            body_text,
            headline,
            link_description,
            cta_text,
            destination_url,
            aspect_ratio,
            ad_format,
            language,
            variant_signature,
            first_seen_at,
            last_seen_at,
            metadata_json,
            raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            variant.tenant_key,
            variant.store_key,
            variant.variant_id,
            variant.asset_id,
            variant.platform,
            variant.source_creative_id,
            variant.creative_name,
            variant.body_text,
            variant.headline,
            variant.link_description,
            variant.cta_text,
            variant.destination_url,
            variant.aspect_ratio,
            variant.ad_format,
            variant.language,
            variant.variant_signature,
            variant.first_seen_at,
            variant.last_seen_at,
            metadata_json,
            raw_json,
        ),
    )


def _upsert_usage(conn: sqlite3.Connection, usage: CreativeLibraryUsage) -> None:
    metadata_json = _json_text(usage.metadata)
    raw_json = _json_text(usage.raw)
    existing = conn.execute(
        """
        SELECT *
        FROM creative_usages
        WHERE tenant_key = ? AND store_key = ? AND usage_id = ?
        """,
        (usage.tenant_key, usage.store_key, usage.usage_id),
    ).fetchone()
    if existing:
        conn.execute(
            """
            UPDATE creative_usages
            SET variant_id = ?,
                platform = ?,
                account_id = ?,
                account_name = ?,
                campaign_id = ?,
                campaign_name = ?,
                adset_id = ?,
                adset_name = ?,
                ad_id = ?,
                ad_name = ?,
                country = ?,
                region = ?,
                geo_bucket = ?,
                publisher_platform = ?,
                platform_position = ?,
                placement = ?,
                device_platform = ?,
                objective = ?,
                buying_type = ?,
                status = ?,
                effective_status = ?,
                started_at = ?,
                ended_at = ?,
                first_seen_at = ?,
                last_seen_at = ?,
                metadata_json = ?,
                raw_json = ?
            WHERE tenant_key = ? AND store_key = ? AND usage_id = ?
            """,
            (
                usage.variant_id,
                usage.platform,
                _merge_text(str(existing["account_id"]), usage.account_id),
                _merge_text(str(existing["account_name"]), usage.account_name),
                _merge_text(str(existing["campaign_id"]), usage.campaign_id),
                _merge_text(str(existing["campaign_name"]), usage.campaign_name),
                _merge_text(str(existing["adset_id"]), usage.adset_id),
                _merge_text(str(existing["adset_name"]), usage.adset_name),
                _merge_text(str(existing["ad_id"]), usage.ad_id),
                _merge_text(str(existing["ad_name"]), usage.ad_name),
                _merge_text(str(existing["country"]), usage.country),
                _merge_text(str(existing["region"]), usage.region),
                _merge_text(str(existing["geo_bucket"]), usage.geo_bucket),
                _merge_text(str(existing["publisher_platform"]), usage.publisher_platform),
                _merge_text(str(existing["platform_position"]), usage.platform_position),
                _merge_text(str(existing["placement"]), usage.placement),
                _merge_text(str(existing["device_platform"]), usage.device_platform),
                _merge_text(str(existing["objective"]), usage.objective),
                _merge_text(str(existing["buying_type"]), usage.buying_type),
                _merge_text(str(existing["status"]), usage.status),
                _merge_text(str(existing["effective_status"]), usage.effective_status),
                _min_text(str(existing["started_at"]), usage.started_at),
                _max_text(str(existing["ended_at"]), usage.ended_at),
                _min_text(str(existing["first_seen_at"]), usage.first_seen_at),
                _max_text(str(existing["last_seen_at"]), usage.last_seen_at),
                _merge_json_text(str(existing["metadata_json"]), metadata_json),
                _merge_json_text(str(existing["raw_json"]), raw_json),
                usage.tenant_key,
                usage.store_key,
                usage.usage_id,
            ),
        )
        return

    conn.execute(
        """
        INSERT INTO creative_usages (
            tenant_key,
            store_key,
            usage_id,
            variant_id,
            platform,
            account_id,
            account_name,
            campaign_id,
            campaign_name,
            adset_id,
            adset_name,
            ad_id,
            ad_name,
            country,
            region,
            geo_bucket,
            publisher_platform,
            platform_position,
            placement,
            device_platform,
            objective,
            buying_type,
            status,
            effective_status,
            started_at,
            ended_at,
            first_seen_at,
            last_seen_at,
            metadata_json,
            raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            usage.tenant_key,
            usage.store_key,
            usage.usage_id,
            usage.variant_id,
            usage.platform,
            usage.account_id,
            usage.account_name,
            usage.campaign_id,
            usage.campaign_name,
            usage.adset_id,
            usage.adset_name,
            usage.ad_id,
            usage.ad_name,
            usage.country,
            usage.region,
            usage.geo_bucket,
            usage.publisher_platform,
            usage.platform_position,
            usage.placement,
            usage.device_platform,
            usage.objective,
            usage.buying_type,
            usage.status,
            usage.effective_status,
            usage.started_at,
            usage.ended_at,
            usage.first_seen_at,
            usage.last_seen_at,
            metadata_json,
            raw_json,
        ),
    )


def _upsert_snapshot(conn: sqlite3.Connection, snapshot: CreativeLibrarySnapshot) -> None:
    conn.execute(
        """
        INSERT INTO creative_snapshots (
            tenant_key,
            store_key,
            snapshot_id,
            usage_id,
            variant_id,
            asset_id,
            sync_run_id,
            observed_at,
            date_start,
            date_stop,
            spend,
            impressions,
            clicks,
            link_clicks,
            ctr,
            cpc,
            cpm,
            frequency,
            conversions,
            purchases,
            revenue,
            roas,
            hook_hold_rate,
            thumb_stop_rate,
            video_3s_views,
            metadata_json,
            raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_key, store_key, snapshot_id)
        DO UPDATE SET
            usage_id = excluded.usage_id,
            variant_id = excluded.variant_id,
            asset_id = excluded.asset_id,
            sync_run_id = excluded.sync_run_id,
            observed_at = excluded.observed_at,
            date_start = excluded.date_start,
            date_stop = excluded.date_stop,
            spend = excluded.spend,
            impressions = excluded.impressions,
            clicks = excluded.clicks,
            link_clicks = excluded.link_clicks,
            ctr = excluded.ctr,
            cpc = excluded.cpc,
            cpm = excluded.cpm,
            frequency = excluded.frequency,
            conversions = excluded.conversions,
            purchases = excluded.purchases,
            revenue = excluded.revenue,
            roas = excluded.roas,
            hook_hold_rate = excluded.hook_hold_rate,
            thumb_stop_rate = excluded.thumb_stop_rate,
            video_3s_views = excluded.video_3s_views,
            metadata_json = excluded.metadata_json,
            raw_json = excluded.raw_json
        """,
        (
            snapshot.tenant_key,
            snapshot.store_key,
            snapshot.snapshot_id,
            snapshot.usage_id,
            snapshot.variant_id,
            snapshot.asset_id,
            snapshot.sync_run_id,
            snapshot.observed_at,
            snapshot.date_start,
            snapshot.date_stop,
            snapshot.spend,
            snapshot.impressions,
            snapshot.clicks,
            snapshot.link_clicks,
            snapshot.ctr,
            snapshot.cpc,
            snapshot.cpm,
            snapshot.frequency,
            snapshot.conversions,
            snapshot.purchases,
            snapshot.revenue,
            snapshot.roas,
            snapshot.hook_hold_rate,
            snapshot.thumb_stop_rate,
            snapshot.video_3s_views,
            _json_text(snapshot.metadata),
            _json_text(snapshot.raw),
        ),
    )


def persist_creative_library_batch(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    platform: str,
    source_system: str,
    sync_label: str,
    assets: Iterable[CreativeLibraryAsset],
    variants: Iterable[CreativeLibraryVariant],
    usages: Iterable[CreativeLibraryUsage],
    snapshots: Iterable[CreativeLibrarySnapshot],
    historical_rows: int,
    payload: dict[str, Any],
) -> CreativeLibraryIngestResult:
    asset_list = list(assets)
    variant_list = list(variants)
    usage_list = list(usages)
    snapshot_list = list(snapshots)

    conn = _connect(db_path)
    try:
        _ensure_schema(conn)
        sync_run_id = _insert_sync_run(
            conn,
            tenant_key=tenant_key,
            store_key=store_key,
            platform=platform,
            source_system=source_system,
            sync_label=sync_label,
            row_count=len(snapshot_list),
            historical_rows=historical_rows,
            payload=payload,
        )
        for asset in asset_list:
            _upsert_asset(conn, asset)
        for variant in variant_list:
            _upsert_variant(conn, variant)
        for usage in usage_list:
            _upsert_usage(conn, usage)
        for snapshot in snapshot_list:
            _upsert_snapshot(conn, snapshot.model_copy(update={"sync_run_id": sync_run_id}))
        conn.commit()
    finally:
        conn.close()

    return CreativeLibraryIngestResult(
        sync_run_id=sync_run_id,
        processed_rows=len(snapshot_list),
        asset_count=len({item.asset_id for item in asset_list}),
        variant_count=len({item.variant_id for item in variant_list}),
        usage_count=len({item.usage_id for item in usage_list}),
        snapshot_count=len({item.snapshot_id for item in snapshot_list}),
        historical_rows=historical_rows,
    )


def _fetch_by_ids(
    conn: sqlite3.Connection,
    *,
    table: str,
    id_column: str,
    tenant_key: str,
    store_key: str,
    ids: list[str],
) -> list[sqlite3.Row]:
    if not ids:
        return []
    placeholders = ", ".join("?" for _ in ids)
    return conn.execute(
        f"""
        SELECT *
        FROM {table}
        WHERE tenant_key = ? AND store_key = ? AND {id_column} IN ({placeholders})
        """,
        (tenant_key, store_key, *ids),
    ).fetchall()


def _latest_snapshots_for_variants(
    conn: sqlite3.Connection,
    *,
    tenant_key: str,
    store_key: str,
    variant_ids: list[str],
) -> dict[str, CreativeLibrarySnapshot]:
    if not variant_ids:
        return {}
    placeholders = ", ".join("?" for _ in variant_ids)
    rows = conn.execute(
        f"""
        SELECT s.*
        FROM creative_snapshots s
        WHERE s.tenant_key = ? AND s.store_key = ? AND s.variant_id IN ({placeholders})
          AND s.snapshot_id = (
              SELECT s2.snapshot_id
              FROM creative_snapshots s2
              WHERE s2.tenant_key = s.tenant_key
                AND s2.store_key = s.store_key
                AND s2.variant_id = s.variant_id
              ORDER BY s2.observed_at DESC, s2.date_stop DESC, s2.snapshot_id DESC
              LIMIT 1
          )
        """,
        (tenant_key, store_key, *variant_ids),
    ).fetchall()
    return {str(row["variant_id"]): _row_to_snapshot(row) for row in rows}


def _snapshot_counts_for_variants(
    conn: sqlite3.Connection,
    *,
    tenant_key: str,
    store_key: str,
    variant_ids: list[str],
) -> dict[str, int]:
    if not variant_ids:
        return {}
    placeholders = ", ".join("?" for _ in variant_ids)
    rows = conn.execute(
        f"""
        SELECT variant_id, COUNT(*) AS snapshot_count
        FROM creative_snapshots
        WHERE tenant_key = ? AND store_key = ? AND variant_id IN ({placeholders})
        GROUP BY variant_id
        """,
        (tenant_key, store_key, *variant_ids),
    ).fetchall()
    return {str(row["variant_id"]): int(row["snapshot_count"]) for row in rows}


def _history_for_variants(
    conn: sqlite3.Connection,
    *,
    tenant_key: str,
    store_key: str,
    variant_ids: list[str],
    history_limit: int,
) -> dict[str, list[CreativeLibrarySnapshot]]:
    if not variant_ids or history_limit <= 0:
        return {}
    placeholders = ", ".join("?" for _ in variant_ids)
    rows = conn.execute(
        f"""
        SELECT *
        FROM creative_snapshots
        WHERE tenant_key = ? AND store_key = ? AND variant_id IN ({placeholders})
        ORDER BY variant_id ASC, observed_at DESC, date_stop DESC, snapshot_id DESC
        """,
        (tenant_key, store_key, *variant_ids),
    ).fetchall()
    grouped: dict[str, list[CreativeLibrarySnapshot]] = {}
    for row in rows:
        variant_id = str(row["variant_id"])
        bucket = grouped.setdefault(variant_id, [])
        if len(bucket) >= history_limit:
            continue
        bucket.append(_row_to_snapshot(row))
    return grouped


def list_creative_library_variants(
    db_path: str,
    *,
    tenant_key: str,
    store_key: str,
    limit: int = 100,
    offset: int = 0,
    include_history: bool = False,
    history_limit: int = 30,
) -> list[CreativeLibraryVariantRecord]:
    conn = _connect(db_path)
    try:
        _ensure_schema(conn)
        variant_rows = conn.execute(
            """
            SELECT *
            FROM creative_variants
            WHERE tenant_key = ? AND store_key = ?
            ORDER BY last_seen_at DESC, variant_id DESC
            LIMIT ? OFFSET ?
            """,
            (tenant_key, store_key, limit, offset),
        ).fetchall()
        variants = [_row_to_variant(row) for row in variant_rows]
        variant_ids = [item.variant_id for item in variants]
        asset_ids = [item.asset_id for item in variants]
        asset_rows = _fetch_by_ids(
            conn,
            table="creative_assets",
            id_column="asset_id",
            tenant_key=tenant_key,
            store_key=store_key,
            ids=asset_ids,
        )
        usage_rows = _fetch_by_ids(
            conn,
            table="creative_usages",
            id_column="variant_id",
            tenant_key=tenant_key,
            store_key=store_key,
            ids=variant_ids,
        )
        asset_map = {asset.asset_id: asset for asset in (_row_to_asset(row) for row in asset_rows)}
        usage_map: dict[str, list[CreativeLibraryUsage]] = {}
        for usage_row in usage_rows:
            usage = _row_to_usage(usage_row)
            usage_map.setdefault(usage.variant_id, []).append(usage)
        latest_snapshot_map = _latest_snapshots_for_variants(
            conn,
            tenant_key=tenant_key,
            store_key=store_key,
            variant_ids=variant_ids,
        )
        snapshot_counts = _snapshot_counts_for_variants(
            conn,
            tenant_key=tenant_key,
            store_key=store_key,
            variant_ids=variant_ids,
        )
        history_map = _history_for_variants(
            conn,
            tenant_key=tenant_key,
            store_key=store_key,
            variant_ids=variant_ids,
            history_limit=history_limit if include_history else 0,
        )
    finally:
        conn.close()

    records: list[CreativeLibraryVariantRecord] = []
    for variant in variants:
        asset = asset_map.get(variant.asset_id)
        if asset is None:
            continue
        usages = sorted(
            usage_map.get(variant.variant_id, []),
            key=lambda item: (item.last_seen_at, item.usage_id),
            reverse=True,
        )
        records.append(
            CreativeLibraryVariantRecord(
                asset=asset,
                variant=variant,
                latest_snapshot=latest_snapshot_map.get(variant.variant_id),
                usages=usages,
                history=history_map.get(variant.variant_id, []),
                usage_count=len(usages),
                snapshot_count=snapshot_counts.get(variant.variant_id, 0),
            )
        )
    return records


def get_creative_library_variant(
    db_path: str,
    *,
    tenant_key: str,
    store_key: str,
    variant_id: str,
    history_limit: int = 180,
) -> CreativeLibraryVariantRecord | None:
    records = list_creative_library_variants(
        db_path,
        tenant_key=tenant_key,
        store_key=store_key,
        limit=1,
        offset=0,
        include_history=True,
        history_limit=history_limit,
    )
    for record in records:
        if record.variant.variant_id == variant_id:
            return record

    conn = _connect(db_path)
    try:
        _ensure_schema(conn)
        row = conn.execute(
            """
            SELECT *
            FROM creative_variants
            WHERE tenant_key = ? AND store_key = ? AND variant_id = ?
            """,
            (tenant_key, store_key, variant_id),
        ).fetchone()
        if row is None:
            return None
        variant = _row_to_variant(row)
        asset_row = conn.execute(
            """
            SELECT *
            FROM creative_assets
            WHERE tenant_key = ? AND store_key = ? AND asset_id = ?
            """,
            (tenant_key, store_key, variant.asset_id),
        ).fetchone()
        if asset_row is None:
            return None
        asset = _row_to_asset(asset_row)
        usage_rows = conn.execute(
            """
            SELECT *
            FROM creative_usages
            WHERE tenant_key = ? AND store_key = ? AND variant_id = ?
            ORDER BY last_seen_at DESC, usage_id DESC
            """,
            (tenant_key, store_key, variant_id),
        ).fetchall()
        usages = [_row_to_usage(item) for item in usage_rows]
        history_map = _history_for_variants(
            conn,
            tenant_key=tenant_key,
            store_key=store_key,
            variant_ids=[variant_id],
            history_limit=history_limit,
        )
        latest_snapshot_map = _latest_snapshots_for_variants(
            conn,
            tenant_key=tenant_key,
            store_key=store_key,
            variant_ids=[variant_id],
        )
        snapshot_counts = _snapshot_counts_for_variants(
            conn,
            tenant_key=tenant_key,
            store_key=store_key,
            variant_ids=[variant_id],
        )
    finally:
        conn.close()

    return CreativeLibraryVariantRecord(
        asset=asset,
        variant=variant,
        latest_snapshot=latest_snapshot_map.get(variant_id),
        usages=usages,
        history=history_map.get(variant_id, []),
        usage_count=len(usages),
        snapshot_count=snapshot_counts.get(variant_id, 0),
    )
