from __future__ import annotations

import asyncio
import hashlib
import json
import logging

from fastapi import Request

from app.config import settings

from . import clustering, db, labeler

log = logging.getLogger("phd_bot.analytics.capture")


def client_ip_hash(request: Request) -> str | None:
    """Salted hash of the client IP — the raw IP is never stored anywhere."""
    ip = (
        request.headers.get("x-real-ip")
        or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        or (request.client.host if request.client else "")
    )
    if not ip:
        return None
    return hashlib.sha256((settings.ANALYTICS_IP_SALT + ip).encode()).hexdigest()[:32]


def _capture_sync(fields: dict, embedding: list[float] | None, embed_model: str | None) -> tuple[int, int | None, str]:
    """Cluster-assign + insert, off the event loop. Returns (event_id, new_cluster_id, question)."""
    new_cluster_id: int | None = None
    if embedding and embed_model:
        cluster_id, is_new = clustering.assign_or_create(embedding, embed_model)
        fields["cluster_id"] = cluster_id
        if is_new:
            new_cluster_id = cluster_id
        fields["embedding"] = db.vec_to_blob(embedding)
        fields["embed_dim"] = len(embedding)
        fields["embed_model"] = embed_model
    event_id = db.insert_event(**fields)
    return event_id, new_cluster_id, fields.get("question") or ""


async def capture_query(
    *,
    question: str,
    embedding: list[float] | None,
    embed_model: str | None,
    visitor_id: str | None,
    session_id: str | None,
    ip_hash: str | None,
    top_score: float | None,
    refused: bool,
    prompt_chars: int,
    answer_chars: int,
    ttfb_ms: int | None,
    total_ms: int | None,
    error_message: str | None,
    aborted: bool,
    provider: str,
    llm_model: str,
    cited_sources: list[dict] | None,
) -> int | None:
    """Record one chat query. Never raises — returns the event id or None."""
    if not settings.ANALYTICS_ENABLED:
        return None
    try:
        ts, ts_epoch = db.now_utc()
        fields: dict = {
            "ts": ts,
            "ts_epoch": ts_epoch,
            "visitor_id": visitor_id,
            "session_id": session_id,
            "ip_hash": ip_hash,
            "question": question[:2000],
            "top_score": top_score,
            "refused": int(refused),
            "latency_ttfb_ms": ttfb_ms,
            "latency_total_ms": total_ms,
            # chars/4 estimation; refusals skip the LLM entirely → 0 tokens.
            "tokens_in": 0 if refused else prompt_chars // 4,
            "tokens_out": 0 if refused else answer_chars // 4,
            "tokens_estimated": 1,
            "error": int(error_message is not None),
            "error_message": error_message,
            "aborted": int(aborted),
            "provider": provider,
            "llm_model": llm_model,
            "cited_sources": json.dumps(cited_sources) if cited_sources else None,
        }
        event_id, new_cluster_id, q = await asyncio.to_thread(
            _capture_sync, fields, embedding, embed_model
        )
        if new_cluster_id is not None and q:
            labeler.enqueue(new_cluster_id, q)
        return event_id
    except Exception:
        log.exception("Analytics capture failed (chat unaffected)")
        return None
