from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from .models import CompetitorIntelligence, KeywordMetric, StoreProfile


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
        CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            store_url TEXT NOT NULL,
            store_domain TEXT NOT NULL,
            profile_json TEXT NOT NULL,
            source_status_json TEXT NOT NULL,
            competitor_json TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS run_keywords (
            run_id INTEGER NOT NULL,
            keyword TEXT NOT NULL,
            score REAL NOT NULL,
            confidence REAL NOT NULL,
            volume INTEGER NOT NULL,
            cpc REAL NOT NULL,
            competition_index REAL NOT NULL,
            trend_direction TEXT NOT NULL,
            hidden_gem INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (run_id, keyword)
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_runs_store_domain ON runs(store_domain, id DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_keywords_run_score ON run_keywords(run_id, score DESC)"
    )
    conn.commit()


def _latest_run_id_for_domain(conn: sqlite3.Connection, store_domain: str) -> int | None:
    row = conn.execute(
        """
        SELECT id
        FROM runs
        WHERE store_domain = ?
        ORDER BY id DESC
        LIMIT 1
        """,
        (store_domain,),
    ).fetchone()
    if not row:
        return None
    return int(row["id"])


def load_run_keywords(db_path: str, run_id: int) -> dict[str, KeywordMetric]:
    conn = _connect(db_path)
    try:
        _ensure_schema(conn)
        rows = conn.execute(
            """
            SELECT payload_json
            FROM run_keywords
            WHERE run_id = ?
            """,
            (run_id,),
        ).fetchall()
    finally:
        conn.close()
    payloads = [json.loads(str(row["payload_json"])) for row in rows]
    return {
        item["keyword"]: KeywordMetric.model_validate(item)
        for item in payloads
        if isinstance(item, dict) and item.get("keyword")
    }


def persist_run(
    *,
    db_path: str,
    profile: StoreProfile,
    keywords: list[KeywordMetric],
    source_status: dict[str, str],
    competitor_intelligence: CompetitorIntelligence | None,
) -> tuple[int, int | None]:
    conn = _connect(db_path)
    try:
        _ensure_schema(conn)
        store_domain = profile.url.split("://")[-1].split("/")[0].lower()
        previous_run_id = _latest_run_id_for_domain(conn, store_domain)

        cursor = conn.execute(
            """
            INSERT INTO runs (
                created_at,
                store_url,
                store_domain,
                profile_json,
                source_status_json,
                competitor_json
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                _utc_now_iso(),
                profile.url,
                store_domain,
                json.dumps(profile.model_dump(), ensure_ascii=False),
                json.dumps(source_status, ensure_ascii=False),
                json.dumps(
                    (competitor_intelligence or CompetitorIntelligence()).model_dump(),
                    ensure_ascii=False,
                ),
            ),
        )
        run_id = int(cursor.lastrowid)

        conn.executemany(
            """
            INSERT INTO run_keywords (
                run_id,
                keyword,
                score,
                confidence,
                volume,
                cpc,
                competition_index,
                trend_direction,
                hidden_gem,
                payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    run_id,
                    metric.keyword,
                    metric.score,
                    metric.confidence,
                    metric.volume,
                    metric.cpc,
                    metric.competition_index,
                    metric.trend_direction,
                    1 if metric.hidden_gem else 0,
                    json.dumps(metric.model_dump(), ensure_ascii=False),
                )
                for metric in keywords
            ],
        )
        conn.commit()
        return run_id, previous_run_id
    finally:
        conn.close()
