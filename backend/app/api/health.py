from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/health")
async def health(request: Request) -> dict:
    rag = request.app.state.rag
    store = request.app.state.store
    from app.config import settings

    return {
        "status": "ok",
        "provider": settings.PROVIDER,
        "embed_model": rag.embedder.name,
        "llm_model": rag.llm.name,
        "reranker": rag.reranker.name if rag.reranker else None,
        "num_chunks": store.count(),
    }
