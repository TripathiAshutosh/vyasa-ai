from __future__ import annotations

from pathlib import Path

import chromadb
from chromadb.config import Settings as ChromaSettings

from app.config import settings

COLLECTION_NAME = "phd_docs"


class VectorStore:
    def __init__(self) -> None:
        Path(settings.CHROMA_DIR).mkdir(parents=True, exist_ok=True)
        self._client = chromadb.PersistentClient(
            path=settings.CHROMA_DIR,
            settings=ChromaSettings(anonymized_telemetry=False, allow_reset=True),
        )
        self._collection = self._client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )

    @property
    def collection(self):
        return self._collection

    def count(self) -> int:
        return self._collection.count()

    def reset(self) -> None:
        try:
            self._client.delete_collection(COLLECTION_NAME)
        except Exception:
            pass
        self._collection = self._client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )

    def delete_by_source(self, source: str) -> int:
        before = self._collection.count()
        self._collection.delete(where={"source": source})
        after = self._collection.count()
        return max(0, before - after)

    def add(
        self,
        ids: list[str],
        embeddings: list[list[float]],
        documents: list[str],
        metadatas: list[dict],
    ) -> None:
        if not ids:
            return
        self._collection.upsert(
            ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas
        )

    def query(self, embedding: list[float], top_k: int) -> list[dict]:
        res = self._collection.query(
            query_embeddings=[embedding],
            n_results=top_k,
            include=["documents", "metadatas", "distances"],
        )
        docs = (res.get("documents") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]
        dists = (res.get("distances") or [[]])[0]
        ids = (res.get("ids") or [[]])[0]
        out: list[dict] = []
        for i, doc in enumerate(docs):
            out.append(
                {
                    "id": ids[i],
                    "text": doc,
                    "metadata": metas[i] or {},
                    "distance": dists[i] if i < len(dists) else None,
                }
            )
        return out

    def list_sources(self) -> dict[str, int]:
        # Returns {source_filename: chunk_count}
        # Chroma doesn't expose grouping; we fetch all metadatas and tally.
        # For an MVP with a few PDFs this is fine.
        total = self._collection.count()
        if total == 0:
            return {}
        got = self._collection.get(include=["metadatas"], limit=total)
        metas = got.get("metadatas") or []
        counts: dict[str, int] = {}
        for m in metas:
            src = (m or {}).get("source") or "unknown"
            counts[src] = counts.get(src, 0) + 1
        return counts


_store: VectorStore | None = None


def get_store() -> VectorStore:
    global _store
    if _store is None:
        _store = VectorStore()
    return _store
