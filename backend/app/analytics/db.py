from __future__ import annotations

import array
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings

log = logging.getLogger("phd_bot.analytics.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    ts_epoch INTEGER NOT NULL,
    visitor_id TEXT,
    session_id TEXT,
    ip_hash TEXT,
    question TEXT,
    embedding BLOB,
    embed_dim INTEGER,
    embed_model TEXT,
    cluster_id INTEGER,
    topic TEXT,
    top_score REAL,
    refused INTEGER NOT NULL DEFAULT 0,
    latency_ttfb_ms INTEGER,
    latency_total_ms INTEGER,
    tokens_in INTEGER,
    tokens_out INTEGER,
    tokens_estimated INTEGER NOT NULL DEFAULT 1,
    error INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    aborted INTEGER NOT NULL DEFAULT 0,
    provider TEXT,
    llm_model TEXT,
    cited_sources TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts_epoch);
CREATE INDEX IF NOT EXISTS idx_events_cluster ON events(cluster_id);
CREATE INDEX IF NOT EXISTS idx_events_refused ON events(refused);
CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(visitor_id);

CREATE TABLE IF NOT EXISTS clusters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    centroid BLOB NOT NULL,
    dim INTEGER NOT NULL,
    embed_model TEXT NOT NULL,
    canonical_question TEXT,
    topic TEXT,
    count INTEGER NOT NULL DEFAULT 1,
    created_ts TEXT NOT NULL,
    label_status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    ts TEXT NOT NULL,
    visitor_id TEXT,
    comment TEXT,
    UNIQUE(event_id, visitor_id)
);
"""


def db_path() -> Path:
    return Path(settings.ANALYTICS_DIR) / "analytics.db"


def connect() -> sqlite3.Connection:
    """Short-lived connection; WAL (set at init) makes concurrent reads safe."""
    conn = sqlite3.connect(db_path(), timeout=5.0)
    conn.execute("PRAGMA busy_timeout=5000")
    conn.row_factory = sqlite3.Row
    return conn


def now_utc() -> tuple[str, int]:
    dt = datetime.now(timezone.utc)
    return dt.isoformat(timespec="seconds"), int(dt.timestamp())


def vec_to_blob(vec: list[float]) -> bytes:
    return array.array("f", vec).tobytes()


def blob_to_vec(blob: bytes) -> list[float]:
    a = array.array("f")
    a.frombytes(blob)
    return list(a)


def init_schema() -> None:
    db_path().parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")  # persisted in the DB file
        conn.executescript(_SCHEMA)
    log.info("Analytics DB ready at %s", db_path())


# --- writes (called from background threads via asyncio.to_thread) ---


def insert_event(**fields) -> int:
    cols = ", ".join(fields)
    marks = ", ".join("?" for _ in fields)
    with connect() as conn:
        cur = conn.execute(
            f"INSERT INTO events ({cols}) VALUES ({marks})", tuple(fields.values())
        )
        return int(cur.lastrowid)


def insert_cluster(centroid: bytes, dim: int, embed_model: str) -> int:
    ts, _ = now_utc()
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO clusters (centroid, dim, embed_model, count, created_ts)"
            " VALUES (?, ?, ?, 1, ?)",
            (centroid, dim, embed_model, ts),
        )
        return int(cur.lastrowid)


def update_cluster_centroid(cluster_id: int, centroid: bytes, count: int) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE clusters SET centroid = ?, count = ? WHERE id = ?",
            (centroid, count, cluster_id),
        )


def update_cluster_label(
    cluster_id: int, canonical_question: str | None, topic: str | None, status: str
) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE clusters SET canonical_question = ?, topic = ?, label_status = ?"
            " WHERE id = ?",
            (canonical_question, topic, status, cluster_id),
        )


def record_feedback(
    event_id: int, rating: int, visitor_id: str | None, comment: str | None
) -> None:
    ts, _ = now_utc()
    with connect() as conn:
        conn.execute(
            "INSERT INTO feedback (event_id, rating, ts, visitor_id, comment)"
            " VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT(event_id, visitor_id) DO UPDATE SET"
            " rating = excluded.rating, ts = excluded.ts, comment = excluded.comment",
            (event_id, rating, ts, visitor_id, comment),
        )


# --- reads ---


def load_centroids(embed_model: str) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, centroid, dim, count FROM clusters WHERE embed_model = ?",
            (embed_model,),
        ).fetchall()
    return [
        {"id": r["id"], "vec": blob_to_vec(r["centroid"]), "count": r["count"]}
        for r in rows
    ]


def unlabeled_clusters() -> list[dict]:
    """Clusters still needing a label, each with a representative question."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT c.id, (SELECT e.question FROM events e WHERE e.cluster_id = c.id"
            "  ORDER BY e.id LIMIT 1) AS question"
            " FROM clusters c WHERE c.label_status != 'done'"
        ).fetchall()
    return [{"id": r["id"], "question": r["question"]} for r in rows if r["question"]]


def event_exists(event_id: int) -> bool:
    with connect() as conn:
        row = conn.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone()
    return row is not None
