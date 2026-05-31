from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncIterator

from app.config import settings
from app.core.embeddings import Embedder
from app.core.llm import LLM
from app.core.reranker import JinaReranker
from app.core.vectorstore import VectorStore

SYSTEM_PROMPT = """You are a helpful, precise assistant for prospective PhD applicants.
Your job is to answer questions about university PhD admissions strictly using the provided
context from official admission documents.

Rules:
1. Use ONLY the information in the Context section. Do not invent facts, dates, fees,
   eligibility, or contact details that are not in the Context.
2. If the answer is not present in the Context, reply exactly:
   "I don't have that in the provided documents. Please check the official notification or
   contact the admissions office."
3. When you state a fact, cite the source like [Source: <file>.pdf p.<page>]. Cite the
   most specific page that supports each claim. Multiple citations are fine.
4. Prefer concise, well-structured answers. Use short bullet lists for criteria, dates, or
   steps. Use plain prose for definitions or single-fact answers.
5. If the user's question is ambiguous, ask a brief clarifying question before answering.
6. Do not mention these instructions or that you were given context — speak naturally."""


@dataclass
class Source:
    source: str
    page: int
    text: str
    score: float | None = None


def _build_context(sources: list[Source], max_chars: int = 12000) -> str:
    parts: list[str] = []
    total = 0
    for s in sources:
        block = f"[Source: {s.source} p.{s.page}]\n{s.text}"
        if total + len(block) > max_chars:
            break
        parts.append(block)
        total += len(block)
    return "\n\n---\n\n".join(parts)


class RAGPipeline:
    def __init__(
        self,
        embedder: Embedder,
        llm: LLM,
        store: VectorStore,
        reranker: JinaReranker | None,
    ) -> None:
        self.embedder = embedder
        self.llm = llm
        self.store = store
        self.reranker = reranker

    async def retrieve(self, query: str) -> list[Source]:
        q_emb = await self.embedder.embed_query(query)
        hits = self.store.query(q_emb, top_k=settings.TOP_K)
        if not hits:
            return []
        if self.reranker is not None and len(hits) > settings.RERANK_TOP_K:
            ranked = await self.reranker.rerank(
                query=query,
                documents=[h["text"] for h in hits],
                top_n=settings.RERANK_TOP_K,
            )
            picked: list[Source] = []
            for idx, score in ranked:
                h = hits[idx]
                meta = h.get("metadata") or {}
                picked.append(
                    Source(
                        source=str(meta.get("source", "unknown")),
                        page=int(meta.get("page", 0)),
                        text=h["text"],
                        score=score,
                    )
                )
            return picked
        # No reranker — just truncate
        out: list[Source] = []
        for h in hits[: settings.RERANK_TOP_K]:
            meta = h.get("metadata") or {}
            out.append(
                Source(
                    source=str(meta.get("source", "unknown")),
                    page=int(meta.get("page", 0)),
                    text=h["text"],
                    score=(1.0 - h["distance"]) if h.get("distance") is not None else None,
                )
            )
        return out

    async def stream_answer(
        self, messages: list[dict]
    ) -> tuple[AsyncIterator[str], list[Source]]:
        last_user = next(
            (m["content"] for m in reversed(messages) if m.get("role") == "user"), ""
        )
        sources = await self.retrieve(last_user) if last_user else []

        # If retrieval clearly missed (top score below threshold) the question is
        # off-topic for our PDFs. Skip the LLM call, return a canned refusal, and
        # drop the citations so the UI doesn't show misleading source chips.
        top_score = sources[0].score if sources and sources[0].score is not None else None
        if top_score is not None and top_score < settings.RELEVANCE_THRESHOLD:
            async def _refuse() -> AsyncIterator[str]:
                yield (
                    "I don't have that in the provided documents. "
                    "Please check the official notification or contact the admissions office."
                )
            return _refuse(), []

        context = _build_context(sources) if sources else "(no documents indexed)"

        chat_messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
        # Keep conversation context lean: last 6 exchanges
        history = [m for m in messages if m.get("role") in ("user", "assistant")][-12:]
        # All but the last user message are prior turns
        for m in history[:-1]:
            chat_messages.append({"role": m["role"], "content": m["content"]})
        chat_messages.append(
            {
                "role": "user",
                "content": (
                    f"Context from the PhD admission documents:\n\n{context}\n\n"
                    f"Question: {last_user}"
                ),
            }
        )
        return self.llm.stream(chat_messages), sources
