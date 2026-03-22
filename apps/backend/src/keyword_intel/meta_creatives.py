from __future__ import annotations

import json
import time
from typing import Any

import requests

from .creative_library import ingest_creative_library_rows
from .models import CreativeLibraryIngestResult, MetaCreativePullResult
from .settings import ProviderSettings


GRAPH_API_BASE = "https://graph.facebook.com"
DEFAULT_AD_FIELDS = (
    "id,name,status,effective_status,updated_time,"
    "campaign{id,name,objective,buying_type,effective_status},"
    "adset{id,name,effective_status},"
    "creative{id,name,thumbnail_url,image_hash,object_story_spec,asset_feed_spec}"
)
AD_FIELD_FALLBACKS = (
    DEFAULT_AD_FIELDS,
    (
        "id,name,status,effective_status,updated_time,"
        "campaign{id,name},"
        "adset{id,name},"
        "creative{id,name,thumbnail_url,image_hash,object_story_spec,asset_feed_spec}"
    ),
    (
        "id,name,status,effective_status,updated_time,"
        "campaign{id,name},"
        "adset{id,name},"
        "creative{id,name,thumbnail_url,image_hash,object_story_spec}"
    ),
)
DEFAULT_INSIGHT_FIELDS = (
    "account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,"
    "ad_id,ad_name,spend,impressions,clicks,cpc,cpm,ctr,frequency,"
    "account_currency,actions,action_values,purchase_roas,"
    "date_start,date_stop"
)
PURCHASE_ACTION_KEYS = {
    "purchase",
    "omni_purchase",
    "offsite_conversion.fb_pixel_purchase",
    "onsite_web_purchase",
}
LINK_CLICK_ACTION_KEYS = {
    "link_click",
    "outbound_click",
}
VIDEO_VIEW_ACTION_KEYS = {
    "video_view",
}


def _clean_text(value: object) -> str:
    return " ".join(str(value or "").strip().split())


