from __future__ import annotations

import base64
import hmac
import json
import os
from hashlib import sha256
from typing import Any, Literal
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, HttpUrl, TypeAdapter, ValidationError
import requests

from .blackbox import (
    CaseFilter,
    EventInput,
    blackbox_overview,
    build_shopify_webhook_event,
    export_cases_csv,
    hash_value,
    ingest_event,
    list_case_events,
    list_cases,
)
from .beats_audio import analyze_beats_audio
from .firered_audio import analyze_firered_audio_source
from .creative_library import (
    get_creative_record,
    ingest_creative_library_rows,
    list_creative_records,
)
from .creative_rollups import (
    get_usa_creative_rollup_detail,
    list_usa_creative_rollups,
    materialize_usa_creative_rollups,
)
from .meta_creatives import sync_meta_creatives
from .creative_dna import append_vector_mark, refresh_creative_dna_profile
from .creative_dna_storage import load_creative_dna_profile
from .creative_overlays import generate_reel_overlay_plan
from .google_ads_push import GoogleAdsCampaignPusher
from .models import (
    BeatsAudioAnalysisResult,
    FireRedAudioSourceResult,
    SigLIPEmbedResult,
    SignalStackAudioStackResult,
)
from .pipeline import run_pipeline
from .serp import search_serp
from .settings import load_settings
from .siglip_embed import embed_siglip_image
from .vectorize import (
    VectorizationTimeoutError,
    VectorizationUnavailableError,
    decode_base64_image,
    vectorize_image_bytes,
)

app = FastAPI(title="Keyword Intelligence API", version="0.1.0")
_HTTP_URL_ADAPTER = TypeAdapter(HttpUrl)
DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)
LOCAL_DEV_CORS_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"


def _cors_origins() -> list[str]:
    extra = [origin.strip() for origin in os.getenv("KEYWORD_INTEL_CORS_ORIGINS", "").split(",") if origin.strip()]
    return list(dict.fromkeys([*DEFAULT_CORS_ORIGINS, *extra]))


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_origin_regex=LOCAL_DEV_CORS_REGEX,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    store_url: str | None = None
    url: str | None = None
    max_keywords: int = 300
    market: str | None = None
    language: str | None = None


class CreativeDNAProfileRequest(BaseModel):
    tenant_key: str = "default"
    store_key: str | None = None
    store_url: str | None = None
    url: str | None = None


class CreativeDNAVectorizeRequest(BaseModel):
    tenant_key: str = "default"
    store_key: str
    store_url: str | None = None
    url: str | None = None
    name: str = "Vector Mark"
    filename: str = "upload.png"
    image_base64: str
    preset: Literal["color", "monochrome"] = "color"


class CreativeLibraryIngestRequest(BaseModel):
    tenant_key: str = "default"
    store_key: str
    platform: str = "meta"
    source_system: str = "meta_api"
    sync_label: str = ""
    rows: list[dict[str, Any]] = Field(default_factory=list)


class MetaCreativePullRequest(BaseModel):
    tenant_key: str = "default"
    store_key: str
    ad_account_id: str | None = None
    since: str | None = None
    until: str | None = None
    time_increment: int = 1
    breakdowns: list[str] = Field(default_factory=lambda: ["country"])
    countries: list[str] = Field(default_factory=list)
    limit: int = 200
    sync_label: str = ""


class CreativeUsaRollupMaterializeRequest(BaseModel):
    tenant_key: str = "default"
    store_key: str
    lookback_days: int = 60
    metric_keys: list[str] = Field(default_factory=lambda: ["spend", "roas", "orders", "ctr", "hook_rate"])


class SerpSearchRequest(BaseModel):
    query: str
    hl: str = "en-US"
    gl: str = "us"
    num: int = 10


class PushGoogleAdsRequest(BaseModel):
    store_url: str | None = None
    url: str | None = None
    customer_id: str | None = None
    campaign_name: str | None = None
    max_keywords: int = 300
    dry_run: bool = True


