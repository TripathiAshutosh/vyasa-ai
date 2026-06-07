from __future__ import annotations

# USD per 1M tokens (input, output). Unknown models (incl. Groq/Jina free-tier
# usage in opensource mode) default to 0 — the dashboard labels cost "estimated".
PRICES: dict[str, tuple[float, float]] = {
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "text-embedding-3-small": (0.02, 0.0),
    # Fallback-chain providers are recorded by display name (the model id alone
    # can't tell free Groq from paid DeepInfra — both serve openai/gpt-oss-120b).
    "GPT-OSS 120B [DeepInfra]": (0.09, 0.45),
}


def estimate_cost_usd(model: str | None, tokens_in: int | None, tokens_out: int | None) -> float:
    if not model:
        return 0.0
    price_in, price_out = PRICES.get(model, (0.0, 0.0))
    return ((tokens_in or 0) / 1e6) * price_in + ((tokens_out or 0) / 1e6) * price_out
