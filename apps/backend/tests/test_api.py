import pytest
import requests
from fastapi import HTTPException

from keyword_intel import api
from keyword_intel.creative_overlays import (
    BrandIntelligence,
    OverlaySuggestion,
    ReelOverlayPlan,
    VideoMetadata,
)
from keyword_intel.models import PipelineOutput, StoreProfile


def _stub_output(store_url: str) -> PipelineOutput:
    return PipelineOutput(
        profile=StoreProfile(
            url=store_url,
            platform="shopify",
            language="en",
            market="US",
            positioning="test",
            products=[],
        ),
        keywords=[],
        ad_groups=[],
    )


def test_analyze_accepts_domain_without_scheme(monkeypatch) -> None:
    captured: dict[str, str] = {}

    def fake_run_pipeline(
        store_url: str,
        max_keywords: int = 300,
        *,
        market: str | None = None,
        language: str | None = None,
    ) -> PipelineOutput:
        captured["store_url"] = store_url
        return _stub_output(store_url)

    monkeypatch.setattr(api, "run_pipeline", fake_run_pipeline)
    response = api.analyze(api.AnalyzeRequest(store_url="shawq.co", max_keywords=10))

    assert captured["store_url"] == "https://shawq.co/"
    assert response["profile"]["url"] == "https://shawq.co/"


def test_analyze_accepts_legacy_url_field(monkeypatch) -> None:
    captured: dict[str, str] = {}

    def fake_run_pipeline(
        store_url: str,
        max_keywords: int = 300,
        *,
        market: str | None = None,
        language: str | None = None,
    ) -> PipelineOutput:
        captured["store_url"] = store_url
        return _stub_output(store_url)

    monkeypatch.setattr(api, "run_pipeline", fake_run_pipeline)
    response = api.analyze(api.AnalyzeRequest(url="shawq.co", max_keywords=10))

    assert captured["store_url"] == "https://shawq.co/"
    assert response["profile"]["url"] == "https://shawq.co/"


def test_analyze_rejects_invalid_store_url() -> None:
    with pytest.raises(HTTPException) as exc_info:
        api.analyze(api.AnalyzeRequest(store_url="not a valid url"))

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "store_url must be a valid URL (example: https://example.com)"


def test_analyze_rewrites_generic_bad_request_errors(monkeypatch) -> None:
    def fake_run_pipeline(
        store_url: str,
        max_keywords: int = 300,
        *,
        market: str | None = None,
        language: str | None = None,
    ) -> PipelineOutput:
        del store_url, max_keywords, market, language
        raise RuntimeError("Bad Request")

    monkeypatch.setattr(api, "run_pipeline", fake_run_pipeline)

    with pytest.raises(HTTPException) as exc_info:
        api.analyze(api.AnalyzeRequest(store_url="shawq.co", max_keywords=10))

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "analysis failed: request payload is invalid or incomplete"


def test_analyze_rewrites_upstream_http_bad_request(monkeypatch) -> None:
    def fake_run_pipeline(
        store_url: str,
        max_keywords: int = 300,
        *,
        market: str | None = None,
        language: str | None = None,
    ) -> PipelineOutput:
        del store_url, max_keywords, market, language
        response = requests.Response()
        response.status_code = 400
        response._content = b'{"error":"Bad Request"}'
        response.url = "https://api.example.com/test"
        raise requests.HTTPError(response=response)

    monkeypatch.setattr(api, "run_pipeline", fake_run_pipeline)

    with pytest.raises(HTTPException) as exc_info:
        api.analyze(api.AnalyzeRequest(store_url="shawq.co", max_keywords=10))

    assert exc_info.value.status_code == 400
    assert (
        exc_info.value.detail
        == "analysis failed: request was rejected by an upstream provider; check request payload and provider settings"
    )


