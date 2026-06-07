from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Query

from app.analytics import db
from app.analytics.cost import estimate_cost_usd
from app.config import settings
from app.deps import require_admin

router = APIRouter(prefix="/analytics", dependencies=[Depends(require_admin)])

# All handlers are sync `def` on purpose: FastAPI runs them in its threadpool,
# so the blocking sqlite3 reads never touch the event loop serving chat SSE.


def _range(from_: int | None, to: int | None) -> tuple[int, int]:
    now = int(time.time())
    return from_ if from_ is not None else now - 30 * 86400, to if to is not None else now


def _pct(sorted_vals: list, p: float):
    if not sorted_vals:
        return None
    idx = min(len(sorted_vals) - 1, round(p / 100 * (len(sorted_vals) - 1)))
    return sorted_vals[idx]


@router.get("/overview")
def overview(
    from_: int | None = Query(None, alias="from"), to: int | None = Query(None)
) -> dict:
    f, t = _range(from_, to)
    with db.connect() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS total,
                   COUNT(DISTINCT COALESCE(visitor_id, ip_hash)) AS visitors,
                   COUNT(DISTINCT session_id) AS sessions,
                   AVG(refused) AS refusal_rate,
                   AVG(CASE WHEN refused = 0 THEN top_score END) AS avg_top_score,
                   AVG(error) AS error_rate,
                   SUM(aborted) AS aborted
            FROM events WHERE ts_epoch BETWEEN ? AND ?
            """,
            (f, t),
        ).fetchone()
        nv = conn.execute(
            """
            SELECT SUM(first_seen >= ?) AS new_v, SUM(first_seen < ?) AS ret_v
            FROM (SELECT COALESCE(visitor_id, ip_hash) AS vid,
                         MIN(ts_epoch) AS first_seen, MAX(ts_epoch) AS last_seen
                  FROM events WHERE COALESCE(visitor_id, ip_hash) IS NOT NULL
                  GROUP BY vid)
            WHERE last_seen >= ? AND first_seen <= ?
            """,
            (f, f, f, t),
        ).fetchone()
        cost_rows = conn.execute(
            "SELECT llm_model, SUM(tokens_in) ti, SUM(tokens_out) tout"
            " FROM events WHERE ts_epoch BETWEEN ? AND ? GROUP BY llm_model",
            (f, t),
        ).fetchall()
        fb = conn.execute(
            "SELECT SUM(fb.rating = 1) AS up, SUM(fb.rating = -1) AS down"
            " FROM feedback fb JOIN events e ON e.id = fb.event_id"
            " WHERE e.ts_epoch BETWEEN ? AND ?",
            (f, t),
        ).fetchone()
    total = row["total"] or 0
    sessions = row["sessions"] or 0
    cost = sum(estimate_cost_usd(r["llm_model"], r["ti"], r["tout"]) for r in cost_rows)
    days = max(1, (t - f) / 86400)
    return {
        "from": f,
        "to": t,
        "total_queries": total,
        "unique_visitors": row["visitors"] or 0,
        "unique_sessions": sessions,
        "avg_queries_per_session": round(total / sessions, 2) if sessions else 0,
        "new_visitors": nv["new_v"] or 0,
        "returning_visitors": nv["ret_v"] or 0,
        "refusal_rate": round(row["refusal_rate"] or 0, 4),
        "avg_top_score": round(row["avg_top_score"], 4) if row["avg_top_score"] is not None else None,
        "error_rate": round(row["error_rate"] or 0, 4),
        "aborted": row["aborted"] or 0,
        "est_cost_usd": round(cost, 4),
        "est_cost_usd_per_day": round(cost / days, 4),
        "feedback_up": fb["up"] or 0,
        "feedback_down": fb["down"] or 0,
    }


@router.get("/timeseries")
def timeseries(
    from_: int | None = Query(None, alias="from"),
    to: int | None = Query(None),
    tz_offset_minutes: int = Query(330),  # default IST for the admissions team
) -> dict:
    f, t = _range(from_, to)
    shift = f"{tz_offset_minutes:+d} minutes"
    with db.connect() as conn:
        daily = conn.execute(
            """
            SELECT date(ts_epoch, 'unixepoch', ?) AS day,
                   COUNT(*) AS queries,
                   COUNT(DISTINCT COALESCE(visitor_id, ip_hash)) AS visitors,
                   AVG(refused) AS refusal_rate
            FROM events WHERE ts_epoch BETWEEN ? AND ?
            GROUP BY day ORDER BY day
            """,
            (shift, f, t),
        ).fetchall()
        heatmap = conn.execute(
            """
            SELECT CAST(strftime('%w', ts_epoch, 'unixepoch', ?) AS INT) AS dow,
                   CAST(strftime('%H', ts_epoch, 'unixepoch', ?) AS INT) AS hour,
                   COUNT(*) AS queries
            FROM events WHERE ts_epoch BETWEEN ? AND ?
            GROUP BY dow, hour
            """,
            (shift, shift, f, t),
        ).fetchall()
    return {
        "daily": [dict(r) for r in daily],
        "heatmap": [dict(r) for r in heatmap],
        "tz_offset_minutes": tz_offset_minutes,
    }


@router.get("/topics")
def topics(
    from_: int | None = Query(None, alias="from"),
    to: int | None = Query(None),
    limit: int = Query(50, le=200),
) -> dict:
    f, t = _range(from_, to)
    with db.connect() as conn:
        by_topic = conn.execute(
            """
            SELECT COALESCE(c.topic, '(pending)') AS topic, COUNT(*) AS queries
            FROM events e LEFT JOIN clusters c ON c.id = e.cluster_id
            WHERE e.ts_epoch BETWEEN ? AND ?
            GROUP BY 1 ORDER BY queries DESC
            """,
            (f, t),
        ).fetchall()
        intents = conn.execute(
            """
            SELECT c.id, c.canonical_question, c.topic, c.label_status,
                   COUNT(e.id) AS queries,
                   MIN(e.question) AS example_question,
                   AVG(e.refused) AS refusal_rate
            FROM clusters c JOIN events e ON e.cluster_id = c.id
            WHERE e.ts_epoch BETWEEN ? AND ?
            GROUP BY c.id ORDER BY queries DESC LIMIT ?
            """,
            (f, t, limit),
        ).fetchall()
    return {"by_topic": [dict(r) for r in by_topic], "intents": [dict(r) for r in intents]}


@router.get("/gaps")
def gaps(
    from_: int | None = Query(None, alias="from"),
    to: int | None = Query(None),
    max_score: float = Query(0.3),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    """Refused or low-confidence questions — likely missing from the documents."""
    f, t = _range(from_, to)
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT e.id, e.ts, e.question, e.top_score, e.refused,
                   c.canonical_question, c.topic
            FROM events e LEFT JOIN clusters c ON c.id = e.cluster_id
            WHERE e.ts_epoch BETWEEN ? AND ?
              AND (e.refused = 1 OR (e.top_score IS NOT NULL AND e.top_score < ?))
            ORDER BY e.id DESC LIMIT ? OFFSET ?
            """,
            (f, t, max_score, limit, offset),
        ).fetchall()
        total = conn.execute(
            "SELECT COUNT(*) AS n FROM events WHERE ts_epoch BETWEEN ? AND ?"
            " AND (refused = 1 OR (top_score IS NOT NULL AND top_score < ?))",
            (f, t, max_score),
        ).fetchone()
    return {"total": total["n"], "items": [dict(r) for r in rows]}