class CreativeOverlayRequest(BaseModel):
    reel_path: str
    brand_name: str = ""
    product_name: str = ""
    tone: str = ""
    audience: str = ""
    objective: str = "conversion"
    language: str = "en"
    max_overlays: int = 8
    brand_website_url: str = ""
    audience_responses: list[str] = Field(default_factory=list)
    brand_notes: str = ""
    provider_mode: str = "auto"
    overlay_blind: bool = True


class BeatsAudioAnalyzeRequest(BaseModel):
    audio_url: str | None = None
    video_url: str | None = None


class SigLIPEmbedRequest(BaseModel):
    image_url: str


class BlackboxIngestRequest(BaseModel):
    tenant_key: str = "default"
    store_key: str
    source_system: str = "browser"
    event_name: str
    observed_at: str | None = None
    journey_id: str | None = None
    case_id: str | None = None
    status: str | None = None
    order_id: str | None = None
    checkout_attempt_id: str | None = None
    checkout_token: str | None = None
    event_id: str | None = None
    external_id: str | None = None
    fbp: str | None = None
    fbc: str | None = None
    country: str | None = None
    region: str | None = None
    ip: str | None = None
    ip_hash: str | None = None
    user_agent: str | None = None
    ua_hash: str | None = None
    page_url: str | None = None
    checkout_source: str | None = None
    checkout_button: str | None = None
    event_value: float | None = None
    currency: str | None = None
    is_begin_checkout: bool = False
    is_purchase_pixel: bool = False
    is_purchase_webhook: bool = False
    is_meta_200: bool = False
    is_shopify_order: bool = False
    is_duplicate_candidate: bool = False
    confidence_hint: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


def _normalize_store_url(raw_url: str) -> str:
    candidate = str(raw_url or "").strip()
    if not candidate:
        raise HTTPException(status_code=422, detail="store_url is required")
    if "://" not in candidate:
        candidate = f"https://{candidate}"

    parsed = urlparse(candidate)
    if not parsed.netloc and parsed.path:
        candidate = f"https://{parsed.path.lstrip('/')}"

    try:
        return str(_HTTP_URL_ADAPTER.validate_python(candidate))
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail="store_url must be a valid URL (example: https://example.com)",
        ) from exc


def _payload_store_url(*, store_url: str | None, url: str | None) -> str:
    # Backward-compatible input handling: accept `store_url` and legacy `url`.
    return _normalize_store_url(store_url or url or "")


def _clean_error_message(value: object) -> str:
    return " ".join(str(value or "").strip().split())


def _normalize_store_key(value: str | None, *, store_url: str | None = None) -> str:
    text = str(value or "").strip().lower()
    if text:
        return text
    parsed = urlparse(str(store_url or "").strip())
    hostname = str(parsed.hostname or "").strip().lower()
    if hostname:
        return hostname
    raise HTTPException(status_code=422, detail="store_key is required")


def _extract_response_error(response: requests.Response | None) -> str:
    if response is None:
        return ""

    try:
        payload = response.json()
    except Exception:
        payload = None

    if isinstance(payload, dict):
        for key in ("detail", "error_description", "error", "message"):
            candidate = payload.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return _clean_error_message(candidate)

        detail = payload.get("detail")
        if isinstance(detail, list):
            for item in detail:
                if not isinstance(item, dict):
                    continue
                msg = item.get("msg")
                if isinstance(msg, str) and msg.strip():
                    return _clean_error_message(msg)

    text = _clean_error_message(response.text)
    if text and len(text) <= 320:
        return text
    return ""