def test_push_accepts_domain_without_scheme(monkeypatch) -> None:
    captured: dict[str, str] = {}

    def fake_run_pipeline(
        store_url: str,
        max_keywords: int = 300,
        *,
        market: str | None = None,
        language: str | None = None,
    ) -> PipelineOutput:
        captured["store_url"] = store_url
        return _stub_output(store_url)

    class DummyPusher:
        def __init__(self, settings) -> None:
            self.settings = settings

        def push_campaign(
            self,
            profile,
            ad_groups,
            customer_id: str,
            campaign_name: str | None = None,
            dry_run: bool = True,
        ) -> dict:
            return {"ok": True, "customer_id": customer_id, "dry_run": dry_run}

    monkeypatch.setattr(api, "run_pipeline", fake_run_pipeline)
    monkeypatch.setattr(api, "GoogleAdsCampaignPusher", DummyPusher)
    response = api.push_google_ads(
        api.PushGoogleAdsRequest(
            store_url="shawq.co",
            customer_id="1234567890",
            dry_run=True,
            max_keywords=10,
        )
    )

    assert captured["store_url"] == "https://shawq.co/"
    assert response["push"]["ok"] is True


def test_push_accepts_legacy_url_field(monkeypatch) -> None:
    captured: dict[str, str] = {}

    def fake_run_pipeline(
        store_url: str,
        max_keywords: int = 300,
        *,
        market: str | None = None,
        language: str | None = None,
    ) -> PipelineOutput:
        captured["store_url"] = store_url
        return _stub_output(store_url)

    class DummyPusher:
        def __init__(self, settings) -> None:
            self.settings = settings

        def push_campaign(
            self,
            profile,
            ad_groups,
            customer_id: str,
            campaign_name: str | None = None,
            dry_run: bool = True,
        ) -> dict:
            return {"ok": True, "customer_id": customer_id, "dry_run": dry_run}

    monkeypatch.setattr(api, "run_pipeline", fake_run_pipeline)
    monkeypatch.setattr(api, "GoogleAdsCampaignPusher", DummyPusher)
    response = api.push_google_ads(
        api.PushGoogleAdsRequest(
            url="shawq.co",
            customer_id="1234567890",
            dry_run=True,
            max_keywords=10,
        )
    )

    assert captured["store_url"] == "https://shawq.co/"
    assert response["push"]["ok"] is True


def test_creative_overlays_forwards_brand_inputs(monkeypatch, tmp_path) -> None:
    reel_path = tmp_path / "reel.mp4"
    reel_path.write_bytes(b"")
    captured: dict[str, object] = {}

    def fake_generate_reel_overlay_plan(
        reel_path: str,
        *,
        brand_name: str = "",
        product_name: str = "",
        tone: str = "",
        audience: str = "",
        objective: str = "conversion",
        language: str = "en",
        max_overlays: int = 8,
        brand_website_url: str = "",
        audience_responses: list[str] | None = None,
        brand_notes: str = "",
        provider_mode: str = "auto",
        overlay_blind: bool = True,
    ) -> ReelOverlayPlan:
        captured["brand_website_url"] = brand_website_url
        captured["audience_responses"] = audience_responses or []
        captured["brand_notes"] = brand_notes
        return ReelOverlayPlan(
            provider="template",
            reel_path=str(reel_path),
            summary="ok",
            hooks=["hook"],
            primary_cta="Shop now",
            overlays=[
                OverlaySuggestion(
                    start_sec=0.2,
                    end_sec=1.8,
                    text="Stop scrolling",
                )
            ],
            metadata=VideoMetadata(duration_sec=9.5),
            brand_intelligence=BrandIntelligence(
                source_url=brand_website_url,
                audience_responses=list(audience_responses or []),
                brand_notes=brand_notes,
            ),
        )

    monkeypatch.setattr(api, "generate_reel_overlay_plan", fake_generate_reel_overlay_plan)
    response = api.creative_overlays(
        api.CreativeOverlayRequest(
            reel_path=str(reel_path),
            brand_name="Shawq",
            brand_website_url="https://shawq.co",
            audience_responses=["love the fit"],
            brand_notes="Keep it minimal and premium",
        )
    )

    assert captured["brand_website_url"] == "https://shawq.co"
    assert captured["audience_responses"] == ["love the fit"]
    assert response["brand_intelligence"]["source_url"] == "https://shawq.co"
