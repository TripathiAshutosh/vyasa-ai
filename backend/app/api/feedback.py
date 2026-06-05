from __future__ import annotations

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.analytics import db
from app.config import settings

log = logging.getLogger("phd_bot.feedback")

router = APIRouter()


class FeedbackRequest(BaseModel):
    event_id: int
    rating: Literal[1, -1]
    visitor_id: str | None = Field(default=None, max_length=64)
    comment: str | None = Field(default=None, max_length=1000)


@router.post("/feedback")
async def submit_feedback(req: FeedbackRequest) -> dict:
    """Public 👍/👎 on an answer. Re-submitting flips the previous rating."""
    if not settings.ANALYTICS_ENABLED:
        return {"ok": False}
    try:
        if not await asyncio.to_thread(db.event_exists, req.event_id):
            raise HTTPException(status_code=404, detail="Unknown event_id.")
        await asyncio.to_thread(
            db.record_feedback, req.event_id, req.rating, req.visitor_id, req.comment
        )
        return {"ok": True}
    except HTTPException:
        raise
    except Exception:
        log.exception("Feedback write failed")
        return {"ok": False}