def _to_http_error(*, operation: str, exc: Exception) -> HTTPException:
    raw_message = _clean_error_message(str(exc))

    if isinstance(exc, requests.HTTPError):
        upstream = _extract_response_error(exc.response)
        message = upstream or raw_message
        if message.lower() in {"bad request", "400 bad request"}:
            message = (
                "request was rejected by an upstream provider; check request payload and provider settings"
            )

        status_code = 502
        if exc.response is not None and 400 <= exc.response.status_code < 500:
            status_code = 400
        return HTTPException(status_code=status_code, detail=f"{operation} failed: {message}")

    if isinstance(exc, requests.RequestException):
        message = raw_message or "upstream request failed"
        return HTTPException(status_code=502, detail=f"{operation} failed: {message}")

    message = raw_message or "request could not be processed"
    if message.lower() in {"bad request", "400 bad request"}:
        message = "request payload is invalid or incomplete"
    return HTTPException(status_code=400, detail=f"{operation} failed: {message}")


def _security_token(header_token: str | None, env_token: str | None, *, operation: str) -> None:
    token = str(env_token or "").strip()
    if not token:
        return
    incoming = str(header_token or "").strip()
    if not incoming or not hmac.compare_digest(incoming, token):
        raise HTTPException(status_code=401, detail=f"{operation} unauthorized")


def _max_payload_bytes() -> int:
    raw = os.getenv("BLACKBOX_MAX_PAYLOAD_BYTES", "262144").strip()
    try:
        parsed = int(raw)
    except ValueError:
        parsed = 262144
    return max(65536, min(parsed, 5 * 1024 * 1024))


def _hash_salt() -> str:
    return os.getenv("BLACKBOX_HASH_SALT", "").strip()


def _coerce_int_param(value: object, default: int) -> int:
    return value if isinstance(value, int) else default


def _coerce_bool_param(value: object, default: bool) -> bool:
    return value if isinstance(value, bool) else default


def _split_csv_list(value: str | None) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    return [item.strip() for item in text.split(",") if item.strip()]


def _to_event_input(payload: BlackboxIngestRequest, request: Request) -> EventInput:
    salt = _hash_salt()
    client_host = request.client.host if request.client else None
    country = payload.country or request.headers.get("x-geo-country") or request.headers.get("x-gclb-country")
    region = payload.region or request.headers.get("x-geo-region") or request.headers.get("x-gclb-region")
    user_agent = payload.user_agent or request.headers.get("user-agent")
    ip_hash = payload.ip_hash or hash_value(payload.ip or client_host, salt=salt)
    ua_hash = payload.ua_hash or hash_value(user_agent, salt=salt)
    payload_dict = payload.payload if isinstance(payload.payload, dict) else {}
    observed = payload.observed_at or payload_dict.get("ts") or payload_dict.get("observed_at")
    checkout_source = payload.checkout_source or payload_dict.get("checkout_source") or payload_dict.get("source")
    checkout_button = payload.checkout_button or payload_dict.get("checkout_button")
    event_value = payload.event_value
    if event_value is None:
        for key in ("value", "total_price", "amount"):
            candidate = payload_dict.get(key)
            if candidate is None:
                continue
            try:
                event_value = float(str(candidate).replace(",", "").strip())
                break
            except ValueError:
                continue
    currency = payload.currency or payload_dict.get("currency")

    return EventInput(
        tenant_key=payload.tenant_key or "default",
        store_key=payload.store_key,
        source_system=payload.source_system,
        event_name=payload.event_name,
        observed_at=str(observed or ""),
        journey_id=payload.journey_id,
        case_id=payload.case_id,
        status=payload.status,
        order_id=payload.order_id,
        checkout_attempt_id=payload.checkout_attempt_id,
        checkout_token=payload.checkout_token,
        event_id=payload.event_id,
        external_id=payload.external_id,
        fbp=payload.fbp,
        fbc=payload.fbc,
        country=country,
        region=region,
        ip_hash=ip_hash,
        ua_hash=ua_hash,
        page_url=payload.page_url,
        checkout_source=checkout_source,
        checkout_button=checkout_button,
        event_value=event_value,
        currency=currency,
        is_begin_checkout=payload.is_begin_checkout,
        is_purchase_pixel=payload.is_purchase_pixel,
        is_purchase_webhook=payload.is_purchase_webhook,
        is_meta_200=payload.is_meta_200,
        is_shopify_order=payload.is_shopify_order,
        is_duplicate_candidate=payload.is_duplicate_candidate,
        confidence_hint=payload.confidence_hint,
        payload=payload.payload,
    )