@router.get("/rag")
def rag_quality(
    from_: int | None = Query(None, alias="from"), to: int | None = Query(None)
) -> dict:
    f, t = _range(from_, to)
    with db.connect() as conn:
        cited = conn.execute(
            """
            SELECT json_extract(j.value, '$.source') AS source,
                   json_extract(j.value, '$.page') AS page,
                   COUNT(*) AS citations
            FROM events e, json_each(e.cited_sources) j
            WHERE e.ts_epoch BETWEEN ? AND ?
            GROUP BY source, page ORDER BY citations DESC LIMIT 20
            """,
            (f, t),
        ).fetchall()
        by_doc = conn.execute(
            """
            SELECT json_extract(j.value, '$.source') AS source, COUNT(*) AS citations
            FROM events e, json_each(e.cited_sources) j
            WHERE e.ts_epoch BETWEEN ? AND ?
            GROUP BY source ORDER BY citations DESC
            """,
            (f, t),
        ).fetchall()
        dist = conn.execute(
            """
            SELECT MIN(CAST(top_score * 10 AS INT), 9) AS bucket, COUNT(*) AS queries
            FROM events WHERE ts_epoch BETWEEN ? AND ? AND top_score IS NOT NULL
            GROUP BY bucket ORDER BY bucket
            """,
            (f, t),
        ).fetchall()
    return {
        "most_cited_pages": [dict(r) for r in cited],
        "by_document": [dict(r) for r in by_doc],
        "score_distribution": [dict(r) for r in dist],
    }


