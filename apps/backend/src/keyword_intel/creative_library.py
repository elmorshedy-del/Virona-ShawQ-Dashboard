from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qsl, urlparse, urlunparse

from .creative_library_storage import (
    get_creative_library_variant,
    list_creative_library_variants,
    persist_creative_library_batch,
)
from .models import (
    CreativeLibraryAsset,
    CreativeLibraryIngestResult,
    CreativeLibrarySnapshot,
    CreativeLibraryUsage,
    CreativeLibraryVariant,
    CreativeLibraryVariantRecord,
)


DEFAULT_CREATIVE_PLATFORM = "meta"
TRACKING_QUERY_KEYS = {
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


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _today_iso() -> str:
    return datetime.now(UTC).date().isoformat()


def _clean_text(value: object) -> str:
    return " ".join(str(value or "").strip().split())


def _mapping(value: object) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _pick(payload: dict[str, Any], *paths: str) -> Any:
    for path in paths:
        current: Any = payload
        for part in path.split("."):
            if not isinstance(current, dict) or part not in current:
                current = None
                break
            current = current.get(part)
        if current is None:
            continue
        if isinstance(current, str):
            text = _clean_text(current)
            if text:
                return text
            continue
        return current
    return None


def _pick_text(payload: dict[str, Any], *paths: str) -> str:
    value = _pick(payload, *paths)
    return _clean_text(value)


def _pick_float(payload: dict[str, Any], *paths: str) -> float | None:
    value = _pick(payload, *paths)
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).replace(",", "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _pick_int(payload: dict[str, Any], *paths: str) -> int | None:
    value = _pick_float(payload, *paths)
    if value is None:
        return None
    return int(round(value))


def _normalize_datetime_text(value: object) -> str:
    text = _clean_text(value)
    if not text:
        return _utc_now_iso()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).replace(microsecond=0).isoformat()


def _normalize_date_text(value: object) -> str:
    text = _clean_text(value)
    if not text:
        return datetime.now(UTC).date().isoformat()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.date().isoformat()
    except ValueError:
        return text[:10]


def _stable_url(value: object) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    parsed = urlparse(text)
    if not parsed.scheme and not parsed.netloc:
        return text
    query_pairs = [
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=False)
        if key.lower() not in TRACKING_QUERY_KEYS
    ]
    cleaned = parsed._replace(
        scheme=(parsed.scheme or "https").lower(),
        netloc=(parsed.netloc or "").lower(),
        query="&".join(f"{key}={item}" for key, item in query_pairs),
        fragment="",
    )
    return urlunparse(cleaned)


def _first_non_empty(*values: str) -> str:
    for value in values:
        text = _clean_text(value)
        if text:
            return text
    return ""


def _merge_seen_min(current: str, incoming: str) -> str:
    if not current:
        return incoming
    if not incoming:
        return current
    return current if current <= incoming else incoming


def _merge_seen_max(current: str, incoming: str) -> str:
    if not current:
        return incoming
    if not incoming:
        return current
    return current if current >= incoming else incoming


def _hash_id(prefix: str, *parts: str) -> str:
    material = "|".join(_clean_text(part).lower() for part in parts if _clean_text(part))
    if not material:
        material = f"{prefix}|unknown"
    return f"{prefix}_{hashlib.sha256(material.encode('utf-8')).hexdigest()[:20]}"


def _identity_group(*groups: list[str]) -> list[str]:
    for group in groups:
        cleaned = [_clean_text(item) for item in group if _clean_text(item)]
        if cleaned:
            return cleaned
    return ["unknown"]


def _infer_asset_type(row: dict[str, Any]) -> str:
    explicit = _pick_text(row, "asset_type", "creative.asset_type", "creative.media_type", "ad_format")
    lowered = explicit.lower()
    if lowered in {"image", "video", "carousel", "collection"}:
        return lowered
    if _pick_text(row, "video_url", "creative.video_url"):
        return "video"
    if _pick_text(row, "image_url", "creative.image_url", "asset_url", "creative.asset_url"):
        return "image"
    if _pick(row, "creative.cards"):
        return "carousel"
    return "unknown"