def _mapping(value: object) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _list_of_dicts(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _first_non_empty(*values: object) -> str:
    for value in values:
        text = _clean_text(value)
        if text:
            return text
    return ""


def _normalize_account_id(value: str) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    if text.startswith("act_"):
        return text
    digits = "".join(ch for ch in text if ch.isdigit())
    return f"act_{digits}" if digits else text


def _meta_error(payload: object) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    error = payload.get("error")
    return dict(error) if isinstance(error, dict) else {}


def _is_retryable_meta_status(status_code: int) -> bool:
    return status_code in {429, 500, 502, 503, 504}


def _is_retryable_meta_error(payload: object) -> bool:
    error = _meta_error(payload)
    if not error:
        return False
    code = error.get("code")
    subcode = error.get("error_subcode")
    is_transient = bool(error.get("is_transient"))
    return is_transient or code in {1, 2, 4, 17, 32, 613} or subcode in {2446079}


def _request_json(url: str, *, params: dict[str, Any], timeout_sec: float) -> dict[str, Any]:
    last_error: Exception | None = None
    request_timeout = max(30.0, timeout_sec)
    for attempt in range(3):
        try:
            response = requests.get(url, params=params, timeout=request_timeout)
        except requests.RequestException as exc:
            last_error = exc
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
            continue
        payload: dict[str, Any] | None = None
        try:
            payload = response.json()
        except ValueError:
            payload = None

        if response.ok:
            if not isinstance(payload, dict):
                raise RuntimeError("meta api returned unexpected payload format")
            return payload

        retryable = _is_retryable_meta_status(response.status_code) or _is_retryable_meta_error(payload)
        message = response.text[:1000]
        last_error = RuntimeError(f"meta api error {response.status_code}: {message}")
        if not retryable or attempt == 2:
            raise last_error
        time.sleep(2 * (attempt + 1))

    raise last_error or RuntimeError("meta api request failed")


def _paged_get(
    *,
    account_path: str,
    edge: str,
    params: dict[str, Any],
    settings: ProviderSettings,
) -> list[dict[str, Any]]:
    base_url = f"{GRAPH_API_BASE}/{settings.meta_graph_api_version}/{account_path}/{edge}"
    next_url = base_url
    next_params = dict(params)
    next_params["access_token"] = settings.meta_access_token
    items: list[dict[str, Any]] = []

    while next_url:
        payload = _request_json(
            next_url,
            params=next_params,
            timeout_sec=settings.http_timeout_sec,
        )
        items.extend(_list_of_dicts(payload.get("data")))
        paging = _mapping(payload.get("paging"))
        next_url = _clean_text(paging.get("next"))
        next_params = {}

    return items


def _fetch_ads_with_fallback(
    *,
    ad_ids: list[str],
    settings: ProviderSettings,
) -> list[dict[str, Any]]:
    if not ad_ids:
        return []

    last_error: Exception | None = None
    items_by_id: dict[str, dict[str, Any]] = {}
    for chunk_start in range(0, len(ad_ids), 50):
        chunk_ids = ad_ids[chunk_start : chunk_start + 50]
        chunk_error: Exception | None = None
        for fields in AD_FIELD_FALLBACKS:
            try:
                payload = _request_json(
                    f"{GRAPH_API_BASE}/{settings.meta_graph_api_version}/",
                    params={
                        "ids": ",".join(chunk_ids),
                        "fields": fields,
                        "access_token": settings.meta_access_token,
                    },
                    timeout_sec=settings.http_timeout_sec,
                )
                for ad_id in chunk_ids:
                    item = payload.get(ad_id)
                    if isinstance(item, dict):
                        items_by_id[ad_id] = dict(item)
                chunk_error = None
                break
            except Exception as exc:
                chunk_error = exc
                last_error = exc
        if chunk_error is not None:
            raise chunk_error
    if not items_by_id and last_error is not None:
        raise last_error
    return [items_by_id[ad_id] for ad_id in ad_ids if ad_id in items_by_id]


def _action_total(rows: list[dict[str, Any]], keys: set[str]) -> float | None:
    total = 0.0
    matched = False
    for row in rows:
        if _clean_text(row.get("action_type")) not in keys:
            continue
        try:
            total += float(str(row.get("value", "")).replace(",", "").strip())
            matched = True
        except ValueError:
            continue
    return total if matched else None


def _purchase_roas(row: dict[str, Any]) -> float | None:
    values = _list_of_dicts(row.get("purchase_roas"))
    for item in values:
        try:
            return float(str(item.get("value", "")).replace(",", "").strip())
        except ValueError:
            continue
    return None


def _video_3s_views(row: dict[str, Any]) -> int | None:
    values = _list_of_dicts(row.get("video_3_sec_watched_actions"))
    for item in values:
        try:
            return int(round(float(str(item.get("value", "")).replace(",", "").strip())))
        except ValueError:
            continue
    fallback = _action_total(_list_of_dicts(row.get("actions")), VIDEO_VIEW_ACTION_KEYS)
    if fallback is None:
        return None
    return int(round(fallback))


def _story_parts(creative: dict[str, Any]) -> dict[str, Any]:
    story = _mapping(creative.get("object_story_spec"))
    link_data = _mapping(story.get("link_data"))
    video_data = _mapping(story.get("video_data"))
    photo_data = _mapping(story.get("photo_data"))
    template_data = _mapping(story.get("template_data"))
    return {
        "story": story,
        "link_data": link_data,
        "video_data": video_data,
        "photo_data": photo_data,
        "template_data": template_data,
    }


def _cta_text(parts: dict[str, Any]) -> str:
    for key in ("link_data", "video_data", "photo_data", "template_data"):
        data = _mapping(parts.get(key))
        call_to_action = _mapping(data.get("call_to_action"))
        cta_value = _first_non_empty(call_to_action.get("type"), call_to_action.get("name"))
        if cta_value:
            return cta_value
    return ""


def _destination_url(parts: dict[str, Any]) -> str:
    for key in ("link_data", "video_data", "photo_data", "template_data"):
        data = _mapping(parts.get(key))
        call_to_action = _mapping(data.get("call_to_action"))
        value = _mapping(call_to_action.get("value"))
        destination = _first_non_empty(value.get("link"), value.get("link_caption"), data.get("link"))
        if destination:
            return destination
    return _first_non_empty(parts["story"].get("link"))


def _body_text(parts: dict[str, Any]) -> str:
    return _first_non_empty(
        parts["link_data"].get("message"),
        parts["video_data"].get("message"),
        parts["photo_data"].get("message"),
        parts["template_data"].get("message"),
    )


def _headline(parts: dict[str, Any]) -> str:
    return _first_non_empty(
        parts["link_data"].get("name"),
        parts["video_data"].get("title"),
        parts["photo_data"].get("name"),
        parts["template_data"].get("name"),
    )


def _description(parts: dict[str, Any]) -> str:
    return _first_non_empty(
        parts["link_data"].get("description"),
        parts["video_data"].get("link_description"),
        parts["photo_data"].get("caption"),
        parts["template_data"].get("description"),
    )


def _creative_asset_info(creative: dict[str, Any]) -> tuple[str, str, str, str]:
    parts = _story_parts(creative)
    thumbnail_url = _first_non_empty(
        creative.get("thumbnail_url"),
        parts["video_data"].get("image_url"),
        parts["link_data"].get("picture"),
        parts["photo_data"].get("url"),
    )
    image_hash = _first_non_empty(
        parts["link_data"].get("image_hash"),
        creative.get("image_hash"),
    )
    video_id = _first_non_empty(parts["video_data"].get("video_id"))
    child_attachments = _list_of_dicts(parts["link_data"].get("child_attachments"))
    first_card = child_attachments[0] if child_attachments else {}

    if video_id:
        return ("video", video_id, thumbnail_url, thumbnail_url)
    if first_card:
        return (
            "carousel",
            _first_non_empty(first_card.get("image_hash"), image_hash, creative.get("id")),
            _first_non_empty(first_card.get("picture"), thumbnail_url),
            thumbnail_url,
        )
    if image_hash or thumbnail_url:
        return ("image", _first_non_empty(image_hash, creative.get("id")), thumbnail_url, thumbnail_url)
    return ("unknown", _first_non_empty(creative.get("id")), thumbnail_url, thumbnail_url)


def _normalize_meta_row(
    *,
    account_id: str,
    ad: dict[str, Any],
    insight: dict[str, Any],
    breakdowns: list[str],
) -> dict[str, Any]:
    creative = _mapping(ad.get("creative"))
    campaign = _mapping(ad.get("campaign"))
    adset = _mapping(ad.get("adset"))
    parts = _story_parts(creative)
    asset_type, source_asset_id, asset_url, thumbnail_url = _creative_asset_info(creative)
    actions = _list_of_dicts(insight.get("actions"))
    action_values = _list_of_dicts(insight.get("action_values"))

    return {
        "platform": "meta",
        "creative_id": _first_non_empty(creative.get("id")),
        "creative_name": _first_non_empty(creative.get("name"), ad.get("name")),
        "source_asset_id": source_asset_id,
        "asset_type": asset_type,
        "asset_url": asset_url,
        "thumbnail_url": thumbnail_url,
        "preview_url": thumbnail_url,
        "body_text": _body_text(parts),
        "headline": _headline(parts),
        "link_description": _description(parts),
        "cta_text": _cta_text(parts),
        "destination_url": _destination_url(parts),
        "ad_format": asset_type,
        "account_id": _first_non_empty(insight.get("account_id"), account_id),
        "account_name": _first_non_empty(insight.get("account_name")),
        "campaign_id": _first_non_empty(insight.get("campaign_id"), campaign.get("id")),
        "campaign_name": _first_non_empty(insight.get("campaign_name"), campaign.get("name")),
        "adset_id": _first_non_empty(insight.get("adset_id"), adset.get("id")),
        "adset_name": _first_non_empty(insight.get("adset_name"), adset.get("name")),
        "ad_id": _first_non_empty(insight.get("ad_id"), ad.get("id")),
        "ad_name": _first_non_empty(insight.get("ad_name"), ad.get("name")),
        "country": _first_non_empty(insight.get("country")),
        "publisher_platform": _first_non_empty(insight.get("publisher_platform")),
        "platform_position": _first_non_empty(insight.get("platform_position")),
        "device_platform": _first_non_empty(insight.get("impression_device")),
        "objective": _first_non_empty(campaign.get("objective")),
        "buying_type": _first_non_empty(campaign.get("buying_type")),
        "status": _first_non_empty(ad.get("status")),
        "effective_status": _first_non_empty(ad.get("effective_status"), campaign.get("effective_status")),
        "date_start": _first_non_empty(insight.get("date_start")),
        "date_stop": _first_non_empty(insight.get("date_stop")),
        "spend": insight.get("spend"),
        "impressions": insight.get("impressions"),
        "clicks": insight.get("clicks"),
        "link_clicks": _action_total(actions, LINK_CLICK_ACTION_KEYS),
        "ctr": insight.get("ctr"),
        "cpc": insight.get("cpc"),
        "cpm": insight.get("cpm"),
        "frequency": insight.get("frequency"),
        "purchases": _action_total(actions, PURCHASE_ACTION_KEYS),
        "revenue": _action_total(action_values, PURCHASE_ACTION_KEYS),
        "roas": _purchase_roas(insight),
        "video_3s_views": _video_3s_views(insight),
        "metadata": {
            "source": "meta_graph_api",
            "breakdowns": breakdowns,
            "account_currency": _first_non_empty(insight.get("account_currency")),
            "ad_updated_time": _first_non_empty(ad.get("updated_time")),
        },
        "raw": {
            "ad": ad,
            "insight": insight,
        },
    }


def sync_meta_creatives(
    *,
    db_path: str,
    settings: ProviderSettings,
    tenant_key: str,
    store_key: str,
    ad_account_id: str | None = None,
    since: str | None = None,
    until: str | None = None,
    time_increment: int = 1,
    breakdowns: list[str] | None = None,
    countries: list[str] | None = None,
    limit: int = 200,
    sync_label: str = "",
) -> MetaCreativePullResult:
    if not settings.meta_ready and not (settings.meta_access_token and ad_account_id):
        raise RuntimeError("missing Meta credentials: set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID")

    resolved_account_id = _normalize_account_id(ad_account_id or settings.meta_ad_account_id)
    if not resolved_account_id:
        raise RuntimeError("missing Meta ad account ID")

    active_breakdowns = [item.strip() for item in (breakdowns or ["country"]) if item.strip()]
    insight_params: dict[str, Any] = {
        "fields": DEFAULT_INSIGHT_FIELDS,
        "level": "ad",
        "limit": max(1, min(limit, 500)),
        "time_increment": max(1, min(time_increment, 90)),
    }
    if active_breakdowns:
        insight_params["breakdowns"] = ",".join(active_breakdowns)
    active_countries = [item.strip().upper() for item in (countries or []) if item and item.strip()]
    if active_countries:
        insight_params["filtering"] = json.dumps(
            [{"field": "country", "operator": "IN", "value": active_countries}]
        )
    if since and until:
        insight_params["time_range"] = json.dumps({"since": since, "until": until})
    else:
        insight_params["date_preset"] = "maximum"

    insights = _paged_get(
        account_path=resolved_account_id,
        edge="insights",
        params=insight_params,
        settings=settings,
    )
    ad_ids = []
    seen_ad_ids: set[str] = set()
    for item in insights:
        ad_id = _clean_text(item.get("ad_id"))
        if ad_id and ad_id not in seen_ad_ids:
            seen_ad_ids.add(ad_id)
            ad_ids.append(ad_id)

    ads = _fetch_ads_with_fallback(
        ad_ids=ad_ids,
        settings=settings,
    )
    ads_by_id = {_clean_text(item.get("id")): item for item in ads if _clean_text(item.get("id"))}

    normalized_rows = []
    for insight in insights:
        ad_id = _clean_text(insight.get("ad_id"))
        ad = ads_by_id.get(ad_id, {"id": ad_id, "name": insight.get("ad_name")})
        normalized_rows.append(
            _normalize_meta_row(
                account_id=resolved_account_id,
                ad=ad,
                insight=insight,
                breakdowns=active_breakdowns,
            )
        )

    ingest_result = (
        ingest_creative_library_rows(
            db_path=db_path,
            tenant_key=tenant_key,
            store_key=store_key,
            platform="meta",
            source_system="meta_graph_api",
            sync_label=sync_label or "meta-pull",
            rows=normalized_rows,
        )
        if normalized_rows
        else CreativeLibraryIngestResult()
    )

    return MetaCreativePullResult(
        ad_account_id=resolved_account_id,
        fetched_ads=len(ads),
        fetched_insights=len(insights),
        normalized_rows=len(normalized_rows),
        breakdowns=active_breakdowns,
        ingest=ingest_result,
    )
