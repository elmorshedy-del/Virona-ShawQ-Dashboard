from __future__ import annotations

import base64
import hashlib
import hmac
import json
import asyncio
from datetime import UTC, datetime, timedelta

from keyword_intel import api
from keyword_intel.blackbox import CaseFilter, EventInput, ingest_event, list_case_events, list_cases


class _FakeClient:
    def __init__(self, host: str = "127.0.0.1") -> None:
        self.host = host


class _FakeRequest:
    def __init__(self, headers: dict[str, str] | None = None, body: bytes = b"", host: str = "127.0.0.1") -> None:
        self.headers = headers or {}
        self._body = body
        self.client = _FakeClient(host)

    async def body(self) -> bytes:
        return self._body


def test_blackbox_case_statuses(tmp_path) -> None:
    db_path = str(tmp_path / "blackbox.db")

    now = datetime.now(UTC).replace(microsecond=0)
    old = (now - timedelta(hours=2)).isoformat()

    ingest_event(
        db_path,
        EventInput(
            tenant_key="tenant_a",
            store_key="store_a",
            source_system="browser",
            event_name="begin_checkout_stape",
            observed_at=old,
            checkout_attempt_id="attempt-ghost",
            is_begin_checkout=True,
        ),
    )

    ghost_cases = list_cases(
        db_path,
        CaseFilter(tenant_key="tenant_a", store_key="store_a", status="ghost_candidate", limit=50),
    )
    assert ghost_cases["total"] == 1

    ingest_event(
        db_path,
        EventInput(
            tenant_key="tenant_a",
            store_key="store_a",
            source_system="browser",
            event_name="begin_checkout_stape",
            observed_at=now.isoformat(),
            checkout_attempt_id="attempt-dup",
            is_begin_checkout=True,
        ),
    )
    ingest_event(
        db_path,
        EventInput(
            tenant_key="tenant_a",
            store_key="store_a",
            source_system="browser",
            event_name="duplicate_candidate",
            observed_at=(now + timedelta(seconds=1)).isoformat(),
            checkout_attempt_id="attempt-dup",
            is_duplicate_candidate=True,
            is_begin_checkout=True,
        ),
    )

    dup_cases = list_cases(
        db_path,
        CaseFilter(tenant_key="tenant_a", store_key="store_a", status="duplicate_begin_checkout", limit=50),
    )
    assert dup_cases["total"] == 1
    assert dup_cases["items"][0]["duplicate_count"] >= 1

    ingest_event(
        db_path,
        EventInput(
            tenant_key="tenant_a",
            store_key="store_a",
            source_system="shopify_webhook",
            event_name="order_paid",
            observed_at=now.isoformat(),
            order_id="900001",
            is_shopify_order=True,
            is_purchase_webhook=True,
        ),
    )

    ghost_order = list_cases(
        db_path,
        CaseFilter(tenant_key="tenant_a", store_key="store_a", status="ghost_order", limit=50),
    )
    assert ghost_order["total"] == 1


def test_blackbox_api_ingest_and_list(monkeypatch, tmp_path) -> None:
    db_path = str(tmp_path / "api_blackbox.db")
    monkeypatch.setenv("KEYWORD_INTEL_DB_PATH", db_path)
    monkeypatch.setenv("BLACKBOX_INGEST_TOKEN", "token-123")

    ingest_payload = {
        "tenant_key": "tenant_a",
        "store_key": "store_a",
        "source_system": "browser",
        "event_name": "begin_checkout_stape",
        "checkout_attempt_id": "attempt-1",
        "is_begin_checkout": True,
    }
    response = asyncio.run(
        api.blackbox_ingest(
            request=_FakeRequest(
                headers={"user-agent": "pytest-agent", "content-type": "application/json"},
                body=json.dumps(ingest_payload).encode("utf-8"),
            ),
            token=None,
            x_blackbox_token="token-123",
        )
    )
    assert response["success"] is True

    payload = api.blackbox_cases(
        tenant_key="tenant_a",
        store_key="store_a",
        status=None,
        confidence=None,
        date_from=None,
        date_to=None,
        limit=100,
        offset=0,
    )
    assert payload["success"] is True
    assert payload["total"] == 1