def _merge_asset(current: CreativeLibraryAsset, incoming: CreativeLibraryAsset) -> CreativeLibraryAsset:
    return current.model_copy(
        update={
            "source_creative_id": incoming.source_creative_id or current.source_creative_id,
            "source_asset_id": incoming.source_asset_id or current.source_asset_id,
            "asset_type": incoming.asset_type if incoming.asset_type != "unknown" else current.asset_type,
            "asset_name": incoming.asset_name or current.asset_name,
            "asset_url": incoming.asset_url or current.asset_url,
            "thumbnail_url": incoming.thumbnail_url or current.thumbnail_url,
            "preview_url": incoming.preview_url or current.preview_url,
            "asset_fingerprint": incoming.asset_fingerprint or current.asset_fingerprint,
            "image_hash": incoming.image_hash or current.image_hash,
            "perceptual_hash": incoming.perceptual_hash or current.perceptual_hash,
            "first_seen_at": _merge_seen_min(current.first_seen_at, incoming.first_seen_at),
            "last_seen_at": _merge_seen_max(current.last_seen_at, incoming.last_seen_at),
            "metadata": incoming.metadata or current.metadata,
            "raw": incoming.raw or current.raw,
        }
    )


def _merge_variant(current: CreativeLibraryVariant, incoming: CreativeLibraryVariant) -> CreativeLibraryVariant:
    return current.model_copy(
        update={
            "source_creative_id": incoming.source_creative_id or current.source_creative_id,
            "creative_name": incoming.creative_name or current.creative_name,
            "body_text": incoming.body_text or current.body_text,
            "headline": incoming.headline or current.headline,
            "link_description": incoming.link_description or current.link_description,
            "cta_text": incoming.cta_text or current.cta_text,
            "destination_url": incoming.destination_url or current.destination_url,
            "aspect_ratio": incoming.aspect_ratio or current.aspect_ratio,
            "ad_format": incoming.ad_format or current.ad_format,
            "language": incoming.language or current.language,
            "first_seen_at": _merge_seen_min(current.first_seen_at, incoming.first_seen_at),
            "last_seen_at": _merge_seen_max(current.last_seen_at, incoming.last_seen_at),
            "metadata": incoming.metadata or current.metadata,
            "raw": incoming.raw or current.raw,
        }
    )


def _merge_usage(current: CreativeLibraryUsage, incoming: CreativeLibraryUsage) -> CreativeLibraryUsage:
    return current.model_copy(
        update={
            "account_id": incoming.account_id or current.account_id,
            "account_name": incoming.account_name or current.account_name,
            "campaign_id": incoming.campaign_id or current.campaign_id,
            "campaign_name": incoming.campaign_name or current.campaign_name,
            "adset_id": incoming.adset_id or current.adset_id,
            "adset_name": incoming.adset_name or current.adset_name,
            "ad_id": incoming.ad_id or current.ad_id,
            "ad_name": incoming.ad_name or current.ad_name,
            "country": incoming.country or current.country,
            "region": incoming.region or current.region,
            "geo_bucket": incoming.geo_bucket or current.geo_bucket,
            "publisher_platform": incoming.publisher_platform or current.publisher_platform,
            "platform_position": incoming.platform_position or current.platform_position,
            "placement": incoming.placement or current.placement,
            "device_platform": incoming.device_platform or current.device_platform,
            "objective": incoming.objective or current.objective,
            "buying_type": incoming.buying_type or current.buying_type,
            "status": incoming.status or current.status,
            "effective_status": incoming.effective_status or current.effective_status,
            "started_at": _merge_seen_min(current.started_at, incoming.started_at),
            "ended_at": _merge_seen_max(current.ended_at, incoming.ended_at),
            "first_seen_at": _merge_seen_min(current.first_seen_at, incoming.first_seen_at),
            "last_seen_at": _merge_seen_max(current.last_seen_at, incoming.last_seen_at),
            "metadata": incoming.metadata or current.metadata,
            "raw": incoming.raw or current.raw,
        }
    )


