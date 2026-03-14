from __future__ import annotations

import csv
import hashlib
import io
import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _parse_number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        value_float = float(value)
        if value_float != value_float:  # NaN
            return None
        return value_float
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        value_float = float(text)
    except ValueError:
        return None
    if value_float != value_float:  # NaN
        return None
    return value_float


def _extract_payload_value(payload: dict[str, Any] | None) -> float | None:
    if not isinstance(payload, dict):
        return None
    direct = (
        payload.get("value"),
        payload.get("total_price"),
        payload.get("amount"),
        payload.get("order_value"),
    )
    for candidate in direct:
        parsed = _parse_number(candidate)
        if parsed is not None:
            return parsed

    ecommerce = payload.get("ecommerce")
    if isinstance(ecommerce, dict):
        parsed = _parse_number(ecommerce.get("value"))
        if parsed is not None:
            return parsed

    custom_data = payload.get("custom_data")
    if isinstance(custom_data, dict):
        parsed = _parse_number(custom_data.get("value"))
        if parsed is not None:
            return parsed
    return None


def _extract_payload_currency(payload: dict[str, Any] | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    candidates = [
        payload.get("currency"),
        payload.get("presentment_currency"),
    ]
    ecommerce = payload.get("ecommerce")
    if isinstance(ecommerce, dict):
        candidates.append(ecommerce.get("currency"))
    custom_data = payload.get("custom_data")
    if isinstance(custom_data, dict):
        candidates.append(custom_data.get("currency"))
    for candidate in candidates:
        value = _clean_text(candidate, max_len=12)
        if value:
            return value
    return None


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        numeric_value = float(value)
        if numeric_value > 10_000_000_000:
            numeric_value = numeric_value / 1000.0
        try:
            return datetime.fromtimestamp(numeric_value, tz=UTC)
        except (OSError, OverflowError, ValueError):
            return None
    raw = str(value).strip()
    if not raw:
        return None

    numeric_text = raw
    if numeric_text.replace(".", "", 1).isdigit():
        parsed_numeric = _parse_number(numeric_text)
        if parsed_numeric is not None:
            seconds = parsed_numeric / 1000.0 if parsed_numeric > 10_000_000_000 else parsed_numeric
            try:
                return datetime.fromtimestamp(seconds, tz=UTC)
            except (OSError, OverflowError, ValueError):
                pass

    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    except ValueError:
        pass

    for pattern in (
        "%m/%d/%Y, %I:%M:%S %p",
        "%m/%d/%Y %I:%M:%S %p",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
    ):
        try:
            dt = datetime.strptime(raw, pattern)
            return dt.replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def _connect(db_path: str) -> sqlite3.Connection:
    path = Path(db_path).expanduser()
    if path.parent and not path.parent.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _clean_text(value: Any, max_len: int = 255) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).strip().split())
    if not text:
        return None
    return text[:max_len]


def _clean_url(value: Any, max_len: int = 2048) -> str | None:
    text = _clean_text(value, max_len=max_len)
    if not text:
        return None
    if text.startswith("http://") or text.startswith("https://"):
        return text
    return text[:max_len]


def _bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "on", "y"}


def hash_value(value: str | None, *, salt: str = "") -> str | None:
    if not value:
        return None
    raw = str(value).strip().lower()
    if not raw:
        return None
    payload = f"{salt}:{raw}" if salt else raw
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


BEGIN_CHECKOUT_NAMES = {
    "begin_checkout",
    "begin_checkout_stape",
    "checkout_started",
    "begin_checkout_emitted",
}

PURCHASE_NAMES = {
    "purchase",
    "purchase_stape",
    "checkout_completed",
    "checkout_completed_stape",
    "purchase_send_success",
}

DUPLICATE_NAMES = {
    "duplicate_candidate",
    "duplicate_suppressed",
}


@dataclass(slots=True)
class EventInput:
    tenant_key: str
    store_key: str
    source_system: str
    event_name: str
    observed_at: str
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
    ip_hash: str | None = None
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
    payload: dict[str, Any] | None = None


@dataclass(slots=True)
class CaseFilter:
    tenant_key: str
    store_key: str
    status: str | None = None
    confidence: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    limit: int = 100
    offset: int = 0


def _ensure_column(conn: sqlite3.Connection, *, table: str, definition: str) -> None:
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")
    except sqlite3.OperationalError as exc:
        message = str(exc).lower()
        if "duplicate column name" in message:
            return
        raise


