from __future__ import annotations

import ipaddress
import os
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl, TypeAdapter, ValidationError
from typing import Literal

from .creative_dna import append_vector_mark, refresh_creative_dna_profile
from .creative_dna_storage import load_creative_dna_profile
from .settings import load_settings
from .vectorize import (
    VectorizationTimeoutError,
    VectorizationUnavailableError,
    decode_base64_image,
    vectorize_image_bytes,
)


APP_TITLE = "Creative DNA API"
APP_VERSION = "0.1.0"
DEFAULT_TENANT_KEY = "default"
DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)
LOCAL_DEV_CORS_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
STORE_URL_ERROR_MESSAGE = "store_url must be a valid URL (example: https://example.com)"
UNSAFE_STORE_HOST_ERROR_MESSAGE = "store_url must point to a public storefront host"
CREATIVE_DNA_CORS_ENV_KEYS = (
    "CREATIVE_DNA_CORS_ORIGINS",
    "KEYWORD_INTEL_CORS_ORIGINS",
)
HTTP_URL_ADAPTER = TypeAdapter(HttpUrl)
LOCAL_HOSTNAMES = {"localhost", "0.0.0.0", "::1"}
LOCAL_DOMAIN_SUFFIXES = (".local", ".internal", ".lan")

app = FastAPI(title=APP_TITLE, version=APP_VERSION)


def _cors_origins() -> list[str]:
    all_origins: list[str] = list(DEFAULT_CORS_ORIGINS)
    for env_key in CREATIVE_DNA_CORS_ENV_KEYS:
        raw_value = os.getenv(env_key, "")
        if raw_value.strip():
            all_origins.extend(
                origin.strip()
                for origin in raw_value.split(",")
                if origin.strip()
            )
    return list(dict.fromkeys(all_origins))


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_origin_regex=LOCAL_DEV_CORS_REGEX,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreativeDNAProfileRequest(BaseModel):
    tenant_key: str = DEFAULT_TENANT_KEY
    store_key: str | None = None
    store_url: str | None = None
    url: str | None = None


class CreativeDNAVectorizeRequest(BaseModel):
    tenant_key: str = DEFAULT_TENANT_KEY
    store_key: str
    store_url: str | None = None
    url: str | None = None
    name: str = "Vector Mark"
    filename: str = "upload.png"
    image_base64: str
    preset: Literal["color", "monochrome"] = "color"


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
        normalized_url = str(HTTP_URL_ADAPTER.validate_python(candidate))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=STORE_URL_ERROR_MESSAGE) from exc
    if not _is_safe_public_host(urlparse(normalized_url).hostname or ""):
        raise HTTPException(status_code=422, detail=UNSAFE_STORE_HOST_ERROR_MESSAGE)
    return normalized_url


def _is_safe_public_host(hostname: str) -> bool:
    normalized_host = str(hostname or "").strip().lower()
    if not normalized_host:
        return False
    if normalized_host in LOCAL_HOSTNAMES:
        return False
    if normalized_host.endswith(LOCAL_DOMAIN_SUFFIXES):
        return False

    try:
        ip_address = ipaddress.ip_address(normalized_host)
    except ValueError:
        return True

    return not (
        ip_address.is_private
        or ip_address.is_loopback
        or ip_address.is_link_local
        or ip_address.is_multicast
        or ip_address.is_reserved
        or ip_address.is_unspecified
    )


def _payload_store_url(*, store_url: str | None, url: str | None) -> str:
    return _normalize_store_url(store_url or url or "")


def _normalize_store_key(value: str | None, *, store_url: str | None = None) -> str:
    text = str(value or "").strip().lower()
    if text:
        return text

    hostname = (urlparse(str(store_url or "").strip()).hostname or "").strip().lower()
    if hostname:
        return hostname
    raise HTTPException(status_code=422, detail="store_key is required")


def _clean_error_message(value: object) -> str:
    return " ".join(str(value or "").strip().split())


def _extract_response_error(response: requests.Response | None) -> str:
    if response is None:
        return ""

    try:
        payload = response.json()
    except requests.exceptions.JSONDecodeError:
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
                message = item.get("msg")
                if isinstance(message, str) and message.strip():
                    return _clean_error_message(message)

    text = _clean_error_message(response.text)
    if text and len(text) <= 320:
        return text
    return ""


def _to_http_error(exc: Exception, *, action: str) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc

    if isinstance(exc, requests.HTTPError):
        response = exc.response
        status_code = getattr(response, "status_code", 502) or 502
        detail = _extract_response_error(response)
        message = detail or f"{action} failed: upstream request failed"
        return HTTPException(status_code=status_code, detail=message)

    if isinstance(exc, requests.RequestException):
        message = _clean_error_message(exc) or f"{action} failed: upstream request failed"
        return HTTPException(status_code=502, detail=message)

    message = _clean_error_message(exc) or f"{action} failed"
    return HTTPException(status_code=400, detail=message)


@app.get("/health")
def health() -> dict[str, str]:
    settings = load_settings()
    return {
        "status": "ok",
        "db_path": settings.db_path,
    }


@app.get("/creative-dna/profile")
def get_creative_dna_profile(
    tenant_key: str = Query(default=DEFAULT_TENANT_KEY),
    store_key: str = Query(...),
) -> dict:
    settings = load_settings()
    profile = load_creative_dna_profile(
        settings.db_path,
        tenant_key=str(tenant_key or DEFAULT_TENANT_KEY).strip() or DEFAULT_TENANT_KEY,
        store_key=_normalize_store_key(store_key),
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="Creative DNA profile not found")
    return profile.model_dump()


@app.post("/creative-dna/profile")
def refresh_creative_dna(payload: CreativeDNAProfileRequest) -> dict:
    store_url = _payload_store_url(store_url=payload.store_url, url=payload.url)
    resolved_store_key = _normalize_store_key(payload.store_key, store_url=store_url)
    tenant_key = str(payload.tenant_key or DEFAULT_TENANT_KEY).strip() or DEFAULT_TENANT_KEY
    settings = load_settings()

    try:
        profile = refresh_creative_dna_profile(
            db_path=settings.db_path,
            store_url=store_url,
            tenant_key=tenant_key,
            store_key=resolved_store_key,
        )
    except Exception as exc:
        raise _to_http_error(exc, action="creative DNA refresh") from exc

    return profile.model_dump()


@app.post("/creative-dna/vectorize")
def creative_dna_vectorize(payload: CreativeDNAVectorizeRequest) -> dict:
    settings = load_settings()
    tenant_key = str(payload.tenant_key or DEFAULT_TENANT_KEY).strip() or DEFAULT_TENANT_KEY
    store_url = None
    if str(payload.store_url or payload.url or "").strip():
        store_url = _payload_store_url(store_url=payload.store_url, url=payload.url)

    try:
        image_bytes = decode_base64_image(payload.image_base64)
        svg = vectorize_image_bytes(
            image_bytes,
            filename=payload.filename,
            preset_name=payload.preset,
        )
        result = append_vector_mark(
            db_path=settings.db_path,
            tenant_key=tenant_key,
            store_key=_normalize_store_key(payload.store_key, store_url=store_url),
            mark_name=str(payload.name or "").strip() or "Vector Mark",
            source_name=str(payload.filename or "").strip() or "upload.png",
            svg=svg,
            store_url=store_url,
        )
    except (VectorizationUnavailableError, VectorizationTimeoutError) as exc:
        raise HTTPException(status_code=503, detail=_clean_error_message(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=_clean_error_message(exc)) from exc
    except Exception as exc:
        raise _to_http_error(exc, action="SVG conversion") from exc

    return result.model_dump()
