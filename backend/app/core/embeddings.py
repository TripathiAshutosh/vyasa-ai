from __future__ import annotations

from typing import Protocol

import httpx
from openai import AsyncOpenAI

from app.config import settings


class Embedder(Protocol):
    name: str
    dim: int | None

    async def embed_documents(self, texts: list[str]) -> list[list[float]]: ...
    async def embed_query(self, text: str) -> list[float]: ...


class OpenAIEmbedder:
    def __init__(self) -> None:
        if not settings.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY not set")
        self._client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY, base_url=settings.OPENAI_BASE_URL)
        self.name = settings.OPENAI_EMBED_MODEL
        self.dim = None

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), settings.EMBED_BATCH_SIZE):
            batch = texts[i : i + settings.EMBED_BATCH_SIZE]
            resp = await self._client.embeddings.create(model=self.name, input=batch)
            out.extend([d.embedding for d in resp.data])
        return out

    async def embed_query(self, text: str) -> list[float]:
        resp = await self._client.embeddings.create(model=self.name, input=[text])
        return resp.data[0].embedding


class JinaEmbedder:
    def __init__(self) -> None:
        if not settings.JINA_API_KEY:
            raise RuntimeError("JINA_API_KEY not set")
        self.name = settings.JINA_EMBED_MODEL
        self.dim = None
        self._endpoint = "https://api.jina.ai/v1/embeddings"
        self._headers = {
            "Authorization": f"Bearer {settings.JINA_API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    async def _embed(self, texts: list[str], task: str) -> list[list[float]]:
        payload = {
            "model": self.name,
            "task": task,
            "input": texts,
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(self._endpoint, headers=self._headers, json=payload)
            r.raise_for_status()
            data = r.json()
        return [item["embedding"] for item in data["data"]]

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), settings.EMBED_BATCH_SIZE):
            batch = texts[i : i + settings.EMBED_BATCH_SIZE]
            out.extend(await self._embed(batch, task="retrieval.passage"))
        return out

    async def embed_query(self, text: str) -> list[float]:
        vecs = await self._embed([text], task="retrieval.query")
        return vecs[0]


def make_embedder() -> Embedder:
    if settings.PROVIDER == "openai":
        return OpenAIEmbedder()
    return JinaEmbedder()
