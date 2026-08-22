from types import SimpleNamespace

from keyword_intel import meta_creatives
from keyword_intel.creative_rollups import (
    get_usa_creative_rollup_detail,
    list_usa_creative_rollups,
    materialize_usa_creative_rollups,
)


def test_materialize_usa_creative_rollups_merges_duplicate_usages_and_computes_hook_rate(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "creative-rollups.db"
    settings = SimpleNamespace(
        meta_ready=True,
        meta_access_token="token",
        meta_ad_account_id="1234567890",
        meta_graph_api_version="v22.0",
        http_timeout_sec=5.0,
    )

    def fake_paged_get(*, account_path: str, edge: str, params: dict, settings) -> list[dict]:
        del settings
        assert account_path == "act_1234567890"
        assert edge == "insights"
        assert params["breakdowns"] == "country"
        return [
            {
                "account_id": "act_1234567890",
                "account_name": "Shawq",
                "account_currency": "TRY",
                "campaign_id": "camp_1",
                "campaign_name": "USA Scale",
                "adset_id": "adset_1",
                "adset_name": "Broad 1",
                "ad_id": "ad_1",
                "ad_name": "Winter Hook A",
                "country": "US",
                "spend": "50",
                "impressions": "1000",
                "clicks": "40",
                "cpc": "1.25",
                "cpm": "50",
                "ctr": "4.0",
                "frequency": "1.2",
                "actions": [{"action_type": "purchase", "value": "2"}],
                "action_values": [{"action_type": "purchase", "value": "180"}],
                "purchase_roas": [{"action_type": "purchase", "value": "3.6"}],
                "video_3_sec_watched_actions": [{"action_type": "video_view", "value": "120"}],
                "date_start": "2026-03-20",
                "date_stop": "2026-03-20",
            },
            {
                "account_id": "act_1234567890",
                "account_name": "Shawq",
                "account_currency": "TRY",
                "campaign_id": "camp_2",
                "campaign_name": "USA Test",
                "adset_id": "adset_2",
                "adset_name": "Broad 2",
                "ad_id": "ad_2",
                "ad_name": "Winter Hook B",
                "country": "US",
                "spend": "150",
                "impressions": "1000",
                "clicks": "20",
                "cpc": "7.50",
                "cpm": "150",
                "ctr": "2.0",
                "frequency": "1.1",
                "actions": [{"action_type": "purchase", "value": "4"}],
                "action_values": [{"action_type": "purchase", "value": "300"}],
                "purchase_roas": [{"action_type": "purchase", "value": "2.0"}],
                "video_3_sec_watched_actions": [{"action_type": "video_view", "value": "300"}],
                "date_start": "2026-03-21",
                "date_stop": "2026-03-21",
            },
        ]

    monkeypatch.setattr(meta_creatives, "_paged_get", fake_paged_get)

    def fake_fetch_ads_with_fallback(*, ad_ids: list[str], settings) -> list[dict]:
        del settings
        assert ad_ids == ["ad_1", "ad_2"]
        return [
            {
                "id": "ad_1",
                "name": "Winter Hook A",
                "status": "ACTIVE",
                "effective_status": "ACTIVE",
                "updated_time": "2026-03-21T00:00:00+0000",
                "campaign": {"id": "camp_1", "name": "USA Scale", "objective": "OUTCOME_SALES"},
                "adset": {"id": "adset_1", "name": "Broad 1"},
                "creative": {
                    "id": "cr_1",
                    "name": "Winter Hook",
                    "thumbnail_url": "https://cdn.example.com/video-thumb.jpg",
                    "object_story_spec": {
                        "video_data": {
                            "video_id": "vid_123",
                            "image_url": "https://cdn.example.com/video-thumb.jpg",
                            "message": "Wear it loud",
                            "title": "Tatreez Hoodie",
                            "call_to_action": {
                                "type": "SHOP_NOW",
                                "value": {"link": "https://shawq.co/products/tatreez-hoodie"},
                            },
                        }
                    },
                },
            },
            {
                "id": "ad_2",
                "name": "Winter Hook B",
                "status": "ACTIVE",
                "effective_status": "ACTIVE",
                "updated_time": "2026-03-21T00:00:00+0000",
                "campaign": {"id": "camp_2", "name": "USA Test", "objective": "OUTCOME_SALES"},
                "adset": {"id": "adset_2", "name": "Broad 2"},
                "creative": {
                    "id": "cr_1",
                    "name": "Winter Hook",
                    "thumbnail_url": "https://cdn.example.com/video-thumb.jpg",
                    "object_story_spec": {
                        "video_data": {
                            "video_id": "vid_123",
                            "image_url": "https://cdn.example.com/video-thumb.jpg",
                            "message": "Wear it loud",
                            "title": "Tatreez Hoodie",
                            "call_to_action": {
                                "type": "SHOP_NOW",
                                "value": {"link": "https://shawq.co/products/tatreez-hoodie"},
                            },
                        }
                    },
                },
            },
        ]

    monkeypatch.setattr(meta_creatives, "_fetch_ads_with_fallback", fake_fetch_ads_with_fallback)
    meta_creatives.sync_meta_creatives(
        db_path=str(db_path),
        settings=settings,
        tenant_key="default",
        store_key="shawq.co",
        since="2026-03-20",
        until="2026-03-21",
    )

    result = materialize_usa_creative_rollups(
        db_path=str(db_path),
        tenant_key="default",
        store_key="shawq.co",
        lookback_days=60,
    )

    assert result["rollup_count"] == 1
    listing = list_usa_creative_rollups(
        db_path=str(db_path),
        tenant_key="default",
        store_key="shawq.co",
        lookback_days=60,
    )
    assert listing["count"] == 1
    item = listing["items"][0]
    assert item["usage_count"] == 2
    assert item["snapshot_count"] == 2
    assert item["currency"] == "TRY"
    assert item["total_spend"] == 200.0
    assert item["total_revenue"] == 480.0
    assert item["total_orders"] == 6
    assert item["blended_roas"] == 2.4
    assert item["ctr"] == 3.0
    assert item["hook_rate"] == 21.0

    detail = get_usa_creative_rollup_detail(
        db_path=str(db_path),
        tenant_key="default",
        store_key="shawq.co",
        rollup_id=item["rollup_id"],
    )
    assert detail is not None
    assert len(detail["usage_members"]) == 2


def test_materialize_usa_creative_rollups_uses_usage_level_roas_not_daily_snapshot_median(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "creative-rollups-usage-roas.db"
    settings = SimpleNamespace(
        meta_ready=True,
        meta_access_token="token",
        meta_ad_account_id="1234567890",
        meta_graph_api_version="v22.0",
        http_timeout_sec=5.0,
    )

    def fake_paged_get(*, account_path: str, edge: str, params: dict, settings) -> list[dict]:
        del settings
        assert account_path == "act_1234567890"
        assert edge == "insights"
        return [
            {
                "account_id": "act_1234567890",
                "account_name": "Shawq",
                "account_currency": "TRY",
                "campaign_id": "camp_1",
                "campaign_name": "USA Scale",
                "adset_id": "adset_1",
                "adset_name": "Broad 1",
                "ad_id": "ad_1",
                "ad_name": "Winter Hook A",
                "country": "US",
                "spend": "10",
                "impressions": "1000",
                "clicks": "20",
                "ctr": "2.0",
                "actions": [{"action_type": "purchase", "value": "2"}, {"action_type": "video_view", "value": "100"}],
                "action_values": [{"action_type": "purchase", "value": "1000"}],
                "purchase_roas": [{"action_type": "purchase", "value": "100"}],
                "date_start": "2026-03-20",
                "date_stop": "2026-03-20",
            },
            {
                "account_id": "act_1234567890",
                "account_name": "Shawq",
                "account_currency": "TRY",
                "campaign_id": "camp_1",
                "campaign_name": "USA Scale",
                "adset_id": "adset_1",
                "adset_name": "Broad 1",
                "ad_id": "ad_1",
                "ad_name": "Winter Hook A",
                "country": "US",
                "spend": "190",
                "impressions": "9000",
                "clicks": "180",
                "ctr": "2.0",
                "actions": [{"action_type": "purchase", "value": "2"}, {"action_type": "video_view", "value": "900"}],
                "action_values": [{"action_type": "purchase", "value": "0"}],
                "purchase_roas": [{"action_type": "purchase", "value": "0"}],
                "date_start": "2026-03-21",
                "date_stop": "2026-03-21",
            },
            {
                "account_id": "act_1234567890",
                "account_name": "Shawq",
                "account_currency": "TRY",
                "campaign_id": "camp_2",
                "campaign_name": "USA Test",
                "adset_id": "adset_2",
                "adset_name": "Broad 2",
                "ad_id": "ad_2",
                "ad_name": "Winter Hook B",
                "country": "US",
                "spend": "100",
                "impressions": "5000",
                "clicks": "150",
                "ctr": "3.0",
                "actions": [{"action_type": "purchase", "value": "4"}, {"action_type": "video_view", "value": "750"}],
                "action_values": [{"action_type": "purchase", "value": "300"}],
                "purchase_roas": [{"action_type": "purchase", "value": "3"}],
                "date_start": "2026-03-21",
                "date_stop": "2026-03-21",
            },
        ]

    monkeypatch.setattr(meta_creatives, "_paged_get", fake_paged_get)

    def fake_fetch_ads_with_fallback(*, ad_ids: list[str], settings) -> list[dict]:
        del settings
        assert ad_ids == ["ad_1", "ad_2"]
        return [
            {
                "id": "ad_1",
                "name": "Winter Hook A",
                "status": "ACTIVE",
                "effective_status": "ACTIVE",
                "updated_time": "2026-03-21T00:00:00+0000",
                "campaign": {"id": "camp_1", "name": "USA Scale", "objective": "OUTCOME_SALES"},
                "adset": {"id": "adset_1", "name": "Broad 1"},
                "creative": {
                    "id": "cr_1",
                    "name": "Winter Hook",
                    "thumbnail_url": "https://cdn.example.com/video-thumb.jpg",
                    "object_story_spec": {"video_data": {"video_id": "vid_123", "title": "Tatreez Hoodie"}},
                },
            },
            {
                "id": "ad_2",
                "name": "Winter Hook B",
                "status": "ACTIVE",
                "effective_status": "ACTIVE",
                "updated_time": "2026-03-21T00:00:00+0000",
                "campaign": {"id": "camp_2", "name": "USA Test", "objective": "OUTCOME_SALES"},
                "adset": {"id": "adset_2", "name": "Broad 2"},
                "creative": {
                    "id": "cr_1",
                    "name": "Winter Hook",
                    "thumbnail_url": "https://cdn.example.com/video-thumb.jpg",
                    "object_story_spec": {"video_data": {"video_id": "vid_123", "title": "Tatreez Hoodie"}},
                },
            },
        ]

    monkeypatch.setattr(meta_creatives, "_fetch_ads_with_fallback", fake_fetch_ads_with_fallback)
    meta_creatives.sync_meta_creatives(
        db_path=str(db_path),
        settings=settings,
        tenant_key="default",
        store_key="shawq.co",
        since="2026-03-20",
        until="2026-03-21",
    )

    materialize_usa_creative_rollups(
        db_path=str(db_path),
        tenant_key="default",
        store_key="shawq.co",
        lookback_days=60,
    )

    listing = list_usa_creative_rollups(
        db_path=str(db_path),
        tenant_key="default",
        store_key="shawq.co",
        lookback_days=60,
    )
    item = listing["items"][0]
    assert item["total_spend"] == 300.0
    assert item["total_revenue"] == 1300.0
    assert round(float(item["blended_roas"]), 4) == 4.3333


def test_usa_rollups_resolve_hostname_store_key_alias(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "creative-rollups-alias.db"
    settings = SimpleNamespace(
        meta_ready=True,
        meta_access_token="token",
        meta_ad_account_id="1234567890",
        meta_graph_api_version="v22.0",
        http_timeout_sec=5.0,
    )

    def fake_paged_get(*, account_path: str, edge: str, params: dict, settings) -> list[dict]:
        del settings
        assert account_path == "act_1234567890"
        assert edge == "insights"
        assert params["breakdowns"] == "country"
        return [
            {
                "account_id": "act_1234567890",
                "account_name": "Shawq",
                "campaign_id": "camp_1",
                "campaign_name": "USA Scale",
                "adset_id": "adset_1",
                "adset_name": "Broad 1",
                "ad_id": "ad_1",
                "ad_name": "Winter Hook A",
                "country": "US",
                "spend": "50",
                "impressions": "1000",
                "clicks": "40",
                "cpc": "1.25",
                "cpm": "50",
                "ctr": "4.0",
                "frequency": "1.2",
                "actions": [{"action_type": "purchase", "value": "2"}, {"action_type": "video_view", "value": "120"}],
                "action_values": [{"action_type": "purchase", "value": "180"}],
                "purchase_roas": [{"action_type": "purchase", "value": "3.6"}],
                "date_start": "2026-03-20",
                "date_stop": "2026-03-20",
            },
        ]

    monkeypatch.setattr(meta_creatives, "_paged_get", fake_paged_get)

    def fake_fetch_ads_with_fallback(*, ad_ids: list[str], settings) -> list[dict]:
        del settings
        assert ad_ids == ["ad_1"]
        return [
            {
                "id": "ad_1",
                "name": "Winter Hook A",
                "status": "ACTIVE",
                "effective_status": "ACTIVE",
                "updated_time": "2026-03-21T00:00:00+0000",
                "campaign": {"id": "camp_1", "name": "USA Scale", "objective": "OUTCOME_SALES"},
                "adset": {"id": "adset_1", "name": "Broad 1"},
                "creative": {
                    "id": "cr_1",
                    "name": "Winter Hook",
                    "thumbnail_url": "https://cdn.example.com/video-thumb.jpg",
                    "object_story_spec": {
                        "video_data": {
                            "video_id": "vid_123",
                            "image_url": "https://cdn.example.com/video-thumb.jpg",
                            "message": "Wear it loud",
                            "title": "Tatreez Hoodie",
                            "call_to_action": {
                                "type": "SHOP_NOW",
                                "value": {"link": "https://shawq.co/products/tatreez-hoodie"},
                            },
                        }
                    },
                },
            }
        ]

    monkeypatch.setattr(meta_creatives, "_fetch_ads_with_fallback", fake_fetch_ads_with_fallback)
    meta_creatives.sync_meta_creatives(
        db_path=str(db_path),
        settings=settings,
        tenant_key="default",
        store_key="shawq",
        since="2026-03-20",
        until="2026-03-20",
    )

    result = materialize_usa_creative_rollups(
        db_path=str(db_path),
        tenant_key="default",
        store_key="shawq.co",
        lookback_days=60,
    )
    assert result["resolved_store_key"] == "shawq"

    listing = list_usa_creative_rollups(
        db_path=str(db_path),
        tenant_key="default",
        store_key="https://shawq.co",
        lookback_days=60,
    )
    assert listing["count"] == 1
    assert listing["resolved_store_key"] == "shawq"

    item = listing["items"][0]
    detail = get_usa_creative_rollup_detail(
        db_path=str(db_path),
        tenant_key="default",
        store_key="shawq.co",
        rollup_id=item["rollup_id"],
    )
    assert detail is not None
    assert detail["resolved_store_key"] == "shawq"
    assert detail["rollup_id"] == item["rollup_id"]