def _verify_shopify_hmac(raw_body: bytes, provided_hmac: str | None, secret: str | None) -> bool:
    shared = str(secret or "").strip()
    if not shared:
        return True
    incoming = str(provided_hmac or "").strip()
    if not incoming:
        return False
    digest = hmac.new(shared.encode("utf-8"), raw_body, sha256).digest()
    expected = base64.b64encode(digest).decode("utf-8")
    return hmac.compare_digest(expected, incoming)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze")
def analyze(payload: AnalyzeRequest) -> dict:
    try:
        normalized_store_url = _payload_store_url(
            store_url=payload.store_url,
            url=payload.url,
        )
        result = run_pipeline(
            store_url=normalized_store_url,
            max_keywords=payload.max_keywords,
            market=payload.market,
            language=payload.language,
        )
        return result.model_dump()
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise _to_http_error(operation="analysis", exc=exc) from exc


@app.get("/creative-dna/profile")
def get_creative_dna_profile(
    tenant_key: str = Query(default="default"),
    store_key: str = Query(...),
) -> dict:
    settings = load_settings()
    profile = load_creative_dna_profile(
        settings.db_path,
        tenant_key=str(tenant_key or "default").strip() or "default",
        store_key=_normalize_store_key(store_key),
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="creative dna profile not found")
    return profile.model_dump()


@app.post("/creative-dna/profile")
def refresh_creative_dna(payload: CreativeDNAProfileRequest) -> dict:
    try:
        normalized_store_url = _payload_store_url(
            store_url=payload.store_url,
            url=payload.url,
        )
        settings = load_settings()
        profile = refresh_creative_dna_profile(
            db_path=settings.db_path,
            store_url=normalized_store_url,
            tenant_key=str(payload.tenant_key or "default").strip() or "default",
            store_key=_normalize_store_key(payload.store_key, store_url=normalized_store_url),
        )
        return profile.model_dump()
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise _to_http_error(operation="creative dna refresh", exc=exc) from exc