def ensure_schema(db_path: str) -> None:
    conn = _connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS blackbox_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                observed_at TEXT NOT NULL,
                tenant_key TEXT NOT NULL,
                store_key TEXT NOT NULL,
                source_system TEXT NOT NULL,
                event_name TEXT NOT NULL,
                journey_id TEXT,
                case_id TEXT NOT NULL,
                status TEXT,
                order_id TEXT,
                checkout_attempt_id TEXT,
                checkout_token TEXT,
                event_id TEXT,
                external_id TEXT,
                fbp TEXT,
                fbc TEXT,
                country TEXT,
                region TEXT,
                ip_hash TEXT,
                ua_hash TEXT,
                page_url TEXT,
                checkout_source TEXT,
                checkout_button TEXT,
                event_value REAL,
                currency TEXT,
                is_begin_checkout INTEGER NOT NULL DEFAULT 0,
                is_purchase_pixel INTEGER NOT NULL DEFAULT 0,
                is_purchase_webhook INTEGER NOT NULL DEFAULT 0,
                is_meta_200 INTEGER NOT NULL DEFAULT 0,
                is_shopify_order INTEGER NOT NULL DEFAULT 0,
                is_duplicate_candidate INTEGER NOT NULL DEFAULT 0,
                confidence_hint TEXT,
                payload_json TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS blackbox_cases (
                tenant_key TEXT NOT NULL,
                store_key TEXT NOT NULL,
                case_id TEXT NOT NULL,
                journey_id TEXT,
                status TEXT NOT NULL,
                confidence TEXT NOT NULL,
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                order_id TEXT,
                checkout_attempt_id TEXT,
                checkout_token TEXT,
                checkout_source TEXT,
                checkout_button TEXT,
                signal_count INTEGER NOT NULL DEFAULT 0,
                duplicate_count INTEGER NOT NULL DEFAULT 0,
                has_begin_checkout INTEGER NOT NULL DEFAULT 0,
                has_purchase_pixel INTEGER NOT NULL DEFAULT 0,
                has_purchase_webhook INTEGER NOT NULL DEFAULT 0,
                has_meta_200 INTEGER NOT NULL DEFAULT 0,
                has_shopify_order INTEGER NOT NULL DEFAULT 0,
                external_id TEXT,
                fbp TEXT,
                fbc TEXT,
                country TEXT,
                region TEXT,
                order_value REAL,
                currency TEXT,
                ip_hash TEXT,
                ua_hash TEXT,
                notes TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (tenant_key, store_key, case_id)
            )
            """
        )

        _ensure_column(conn, table="blackbox_events", definition="checkout_button TEXT")
        _ensure_column(conn, table="blackbox_events", definition="event_value REAL")
        _ensure_column(conn, table="blackbox_events", definition="currency TEXT")
        _ensure_column(conn, table="blackbox_cases", definition="checkout_button TEXT")
        _ensure_column(conn, table="blackbox_cases", definition="order_value REAL")
        _ensure_column(conn, table="blackbox_cases", definition="currency TEXT")

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_blackbox_events_store_ts ON blackbox_events(tenant_key, store_key, observed_at DESC)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_blackbox_events_case ON blackbox_events(tenant_key, store_key, case_id, observed_at DESC)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_blackbox_cases_store_status ON blackbox_cases(tenant_key, store_key, status, last_seen_at DESC)"
        )
        conn.commit()
    finally:
        conn.close()


def _derive_journey_id(event: EventInput) -> str:
    if event.journey_id:
        return str(event.journey_id)
    if event.order_id:
        return f"order:{event.order_id}"
    if event.checkout_attempt_id:
        return f"attempt:{event.checkout_attempt_id}"
    if event.checkout_token:
        return f"checkout:{event.checkout_token}"
    if event.external_id:
        return f"external:{event.external_id}"
    if event.fbp:
        return f"fbp:{event.fbp}"
    if event.fbc:
        return f"fbc:{event.fbc}"
    if event.ip_hash and event.ua_hash:
        return f"network:{event.ip_hash[:12]}:{event.ua_hash[:12]}"
    return f"anon:{hash_value(event.event_id or _utc_now_iso()) or _utc_now_iso()}"


def _derive_case_id(event: EventInput, journey_id: str) -> str:
    if event.case_id:
        return str(event.case_id)
    if event.order_id:
        return f"order:{event.order_id}"
    if event.checkout_attempt_id:
        return f"attempt:{event.checkout_attempt_id}"
    return journey_id


def _row_payload(row: sqlite3.Row) -> dict[str, Any]:
    raw = row["payload_json"]
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    if isinstance(parsed, dict):
        return parsed
    return {}


def _row_event_value(row: sqlite3.Row) -> float | None:
    direct = _parse_number(row["event_value"])
    if direct is not None:
        return direct
    return _extract_payload_value(_row_payload(row))


def _row_currency(row: sqlite3.Row) -> str | None:
    direct = _clean_text(row["currency"], max_len=12)
    if direct:
        return direct
    return _extract_payload_currency(_row_payload(row))


def _row_is_tracking_purchase(row: sqlite3.Row) -> bool:
    if bool(row["is_purchase_pixel"]) or bool(row["is_meta_200"]):
        return True
    event_name = str(row["event_name"] or "").strip().lower()
    source_system = str(row["source_system"] or "").strip().lower()
    if "purchase" in event_name and source_system in {"gtm", "sgtm", "server", "stape", "pixel", "theme", "browser"}:
        return True
    return False


def _derive_confidence(events: list[sqlite3.Row]) -> str:
    has_order = any(row["order_id"] for row in events)
    has_attempt = any(row["checkout_attempt_id"] for row in events)
    has_external = any(row["external_id"] for row in events)
    has_markers = any(row["fbp"] or row["fbc"] for row in events)
    has_network = any(row["ip_hash"] and row["ua_hash"] for row in events)

    if has_order or has_attempt:
        return "high"
    if has_external or has_markers:
        return "medium"
    if has_network:
        return "low"
    return "low"


def _derive_case_status(events: list[sqlite3.Row], *, now: datetime) -> tuple[str, str]:
    has_begin = any(bool(row["is_begin_checkout"]) for row in events)
    has_purchase_tracking = any(_row_is_tracking_purchase(row) for row in events)
    has_purchase_webhook = any(bool(row["is_purchase_webhook"]) for row in events)
    has_order = any(bool(row["is_shopify_order"]) or row["order_id"] for row in events)
    duplicate_count = sum(1 for row in events if bool(row["is_duplicate_candidate"]))

    last_ts = _parse_iso(str(events[-1]["observed_at"]))
    age_sec = int((now - last_ts).total_seconds()) if last_ts else 0

    if has_order and has_purchase_webhook and has_purchase_tracking:
        return "full_success", "order + webhook + conversion signal present"
    if has_order and not has_purchase_tracking:
        return "ghost_order", "shopify order exists but no pixel/gtm purchase coverage"
    if has_order and not has_purchase_webhook and has_purchase_tracking:
        return "pixel_only", "order tracked only by pixel/server conversion"
    if has_begin and not has_order and age_sec >= 1800:
        return "ghost_candidate", "checkout started but no order after 30m"
    if duplicate_count > 0:
        return "duplicate_begin_checkout", "duplicate begin_checkout candidates observed"
    if has_begin and not has_order:
        return "in_progress", "checkout activity observed"
    return "observed", "signals captured"


def _pick_last(events: list[sqlite3.Row], field: str) -> str | None:
    for row in reversed(events):
        value = _clean_text(row[field], max_len=512)
        if value:
            return value
    return None


def _pick_first(events: list[sqlite3.Row], field: str) -> str | None:
    for row in events:
        value = _clean_text(row[field], max_len=512)
        if value:
            return value
    return None


def _pick_last_value(events: list[sqlite3.Row]) -> float | None:
    for row in reversed(events):
        value = _row_event_value(row)
        if value is not None:
            return value
    return None


def _delete_case_if_empty(conn: sqlite3.Connection, *, tenant_key: str, store_key: str, case_id: str) -> None:
    still_has_events = conn.execute(
        """
        SELECT 1
        FROM blackbox_events
        WHERE tenant_key = ? AND store_key = ? AND case_id = ?
        LIMIT 1
        """,
        (tenant_key, store_key, case_id),
    ).fetchone()
    if still_has_events:
        return
    conn.execute(
        """
        DELETE FROM blackbox_cases
        WHERE tenant_key = ? AND store_key = ? AND case_id = ?
        """,
        (tenant_key, store_key, case_id),
    )


def _find_order_link_candidate(
    conn: sqlite3.Connection,
    *,
    tenant_key: str,
    store_key: str,
    order_event_id: int,
    observed_at: str,
    checkout_token: str | None,
    external_id: str | None,
    fbp: str | None,
    fbc: str | None,
    ip_hash: str | None,
    country: str | None,
    region: str | None,
    order_value: float | None,
) -> dict[str, Any] | None:
    observed_dt = _parse_iso(observed_at)
    if not observed_dt:
        observed_dt = datetime.now(UTC)
    since = (observed_dt - timedelta(days=7)).replace(microsecond=0).isoformat()

    candidates = conn.execute(
        """
        SELECT *
        FROM blackbox_events
        WHERE tenant_key = ?
          AND store_key = ?
          AND id != ?
          AND observed_at >= ?
          AND (
            is_begin_checkout = 1
            OR lower(event_name) IN ('checkout_signal', 'begin_checkout_emitted', 'add_to_cart', 'add_to_cart_stape')
          )
        ORDER BY observed_at DESC, id DESC
        LIMIT 1200
        """,
        (tenant_key, store_key, order_event_id, since),
    ).fetchall()

    if not candidates:
        return None

    best: dict[str, Any] | None = None
    for row in candidates:
        row_case_id = _clean_text(row["case_id"], max_len=255)
        if not row_case_id:
            continue
        score = 0
        reasons: list[str] = []
        row_observed = _parse_iso(_clean_text(row["observed_at"], max_len=64))
        if row_observed:
            diff_seconds = abs(int((observed_dt - row_observed).total_seconds()))
            if diff_seconds <= 1800:
                score += 25
                reasons.append("time<=30m")
            elif diff_seconds <= 6 * 3600:
                score += 15
                reasons.append("time<=6h")
            elif diff_seconds <= 48 * 3600:
                score += 8
                reasons.append("time<=48h")
        else:
            diff_seconds = None

        row_checkout_token = _clean_text(row["checkout_token"], max_len=160)
        if checkout_token and row_checkout_token and checkout_token == row_checkout_token:
            score += 140
            reasons.append("checkout_token")

        row_external = _clean_text(row["external_id"], max_len=180)
        if external_id and row_external and external_id == row_external:
            score += 80
            reasons.append("external_id")

        row_fbp = _clean_text(row["fbp"], max_len=180)
        if fbp and row_fbp and fbp == row_fbp:
            score += 42
            reasons.append("fbp")

        row_fbc = _clean_text(row["fbc"], max_len=300)
        if fbc and row_fbc and fbc == row_fbc:
            score += 42
            reasons.append("fbc")

        row_ip_hash = _clean_text(row["ip_hash"], max_len=128)
        if ip_hash and row_ip_hash and ip_hash == row_ip_hash:
            score += 70
            reasons.append("ip_hash")

        row_country = _clean_text(row["country"], max_len=6)
        row_region = _clean_text(row["region"], max_len=64)
        if country and row_country and country == row_country:
            score += 12
            reasons.append("country")
        if region and row_region and region == row_region:
            score += 10
            reasons.append("region")

        row_value = _row_event_value(row)
        if order_value is not None and row_value is not None:
            delta = abs(order_value - row_value)
            if delta <= 0.01:
                score += 45
                reasons.append("value_exact")
            elif delta <= 1.5:
                score += 20
                reasons.append("value_close")

        if not reasons:
            continue

        confidence_gate = False
        if "checkout_token" in reasons or "external_id" in reasons:
            confidence_gate = True
        elif "ip_hash" in reasons and ("value_exact" in reasons or "value_close" in reasons):
            confidence_gate = True
        elif "ip_hash" in reasons and "country" in reasons and (diff_seconds is not None and diff_seconds <= 12 * 3600):
            confidence_gate = True

        if not confidence_gate:
            continue

        if score < 90:
            continue

        current = {
            "case_id": row_case_id,
            "journey_id": _clean_text(row["journey_id"], max_len=255),
            "checkout_attempt_id": _clean_text(row["checkout_attempt_id"], max_len=120),
            "checkout_source": _clean_text(row["checkout_source"], max_len=120),
            "checkout_button": _clean_text(row["checkout_button"], max_len=120),
            "score": score,
            "match_reasons": reasons,
        }
        if best is None or score > best["score"]:
            best = current

    return best


def _update_case(conn: sqlite3.Connection, *, tenant_key: str, store_key: str, case_id: str) -> dict[str, Any]:
    rows = conn.execute(
        """
        SELECT *
        FROM blackbox_events
        WHERE tenant_key = ? AND store_key = ? AND case_id = ?
        ORDER BY observed_at ASC, id ASC
        """,
        (tenant_key, store_key, case_id),
    ).fetchall()

    if not rows:
        return {}

    now = datetime.now(UTC)
    status, notes = _derive_case_status(rows, now=now)
    confidence = _derive_confidence(rows)

    first_seen = _clean_text(rows[0]["observed_at"], max_len=64) or _utc_now_iso()
    last_seen = _clean_text(rows[-1]["observed_at"], max_len=64) or first_seen
    signal_count = len(rows)
    duplicate_count = sum(1 for row in rows if bool(row["is_duplicate_candidate"]))

    payload = {
        "tenant_key": tenant_key,
        "store_key": store_key,
        "case_id": case_id,
        "journey_id": _pick_first(rows, "journey_id"),
        "status": status,
        "confidence": confidence,
        "first_seen_at": first_seen,
        "last_seen_at": last_seen,
        "order_id": _pick_last(rows, "order_id"),
        "checkout_attempt_id": _pick_last(rows, "checkout_attempt_id"),
        "checkout_token": _pick_last(rows, "checkout_token"),
        "checkout_source": _pick_last(rows, "checkout_source"),
        "checkout_button": _pick_last(rows, "checkout_button"),
        "signal_count": signal_count,
        "duplicate_count": duplicate_count,
        "has_begin_checkout": 1 if any(bool(row["is_begin_checkout"]) for row in rows) else 0,
        "has_purchase_pixel": 1 if any(bool(row["is_purchase_pixel"]) for row in rows) else 0,
        "has_purchase_webhook": 1 if any(bool(row["is_purchase_webhook"]) for row in rows) else 0,
        "has_meta_200": 1 if any(bool(row["is_meta_200"]) for row in rows) else 0,
        "has_shopify_order": 1 if any(bool(row["is_shopify_order"]) or row["order_id"] for row in rows) else 0,
        "order_value": _pick_last_value(rows),
        "currency": _pick_last(rows, "currency") or _row_currency(rows[-1]),
        "external_id": _pick_last(rows, "external_id"),
        "fbp": _pick_last(rows, "fbp"),
        "fbc": _pick_last(rows, "fbc"),
        "country": _pick_last(rows, "country"),
        "region": _pick_last(rows, "region"),
        "ip_hash": _pick_last(rows, "ip_hash"),
        "ua_hash": _pick_last(rows, "ua_hash"),
        "notes": notes,
        "updated_at": _utc_now_iso(),
    }

    conn.execute(
        """
        INSERT INTO blackbox_cases (
            tenant_key, store_key, case_id, journey_id, status, confidence,
            first_seen_at, last_seen_at, order_id, checkout_attempt_id, checkout_token,
            checkout_source, checkout_button, signal_count, duplicate_count,
            has_begin_checkout, has_purchase_pixel, has_purchase_webhook, has_meta_200, has_shopify_order,
            order_value, currency, external_id, fbp, fbc, country, region, ip_hash, ua_hash,
            notes, updated_at
        ) VALUES (
            :tenant_key, :store_key, :case_id, :journey_id, :status, :confidence,
            :first_seen_at, :last_seen_at, :order_id, :checkout_attempt_id, :checkout_token,
            :checkout_source, :checkout_button, :signal_count, :duplicate_count,
            :has_begin_checkout, :has_purchase_pixel, :has_purchase_webhook, :has_meta_200, :has_shopify_order,
            :order_value, :currency, :external_id, :fbp, :fbc, :country, :region, :ip_hash, :ua_hash,
            :notes, :updated_at
        )
        ON CONFLICT(tenant_key, store_key, case_id) DO UPDATE SET
            journey_id = excluded.journey_id,
            status = excluded.status,
            confidence = excluded.confidence,
            first_seen_at = excluded.first_seen_at,
            last_seen_at = excluded.last_seen_at,
            order_id = excluded.order_id,
            checkout_attempt_id = excluded.checkout_attempt_id,
            checkout_token = excluded.checkout_token,
            checkout_source = excluded.checkout_source,
            checkout_button = excluded.checkout_button,
            signal_count = excluded.signal_count,
            duplicate_count = excluded.duplicate_count,
            has_begin_checkout = excluded.has_begin_checkout,
            has_purchase_pixel = excluded.has_purchase_pixel,
            has_purchase_webhook = excluded.has_purchase_webhook,
            has_meta_200 = excluded.has_meta_200,
            has_shopify_order = excluded.has_shopify_order,
            order_value = excluded.order_value,
            currency = excluded.currency,
            external_id = excluded.external_id,
            fbp = excluded.fbp,
            fbc = excluded.fbc,
            country = excluded.country,
            region = excluded.region,
            ip_hash = excluded.ip_hash,
            ua_hash = excluded.ua_hash,
            notes = excluded.notes,
            updated_at = excluded.updated_at
        """,
        payload,
    )

    return payload


def ingest_event(db_path: str, event: EventInput) -> dict[str, Any]:
    ensure_schema(db_path)
    conn = _connect(db_path)
    try:
        journey_id = _derive_journey_id(event)
        case_id = _derive_case_id(event, journey_id)

        observed_dt = _parse_iso(event.observed_at)
        observed_at = (observed_dt or datetime.now(UTC)).replace(microsecond=0).isoformat()

        lower_name = (event.event_name or "").strip().lower()
        row = {
            "created_at": _utc_now_iso(),
            "observed_at": observed_at,
            "tenant_key": _clean_text(event.tenant_key, max_len=80) or "default",
            "store_key": _clean_text(event.store_key, max_len=120) or "unknown",
            "source_system": _clean_text(event.source_system, max_len=80) or "unknown",
            "event_name": _clean_text(event.event_name, max_len=120) or "unknown",
            "journey_id": _clean_text(journey_id, max_len=255),
            "case_id": _clean_text(case_id, max_len=255) or journey_id,
            "status": _clean_text(event.status, max_len=80),
            "order_id": _clean_text(event.order_id, max_len=120),
            "checkout_attempt_id": _clean_text(event.checkout_attempt_id, max_len=120),
            "checkout_token": _clean_text(event.checkout_token, max_len=160),
            "event_id": _clean_text(event.event_id, max_len=160),
            "external_id": _clean_text(event.external_id, max_len=180),
            "fbp": _clean_text(event.fbp, max_len=180),
            "fbc": _clean_text(event.fbc, max_len=300),
            "country": _clean_text(event.country, max_len=6),
            "region": _clean_text(event.region, max_len=64),
            "ip_hash": _clean_text(event.ip_hash, max_len=128),
            "ua_hash": _clean_text(event.ua_hash, max_len=128),
            "page_url": _clean_url(event.page_url),
            "checkout_source": _clean_text(event.checkout_source, max_len=120),
            "checkout_button": _clean_text(event.checkout_button, max_len=120),
            "event_value": _parse_number(event.event_value),
            "currency": _clean_text(event.currency, max_len=12),
            "is_begin_checkout": 1 if (event.is_begin_checkout or lower_name in BEGIN_CHECKOUT_NAMES) else 0,
            "is_purchase_pixel": 1 if (event.is_purchase_pixel or ("purchase" in lower_name and event.source_system in {"theme", "pixel", "browser"})) else 0,
            "is_purchase_webhook": 1 if (event.is_purchase_webhook or event.source_system == "shopify_webhook") else 0,
            "is_meta_200": 1 if event.is_meta_200 else 0,
            "is_shopify_order": 1 if (event.is_shopify_order or event.source_system == "shopify_webhook") else 0,
            "is_duplicate_candidate": 1 if (event.is_duplicate_candidate or lower_name in DUPLICATE_NAMES) else 0,
            "confidence_hint": _clean_text(event.confidence_hint, max_len=40),
            "payload_json": json.dumps(event.payload or {}, ensure_ascii=False),
        }

        if row["event_value"] is None:
            row["event_value"] = _extract_payload_value(event.payload)
        if not row["currency"]:
            row["currency"] = _extract_payload_currency(event.payload)

        cursor = conn.execute(
            """
            INSERT INTO blackbox_events (
                created_at, observed_at, tenant_key, store_key, source_system, event_name,
                journey_id, case_id, status, order_id, checkout_attempt_id, checkout_token,
                event_id, external_id, fbp, fbc, country, region, ip_hash, ua_hash,
                page_url, checkout_source, checkout_button, event_value, currency,
                is_begin_checkout, is_purchase_pixel, is_purchase_webhook, is_meta_200,
                is_shopify_order, is_duplicate_candidate,
                confidence_hint, payload_json
            ) VALUES (
                :created_at, :observed_at, :tenant_key, :store_key, :source_system, :event_name,
                :journey_id, :case_id, :status, :order_id, :checkout_attempt_id, :checkout_token,
                :event_id, :external_id, :fbp, :fbc, :country, :region, :ip_hash, :ua_hash,
                :page_url, :checkout_source, :checkout_button, :event_value, :currency,
                :is_begin_checkout, :is_purchase_pixel, :is_purchase_webhook, :is_meta_200,
                :is_shopify_order, :is_duplicate_candidate,
                :confidence_hint, :payload_json
            )
            """,
            row,
        )

        linked_case_id: str | None = None
        match_reasons: list[str] = []
        linked_confidence = "none"
        original_case_id = row["case_id"]
        if row["source_system"] == "shopify_webhook" and row["order_id"]:
            match = _find_order_link_candidate(
                conn,
                tenant_key=row["tenant_key"],
                store_key=row["store_key"],
                order_event_id=int(cursor.lastrowid),
                observed_at=row["observed_at"],
                checkout_token=row["checkout_token"],
                external_id=row["external_id"],
                fbp=row["fbp"],
                fbc=row["fbc"],
                ip_hash=row["ip_hash"],
                country=row["country"],
                region=row["region"],
                order_value=_parse_number(row["event_value"]),
            )
            if match and match.get("case_id") and match["case_id"] != row["case_id"]:
                linked_case_id = match["case_id"]
                match_reasons = list(match.get("match_reasons") or [])
                if "checkout_token" in match_reasons or "external_id" in match_reasons:
                    linked_confidence = "high"
                elif "ip_hash" in match_reasons and ("value_exact" in match_reasons or "value_close" in match_reasons):
                    linked_confidence = "high"
                else:
                    linked_confidence = "medium"

                row["case_id"] = linked_case_id
                if match.get("journey_id"):
                    row["journey_id"] = match["journey_id"]
                if not row["checkout_attempt_id"] and match.get("checkout_attempt_id"):
                    row["checkout_attempt_id"] = match["checkout_attempt_id"]
                if not row["checkout_source"] and match.get("checkout_source"):
                    row["checkout_source"] = match["checkout_source"]
                if not row["checkout_button"] and match.get("checkout_button"):
                    row["checkout_button"] = match["checkout_button"]

                payload_obj = event.payload or {}
                if isinstance(payload_obj, dict):
                    payload_obj = dict(payload_obj)
                    payload_obj["linked_case_id"] = linked_case_id
                    payload_obj["match_reasons"] = match_reasons
                    payload_obj["match_confidence"] = linked_confidence
                row["payload_json"] = json.dumps(payload_obj, ensure_ascii=False)

                conn.execute(
                    """
                    UPDATE blackbox_events
                    SET case_id = ?, journey_id = ?, checkout_attempt_id = ?, checkout_source = ?, checkout_button = ?, payload_json = ?
                    WHERE id = ?
                    """,
                    (
                        row["case_id"],
                        row["journey_id"],
                        row["checkout_attempt_id"],
                        row["checkout_source"],
                        row["checkout_button"],
                        row["payload_json"],
                        int(cursor.lastrowid),
                    ),
                )
                _delete_case_if_empty(
                    conn,
                    tenant_key=row["tenant_key"],
                    store_key=row["store_key"],
                    case_id=original_case_id,
                )

        case_payload = _update_case(
            conn,
            tenant_key=row["tenant_key"],
            store_key=row["store_key"],
            case_id=row["case_id"],
        )
        conn.commit()

        return {
            "event_id": int(cursor.lastrowid),
            "case": case_payload,
            "linked_case_id": linked_case_id,
            "match_reasons": match_reasons,
            "match_confidence": linked_confidence,
        }
    finally:
        conn.close()


def list_cases(db_path: str, filters: CaseFilter) -> dict[str, Any]:
    ensure_schema(db_path)
    conn = _connect(db_path)
    try:
        where = ["tenant_key = ?", "store_key = ?"]
        params: list[Any] = [filters.tenant_key, filters.store_key]

        if filters.status:
            where.append("status = ?")
            params.append(filters.status)
        if filters.confidence:
            where.append("confidence = ?")
            params.append(filters.confidence)
        if filters.date_from:
            where.append("last_seen_at >= ?")
            params.append(filters.date_from)
        if filters.date_to:
            where.append("last_seen_at <= ?")
            params.append(filters.date_to)

        where_sql = " AND ".join(where)

        total = conn.execute(
            f"SELECT COUNT(*) AS c FROM blackbox_cases WHERE {where_sql}",
            params,
        ).fetchone()["c"]

        rows = conn.execute(
            f"""
            SELECT *
            FROM blackbox_cases
            WHERE {where_sql}
            ORDER BY last_seen_at DESC
            LIMIT ? OFFSET ?
            """,
            params + [max(1, min(filters.limit, 1000)), max(0, filters.offset)],
        ).fetchall()

        items = [dict(row) for row in rows]
        return {
            "total": int(total),
            "items": items,
        }
    finally:
        conn.close()


def list_case_events(
    db_path: str,
    *,
    tenant_key: str,
    store_key: str,
    case_id: str,
    limit: int = 500,
) -> list[dict[str, Any]]:
    ensure_schema(db_path)
    conn = _connect(db_path)
    try:
        rows = conn.execute(
            """
            SELECT *
            FROM blackbox_events
            WHERE tenant_key = ? AND store_key = ? AND case_id = ?
            ORDER BY observed_at ASC, id ASC
            LIMIT ?
            """,
            (tenant_key, store_key, case_id, max(1, min(limit, 5000))),
        ).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            payload_raw = item.get("payload_json")
            try:
                item["payload"] = json.loads(payload_raw) if payload_raw else {}
            except Exception:
                item["payload"] = {}
            item.pop("payload_json", None)
            items.append(item)
        return items
    finally:
        conn.close()


def blackbox_overview(
    db_path: str,
    *,
    tenant_key: str,
    store_key: str,
    lookback_days: int = 7,
) -> dict[str, Any]:
    ensure_schema(db_path)
    conn = _connect(db_path)
    try:
        since = (datetime.now(UTC) - timedelta(days=max(1, min(lookback_days, 90)))).replace(microsecond=0).isoformat()
        rows = conn.execute(
            """
            SELECT status, COUNT(*) AS count
            FROM blackbox_cases
            WHERE tenant_key = ? AND store_key = ? AND last_seen_at >= ?
            GROUP BY status
            ORDER BY count DESC
            """,
            (tenant_key, store_key, since),
        ).fetchall()
        counts = {str(row["status"]): int(row["count"]) for row in rows}
        total = sum(counts.values())

        return {
            "lookback_days": lookback_days,
            "since": since,
            "total_cases": total,
            "status_counts": counts,
        }
    finally:
        conn.close()


def export_cases_csv(rows: list[dict[str, Any]]) -> str:
    output = io.StringIO()
    fields = [
        "tenant_key",
        "store_key",
        "case_id",
        "journey_id",
        "status",
        "confidence",
        "first_seen_at",
        "last_seen_at",
        "order_id",
        "order_value",
        "currency",
        "checkout_attempt_id",
        "checkout_token",
        "checkout_source",
        "checkout_button",
        "signal_count",
        "duplicate_count",
        "has_begin_checkout",
        "has_purchase_pixel",
        "has_purchase_webhook",
        "has_meta_200",
        "has_shopify_order",
        "external_id",
        "fbp",
        "fbc",
        "country",
        "region",
        "ip_hash",
        "ua_hash",
        "notes",
        "updated_at",
    ]
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        writer.writerow({k: row.get(k) for k in fields})
    return output.getvalue()


def build_shopify_webhook_event(
    *,
    tenant_key: str,
    store_key: str,
    order_payload: dict[str, Any],
    header_topic: str | None,
    hash_salt: str,
) -> EventInput:
    line_items = order_payload.get("line_items") if isinstance(order_payload.get("line_items"), list) else []
    quantity_sum = 0
    for item in line_items:
        if not isinstance(item, dict):
            continue
        try:
            quantity_sum += int(item.get("quantity") or 0)
        except (TypeError, ValueError):
            pass

    order_id = _clean_text(order_payload.get("id"), max_len=120)
    checkout_token = _clean_text(order_payload.get("checkout_token"), max_len=160)
    customer = order_payload.get("customer") if isinstance(order_payload.get("customer"), dict) else {}
    client_details = order_payload.get("client_details") if isinstance(order_payload.get("client_details"), dict) else {}
    shipping = order_payload.get("shipping_address") if isinstance(order_payload.get("shipping_address"), dict) else {}
    billing = order_payload.get("billing_address") if isinstance(order_payload.get("billing_address"), dict) else {}

    browser_ip = _clean_text(
        client_details.get("browser_ip") or order_payload.get("browser_ip"),
        max_len=128,
    )
    user_agent = _clean_text(client_details.get("user_agent"), max_len=400)
    currency = _clean_text(
        order_payload.get("currency") or order_payload.get("presentment_currency"),
        max_len=12,
    )
    total_price = _clean_text(order_payload.get("total_price"), max_len=40)
    order_value = _parse_number(total_price)
    country = _clean_text(
        shipping.get("country_code")
        or billing.get("country_code")
        or shipping.get("country")
        or billing.get("country"),
        max_len=8,
    )
    region = _clean_text(
        shipping.get("province_code")
        or shipping.get("province")
        or billing.get("province_code")
        or billing.get("province"),
        max_len=64,
    )

    event_name = "order_paid" if str(header_topic or "").strip().lower() == "orders/paid" else "order_webhook"

    return EventInput(
        tenant_key=tenant_key,
        store_key=store_key,
        source_system="shopify_webhook",
        event_name=event_name,
        observed_at=_utc_now_iso(),
        order_id=order_id,
        checkout_token=checkout_token,
        journey_id=f"order:{order_id}" if order_id else None,
        case_id=f"order:{order_id}" if order_id else None,
        external_id=_clean_text(customer.get("id"), max_len=180),
        fbp=_clean_text(order_payload.get("fbp"), max_len=180),
        fbc=_clean_text(order_payload.get("fbc"), max_len=300),
        country=country,
        region=region,
        ip_hash=hash_value(browser_ip, salt=hash_salt),
        ua_hash=hash_value(user_agent, salt=hash_salt),
        checkout_source="shopify_orders_webhook",
        event_value=order_value,
        currency=currency,
        is_purchase_webhook=True,
        is_shopify_order=True,
        payload={
            "topic": header_topic,
            "order_id": order_id,
            "checkout_token": checkout_token,
            "currency": currency,
            "value": order_value,
            "total_price": total_price,
            "financial_status": _clean_text(order_payload.get("financial_status"), max_len=40),
            "line_items_count": len(line_items),
            "num_items": quantity_sum,
            "browser_ip_present": bool(browser_ip),
            "user_agent_present": bool(user_agent),
        },
    )
