from __future__ import annotations

import json
import logging
import re
import time
from contextvars import ContextVar
from typing import AsyncIterator, Protocol

import httpx
from openai import AsyncOpenAI

from app.config import settings

log = logging.getLogger("phd_bot.llm")

# Which provider actually served the current request (display name). Set by
# FallbackLLM per attempt; read back via FallbackLLM.name after the stream is
# consumed (analytics capture runs in the same async task), so per-query model
# attribution stays correct under concurrent requests.
_served_by: ContextVar[str | None] = ContextVar("llm_served_by", default=None)


class LLM(Protocol):
    name: str

    async def stream(
        self, messages: list[dict], max_tokens: int | None = None
    ) -> AsyncIterator[str]: ...


class LLMUnavailable(RuntimeError):
    """Transient provider failure (rate limit / 5xx / network) — safe to retry
    on another provider. `retry_after` is how long the provider asked us to
    stay away, in seconds."""

    def __init__(self, msg: str, retry_after: float = 120.0) -> None:
        super().__init__(msg)
        self.retry_after = retry_after


def _parse_retry_after(header: str | None, body: str) -> float:
    """Seconds until the provider wants us back. Sources, in order: the
    Retry-After header, then Groq-style prose ("try again in 3m40.32s").
    Clamped to [30s, 30min]; defaults to 120s when neither is present."""
    if header:
        try:
            return max(30.0, min(float(header), 1800.0))
        except ValueError:
            pass
    m = re.search(
        r"try again in (?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?",
        body,
    )
    if m and any(m.groups()):
        h, mins, s = (float(g) if g else 0.0 for g in m.groups())
        return max(30.0, min(h * 3600 + mins * 60 + s, 1800.0))
    return 120.0


class OpenAIChatLLM:
    def __init__(self) -> None:
        if not settings.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY not set")
        self._client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY, base_url=settings.OPENAI_BASE_URL)
        self.name = settings.OPENAI_LLM_MODEL

    async def stream(
        self, messages: list[dict], max_tokens: int | None = None
    ) -> AsyncIterator[str]:
        kwargs: dict = {}
        if max_tokens is not None:
            kwargs["max_completion_tokens"] = max_tokens
        resp = await self._client.chat.completions.create(
            model=self.name,
            messages=messages,
            temperature=0.1,
            stream=True,
            **kwargs,
        )
        async for chunk in resp:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta and delta.content:
                yield delta.content


class OpenAICompatLLM:
    """Streaming client for any OpenAI-compatible chat-completions endpoint
    (Groq, Cerebras, DeepInfra, …). Defaults to the GROQ_* settings so a
    single-provider setup behaves exactly as before."""

    def __init__(
        self,
        model: str | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
        max_tokens: int | None = None,
        display: str | None = None,
    ) -> None:
        key = api_key or settings.GROQ_API_KEY
        if not key:
            raise RuntimeError("GROQ_API_KEY not set")
        self.name = model or settings.GROQ_LLM_MODEL
        self.display = display or self.name
        self._max_tokens = max_tokens or settings.GROQ_MAX_TOKENS
        base = (base_url or settings.GROQ_BASE_URL).rstrip("/")
        self._endpoint = f"{base}/chat/completions"
        self._headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    async def stream(
        self, messages: list[dict], max_tokens: int | None = None
    ) -> AsyncIterator[str]:
        # gpt-oss-* are reasoning models served via OpenAI-compatible APIs.
        # They require `max_completion_tokens`; `max_tokens` triggers HTTP 413.
        # Plain chat models (llama-*, mixtral-*) accept either, so we send the
        # newer field name universally — it's forward-compatible.
        # Providers reserve the full requested budget against rate limits, so
        # small auxiliary calls (e.g. the analytics labeler) pass a tighter one.
        payload = {
            "model": self.name,
            "messages": messages,
            "temperature": 0.1,
            "stream": True,
            "max_completion_tokens": max_tokens or self._max_tokens,
        }
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST", self._endpoint, headers=self._headers, json=payload
                ) as r:
                    if r.status_code >= 400:
                        body = (await r.aread()).decode("utf-8", errors="replace")
                        snippet = body[:400].replace("\n", " ")
                        msg = f"{self.display} {r.status_code}: {snippet}"
                        # Rate limits and server errors are transient — another
                        # provider can serve the request. Other 4xx (bad request,
                        # bad key) would fail everywhere; don't mask them.
                        if r.status_code in (408, 429) or r.status_code >= 500:
                            raise LLMUnavailable(
                                msg,
                                _parse_retry_after(r.headers.get("retry-after"), body),
                            )
                        raise RuntimeError(msg)
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
        except httpx.TransportError as e:
            # DNS/connect/read failures — provider unreachable, try the next one.
            raise LLMUnavailable(f"{self.display} unreachable: {e}", retry_after=60.0) from e


# Backward-compatible alias (pre-fallback name).
GroqChatLLM = OpenAICompatLLM


class FallbackLLM:
    """Chain of providers with a circuit breaker.

    Requests go to the first provider not on cooldown. When a provider
    rate-limits or errors, it is put on cooldown for the period it asked for
    (Retry-After), so subsequent requests skip it entirely — no extra latency
    while it recovers. Failover only happens before the first streamed token:
    a partially-streamed answer is never restarted on another provider.
    """

    def __init__(self, providers: list[OpenAICompatLLM]) -> None:
        if not providers:
            raise RuntimeError("FallbackLLM needs at least one provider")
        self._providers = providers
        self._cooldown_until = [0.0] * len(providers)

    @property
    def name(self) -> str:
        # Analytics reads this after consuming the stream (same async task), so
        # each query row records the provider that actually served it.
        return _served_by.get() or self._providers[0].display

    async def stream(
        self, messages: list[dict], max_tokens: int | None = None
    ) -> AsyncIterator[str]:
        now = time.monotonic()
        ready = [i for i, t in enumerate(self._cooldown_until) if t <= now]
        cooling = [i for i in range(len(self._providers)) if i not in ready]
        last_err: Exception | None = None
        # If everything is cooling down, try anyway in priority order —
        # a late answer beats a guaranteed error.
        for idx in ready + cooling:
            provider = self._providers[idx]
            _served_by.set(provider.display)
            started = False
            try:
                async for token in provider.stream(messages, max_tokens):
                    started = True
                    yield token
                if idx != 0:
                    log.info("LLM served by fallback provider %s", provider.display)
                return
            except LLMUnavailable as e:
                if started:
                    raise  # mid-stream failure: the user already saw a partial answer
                self._cooldown_until[idx] = time.monotonic() + e.retry_after
                log.warning(
                    "LLM provider %s unavailable, cooling down %.0fs: %s",
                    provider.display,
                    e.retry_after,
                    e,
                )
                last_err = e
        raise last_err or RuntimeError("no LLM provider available")


def make_llm() -> LLM:
    if settings.PROVIDER == "openai":
        return OpenAIChatLLM()
    chain = settings.LLM_CHAIN
    if len(chain) > 1:
        providers = [
            OpenAICompatLLM(
                model=c["model"],
                base_url=c["base_url"],
                api_key=c["api_key"],
                max_tokens=c["max_tokens"],
                display=c["display"],
            )
            for c in chain
        ]
        log.info("LLM fallback chain: %s", " -> ".join(p.display for p in providers))
        return FallbackLLM(providers)
    return OpenAICompatLLM()
