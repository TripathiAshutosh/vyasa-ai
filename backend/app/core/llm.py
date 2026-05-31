from __future__ import annotations

import json
from typing import AsyncIterator, Protocol

import httpx
from openai import AsyncOpenAI

from app.config import settings


class LLM(Protocol):
    name: str

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]: ...


class OpenAIChatLLM:
    def __init__(self) -> None:
        if not settings.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY not set")
        self._client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY, base_url=settings.OPENAI_BASE_URL)
        self.name = settings.OPENAI_LLM_MODEL

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        resp = await self._client.chat.completions.create(
            model=self.name,
            messages=messages,
            temperature=0.1,
            stream=True,
        )
        async for chunk in resp:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta and delta.content:
                yield delta.content


class GroqChatLLM:
    def __init__(self) -> None:
        if not settings.GROQ_API_KEY:
            raise RuntimeError("GROQ_API_KEY not set")
        self.name = settings.GROQ_LLM_MODEL
        self._endpoint = f"{settings.GROQ_BASE_URL.rstrip('/')}/chat/completions"
        self._headers = {
            "Authorization": f"Bearer {settings.GROQ_API_KEY}",
            "Content-Type": "application/json",
        }

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        # gpt-oss-* are reasoning models served via Groq's OpenAI-compatible API.
        # They require `max_completion_tokens`; `max_tokens` triggers HTTP 413.
        # Plain chat models (llama-*, mixtral-*) accept either, so we send the
        # newer field name universally — it's forward-compatible.
        payload = {
            "model": self.name,
            "messages": messages,
            "temperature": 0.1,
            "stream": True,
            "max_completion_tokens": settings.GROQ_MAX_TOKENS,
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("POST", self._endpoint, headers=self._headers, json=payload) as r:
                if r.status_code >= 400:
                    body = (await r.aread()).decode("utf-8", errors="replace")
                    snippet = body[:400].replace("\n", " ")
                    raise RuntimeError(f"Groq {r.status_code}: {snippet}")
                async for line in r.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        obj = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choices = obj.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    content = delta.get("content")
                    if content:
                        yield content


def make_llm() -> LLM:
    if settings.PROVIDER == "openai":
        return OpenAIChatLLM()
    return GroqChatLLM()
