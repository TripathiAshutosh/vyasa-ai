from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger("phd_bot.config")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    PROVIDER: Literal["openai", "opensource"] = "openai"

    OPENAI_API_KEY: str = ""
    OPENAI_LLM_MODEL: str = "gpt-4o-mini"
    OPENAI_EMBED_MODEL: str = "text-embedding-3-small"
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"

    GROQ_API_KEY: str = ""
    GROQ_LLM_MODEL: str = "llama-3.3-70b-versatile"
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"
    # Output budget. For gpt-oss-* reasoning models this also covers reasoning tokens.
    # Groq counts this toward TPM rate limits even if the model uses less, so keep
    # it tight: 1024 is plenty for grounded Q&A answers + modest reasoning.
    GROQ_MAX_TOKENS: int = 1024

    JINA_API_KEY: str = ""
    JINA_EMBED_MODEL: str = "jina-embeddings-v3"
    JINA_RERANK_MODEL: str = "jina-reranker-v2-base-multilingual"

    USE_RERANKER: bool = True
    ADMIN_TOKEN: str = "change-me"

    DATA_DIR: str = "/app/data"
    CHROMA_DIR: str = "/app/chroma_db"

    CHUNK_SIZE: int = 900
    CHUNK_OVERLAP: int = 150
    TOP_K: int = 8
    RERANK_TOP_K: int = 5
    EMBED_BATCH_SIZE: int = 32
    # Minimum relevance score for the top retrieved chunk. Below this we treat the
    # question as off-topic, skip the LLM call, and return a canned refusal with
    # no source citations. Scores: Jina rerank ~[0,1]; (1 - cosine distance) ~[0,1].
    RELEVANCE_THRESHOLD: float = 0.15

    CORS_ORIGINS: str = "http://localhost:3000"

    # --- Analytics (admin dashboard) ---
    # Master switch. When off, no events are recorded and the chat path is untouched.
    ANALYTICS_ENABLED: bool = True
    ANALYTICS_DIR: str = "/app/analytics"
    # Salt for hashing client IPs. Raw IPs are never stored — only sha256(salt + ip).
    ANALYTICS_IP_SALT: str = "change-me-salt"
    # Cosine similarity above which a query joins an existing intent cluster.
    # Lower → fewer, broader clusters; higher → more, tighter clusters.
    CLUSTER_THRESHOLD: float = 0.83

    # Optional: a custom-models JSON dropped in alongside .env.
    # Default name matches the file produced by Groq's chat console.
    MODELS_CONFIG_PATH: str = "models.config.json"
    # Picks an entry from custom_models[]; matches model_display_name or model.
    # Empty => first entry wins.
    MODELS_CONFIG_SELECT: str = ""
    # Ordered LLM provider chain built from custom_models[] (first = primary,
    # rest are rate-limit fallbacks). Populated by _apply_models_config.
    LLM_CHAIN: list[dict] = []

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @model_validator(mode="after")
    def _apply_models_config(self) -> "Settings":
        """If a custom-models JSON exists, let it populate Groq* fields.

        Schema accepted (Groq console export):
            {"custom_models": [
                {"model_display_name": "...", "model": "openai/gpt-oss-120b",
                 "base_url": "...", "api_key": "...",
                 "provider": "generic-chat-completion-api",
                 "max_tokens": 65536}
            ]}
        """
        path = Path(self.MODELS_CONFIG_PATH)
        if not path.is_file():
            return self
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:  # malformed file should not break startup
            log.warning("Failed to parse %s: %s", path, e)
            return self

        entries = data.get("custom_models") or []
        if not entries:
            return self

        # Build the provider chain: file order = fallback priority. Entries
        # with a placeholder key (containing "PASTE") or missing fields are
        # skipped, so the chain grows as real keys get filled in.
        chain: list[dict] = []
        for m in entries:
            key = str(m.get("api_key") or "").strip()
            model = str(m.get("model") or "").strip()
            base_url = str(m.get("base_url") or "").strip()
            if not key or "PASTE" in key.upper() or not model or not base_url:
                continue
            # The JSON max_tokens is usually the *model's* total output ceiling
            # (e.g. 65536). For grounded Q&A we want a much smaller per-request
            # budget — capping at 4096 keeps reasoning + answer well under any
            # model's limit.
            try:
                max_tokens = min(int(m.get("max_tokens") or 0), 4096)
            except (TypeError, ValueError):
                max_tokens = 0
            chain.append(
                {
                    "display": str(m.get("model_display_name") or model),
                    "model": model,
                    "base_url": base_url,
                    "api_key": key,
                    "max_tokens": max_tokens or self.GROQ_MAX_TOKENS,
                }
            )

        if not chain:
            log.warning("%s has no usable custom_models entries", path.name)
            return self

        # MODELS_CONFIG_SELECT promotes the matched entry to primary.
        wanted = self.MODELS_CONFIG_SELECT.strip().lower()
        if wanted:
            for i, c in enumerate(chain):
                if wanted in {c["display"].lower(), c["model"].lower()}:
                    chain.insert(0, chain.pop(i))
                    break

        # The primary also populates the Groq-shaped fields (health checks and
        # single-provider mode read these). The "provider" field in the JSON is
        # descriptive, not authoritative.
        primary = chain[0]
        object.__setattr__(self, "GROQ_API_KEY", primary["api_key"])
        object.__setattr__(self, "GROQ_LLM_MODEL", primary["model"])
        object.__setattr__(self, "GROQ_BASE_URL", primary["base_url"])
        object.__setattr__(self, "GROQ_MAX_TOKENS", primary["max_tokens"])
        object.__setattr__(self, "LLM_CHAIN", chain)

        log.info(
            "Loaded %d model(s) from %s: %s",
            len(chain),
            path.name,
            " -> ".join(c["display"] for c in chain),
        )
        return self


settings = Settings()