def _normalize_ingest_row(raw_row: dict[str, Any], *, default_platform: str) -> dict[str, Any]:
    row = dict(raw_row)
    metadata = _mapping(_pick(row, "metadata"))
    raw = _mapping(_pick(row, "raw")) or row
    platform = _pick_text(row, "platform") or default_platform
    observed_at = _normalize_datetime_text(
        _pick(
            row,
            "observed_at",
            "pulled_at",
            "synced_at",
            "snapshot_observed_at",
            "metrics.observed_at",
            "date_stop",
            "date_start",
        )
        or _utc_now_iso()
    )
    date_start = _normalize_date_text(
        _pick(row, "date_start", "start_date", "snapshot_date", "day", "metrics.date_start") or observed_at
    )
    date_stop = _normalize_date_text(
        _pick(row, "date_stop", "end_date", "snapshot_date", "day", "metrics.date_stop") or date_start
    )
    asset_url = _stable_url(
        _pick(row, "asset_url", "creative.asset_url", "image_url", "creative.image_url", "video_url", "creative.video_url")
    )
    thumbnail_url = _stable_url(_pick(row, "thumbnail_url", "creative.thumbnail_url", "image_url", "creative.image_url"))
    preview_url = _stable_url(_pick(row, "preview_url", "creative.preview_url", "creative_url"))
    destination_url = _stable_url(
        _pick(row, "destination_url", "landing_page_url", "url", "creative.destination_url", "creative.link_url")
    )
    creative_name = _pick_text(row, "creative_name", "creative.name", "asset_name")
    ad_name = _pick_text(row, "ad_name", "ad.name")
    placement = _pick_text(row, "placement", "metrics.placement")
    publisher_platform = _pick_text(row, "publisher_platform", "publisher", "metrics.publisher_platform")
    platform_position = _pick_text(row, "platform_position", "placement_position", "metrics.platform_position")
    if not placement:
        placement = _first_non_empty(
            " ".join(part for part in [publisher_platform, platform_position] if part),
            _pick_text(row, "creative.placement"),
        )

    normalized = {
        "platform": platform,
        "observed_at": observed_at,
        "date_start": date_start,
        "date_stop": date_stop,
        "creative_id": _pick_text(row, "creative_id", "adcreative_id", "creative.id"),
        "creative_name": creative_name,
        "source_asset_id": _pick_text(row, "source_asset_id", "asset_id", "creative.asset_id"),
        "asset_name": _first_non_empty(_pick_text(row, "asset_name"), creative_name, ad_name),
        "asset_type": _infer_asset_type(row),
        "asset_url": asset_url,
        "thumbnail_url": thumbnail_url,
        "preview_url": preview_url,
        "asset_fingerprint": _pick_text(row, "asset_fingerprint", "creative.asset_fingerprint"),
        "image_hash": _pick_text(row, "image_hash", "creative.image_hash"),
        "perceptual_hash": _pick_text(row, "perceptual_hash", "creative.perceptual_hash"),
        "body_text": _pick_text(
            row,
            "body_text",
            "primary_text",
            "text",
            "message",
            "creative.body_text",
            "creative.primary_text",
            "creative.message",
        ),
        "headline": _pick_text(row, "headline", "title", "creative.headline", "creative.title"),
        "link_description": _pick_text(
            row,
            "link_description",
            "description",
            "creative.link_description",
            "creative.description",
        ),
        "cta_text": _pick_text(row, "cta_text", "cta", "call_to_action", "creative.cta_text", "creative.call_to_action"),
        "destination_url": destination_url,
        "aspect_ratio": _pick_text(row, "aspect_ratio", "creative.aspect_ratio"),
        "ad_format": _pick_text(row, "ad_format", "format", "creative.format", "creative.ad_format"),
        "language": _pick_text(row, "language", "locale", "creative.language"),
        "account_id": _pick_text(row, "account_id", "account.id"),
        "account_name": _pick_text(row, "account_name", "account.name"),
        "campaign_id": _pick_text(row, "campaign_id", "campaign.id"),
        "campaign_name": _pick_text(row, "campaign_name", "campaign.name"),
        "adset_id": _pick_text(row, "adset_id", "adset.id"),
        "adset_name": _pick_text(row, "adset_name", "adset.name"),
        "ad_id": _pick_text(row, "ad_id", "ad.id"),
        "ad_name": ad_name,
        "country": _pick_text(row, "country", "geo", "metrics.country"),
        "region": _pick_text(row, "region", "metrics.region"),
        "geo_bucket": _pick_text(row, "geo_bucket", "market", "metrics.geo_bucket"),
        "publisher_platform": publisher_platform,
        "platform_position": platform_position,
        "placement": placement,
        "device_platform": _pick_text(row, "device_platform", "metrics.device_platform"),
        "objective": _pick_text(row, "objective", "campaign.objective"),
        "buying_type": _pick_text(row, "buying_type", "campaign.buying_type"),
        "status": _pick_text(row, "status", "ad.status", "campaign.status"),
        "effective_status": _pick_text(row, "effective_status", "ad.effective_status", "campaign.effective_status"),
        "spend": _pick_float(row, "spend", "metrics.spend"),
        "impressions": _pick_int(row, "impressions", "metrics.impressions"),
        "clicks": _pick_int(row, "clicks", "metrics.clicks"),
        "link_clicks": _pick_int(row, "link_clicks", "outbound_clicks", "metrics.link_clicks"),
        "ctr": _pick_float(row, "ctr", "metrics.ctr"),
        "cpc": _pick_float(row, "cpc", "metrics.cpc"),
        "cpm": _pick_float(row, "cpm", "metrics.cpm"),
        "frequency": _pick_float(row, "frequency", "metrics.frequency"),
        "conversions": _pick_float(row, "conversions", "results", "metrics.conversions"),
        "purchases": _pick_float(row, "purchases", "metrics.purchases"),
        "revenue": _pick_float(row, "revenue", "purchase_value", "metrics.revenue"),
        "roas": _pick_float(row, "roas", "purchase_roas", "metrics.roas"),
        "hook_hold_rate": _pick_float(row, "hook_hold_rate", "metrics.hook_hold_rate"),
        "thumb_stop_rate": _pick_float(row, "thumb_stop_rate", "metrics.thumb_stop_rate"),
        "video_3s_views": _pick_int(row, "video_3s_views", "metrics.video_3s_views"),
        "metadata": metadata,
        "raw": raw,
    }
    return normalized


