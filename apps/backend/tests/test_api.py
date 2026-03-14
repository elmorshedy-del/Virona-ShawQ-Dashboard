import pytest
import requests
from fastapi import HTTPException
from types import SimpleNamespace

from keyword_intel import api
from keyword_intel.creative_overlays import (
    BrandIntelligence,
    OverlaySuggestion,
    ReelOverlayPlan,
    VideoMetadata,
)
from keyword_intel.models import (
    CreativeLibraryIngestResult,
    CreativeDNAMark,
    CreativeDNAProfile,
    CreativeDNASavedWork,
    CreativeDNAVectorizationResult,
    MetaCreativePullResult,
    PipelineOutput,
    StoreProfile,
)
from keyword_intel.vectorize import VectorizationTimeoutError, VectorizationUnavailableError


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


def _stub_creative_dna_profile(store_url: str, *, store_key: str = "shawq.co") -> CreativeDNAProfile:
    return CreativeDNAProfile(
        tenant_key="default",
        store_key=store_key,
        store_url=store_url,
        brand_name="Shawq",
        summary="Brand-safe creative defaults",
        tone_keywords=["premium", "editorial"],
        photography_direction="Calm storefront framing.",
        marks=[],
        saved_works=[
            CreativeDNASavedWork(
                id="work_1",
                title="Creative DNA refreshed",
                work_type="profile_refresh",
                created_at="2026-03-13T00:00:00+00:00",
            )
        ],
        updated_at="2026-03-13T00:00:00+00:00",
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


def test_creative_dna_refresh_accepts_domain_without_scheme(monkeypatch) -> None:
    captured: dict[str, str] = {}

    def fake_refresh_creative_dna_profile(
        *,
        db_path: str,
        store_url: str,
        tenant_key: str = "default",
        store_key: str | None = None,
    ) -> CreativeDNAProfile:
        captured["db_path"] = db_path
        captured["store_url"] = store_url
        captured["tenant_key"] = tenant_key
        captured["store_key"] = store_key or ""
        return _stub_creative_dna_profile(store_url, store_key=store_key or "shawq.co")

    monkeypatch.setattr(api, "load_settings", lambda: SimpleNamespace(db_path=".test.db"))
    monkeypatch.setattr(api, "refresh_creative_dna_profile", fake_refresh_creative_dna_profile)

    response = api.refresh_creative_dna(
        api.CreativeDNAProfileRequest(store_url="shawq.co", tenant_key="tenant-a")
    )

    assert captured["store_url"] == "https://shawq.co/"
    assert captured["tenant_key"] == "tenant-a"
    assert captured["store_key"] == "shawq.co"
    assert response["brand_name"] == "Shawq"


def test_creative_dna_vectorize_appends_mark(monkeypatch) -> None:
    captured: dict[str, str] = {}

    def fake_append_vector_mark(
        *,
        db_path: str,
        tenant_key: str,
        store_key: str,
        mark_name: str,
        source_name: str,
        svg: str,
        store_url: str | None = None,
    ) -> CreativeDNAVectorizationResult:
        captured["db_path"] = db_path
        captured["tenant_key"] = tenant_key
        captured["store_key"] = store_key
        captured["mark_name"] = mark_name
        captured["source_name"] = source_name
        captured["svg"] = svg
        captured["store_url"] = store_url or ""
        profile = _stub_creative_dna_profile(store_url or "https://shawq.co/")
        mark = CreativeDNAMark(
            id="mark_1",
            name=mark_name,
            source_name=source_name,
            svg=svg,
            created_at="2026-03-13T00:00:00+00:00",
        )
        return CreativeDNAVectorizationResult(profile=profile, mark=mark)

    monkeypatch.setattr(api, "load_settings", lambda: SimpleNamespace(db_path=".test.db"))
    monkeypatch.setattr(api, "vectorize_image_bytes", lambda *args, **kwargs: "<svg />")
    monkeypatch.setattr(api, "append_vector_mark", fake_append_vector_mark)

    response = api.creative_dna_vectorize(
        api.CreativeDNAVectorizeRequest(
            tenant_key="tenant-a",
            store_key="shawq.co",
            store_url="shawq.co",
            name="Shawq Logo",
            filename="logo.png",
            image_base64="aGVsbG8=",
            preset="color",
        )
    )

    assert captured["mark_name"] == "Shawq Logo"
    assert captured["store_url"] == "https://shawq.co/"
    assert response["mark"]["svg"] == "<svg />"


def test_creative_dna_vectorize_returns_503_when_vectorizer_missing(monkeypatch) -> None:
    monkeypatch.setattr(api, "load_settings", lambda: SimpleNamespace(db_path=".test.db"))
    monkeypatch.setattr(
        api,
        "vectorize_image_bytes",
        lambda *args, **kwargs: (_ for _ in ()).throw(VectorizationUnavailableError("missing vtracer")),
    )

    with pytest.raises(HTTPException) as exc_info:
        api.creative_dna_vectorize(
            api.CreativeDNAVectorizeRequest(
                tenant_key="tenant-a",
                store_key="shawq.co",
                name="Shawq Logo",
                filename="logo.png",
                image_base64="aGVsbG8=",
                preset="color",
            )
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "missing vtracer"


def test_creative_dna_vectorize_returns_503_when_vectorizer_times_out(monkeypatch) -> None:
    monkeypatch.setattr(api, "load_settings", lambda: SimpleNamespace(db_path=".test.db"))
    monkeypatch.setattr(
        api,
        "vectorize_image_bytes",
        lambda *args, **kwargs: (_ for _ in ()).throw(VectorizationTimeoutError("timed out")),
    )

    with pytest.raises(HTTPException) as exc_info:
        api.creative_dna_vectorize(
            api.CreativeDNAVectorizeRequest(
                tenant_key="tenant-a",
                store_key="shawq.co",
                name="Shawq Logo",
                filename="logo.png",
                image_base64="aGVsbG8=",
                preset="color",
            )
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "timed out"


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


def test_creative_library_meta_pull_forwards_request(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_sync_meta_creatives(
        *,
        db_path: str,
        settings,
        tenant_key: str,
        store_key: str,
        ad_account_id: str | None = None,
        since: str | None = None,
        until: str | None = None,
        time_increment: int = 1,
        breakdowns: list[str] | None = None,
        limit: int = 200,
        sync_label: str = "",
    ) -> MetaCreativePullResult:
        captured["db_path"] = db_path
        captured["tenant_key"] = tenant_key
        captured["store_key"] = store_key
        captured["ad_account_id"] = ad_account_id
        captured["since"] = since
        captured["until"] = until
        captured["time_increment"] = time_increment
        captured["breakdowns"] = breakdowns or []
        captured["limit"] = limit
        captured["sync_label"] = sync_label
        return MetaCreativePullResult(
            ad_account_id=ad_account_id or "act_1",
            fetched_ads=5,
            fetched_insights=12,
            normalized_rows=12,
            breakdowns=list(breakdowns or []),
            ingest=CreativeLibraryIngestResult(
                sync_run_id=7,
                processed_rows=12,
                asset_count=4,
                variant_count=4,
                usage_count=6,
                snapshot_count=12,
                historical_rows=12,
            ),
        )

    monkeypatch.setattr(api, "load_settings", lambda: SimpleNamespace(db_path=".test.db"))
    monkeypatch.setattr(api, "sync_meta_creatives", fake_sync_meta_creatives)

    response = api.creative_library_meta_pull(
        api.MetaCreativePullRequest(
            tenant_key="tenant-a",
            store_key="shawq.co",
            ad_account_id="1234567890",
            since="2024-01-01",
            until="2024-01-31",
            time_increment=1,
            breakdowns=["country"],
            limit=50,
            sync_label="jan-backfill",
        )
    )

    assert captured["store_key"] == "shawq.co"
    assert captured["ad_account_id"] == "1234567890"
    assert captured["breakdowns"] == ["country"]
    assert response["success"] is True
    assert response["normalized_rows"] == 12
    assert response["ingest"]["snapshot_count"] == 12
