from __future__ import annotations

from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, HttpUrl, TypeAdapter, ValidationError
import requests

from .creative_overlays import generate_reel_overlay_plan
from .google_ads_push import GoogleAdsCampaignPusher
from .pipeline import run_pipeline
from .serp import search_serp
from .settings import load_settings

app = FastAPI(title="Keyword Intelligence API", version="0.1.0")
_HTTP_URL_ADAPTER = TypeAdapter(HttpUrl)


class AnalyzeRequest(BaseModel):
    store_url: str | None = None
    url: str | None = None
    max_keywords: int = 300
    market: str | None = None
    language: str | None = None


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
