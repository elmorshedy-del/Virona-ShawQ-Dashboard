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
    BeatsAudioAnalysisResult,
    ClaudeSubjectiveScore,
    ClaudeSubjectiveScoreResult,
    CreativeLabelMaterializationResult,
    CreativeLabelRecord,
    CreativeLibraryIngestResult,
    CreativeDNAMark,
    CreativeDNAProfile,
    CreativeDNASavedWork,
    CreativeDNAVectorizationResult,
    FireRedAudioSourceResult,
    MetaCreativePullResult,
    PipelineOutput,
    SigLIPEmbedResult,
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
        countries: list[str] | None = None,
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
        captured["countries"] = countries or []
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
    assert captured["countries"] == []
    assert response["success"] is True
    assert response["normalized_rows"] == 12
    assert response["ingest"]["snapshot_count"] == 12


def test_creative_library_usa_rollup_materialize_forwards_request(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_materialize_usa_creative_rollups(
        *,
        db_path: str,
        tenant_key: str,
        store_key: str,
        lookback_days: int,
        lookback_window: str | None,
        min_spend_threshold: float,
        metric_keys: list[str],
    ):
        captured["db_path"] = db_path
        captured["tenant_key"] = tenant_key
        captured["store_key"] = store_key
        captured["lookback_days"] = lookback_days
        captured["lookback_window"] = lookback_window
        captured["min_spend_threshold"] = min_spend_threshold
        captured["metric_keys"] = metric_keys
        return {"success": True, "rollup_count": 8}

    monkeypatch.setattr(api, "load_settings", lambda: SimpleNamespace(db_path="test.db"))
    monkeypatch.setattr(api, "materialize_usa_creative_rollups", fake_materialize_usa_creative_rollups)

    response = api.creative_library_usa_rollup_materialize(
        api.CreativeUsaRollupMaterializeRequest(
            tenant_key="tenant-a",
            store_key="shawq.co",
            lookback_days=90,
        )
    )

    assert captured["db_path"] == "test.db"
    assert captured["store_key"] == "shawq.co"
    assert captured["lookback_days"] == 90
    assert captured["lookback_window"] is None
    assert captured["min_spend_threshold"] == 30.0
    assert captured["metric_keys"] == ["spend", "roas", "orders", "ctr", "hook_rate"]
    assert response["rollup_count"] == 8


def test_creative_library_usa_rollup_list_forwards_request(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_list_usa_creative_rollups(
        *,
        db_path: str,
        tenant_key: str,
        store_key: str,
        lookback_days: int,
        lookback_window: str | None,
        limit: int,
        offset: int,
        metric_keys: list[str],
    ):
        captured["db_path"] = db_path
        captured["tenant_key"] = tenant_key
        captured["store_key"] = store_key
        captured["lookback_days"] = lookback_days
        captured["lookback_window"] = lookback_window
        captured["limit"] = limit
        captured["offset"] = offset
        captured["metric_keys"] = metric_keys
        return {"success": True, "count": 1, "items": [{"rollup_id": "variant_1"}]}

    monkeypatch.setattr(api, "load_settings", lambda: SimpleNamespace(db_path="test.db"))
    monkeypatch.setattr(api, "list_usa_creative_rollups", fake_list_usa_creative_rollups)

    response = api.creative_library_usa_rollup_list(
        tenant_key="tenant-a",
        store_key="shawq.co",
        lookback_days=60,
        limit=25,
        offset=5,
        metric_keys=None,
    )

    assert captured["store_key"] == "shawq.co"
    assert captured["lookback_days"] == 60
    assert captured["lookback_window"] is None
    assert captured["limit"] == 25
    assert captured["metric_keys"] == []
    assert response["count"] == 1


def test_creative_library_usa_rollup_detail_returns_404_when_missing(monkeypatch) -> None:
    monkeypatch.setattr(api, "load_settings", lambda: SimpleNamespace(db_path="test.db"))
    monkeypatch.setattr(api, "get_usa_creative_rollup_detail", lambda **kwargs: None)

    with pytest.raises(HTTPException) as exc_info:
        api.creative_library_usa_rollup_detail(
            rollup_id="variant_1",
            tenant_key="tenant-a",
            store_key="shawq.co",
        )

    assert exc_info.value.status_code == 404


def test_signalstack_beats_audio_analyze_forwards_request(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_analyze_beats_audio(
        *,
        endpoint_url: str,
        api_token: str = "",
        audio_url: str | None = None,
        video_url: str | None = None,
        timeout_sec: float = 120.0,
    ) -> BeatsAudioAnalysisResult:
        captured["endpoint_url"] = endpoint_url
        captured["api_token"] = api_token
        captured["audio_url"] = audio_url
        captured["video_url"] = video_url
        captured["timeout_sec"] = timeout_sec
        return BeatsAudioAnalysisResult(
            audio_mood="dramatic",
            energy_level="high",
            voice_music_ratio="balanced",
            model_id="facebook/beats",
        )

    monkeypatch.setattr(
        api,
        "load_settings",
        lambda: SimpleNamespace(
            beats_ready=True,
            beats_endpoint_url="https://beats.example.test",
            beats_api_token="token-123",
            beats_timeout_sec=90.0,
        ),
    )
    monkeypatch.setattr(api, "analyze_beats_audio", fake_analyze_beats_audio)

    response = api.signalstack_beats_audio_analyze(
        api.BeatsAudioAnalyzeRequest(audio_url="https://cdn.example.test/audio.wav")
    )

    assert captured["endpoint_url"] == "https://beats.example.test"
    assert captured["audio_url"] == "https://cdn.example.test/audio.wav"
    assert response["audio_mood"] == "dramatic"
    assert response["model_id"] == "facebook/beats"


def test_signalstack_beats_audio_analyze_requires_endpoint(monkeypatch) -> None:
    monkeypatch.setattr(
        api,
        "load_settings",
        lambda: SimpleNamespace(
            beats_ready=False,
            beats_endpoint_url="",
            beats_api_token="",
            beats_timeout_sec=90.0,
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        api.signalstack_beats_audio_analyze(
            api.BeatsAudioAnalyzeRequest(audio_url="https://cdn.example.test/audio.wav")
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "BEATs endpoint is not configured"


def test_signalstack_firered_audio_source_forwards_request(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_analyze_firered_audio_source(
        *,
        endpoint_url: str,
        api_token: str = "",
        audio_url: str | None = None,
        video_url: str | None = None,
        timeout_sec: float = 120.0,
    ) -> FireRedAudioSourceResult:
        captured["endpoint_url"] = endpoint_url
        captured["api_token"] = api_token
        captured["audio_url"] = audio_url
        captured["video_url"] = video_url
        captured["timeout_sec"] = timeout_sec
        return FireRedAudioSourceResult(
            voice_music_ratio="music_dominant",
            speech_ratio=0.0,
            singing_ratio=0.84,
            music_ratio=1.0,
            model_id="FireRedTeam/FireRedVAD",
        )

    monkeypatch.setattr(
        api,
        "load_settings",
        lambda: SimpleNamespace(
            firered_ready=True,
            firered_endpoint_url="https://firered.example.test",
            firered_api_token="token-456",
            firered_timeout_sec=75.0,
        ),
    )
    monkeypatch.setattr(api, "analyze_firered_audio_source", fake_analyze_firered_audio_source)

    response = api.signalstack_firered_audio_source(
        api.BeatsAudioAnalyzeRequest(video_url="https://cdn.example.test/reel.mp4")
    )

    assert captured["endpoint_url"] == "https://firered.example.test"
    assert captured["video_url"] == "https://cdn.example.test/reel.mp4"
    assert response["voice_music_ratio"] == "music_dominant"
    assert response["model_id"] == "FireRedTeam/FireRedVAD"


def test_signalstack_audio_stack_analyze_combines_beats_and_firered(monkeypatch) -> None:
    def fake_beats(**kwargs) -> BeatsAudioAnalysisResult:
        del kwargs
        return BeatsAudioAnalysisResult(
            audio_mood="upbeat",
            energy_level="high",
            voice_music_ratio="balanced",
            evidence={"tempo_bpm": "124"},
            model_id="beats-model",
        )

    def fake_firered(**kwargs) -> FireRedAudioSourceResult:
        del kwargs
        return FireRedAudioSourceResult(
            voice_music_ratio="music_dominant",
            speech_ratio=0.0,
            singing_ratio=0.84,
            music_ratio=1.0,
            model_id="firered-model",
        )

    monkeypatch.setattr(
        api,
        "load_settings",
        lambda: SimpleNamespace(
            beats_ready=True,
            beats_endpoint_url="https://beats.example.test",
            beats_api_token="token-beats",
            beats_timeout_sec=90.0,
            firered_ready=True,
            firered_endpoint_url="https://firered.example.test",
            firered_api_token="token-fire",
            firered_timeout_sec=90.0,
        ),
    )
    monkeypatch.setattr(api, "analyze_beats_audio", fake_beats)
    monkeypatch.setattr(api, "analyze_firered_audio_source", fake_firered)

    response = api.signalstack_audio_stack_analyze(
        api.BeatsAudioAnalyzeRequest(video_url="https://cdn.example.test/reel.mp4")
    )

    assert response["audio_mood"] == "upbeat"
    assert response["energy_level"] == "high"
    assert response["voice_music_ratio"] == "music_dominant"
    assert response["beats_model_id"] == "beats-model"
    assert response["firered_model_id"] == "firered-model"


def test_signalstack_siglip_embed_forwards_request(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_embed_siglip_image(
        *,
        endpoint_url: str,
        api_token: str = "",
        image_url: str,
        timeout_sec: float = 120.0,
    ) -> SigLIPEmbedResult:
        captured["endpoint_url"] = endpoint_url
        captured["api_token"] = api_token
        captured["image_url"] = image_url
        captured["timeout_sec"] = timeout_sec
        return SigLIPEmbedResult(
            embedding=[0.1, 0.2, 0.3],
            dimensions=3,
            model_id="google/siglip2-so400m-patch14-384",
        )

    monkeypatch.setattr(
        api,
        "load_settings",
        lambda: SimpleNamespace(
            siglip_ready=True,
            siglip_endpoint_url="https://siglip.example.test",
            siglip_api_token="token-789",
            siglip_timeout_sec=55.0,
        ),
    )
    monkeypatch.setattr(api, "embed_siglip_image", fake_embed_siglip_image)

    response = api.signalstack_siglip_embed(
        api.SigLIPEmbedRequest(image_url="https://cdn.example.test/thumb.jpg")
    )

    assert captured["endpoint_url"] == "https://siglip.example.test"
    assert captured["image_url"] == "https://cdn.example.test/thumb.jpg"
    assert response["dimensions"] == 3
    assert response["model_id"] == "google/siglip2-so400m-patch14-384"


def test_signalstack_claude_subjective_score_forwards_request(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_score_usa_rollup_with_claude(
        *,
        db_path: str,
        tenant_key: str,
        store_key: str,
        rollup_id: str,
        anthropic_api_key: str,
        anthropic_model: str,
        anthropic_base_url: str,
        timeout_sec: float,
        force_refresh: bool,
    ) -> ClaudeSubjectiveScoreResult:
        captured["db_path"] = db_path
        captured["tenant_key"] = tenant_key
        captured["store_key"] = store_key
        captured["rollup_id"] = rollup_id
        captured["anthropic_model"] = anthropic_model
        captured["force_refresh"] = force_refresh
        return ClaudeSubjectiveScoreResult(
            rollup_id=rollup_id,
            variant_id=rollup_id,
            model_id=anthropic_model,
            prompt_version="claude_subjective_v1",
            input_hash="abc123",
            cache_hit=True,
            score=ClaudeSubjectiveScore(
                emotional_angle="pride",
                heritage_vibe="strong",
                premium_vs_casual="balanced",
                ugc_vs_polished="hybrid",
                hook_type="direct_statement",
                opening_style="direct_statement",
                cta_style="identity_extension",
                cause_vs_product="balanced",
                text_density="low",
                face_presence="some",
                evidence={"heritage_vibe": "visible cultural cues"},
            ),
        )

    monkeypatch.setattr(
        api,
        "load_settings",
        lambda: SimpleNamespace(
            db_path="test.db",
            anthropic_ready=True,
            anthropic_api_key="test-key",
            anthropic_model="claude-sonnet-4-6",
            anthropic_base_url="https://api.anthropic.com/v1/messages",
            anthropic_timeout_sec=45.0,
        ),
    )
    monkeypatch.setattr(api, "score_usa_rollup_with_claude", fake_score_usa_rollup_with_claude)

    response = api.signalstack_claude_subjective_score(
        api.ClaudeSubjectiveScoreRequest(
            tenant_key="tenant-a",
            store_key="shawq.co",
            rollup_id="variant_1",
            force_refresh=True,
        )
    )

    assert captured["db_path"] == "test.db"
    assert captured["tenant_key"] == "tenant-a"
    assert captured["store_key"] == "shawq.co"
    assert captured["rollup_id"] == "variant_1"
    assert captured["anthropic_model"] == "claude-sonnet-4-6"
    assert captured["force_refresh"] is True
    assert response["cache_hit"] is True
    assert response["score"]["heritage_vibe"] == "strong"


def test_creative_library_labels_materialize_forwards_request(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_materialize_creative_labels(**kwargs) -> CreativeLabelMaterializationResult:
        captured.update(kwargs)
        return CreativeLabelMaterializationResult(
            tenant_key="tenant-a",
            requested_store_key="shawq.co",
            resolved_store_key="shawq",
            canonical_creative_id="asset_1",
            variant_id="variant_1",
            cache_hits={
                "stage_a_qwen": False,
                "stage_b_gemini": False,
                "stage_c_audio": False,
                "stage_d_claude": False,
            },
            models={
                "qwen": "qwen-vl-max",
                "gemini": "gemini-2.5-flash",
                "audio": "firered-test",
                "claude": "claude-sonnet-4-6",
            },
            labels=CreativeLabelRecord(
                canonical_creative_id="asset_1",
                variant_id="variant_1",
                labeled_at="2026-03-27T00:00:00+00:00",
                production_feel="native",
                delivery_format="on_body_showcase",
                face_presence="minor",
                body_presence="major",
                hands_presence="minor",
                face_role="supporting",
                body_role="primary",
                hands_role="supporting",
                on_body_prominence="dominant",
                detail_intensity="moderate",
                texture_emphasis="moderate",
                product_prominence="dominant",
                motion_style="handheld_reveal",
                opening_focus="product",
                styling_count="single",
                text_density="low",
                text_role="selling",
                opening_text_focus="clear",
                extracted_text_sequence=[],
                audio_source_type="singing",
                voiceover_present="no",
                music_energy="upbeat",
                opening_mechanism="offer_open",
                opening_energy="punchy",
                emotional_angle="pride_identity",
                heritage_emphasis_level="strong",
                cause_product_balance="balanced",
                craft_emphasis="moderate",
                surprise_detail="subtle",
                occasion_framing="religious",
                evidence={
                    "production_feel": "Production feel is native; opening focus is product and motion style is handheld_reveal.",
                    "delivery_format": "Delivery format is on_body_showcase; text role is selling with text density low.",
                    "subject_visibility": "Face is minor and supporting. Body is major and primary. Hands are minor and supporting.",
                    "product_presentation": "On-body prominence is dominant, detail intensity is moderate, texture emphasis is moderate, product prominence is dominant, and motion style is handheld_reveal.",
                    "opening": "Offer-led opening with punchy pacing.",
                    "creative_angle": "Pride identity is the dominant emotion. Heritage language is explicit while staying balanced with product selling.",
                    "audio_layer": "Audio source is singing, voiceover is no, and music energy is upbeat.",
                },
            ),
        )

    monkeypatch.setattr(
        api,
        "load_settings",
        lambda: SimpleNamespace(
            db_path="test.db",
            qwen_ready=True,
            gemini_ready=True,
            firered_ready=True,
            anthropic_ready=True,
            dashscope_api_key="dashscope-key",
            dashscope_base_url="https://dashscope.example.test/v1",
            dashscope_model="qwen-vl-max",
            dashscope_timeout_sec=55.0,
            google_ai_api_key="gemini-key",
            gemini_base_url="https://gemini.example.test/v1beta",
            gemini_model="gemini-2.5-flash",
            gemini_timeout_sec=45.0,
            firered_endpoint_url="https://firered.example.test",
            firered_api_token="firered-token",
            firered_timeout_sec=35.0,
            anthropic_api_key="anthropic-key",
            anthropic_model="claude-sonnet-4-6",
            anthropic_base_url="https://api.anthropic.com/v1/messages",
            anthropic_timeout_sec=65.0,
        ),
    )
    monkeypatch.setattr(api, "materialize_creative_labels", fake_materialize_creative_labels)

    response = api.creative_library_labels_materialize(
        api.CreativeLabelMaterializeRequest(
            tenant_key="tenant-a",
            store_key="shawq.co",
            rollup_id="asset_1",
            variant_id="variant_1",
            force_refresh=True,
        )
    )

    assert captured["db_path"] == "test.db"
    assert captured["canonical_creative_id"] == "asset_1"
    assert captured["variant_id"] == "variant_1"
    assert captured["anthropic_model"] == "claude-sonnet-4-6"
    assert captured["force_refresh"] is True
    assert response["labels"]["heritage_emphasis_level"] == "strong"


def test_creative_library_labels_get_returns_record(monkeypatch) -> None:
    monkeypatch.setattr(api, "load_settings", lambda: SimpleNamespace(db_path="test.db"))
    monkeypatch.setattr(
        api,
        "get_creative_label_record",
        lambda **kwargs: CreativeLabelRecord(
            canonical_creative_id="asset_1",
            variant_id="variant_1",
            labeled_at="2026-03-27T00:00:00+00:00",
            production_feel="native",
            delivery_format="on_body_showcase",
            face_presence="minor",
            body_presence="major",
            hands_presence="minor",
            face_role="supporting",
            body_role="primary",
            hands_role="supporting",
            on_body_prominence="dominant",
            detail_intensity="moderate",
            texture_emphasis="moderate",
            product_prominence="dominant",
            motion_style="handheld_reveal",
            opening_focus="product",
            styling_count="single",
            text_density="low",
            text_role="selling",
            opening_text_focus="clear",
            extracted_text_sequence=[],
            audio_source_type="singing",
            voiceover_present="no",
            music_energy="upbeat",
            opening_mechanism="offer_open",
            opening_energy="punchy",
            emotional_angle="pride_identity",
            heritage_emphasis_level="strong",
            cause_product_balance="balanced",
            craft_emphasis="moderate",
            surprise_detail="subtle",
            occasion_framing="religious",
            evidence={
                "production_feel": "Production feel is native; opening focus is product and motion style is handheld_reveal.",
                "delivery_format": "Delivery format is on_body_showcase; text role is selling with text density low.",
                "subject_visibility": "Face is minor and supporting. Body is major and primary. Hands are minor and supporting.",
                "product_presentation": "On-body prominence is dominant, detail intensity is moderate, texture emphasis is moderate, product prominence is dominant, and motion style is handheld_reveal.",
                "opening": "Offer-led opening with punchy pacing.",
                "creative_angle": "Pride identity is the dominant emotion. Heritage language is explicit while staying balanced with product selling.",
                "audio_layer": "Audio source is singing, voiceover is no, and music energy is upbeat.",
            },
        ),
    )

    response = api.creative_library_labels_get(
        canonical_creative_id="asset_1",
        store_key="shawq.co",
        tenant_key="tenant-a",
        variant_id="variant_1",
    )

    assert response["canonical_creative_id"] == "asset_1"
    assert response["heritage_emphasis_level"] == "strong"