@app.post("/creative-dna/vectorize")
def creative_dna_vectorize(payload: CreativeDNAVectorizeRequest) -> dict:
    try:
        settings = load_settings()
        normalized_store_url = ""
        if str(payload.store_url or payload.url or "").strip():
            normalized_store_url = _payload_store_url(
                store_url=payload.store_url,
                url=payload.url,
            )
        store_key = _normalize_store_key(payload.store_key, store_url=normalized_store_url)
        svg = vectorize_image_bytes(
            decode_base64_image(payload.image_base64),
            filename=payload.filename,
            preset_name=payload.preset,
        )
        result = append_vector_mark(
            db_path=settings.db_path,
            tenant_key=str(payload.tenant_key or "default").strip() or "default",
            store_key=store_key,
            store_url=normalized_store_url or None,
            mark_name=str(payload.name or "Vector Mark"),
            source_name=str(payload.filename or "upload.png"),
            svg=svg,
        )
        return result.model_dump()
    except (VectorizationUnavailableError, VectorizationTimeoutError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise _to_http_error(operation="creative dna vectorize", exc=exc) from exc


@app.post("/creative-library/ingest")
def creative_library_ingest(payload: CreativeLibraryIngestRequest) -> dict:
    try:
        settings = load_settings()
        result = ingest_creative_library_rows(
            db_path=settings.db_path,
            tenant_key=str(payload.tenant_key or "default").strip() or "default",
            store_key=_normalize_store_key(payload.store_key),
            platform=str(payload.platform or "meta").strip().lower() or "meta",
            source_system=str(payload.source_system or "meta_api").strip() or "meta_api",
            sync_label=str(payload.sync_label or "").strip(),
            rows=list(payload.rows or []),
        )
        return {"success": True, **result.model_dump()}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise _to_http_error(operation="creative library ingest", exc=exc) from exc


@app.get("/creative-library/variants")
def creative_library_variants(
    tenant_key: str = Query(default="default"),
    store_key: str = Query(...),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    include_history: bool = Query(default=False),
    history_limit: int = Query(default=30, ge=1, le=365),
) -> dict[str, Any]:
    settings = load_settings()
    items = list_creative_records(
        db_path=settings.db_path,
        tenant_key=str(tenant_key or "default").strip() or "default",
        store_key=_normalize_store_key(store_key),
        limit=_coerce_int_param(limit, 100),
        offset=_coerce_int_param(offset, 0),
        include_history=_coerce_bool_param(include_history, False),
        history_limit=_coerce_int_param(history_limit, 30),
    )
    return {"success": True, "count": len(items), "items": [item.model_dump() for item in items]}


@app.get("/creative-library/variants/{variant_id}")
def creative_library_variant_detail(
    variant_id: str,
    tenant_key: str = Query(default="default"),
    store_key: str = Query(...),
    history_limit: int = Query(default=180, ge=1, le=1000),
) -> dict[str, Any]:
    settings = load_settings()
    record = get_creative_record(
        db_path=settings.db_path,
        tenant_key=str(tenant_key or "default").strip() or "default",
        store_key=_normalize_store_key(store_key),
        variant_id=str(variant_id or "").strip(),
        history_limit=_coerce_int_param(history_limit, 180),
    )
    if record is None:
        raise HTTPException(status_code=404, detail="creative variant not found")
    return record.model_dump()


@app.post("/creative-library/meta/pull")
def creative_library_meta_pull(payload: MetaCreativePullRequest) -> dict:
    try:
        settings = load_settings()
        result = sync_meta_creatives(
            db_path=settings.db_path,
            settings=settings,
            tenant_key=str(payload.tenant_key or "default").strip() or "default",
            store_key=_normalize_store_key(payload.store_key),
            ad_account_id=str(payload.ad_account_id or "").strip() or None,
            since=str(payload.since or "").strip() or None,
            until=str(payload.until or "").strip() or None,
            time_increment=max(1, payload.time_increment),
            breakdowns=list(payload.breakdowns or ["country"]),
            countries=list(payload.countries or []),
            limit=max(1, min(payload.limit, 500)),
            sync_label=str(payload.sync_label or "").strip(),
        )
        return {"success": True, **result.model_dump()}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise _to_http_error(operation="creative library meta pull", exc=exc) from exc


@app.post("/creative-library/usa-rollup/materialize")
def creative_library_usa_rollup_materialize(payload: CreativeUsaRollupMaterializeRequest) -> dict[str, Any]:
    try:
        settings = load_settings()
        return materialize_usa_creative_rollups(
            db_path=settings.db_path,
            tenant_key=str(payload.tenant_key or "default").strip() or "default",
            store_key=_normalize_store_key(payload.store_key),
            lookback_days=max(1, min(payload.lookback_days, 365)),
            metric_keys=list(payload.metric_keys or []),
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise _to_http_error(operation="USA creative rollup materialize", exc=exc) from exc


@app.get("/creative-library/usa-rollup")
def creative_library_usa_rollup_list(
    tenant_key: str = Query(default="default"),
    store_key: str = Query(...),
    lookback_days: int = Query(default=60, ge=1, le=365),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    metric_keys: str | None = Query(default=None),
) -> dict[str, Any]:
    settings = load_settings()
    return list_usa_creative_rollups(
        db_path=settings.db_path,
        tenant_key=str(tenant_key or "default").strip() or "default",
        store_key=_normalize_store_key(store_key),
        lookback_days=_coerce_int_param(lookback_days, 60),
        limit=_coerce_int_param(limit, 100),
        offset=_coerce_int_param(offset, 0),
        metric_keys=_split_csv_list(metric_keys),
    )


@app.get("/creative-library/usa-rollup/{rollup_id}")
def creative_library_usa_rollup_detail(
    rollup_id: str,
    tenant_key: str = Query(default="default"),
    store_key: str = Query(...),
    metric_keys: str | None = Query(default=None),
) -> dict[str, Any]:
    settings = load_settings()
    detail = get_usa_creative_rollup_detail(
        db_path=settings.db_path,
        tenant_key=str(tenant_key or "default").strip() or "default",
        store_key=_normalize_store_key(store_key),
        rollup_id=str(rollup_id or "").strip(),
        metric_keys=_split_csv_list(metric_keys),
    )
    if detail is None:
        raise HTTPException(status_code=404, detail="usa creative rollup not found")
    return detail


@app.post("/serp/search")
def serp_search(payload: SerpSearchRequest) -> dict:
    try:
        settings = load_settings()
        return search_serp(
            query=payload.query,
            hl=payload.hl,
            gl=payload.gl,
            num=payload.num,
            settings=settings,
        )
    except Exception as exc:  # pragma: no cover
        raise _to_http_error(operation="serp search", exc=exc) from exc


@app.post("/google-ads/push")
def push_google_ads(payload: PushGoogleAdsRequest) -> dict:
    try:
        normalized_store_url = _payload_store_url(
            store_url=payload.store_url,
            url=payload.url,
        )
        settings = load_settings()
        result = run_pipeline(
            store_url=normalized_store_url,
            max_keywords=payload.max_keywords,
        )
        customer_id = payload.customer_id or settings.google_ads_customer_id
        if not customer_id:
            raise RuntimeError(
                "missing_customer_id:provide customer_id or GOOGLE_ADS_CUSTOMER_ID"
            )

        pusher = GoogleAdsCampaignPusher(settings=settings)
        push_result = pusher.push_campaign(
            profile=result.profile,
            ad_groups=result.ad_groups,
            customer_id=customer_id,
            campaign_name=payload.campaign_name,
            dry_run=payload.dry_run,
        )
        return {
            "push": push_result,
            "summary": {
                "keywords": len(result.keywords),
                "ad_groups": len(result.ad_groups),
                "source_status": result.source_status,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise _to_http_error(operation="google ads push", exc=exc) from exc


@app.post("/creative/overlays")
def creative_overlays(payload: CreativeOverlayRequest) -> dict:
    try:
        result = generate_reel_overlay_plan(
            reel_path=payload.reel_path,
            brand_name=payload.brand_name,
            product_name=payload.product_name,
            tone=payload.tone,
            audience=payload.audience,
            objective=payload.objective,
            language=payload.language,
            max_overlays=payload.max_overlays,
            brand_website_url=payload.brand_website_url,
            audience_responses=payload.audience_responses,
            brand_notes=payload.brand_notes,
            provider_mode=payload.provider_mode,
            overlay_blind=payload.overlay_blind,
        )
        return result.model_dump()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise _to_http_error(operation="creative overlays", exc=exc) from exc


@app.post("/signalstack/beats/audio-analyze")
def signalstack_beats_audio_analyze(payload: BeatsAudioAnalyzeRequest) -> dict[str, Any]:
    settings = load_settings()
    if not settings.beats_ready:
        raise HTTPException(status_code=503, detail="BEATs endpoint is not configured")

    try:
        result: BeatsAudioAnalysisResult = analyze_beats_audio(
            endpoint_url=settings.beats_endpoint_url,
            api_token=settings.beats_api_token,
            audio_url=payload.audio_url,
            video_url=payload.video_url,
            timeout_sec=settings.beats_timeout_sec,
        )
        return result.model_dump()
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise _to_http_error(operation="BEATs audio analysis", exc=exc) from exc


@app.post("/signalstack/firered/audio-source")
def signalstack_firered_audio_source(payload: BeatsAudioAnalyzeRequest) -> dict[str, Any]:
    settings = load_settings()
    if not settings.firered_ready:
        raise HTTPException(status_code=503, detail="FireRedVAD endpoint is not configured")

    try:
        result: FireRedAudioSourceResult = analyze_firered_audio_source(
            endpoint_url=settings.firered_endpoint_url,
            api_token=settings.firered_api_token,
            audio_url=payload.audio_url,
            video_url=payload.video_url,
            timeout_sec=settings.firered_timeout_sec,
        )
        return result.model_dump()
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise _to_http_error(operation="FireRedVAD audio source analysis", exc=exc) from exc


@app.post("/signalstack/audio-stack/analyze")
def signalstack_audio_stack_analyze(payload: BeatsAudioAnalyzeRequest) -> dict[str, Any]:
    settings = load_settings()
    if not settings.beats_ready:
        raise HTTPException(status_code=503, detail="BEATs endpoint is not configured")
    if not settings.firered_ready:
        raise HTTPException(status_code=503, detail="FireRedVAD endpoint is not configured")

    try:
        beats_result: BeatsAudioAnalysisResult = analyze_beats_audio(
            endpoint_url=settings.beats_endpoint_url,
            api_token=settings.beats_api_token,
            audio_url=payload.audio_url,
            video_url=payload.video_url,
            timeout_sec=settings.beats_timeout_sec,
        )
        firered_result: FireRedAudioSourceResult = analyze_firered_audio_source(
            endpoint_url=settings.firered_endpoint_url,
            api_token=settings.firered_api_token,
            audio_url=payload.audio_url,
            video_url=payload.video_url,
            timeout_sec=settings.firered_timeout_sec,
        )
        result = SignalStackAudioStackResult(
            audio_mood=beats_result.audio_mood,
            energy_level=beats_result.energy_level,
            voice_music_ratio=firered_result.voice_music_ratio,
            beats_model_id=beats_result.model_id,
            firered_model_id=firered_result.model_id,
            evidence={
                "beats": beats_result.evidence,
                "firered": {
                    "speech_ratio": firered_result.speech_ratio,
                    "singing_ratio": firered_result.singing_ratio,
                    "music_ratio": firered_result.music_ratio,
                    "evidence": firered_result.evidence,
                },
            },
        )
        return result.model_dump()
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise _to_http_error(operation="SignalStack audio stack analysis", exc=exc) from exc


@app.post("/signalstack/siglip/embed")
def signalstack_siglip_embed(payload: SigLIPEmbedRequest) -> dict[str, Any]:
    settings = load_settings()
    if not settings.siglip_ready:
        raise HTTPException(status_code=503, detail="SigLIP endpoint is not configured")

    try:
        result: SigLIPEmbedResult = embed_siglip_image(
            endpoint_url=settings.siglip_endpoint_url,
            api_token=settings.siglip_api_token,
            image_url=payload.image_url,
            timeout_sec=settings.siglip_timeout_sec,
        )
        return result.model_dump()
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise _to_http_error(operation="SigLIP embedding", exc=exc) from exc


@app.post("/blackbox/ingest")
async def blackbox_ingest(
    request: Request,
    token: str | None = Query(default=None),
    x_blackbox_token: str | None = Header(default=None),
) -> dict[str, Any]:
    raw_body = await request.body()
    if len(raw_body) > _max_payload_bytes():
        raise HTTPException(status_code=413, detail="ingest payload too large")

    if not raw_body:
        raise HTTPException(status_code=400, detail="missing ingest payload")

    content_type = (request.headers.get("content-type") or "").lower()
    try:
        if "application/json" in content_type:
            payload_obj = json.loads(raw_body.decode("utf-8"))
        else:
            # Supports navigator.sendBeacon/fetch no-cors text payloads from storefront JS.
            payload_obj = json.loads(raw_body.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid ingest json payload") from exc

    if not isinstance(payload_obj, dict):
        raise HTTPException(status_code=400, detail="invalid ingest payload format")

    payload = BlackboxIngestRequest.model_validate(payload_obj)
    _security_token(
        x_blackbox_token or token,
        os.getenv("BLACKBOX_INGEST_TOKEN"),
        operation="blackbox ingest",
    )
    settings = load_settings()
    result = ingest_event(settings.db_path, _to_event_input(payload, request))
    return {"success": True, "result": result}


@app.post("/blackbox/shopify/webhook")
async def blackbox_shopify_webhook(
    request: Request,
    tenant_key: str = Query(default="default"),
    store_key: str | None = Query(default=None),
    x_shopify_hmac_sha256: str | None = Header(default=None),
    x_shopify_topic: str | None = Header(default=None),
    x_shopify_shop_domain: str | None = Header(default=None),
) -> dict[str, Any]:
    raw_body = await request.body()
    if len(raw_body) > _max_payload_bytes():
        raise HTTPException(status_code=413, detail="webhook payload too large")

    webhook_secret = os.getenv("SHOPIFY_WEBHOOK_SECRET", "").strip()
    verified = _verify_shopify_hmac(raw_body, x_shopify_hmac_sha256, webhook_secret)
    if webhook_secret and not verified:
        raise HTTPException(status_code=401, detail="shopify webhook signature mismatch")

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=400, detail="invalid webhook json payload") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid webhook payload format")

    resolved_store = store_key or x_shopify_shop_domain or "unknown"
    event = build_shopify_webhook_event(
        tenant_key=tenant_key,
        store_key=resolved_store,
        order_payload=payload,
        header_topic=x_shopify_topic,
        hash_salt=_hash_salt(),
    )
    settings = load_settings()
    result = ingest_event(settings.db_path, event)
    return {
        "success": True,
        "verified": verified,
        "topic": x_shopify_topic,
        "result": result,
    }


@app.get("/blackbox/cases")
def blackbox_cases(
    tenant_key: str = Query(default="default"),
    store_key: str = Query(...),
    status: str | None = Query(default=None),
    confidence: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    settings = load_settings()
    result = list_cases(
        settings.db_path,
        CaseFilter(
            tenant_key=tenant_key,
            store_key=store_key,
            status=status,
            confidence=confidence,
            date_from=date_from,
            date_to=date_to,
            limit=limit,
            offset=offset,
        ),
    )
    return {"success": True, **result}


@app.get("/blackbox/cases/{case_id}/events")
def blackbox_case_events(
    case_id: str,
    tenant_key: str = Query(default="default"),
    store_key: str = Query(...),
    limit: int = Query(default=500, ge=1, le=5000),
) -> dict[str, Any]:
    settings = load_settings()
    events = list_case_events(
        settings.db_path,
        tenant_key=tenant_key,
        store_key=store_key,
        case_id=case_id,
        limit=limit,
    )
    return {"success": True, "items": events}


@app.get("/blackbox/overview")
def blackbox_summary(
    tenant_key: str = Query(default="default"),
    store_key: str = Query(...),
    lookback_days: int = Query(default=7, ge=1, le=90),
) -> dict[str, Any]:
    settings = load_settings()
    overview = blackbox_overview(
        settings.db_path,
        tenant_key=tenant_key,
        store_key=store_key,
        lookback_days=lookback_days,
    )
    return {"success": True, **overview}


@app.get("/blackbox/cases/export.csv")
def blackbox_cases_export_csv(
    tenant_key: str = Query(default="default"),
    store_key: str = Query(...),
    status: str | None = Query(default=None),
    confidence: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    limit: int = Query(default=5000, ge=1, le=20000),
) -> Response:
    settings = load_settings()
    result = list_cases(
        settings.db_path,
        CaseFilter(
            tenant_key=tenant_key,
            store_key=store_key,
            status=status,
            confidence=confidence,
            date_from=date_from,
            date_to=date_to,
            limit=limit,
            offset=0,
        ),
    )
    csv_body = export_cases_csv(result["items"])
    filename = f"blackbox_{store_key.replace('/', '_')}.csv"
    headers = {"Content-Disposition": f'attachment; filename=\"{filename}\"'}
    return Response(content=csv_body, media_type="text/csv", headers=headers)
