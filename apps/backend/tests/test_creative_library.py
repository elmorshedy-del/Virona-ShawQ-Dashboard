from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from keyword_intel import api


def _row(
    *,
    creative_id: str,
    creative_name: str,
    asset_url: str,
    campaign_id: str,
    adset_id: str,
    ad_id: str,
    country: str,
    date_start: str,
    spend: float,
) -> dict:
    return {
        "creative_id": creative_id,
        "creative_name": creative_name,
        "asset_url": asset_url,
        "body_text": "Wear it loud",
        "headline": "Tatreez Hoodie",
        "cta_text": "Shop Now",
        "account_id": "act_1",
        "account_name": "Shawq Main",
        "campaign_id": campaign_id,
        "campaign_name": campaign_id,
        "adset_id": adset_id,
        "adset_name": adset_id,
        "ad_id": ad_id,
        "ad_name": ad_id,
        "country": country,
        "publisher_platform": "facebook",
        "platform_position": "feed",
        "date_start": date_start,
        "date_stop": date_start,
        "spend": spend,
        "impressions": 1000,
        "clicks": 40,
        "metadata": {"source": "meta-backfill", "owner": "creative-intel"},
    }


def test_creative_library_ingest_keeps_history_and_usage_split(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "creative-library.db"
    monkeypatch.setattr(api, "load_settings", lambda: SimpleNamespace(db_path=str(db_path)))

    response = api.creative_library_ingest(
        api.CreativeLibraryIngestRequest(
            store_key="shawq.co",
            platform="meta",
            source_system="meta_api",
            sync_label="historical-backfill",
            rows=[
                _row(
                    creative_id="cr_shared",
                    creative_name="Ramadan Hook 1",
                    asset_url="https://cdn.example.com/shared.mp4?utm_source=meta",
                    campaign_id="camp_us",
                    adset_id="adset_us",
                    ad_id="ad_us",
                    country="US",
                    date_start="2024-01-01",
                    spend=50.0,
                ),
                _row(
                    creative_id="cr_shared",
                    creative_name="Ramadan Hook 1",
                    asset_url="https://cdn.example.com/shared.mp4?utm_campaign=test",
                    campaign_id="camp_ae",
                    adset_id="adset_ae",
                    ad_id="ad_ae",
                    country="AE",
                    date_start="2024-01-02",
                    spend=70.0,
                ),
            ],
        )
    )

    assert response["success"] is True
    assert response["asset_count"] == 1
    assert response["variant_count"] == 1
    assert response["usage_count"] == 2
    assert response["snapshot_count"] == 2
    assert response["historical_rows"] == 2

    listing = api.creative_library_variants(
        tenant_key="default",
        store_key="shawq.co",
        include_history=True,
        history_limit=10,
    )

    assert listing["success"] is True
    assert listing["count"] == 1
    item = listing["items"][0]
    assert item["asset"]["asset_url"] == "https://cdn.example.com/shared.mp4"
    assert item["asset"]["metadata"]["source"] == "meta-backfill"
    assert item["usage_count"] == 2
    assert item["snapshot_count"] == 2
    assert {usage["country"] for usage in item["usages"]} == {"US", "AE"}
    assert [snap["date_start"] for snap in item["history"]] == ["2024-01-02", "2024-01-01"]
    assert item["latest_snapshot"]["spend"] == 70.0

    detail = api.creative_library_variant_detail(
        item["variant"]["variant_id"],
        tenant_key="default",
        store_key="shawq.co",
        history_limit=10,
    )

    assert detail["variant"]["creative_name"] == "Ramadan Hook 1"
    assert detail["variant"]["body_text"] == "Wear it loud"
    assert detail["latest_snapshot"]["date_start"] == "2024-01-02"
    assert len(detail["usages"]) == 2


def test_creative_library_does_not_merge_same_name_when_asset_changes(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "creative-library.db"
    monkeypatch.setattr(api, "load_settings", lambda: SimpleNamespace(db_path=str(db_path)))

    api.creative_library_ingest(
        api.CreativeLibraryIngestRequest(
            store_key="shawq.co",
            rows=[
                _row(
                    creative_id="cr_a",
                    creative_name="Same Name",
                    asset_url="https://cdn.example.com/a.jpg",
                    campaign_id="camp_a",
                    adset_id="adset_a",
                    ad_id="ad_a",
                    country="US",
                    date_start="2024-01-01",
                    spend=10.0,
                ),
                _row(
                    creative_id="cr_b",
                    creative_name="Same Name",
                    asset_url="https://cdn.example.com/b.jpg",
                    campaign_id="camp_b",
                    adset_id="adset_b",
                    ad_id="ad_b",
                    country="US",
                    date_start="2024-01-01",
                    spend=11.0,
                ),
            ],
        )
    )

    listing = api.creative_library_variants(
        tenant_key="default",
        store_key="shawq.co",
        include_history=False,
    )

    assert listing["count"] == 2
    asset_urls = {item["asset"]["asset_url"] for item in listing["items"]}
    assert asset_urls == {"https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"}


def test_creative_library_ingest_rejects_empty_rows(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "creative-library.db"
    monkeypatch.setattr(api, "load_settings", lambda: SimpleNamespace(db_path=str(db_path)))

    with pytest.raises(HTTPException) as exc_info:
        api.creative_library_ingest(api.CreativeLibraryIngestRequest(store_key="shawq.co", rows=[]))

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "rows must contain at least one creative metadata row"
