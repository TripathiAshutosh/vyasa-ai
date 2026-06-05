from __future__ import annotations

import asyncio
import json
import logging

from . import db

log = logging.getLogger("phd_bot.analytics.labeler")

TOPICS = [
    "eligibility",
    "fees",
    "entrance exam",
    "documents",
    "dates",
    "reservation",
    "other",
    "off-topic",
]

_PROMPT = """You label user questions sent to a university PhD-admission chatbot.

Question: {question}

Reply with ONLY a JSON object, no prose:
{{"canonical_question": "<the question rephrased as one short, clear English question>",
 "topic": "<one of: {topics}>"}}"""

# Single in-process queue drained by one worker — labeling is non-urgent and we
# keep concurrency at 1 (plus a delay) to stay well inside Groq rate limits.
_queue: asyncio.Queue[tuple[int, str]] = asyncio.Queue()
_queued_ids: set[int] = set()  # avoid duplicate jobs for the same cluster

# When idle this long, re-scan for pending/failed clusters (e.g. ones that hit a
# provider rate limit earlier) so labeling self-heals without a restart.
_RESCAN_SECONDS = 600

# Tight output budget for label calls: the JSON is ~50 tokens, plus headroom for
# reasoning models (gpt-oss-*). Groq reserves the requested budget against rate
# limits, so this keeps labeling ~8× cheaper on quota than the chat default.
_MAX_TOKENS = 512


def enqueue(cluster_id: int, question: str) -> None:
    try:
        if cluster_id in _queued_ids:
            return
        _queued_ids.add(cluster_id)
        _queue.put_nowait((cluster_id, question))
    except Exception:  # pragma: no cover - unbounded queue, but never break chat
        log.exception("Failed to enqueue label job for cluster %d", cluster_id)


async def _label_one(llm, cluster_id: int, question: str) -> None:
    prompt = _PROMPT.format(question=question[:500], topics=", ".join(TOPICS))
    chunks: list[str] = []
    async for token in llm.stream(
        [{"role": "user", "content": prompt}], max_tokens=_MAX_TOKENS
    ):
        chunks.append(token)
    raw = "".join(chunks)
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"no JSON in label response: {raw[:200]!r}")
    obj = json.loads(raw[start : end + 1])
    canonical = str(obj.get("canonical_question") or question)[:300]
    topic = str(obj.get("topic") or "other").strip().lower()
    if topic not in TOPICS:
        topic = "other"
    await asyncio.to_thread(db.update_cluster_label, cluster_id, canonical, topic, "done")
    log.info("Labeled cluster %d: topic=%s %r", cluster_id, topic, canonical)


async def _requeue_unlabeled() -> None:
    try:
        for c in await asyncio.to_thread(db.unlabeled_clusters):
            enqueue(c["id"], c["question"])
    except Exception:
        log.exception("Failed to requeue unlabeled clusters")


async def run(llm) -> None:
    """Worker loop. Started once in app lifespan; cancelled on shutdown."""
    # Pick up clusters left pending/failed by a previous run.
    await _requeue_unlabeled()

    while True:
        try:
            cluster_id, question = await asyncio.wait_for(
                _queue.get(), timeout=_RESCAN_SECONDS
            )
        except asyncio.TimeoutError:
            await _requeue_unlabeled()
            continue
        try:
            await _label_one(llm, cluster_id, question)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Labeling failed for cluster %d", cluster_id)
            try:
                await asyncio.to_thread(
                    db.update_cluster_label, cluster_id, None, None, "failed"
                )
            except Exception:
                pass
        finally:
            _queued_ids.discard(cluster_id)
        await asyncio.sleep(2.0)  # gentle pacing for provider rate limits


def start(llm) -> asyncio.Task:
    return asyncio.create_task(run(llm), name="analytics-labeler")