@router.get("/performance")
def performance(
    from_: int | None = Query(None, alias="from"), to: int | None = Query(None)
) -> dict:
    f, t = _range(from_, to)
    with db.connect() as conn:
        ttfb = [
            r[0]
            for r in conn.execute(
                "SELECT latency_ttfb_ms FROM events WHERE ts_epoch BETWEEN ? AND ?"
                " AND latency_ttfb_ms IS NOT NULL ORDER BY latency_ttfb_ms",
                (f, t),
            )
        ]
        total = [
            r[0]
            for r in conn.execute(
                "SELECT latency_total_ms FROM events WHERE ts_epoch BETWEEN ? AND ?"
                " AND latency_total_ms IS NOT NULL AND aborted = 0"
                " ORDER BY latency_total_ms",
                (f, t),
            )
        ]
        tokens = conn.execute(
            "SELECT SUM(tokens_in) ti, SUM(tokens_out) tout"
            " FROM events WHERE ts_epoch BETWEEN ? AND ?",
            (f, t),
        ).fetchone()
        daily_cost = conn.execute(
            """
            SELECT date(ts_epoch, 'unixepoch', '+330 minutes') AS day, llm_model,
                   SUM(tokens_in) ti, SUM(tokens_out) tout,
                   AVG(error) AS error_rate, COUNT(*) AS queries
            FROM events WHERE ts_epoch BETWEEN ? AND ?
            GROUP BY day, llm_model ORDER BY day
            """,
            (f, t),
        ).fetchall()
        # Per-provider usage. With the fallback chain, llm_model records the
        # provider that actually served each request (display name), so this
        # shows failovers and paid-tier overflow at a glance.
        model_rows = conn.execute(
            """
            SELECT llm_model, COUNT(*) AS queries,
                   SUM(tokens_in) ti, SUM(tokens_out) tout,
                   AVG(error) AS error_rate
            FROM events WHERE ts_epoch BETWEEN ? AND ?
            GROUP BY llm_model ORDER BY queries DESC
            """,
            (f, t),
        ).fetchall()
    days: dict[str, dict] = {}
    for r in daily_cost:
        d = days.setdefault(
            r["day"], {"day": r["day"], "est_cost_usd": 0.0, "queries": 0, "errors": 0.0}
        )
        d["est_cost_usd"] += estimate_cost_usd(r["llm_model"], r["ti"], r["tout"])
        d["queries"] += r["queries"]
        d["errors"] += (r["error_rate"] or 0) * r["queries"]
    daily = [
        {**d, "est_cost_usd": round(d["est_cost_usd"], 4),
         "error_rate": round(d["errors"] / d["queries"], 4) if d["queries"] else 0}
        for d in days.values()
    ]
    for d in daily:
        d.pop("errors", None)
    # Anonymize providers before they leave the server: the DB keeps real
    # display names (query it directly when needed), but the API only exposes
    # tier labels following the chain order in models.config.json (L1 = primary).
    # Legacy pre-chain rows recorded the raw model id — they fold into the tier
    # of the chain entry that served them (setdefault: first occurrence wins).
    alias: dict[str, str] = {}
    for i, c in enumerate(settings.LLM_CHAIN):
        alias.setdefault(c["display"], f"L{i + 1}")
        alias.setdefault(c["model"], f"L{i + 1}")
    tiers: dict[str, dict] = {}
    for r in model_rows:
        name = r["llm_model"] or "unknown"
        label = alias.get(name, "other")
        d = tiers.setdefault(
            label,
            {"queries": 0, "tokens_in": 0, "tokens_out": 0, "errors": 0.0, "cost": 0.0},
        )
        d["queries"] += r["queries"]
        d["tokens_in"] += r["ti"] or 0
        d["tokens_out"] += r["tout"] or 0
        d["errors"] += (r["error_rate"] or 0) * r["queries"]
        d["cost"] += estimate_cost_usd(name, r["ti"], r["tout"])
    by_model = [
        {
            "model": label,
            "queries": d["queries"],
            "tokens_in": d["tokens_in"],
            "tokens_out": d["tokens_out"],
            "error_rate": round(d["errors"] / d["queries"], 4) if d["queries"] else 0.0,
            "est_cost_usd": round(d["cost"], 4),
        }
        for label, d in sorted(tiers.items())
    ]
    return {
        "latency_ttfb_ms": {"p50": _pct(ttfb, 50), "p90": _pct(ttfb, 90), "p99": _pct(ttfb, 99)},
        "latency_total_ms": {"p50": _pct(total, 50), "p90": _pct(total, 90), "p99": _pct(total, 99)},
        "tokens_in": tokens["ti"] or 0,
        "tokens_out": tokens["tout"] or 0,
        "tokens_estimated": True,
        "daily": daily,
        "by_model": by_model,
    }


@router.get("/feedback")
def feedback(
    from_: int | None = Query(None, alias="from"),
    to: int | None = Query(None),
    limit: int = Query(50, le=200),
) -> dict:
    f, t = _range(from_, to)
    with db.connect() as conn:
        counts = conn.execute(
            "SELECT SUM(fb.rating = 1) AS up, SUM(fb.rating = -1) AS down"
            " FROM feedback fb JOIN events e ON e.id = fb.event_id"
            " WHERE e.ts_epoch BETWEEN ? AND ?",
            (f, t),
        ).fetchone()
        negatives = conn.execute(
            """
            SELECT fb.ts, fb.comment, e.question, e.top_score, c.topic
            FROM feedback fb
            JOIN events e ON e.id = fb.event_id
            LEFT JOIN clusters c ON c.id = e.cluster_id
            WHERE fb.rating = -1 AND e.ts_epoch BETWEEN ? AND ?
            ORDER BY fb.id DESC LIMIT ?
            """,
            (f, t, limit),
        ).fetchall()
    up, down = counts["up"] or 0, counts["down"] or 0
    return {
        "up": up,
        "down": down,
        "satisfaction_rate": round(up / (up + down), 4) if (up + down) else None,
        "negatives": [dict(r) for r in negatives],
    }
