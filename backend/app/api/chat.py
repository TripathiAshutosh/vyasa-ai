from __future__ import annotations

import asyncio
import json
import time
from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.analytics.capture import capture_query, client_ip_hash
from app.config import settings

router = APIRouter()


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)


def _sse(event: str | None, data: str) -> bytes:
    out = ""
    if event:
        out += f"event: {event}\n"
    # Split on newlines per SSE spec
    for line in data.splitlines() or [""]:
        out += f"data: {line}\n"
    out += "\n"
    return out.encode("utf-8")


@router.post("/chat")
async def chat(req: ChatRequest, request: Request) -> StreamingResponse:
    rag = request.app.state.rag
    messages = [m.model_dump() for m in req.messages]

    # Anonymous analytics identifiers — optional headers set by the frontend;
    # the raw client IP is hashed immediately and never stored.
    visitor_id = request.headers.get("x-visitor-id")
    session_id = request.headers.get("x-session-id")
    ip_hash = client_ip_hash(request) if settings.ANALYTICS_ENABLED else None
    last_user = next(
        (m["content"] for m in reversed(messages) if m.get("role") == "user"), ""
    )

    async def gen():
        t0 = time.perf_counter()
        meta = None
        cited: list[dict] = []
        ttfb_ms: int | None = None
        answer_chars = 0
        captured = False

        async def _capture(error_message: str | None = None, aborted: bool = False):
            # Runs at most once per request; never raises (capture_query swallows).
            nonlocal captured
            if captured:
                return None
            captured = True
            return await capture_query(
                question=meta.query if meta else last_user,
                embedding=meta.embedding if meta else None,
                embed_model=rag.embedder.name,
                visitor_id=visitor_id,
                session_id=session_id,
                ip_hash=ip_hash,
                top_score=meta.top_score if meta else None,
                refused=meta.refused if meta else False,
                prompt_chars=meta.prompt_chars if meta else 0,
                answer_chars=answer_chars,
                ttfb_ms=ttfb_ms,
                total_ms=int((time.perf_counter() - t0) * 1000),
                error_message=error_message,
                aborted=aborted,
                provider=settings.PROVIDER,
                llm_model=rag.llm.name,
                cited_sources=cited or None,
            )

        try:
            stream, sources, meta = await rag.stream_answer(messages)
            # Emit sources first so the UI can prep citation slots
            srcs_payload = [
                {"source": s.source, "page": s.page, "text": s.text, "score": s.score}
                for s in sources
            ]
            cited = [{"source": s.source, "page": s.page} for s in sources]
            yield _sse("sources", json.dumps(srcs_payload))
            async for token in stream:
                if ttfb_ms is None:
                    ttfb_ms = int((time.perf_counter() - t0) * 1000)
                answer_chars += len(token)
                yield _sse(None, json.dumps({"token": token}))
            # Record the event, then tell the client its id so 👍/👎 can reference it.
            event_id = await _capture()
            if event_id is not None:
                yield _sse("meta", json.dumps({"event_id": event_id}))
            yield _sse("done", json.dumps({"ok": True}))
        except Exception as e:
            yield _sse("error", json.dumps({"message": str(e)}))
            await _capture(error_message=str(e))
        finally:
            if not captured:
                # Client disconnected mid-stream (generator cancelled) — record
                # the abandoned query fire-and-forget; we can no longer yield.
                asyncio.get_running_loop().create_task(_capture(aborted=True))

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
