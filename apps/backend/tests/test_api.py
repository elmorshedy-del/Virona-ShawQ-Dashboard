from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from keyword_intel import api
from keyword_intel.models import (
    CreativeDNAMark,
    CreativeDNAProfile,
    CreativeDNASavedWork,
    CreativeDNAVectorizationResult,
)
from keyword_intel.vectorize import (
    VectorizationTimeoutError,
    VectorizationUnavailableError,
)


def _stub_creative_dna_profile(
    store_url: str,
    *,
    store_key: str = "shawq.co",
) -> CreativeDNAProfile:
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


def test_creative_dna_refresh_rejects_private_store_hosts() -> None:
    with pytest.raises(HTTPException) as exc_info:
        api.refresh_creative_dna(
            api.CreativeDNAProfileRequest(store_url="http://127.0.0.1:8000")
        )

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "store_url must point to a public storefront host"


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
        lambda *args, **kwargs: (_ for _ in ()).throw(
            VectorizationUnavailableError("potrace is not installed")
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        api.creative_dna_vectorize(
            api.CreativeDNAVectorizeRequest(
                store_key="shawq.co",
                image_base64="aGVsbG8=",
            )
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "potrace is not installed"


def test_creative_dna_vectorize_returns_503_when_vectorizer_times_out(monkeypatch) -> None:
    monkeypatch.setattr(api, "load_settings", lambda: SimpleNamespace(db_path=".test.db"))
    monkeypatch.setattr(
        api,
        "vectorize_image_bytes",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            VectorizationTimeoutError("vectorization timed out")
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        api.creative_dna_vectorize(
            api.CreativeDNAVectorizeRequest(
                store_key="shawq.co",
                image_base64="aGVsbG8=",
            )
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "vectorization timed out"
