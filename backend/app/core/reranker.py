from __future__ import annotations

import httpx

from app.config import settings


class JinaReranker:
    def __init__(self) -> None:
        self._endpoint = "https://api.jina.ai/v1/rerank"
        self._headers = {
            "Authorization": f"Bearer {settings.JINA_API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        self.name = settings.JINA_RERANK_MODEL

    async def rerank(self, query: str, documents: list[str], top_n: int) -> list[tuple[int, float]]:
        """Returns list of (original_index, relevance_score) sorted by relevance desc."""
        if not documents:
            return []
        payload = {
            "model": self.name,
            "query": query,
            "top_n": top_n,
            "documents": documents,
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(self._endpoint, headers=self._headers, json=payload)
            r.raise_for_status()
            data = r.json()
        results = data.get("results", [])
        return [(item["index"], item["relevance_score"]) for item in results]


def make_reranker() -> JinaReranker | None:
    if not settings.USE_RERANKER:
        return None
    if not settings.JINA_API_KEY:
        return None
    return JinaReranker()
