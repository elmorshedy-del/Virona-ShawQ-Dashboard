from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from .models import CreativeDNAProfile


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _connect(db_path: str) -> sqlite3.Connection:
    path = Path(db_path).expanduser()
    if path.parent and not path.parent.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS creative_dna_profiles (
            tenant_key TEXT NOT NULL,
            store_key TEXT NOT NULL,
            store_url TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (tenant_key, store_key)
        )
        """
    )
    conn.commit()


def load_creative_dna_profile(
    db_path: str,
    *,
    tenant_key: str,
    store_key: str,
) -> CreativeDNAProfile | None:
    conn = _connect(db_path)
    try:
        _ensure_schema(conn)
        row = conn.execute(
            """
            SELECT payload_json
            FROM creative_dna_profiles
            WHERE tenant_key = ? AND store_key = ?
            """,
            (tenant_key, store_key),
        ).fetchone()
    finally:
        conn.close()

    if not row:
        return None
    payload = json.loads(str(row["payload_json"]))
    return CreativeDNAProfile.model_validate(payload)


def save_creative_dna_profile(db_path: str, profile: CreativeDNAProfile) -> CreativeDNAProfile:
    conn = _connect(db_path)
    try:
        _ensure_schema(conn)
        updated_profile = profile.model_copy(update={"updated_at": _utc_now_iso()})
        conn.execute(
            """
            INSERT INTO creative_dna_profiles (
                tenant_key,
                store_key,
                store_url,
                updated_at,
                payload_json
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(tenant_key, store_key)
            DO UPDATE SET
                store_url = excluded.store_url,
                updated_at = excluded.updated_at,
                payload_json = excluded.payload_json
            """,
            (
                updated_profile.tenant_key,
                updated_profile.store_key,
                updated_profile.store_url,
                updated_profile.updated_at,
                json.dumps(updated_profile.model_dump(), ensure_ascii=False),
            ),
        )
        conn.commit()
        return updated_profile
    finally:
        conn.close()
