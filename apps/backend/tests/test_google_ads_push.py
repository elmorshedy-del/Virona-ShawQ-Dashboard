from keyword_intel.google_ads_push import GoogleAdsCampaignPusher
from keyword_intel.models import AdGroup, Product, StoreProfile
from keyword_intel.settings import ProviderSettings


def _settings() -> ProviderSettings:
    return ProviderSettings(
        google_ads_api_version="v22",
        google_ads_customer_id="1234567890",
        google_ads_login_customer_id="",
        google_ads_developer_token="",
        google_ads_client_id="",
        google_ads_client_secret="",
        google_ads_refresh_token="",
        serp_base_url="",
        serp_search_path="/search",
        serp_api_key="",
        serp_auth_header="Authorization",
        serp_auth_scheme="Bearer",
        provider_scope_limit=200,
        serp_keyword_limit=40,
        trends_keyword_limit=20,
        provider_max_workers=4,
        http_timeout_sec=12.0,
        serp_internal_enabled=True,
        serp_cache_ttl_sec=1800,
        serp_min_interval_ms=450,
        serp_google_endpoint="https://www.google.com/search",
        serp_proxy_urls=(),
        searxng_base_url="",
        searxng_base_urls=(),
        serpapi_api_key="",
        brightdata_request_url="https://api.brightdata.com/request",
        brightdata_api_key="",
        brightdata_zone="",
        spyfu_api_base_url="https://api.spyfu.com/apis",
        spyfu_username="",
        spyfu_password="",
        spyfu_country_code="US",
        semrush_api_key="",
        semrush_database="us",
        ahrefs_api_base_url="",
        ahrefs_api_key="",
        ahrefs_paid_keywords_path="/paid_keywords",
        ahrefs_organic_keywords_path="/organic_keywords",
        persist_runs=False,
        db_path=".keyword_intel.db",
        monitor_rising_threshold=10.0,
        monitor_alert_min_confidence=60.0,
    )


def test_google_ads_push_dry_run_builds_mutate_operations() -> None:
    profile = StoreProfile(
        url="https://shawq.co",
        platform="shopify",
        language="en",
        market="US",
        positioning="Shawq premium apparel",
        products=[Product(name="Palestine Hoodie")],
    )
    ad_groups = [
        AdGroup(
            name="Hoodie Transactional",
            theme="Hoodie",
            keywords=["buy palestine hoodie", "keffiyeh hoodie"],
            keyword_match_types={
                "buy palestine hoodie": "EXACT",
                "keffiyeh hoodie": "PHRASE",
            },
            negatives=["free", "job"],
            headlines=["Buy Palestine Hoodie", "Shawq Official Store", "Hoodie Deals Today"],
            descriptions=[
                "Shop premium styles with secure checkout and fast shipping.",
                "Limited drops available now. Order today.",
            ],
            callouts=["Fast shipping", "Secure checkout"],
            budget_usd_daily=24.0,
        )
    ]

    pusher = GoogleAdsCampaignPusher(settings=_settings())
    payload = pusher.push_campaign(
        profile=profile,
        ad_groups=ad_groups,
        customer_id="123-456-7890",
        dry_run=True,
    )

    assert payload["status"] == "dry_run"
    assert payload["operation_count"] > 4
    assert any("campaignOperation" in op for op in payload["operations"])
    assert any("adGroupCriterionOperation" in op for op in payload["operations"])