def test_blackbox_links_order_to_checkout_by_ip_and_value(tmp_path) -> None:
    db_path = str(tmp_path / "link_match.db")
    now = datetime.now(UTC).replace(microsecond=0)

    ingest_event(
        db_path,
        EventInput(
            tenant_key="tenant_a",
            store_key="store_a",
            source_system="browser",
            event_name="begin_checkout_stape",
            observed_at=(now - timedelta(minutes=10)).isoformat(),
            checkout_attempt_id="attempt-link-1",
            checkout_source="dynamic_intent",
            checkout_button="shopify-payment-button__button",
            ip_hash="iphash-1",
            country="US",
            region="IL",
            event_value=103.99,
            currency="USD",
            is_begin_checkout=True,
        ),
    )

    response = ingest_event(
        db_path,
        EventInput(
            tenant_key="tenant_a",
            store_key="store_a",
            source_system="shopify_webhook",
            event_name="order_paid",
            observed_at=now.isoformat(),
            order_id="7263202836778",
            ip_hash="iphash-1",
            country="US",
            region="IL",
            event_value=103.99,
            currency="USD",
            is_shopify_order=True,
            is_purchase_webhook=True,
        ),
    )

    assert response["linked_case_id"] == "attempt:attempt-link-1"
    matched = list_cases(
        db_path,
        CaseFilter(tenant_key="tenant_a", store_key="store_a", limit=100),
    )
    assert matched["total"] >= 1
    row = next((item for item in matched["items"] if item["case_id"] == "attempt:attempt-link-1"), None)
    assert row is not None
    assert str(row["order_id"]) == "7263202836778"
    assert row["checkout_button"] == "shopify-payment-button__button"


def test_blackbox_observed_at_normalizes_non_iso_datetime(tmp_path) -> None:
    db_path = str(tmp_path / "time_norm.db")
    ingest_event(
        db_path,
        EventInput(
            tenant_key="tenant_a",
            store_key="store_a",
            source_system="browser",
            event_name="checkout_signal",
            observed_at="02/21/2026, 10:23:45 PM",
            checkout_source="dynamic_intent",
        ),
    )
    cases = list_cases(
        db_path,
        CaseFilter(tenant_key="tenant_a", store_key="store_a", limit=50),
    )
    assert cases["total"] == 1
    events = list_case_events(
        db_path,
        tenant_key="tenant_a",
        store_key="store_a",
        case_id=cases["items"][0]["case_id"],
        limit=50,
    )
    assert events
    assert events[0]["observed_at"].startswith("2026-02-21T22:23:45")


def test_blackbox_shopify_webhook_hmac(monkeypatch, tmp_path) -> None:
    db_path = str(tmp_path / "api_webhook.db")
    secret = "shopify-secret"

    monkeypatch.setenv("KEYWORD_INTEL_DB_PATH", db_path)
    monkeypatch.setenv("SHOPIFY_WEBHOOK_SECRET", secret)

    order_payload = {
        "id": 7263202836778,
        "checkout_token": "checkout-token-1",
        "currency": "USD",
        "total_price": "103.99",
        "financial_status": "paid",
        "line_items": [{"variant_id": 51081857466666, "quantity": 1, "price": "94.00"}],
        "client_details": {
            "browser_ip": "69.14.251.114",
            "user_agent": "Mozilla/5.0 (iPhone)",
        },
        "shipping_address": {"country_code": "US", "province_code": "IL"},
        "customer": {"id": 99887766},
    }
    raw = json.dumps(order_payload).encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).digest()
    hmac_header = base64.b64encode(digest).decode("utf-8")

    ok = asyncio.run(
        api.blackbox_shopify_webhook(
            request=_FakeRequest(
                headers={"content-type": "application/json"},
                body=raw,
                host="34.44.201.165",
            ),
            tenant_key="tenant_a",
            store_key="store_a",
            x_shopify_hmac_sha256=hmac_header,
            x_shopify_topic="orders/paid",
            x_shopify_shop_domain=None,
        )
    )
    assert ok["success"] is True

    try:
        asyncio.run(
            api.blackbox_shopify_webhook(
                request=_FakeRequest(headers={"content-type": "application/json"}, body=raw),
                tenant_key="tenant_a",
                store_key="store_a",
                x_shopify_hmac_sha256="bad-signature",
                x_shopify_topic="orders/paid",
                x_shopify_shop_domain=None,
            )
        )
    except Exception as exc:
        from fastapi import HTTPException

        assert isinstance(exc, HTTPException)
        assert exc.status_code == 401
    else:
        raise AssertionError("Expected HTTPException for invalid Shopify HMAC signature")
