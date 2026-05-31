from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

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

    async def gen():
        try:
            stream, sources = await rag.stream_answer(messages)
            # Emit sources first so the UI can prep citation slots
            srcs_payload = [
                {"source": s.source, "page": s.page, "text": s.text, "score": s.score}
                for s in sources
            ]
            yield _sse("sources", json.dumps(srcs_payload))
            async for token in stream:
                yield _sse(None, json.dumps({"token": token}))
            yield _sse("done", json.dumps({"ok": True}))
        except Exception as e:
            yield _sse("error", json.dumps({"message": str(e)}))

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
