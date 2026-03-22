from types import SimpleNamespace

from keyword_intel.creative_library import list_creative_records
from keyword_intel import meta_creatives


def test_sync_meta_creatives_normalizes_video_to_thumbnail_only(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "meta-creatives.db"
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
                "campaign_name": "Scale",
                "adset_id": "adset_1",
                "adset_name": "Broad",
                "ad_id": "ad_1",
                "ad_name": "Hook Ad",
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
                "date_start": "2024-01-01",
                "date_stop": "2024-01-01",
            },
            {
                "account_id": "act_1234567890",
                "account_name": "Shawq",
                "campaign_id": "camp_1",
                "campaign_name": "Scale",
                "adset_id": "adset_1",
                "adset_name": "Broad",
                "ad_id": "ad_1",
                "ad_name": "Hook Ad",
                "country": "AE",
                "spend": "70",
                "impressions": "1400",
                "clicks": "60",
                "cpc": "1.16",
                "cpm": "50",
                "ctr": "4.2",
                "frequency": "1.3",
                "actions": [{"action_type": "purchase", "value": "3"}],
                "action_values": [{"action_type": "purchase", "value": "250"}],
                "purchase_roas": [{"action_type": "purchase", "value": "3.57"}],
                "video_3_sec_watched_actions": [{"action_type": "video_view", "value": "150"}],
                "date_start": "2024-01-02",
                "date_stop": "2024-01-02",
            },
        ]

    monkeypatch.setattr(meta_creatives, "_paged_get", fake_paged_get)

    def fake_fetch_ads_with_fallback(*, ad_ids: list[str], settings) -> list[dict]:
        del settings
        assert ad_ids == ["ad_1"]
        return [
            {
                "id": "ad_1",
                "name": "Hook Ad",
                "status": "ACTIVE",
                "effective_status": "ACTIVE",
                "updated_time": "2024-01-02T00:00:00+0000",
                "campaign": {"id": "camp_1", "name": "Scale", "objective": "OUTCOME_SALES"},
                "adset": {"id": "adset_1", "name": "Broad"},
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

    result = meta_creatives.sync_meta_creatives(
        db_path=str(db_path),
        settings=settings,
        tenant_key="default",
        store_key="shawq.co",
        since="2024-01-01",
        until="2024-01-02",
    )

    assert result.fetched_ads == 1
    assert result.fetched_insights == 2
    assert result.normalized_rows == 2
    assert result.ingest.asset_count == 1
    assert result.ingest.variant_count == 1
    assert result.ingest.usage_count == 2
    assert result.ingest.snapshot_count == 2

    records = list_creative_records(
        db_path=str(db_path),
        tenant_key="default",
        store_key="shawq.co",
        include_history=True,
        history_limit=10,
    )

    assert len(records) == 1
    record = records[0]
    assert record.asset.asset_type == "video"
    assert record.asset.asset_url == "https://cdn.example.com/video-thumb.jpg"
    assert record.asset.source_asset_id == "vid_123"
    assert record.variant.body_text == "Wear it loud"
    assert record.variant.headline == "Tatreez Hoodie"
    assert {usage.country for usage in record.usages} == {"US", "AE"}
    assert [item.date_start for item in record.history] == ["2024-01-02", "2024-01-01"]