def ingest_creative_library_rows(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    platform: str = DEFAULT_CREATIVE_PLATFORM,
    source_system: str = "meta_api",
    sync_label: str = "",
    rows: list[dict[str, Any]],
) -> CreativeLibraryIngestResult:
    if not rows:
        raise ValueError("rows must contain at least one creative metadata row")

    normalized_rows = [_normalize_ingest_row(row, default_platform=platform) for row in rows]
    asset_map: dict[str, CreativeLibraryAsset] = {}
    variant_map: dict[str, CreativeLibraryVariant] = {}
    usage_map: dict[str, CreativeLibraryUsage] = {}
    snapshots: list[CreativeLibrarySnapshot] = []
    historical_rows = 0
    today_iso = _today_iso()

    for row in normalized_rows:
        asset_tokens = _identity_group(
            [
                row["source_asset_id"],
                row["asset_fingerprint"],
                row["image_hash"],
                row["perceptual_hash"],
            ],
            [row["asset_url"], row["thumbnail_url"], row["preview_url"]],
            [row["creative_id"]],
            [row["asset_name"], row["creative_name"], row["ad_name"]],
        )
        family_tokens = _identity_group(
            [
                row["source_asset_id"],
                row["asset_fingerprint"],
                row["perceptual_hash"],
                row["image_hash"],
            ],
            [row["asset_url"], row["thumbnail_url"], row["preview_url"]],
            [row["creative_id"]],
        )
        asset_signature = _hash_id("asset_sig", row["platform"], row["asset_type"], *asset_tokens)
        asset_id = _hash_id("asset", row["platform"], row["asset_type"], *asset_tokens)
        creative_family_id = _hash_id("family", row["platform"], *family_tokens)

        variant_id = _hash_id(
            "variant",
            asset_id,
            row["body_text"],
            row["headline"],
            row["link_description"],
            row["cta_text"],
            row["destination_url"],
            row["aspect_ratio"],
            row["ad_format"],
            row["language"],
        )
        variant_signature = _hash_id(
            "variant_sig",
            asset_signature,
            row["body_text"],
            row["headline"],
            row["link_description"],
            row["cta_text"],
            row["destination_url"],
            row["aspect_ratio"],
            row["ad_format"],
            row["language"],
        )
        usage_id = _hash_id(
            "usage",
            variant_id,
            row["account_id"],
            row["campaign_id"],
            row["adset_id"],
            row["ad_id"],
            row["country"],
            row["region"],
            row["geo_bucket"],
            row["publisher_platform"],
            row["platform_position"],
            row["placement"],
            row["device_platform"],
        )
        snapshot_id = _hash_id("snapshot", usage_id, row["date_start"], row["date_stop"])

        asset = CreativeLibraryAsset(
            tenant_key=tenant_key,
            store_key=store_key,
            asset_id=asset_id,
            creative_family_id=creative_family_id,
            platform=row["platform"],
            source_creative_id=row["creative_id"],
            source_asset_id=row["source_asset_id"],
            asset_type=row["asset_type"],
            asset_name=row["asset_name"],
            asset_url=row["asset_url"],
            thumbnail_url=row["thumbnail_url"],
            preview_url=row["preview_url"],
            asset_signature=asset_signature,
            asset_fingerprint=row["asset_fingerprint"],
            image_hash=row["image_hash"],
            perceptual_hash=row["perceptual_hash"],
            first_seen_at=row["observed_at"],
            last_seen_at=row["observed_at"],
            metadata=row["metadata"],
            raw=row["raw"],
        )
        variant = CreativeLibraryVariant(
            tenant_key=tenant_key,
            store_key=store_key,
            variant_id=variant_id,
            asset_id=asset_id,
            platform=row["platform"],
            source_creative_id=row["creative_id"],
            creative_name=row["creative_name"],
            body_text=row["body_text"],
            headline=row["headline"],
            link_description=row["link_description"],
            cta_text=row["cta_text"],
            destination_url=row["destination_url"],
            aspect_ratio=row["aspect_ratio"],
            ad_format=row["ad_format"],
            language=row["language"],
            variant_signature=variant_signature,
            first_seen_at=row["observed_at"],
            last_seen_at=row["observed_at"],
            metadata=row["metadata"],
            raw=row["raw"],
        )
        usage = CreativeLibraryUsage(
            tenant_key=tenant_key,
            store_key=store_key,
            usage_id=usage_id,
            variant_id=variant_id,
            platform=row["platform"],
            account_id=row["account_id"],
            account_name=row["account_name"],
            campaign_id=row["campaign_id"],
            campaign_name=row["campaign_name"],
            adset_id=row["adset_id"],
            adset_name=row["adset_name"],
            ad_id=row["ad_id"],
            ad_name=row["ad_name"],
            country=row["country"],
            region=row["region"],
            geo_bucket=row["geo_bucket"],
            publisher_platform=row["publisher_platform"],
            platform_position=row["platform_position"],
            placement=row["placement"],
            device_platform=row["device_platform"],
            objective=row["objective"],
            buying_type=row["buying_type"],
            status=row["status"],
            effective_status=row["effective_status"],
            started_at=row["date_start"],
            ended_at=row["date_stop"],
            first_seen_at=row["observed_at"],
            last_seen_at=row["observed_at"],
            metadata=row["metadata"],
            raw=row["raw"],
        )
        asset_map[asset_id] = _merge_asset(asset_map[asset_id], asset) if asset_id in asset_map else asset
        variant_map[variant_id] = (
            _merge_variant(variant_map[variant_id], variant) if variant_id in variant_map else variant
        )
        usage_map[usage_id] = _merge_usage(usage_map[usage_id], usage) if usage_id in usage_map else usage
        snapshots.append(
            CreativeLibrarySnapshot(
                tenant_key=tenant_key,
                store_key=store_key,
                snapshot_id=snapshot_id,
                usage_id=usage_id,
                variant_id=variant_id,
                asset_id=asset_id,
                observed_at=row["observed_at"],
                date_start=row["date_start"],
                date_stop=row["date_stop"],
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
                metadata=row["metadata"],
                raw=row["raw"],
            )
        )
        if row["date_stop"] < today_iso:
            historical_rows += 1

    return persist_creative_library_batch(
        db_path=db_path,
        tenant_key=tenant_key,
        store_key=store_key,
        platform=platform,
        source_system=source_system,
        sync_label=sync_label,
        assets=asset_map.values(),
        variants=variant_map.values(),
        usages=usage_map.values(),
        snapshots=snapshots,
        historical_rows=historical_rows,
        payload={"rows": len(rows), "platform": platform, "source_system": source_system, "sync_label": sync_label},
    )


def list_creative_records(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    limit: int = 100,
    offset: int = 0,
    include_history: bool = False,
    history_limit: int = 30,
) -> list[CreativeLibraryVariantRecord]:
    return list_creative_library_variants(
        db_path,
        tenant_key=tenant_key,
        store_key=store_key,
        limit=limit,
        offset=offset,
        include_history=include_history,
        history_limit=history_limit,
    )


def get_creative_record(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    variant_id: str,
    history_limit: int = 180,
) -> CreativeLibraryVariantRecord | None:
    return get_creative_library_variant(
        db_path,
        tenant_key=tenant_key,
        store_key=store_key,
        variant_id=variant_id,
        history_limit=history_limit,
    )
