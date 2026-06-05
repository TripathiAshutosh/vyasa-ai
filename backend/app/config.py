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

        wanted = self.MODELS_CONFIG_SELECT.strip().lower()
        picked = None
        if wanted:
            for m in entries:
                names = {
                    str(m.get("model_display_name", "")).lower(),
                    str(m.get("model", "")).lower(),
                }
                if wanted in names:
                    picked = m
                    break
        if picked is None:
            picked = entries[0]

        # All these fields are Groq-shaped (OpenAI-compatible chat completions).
        # The "provider" field in the JSON is descriptive, not authoritative.
        if picked.get("api_key"):
            object.__setattr__(self, "GROQ_API_KEY", picked["api_key"])
        if picked.get("model"):
            object.__setattr__(self, "GROQ_LLM_MODEL", picked["model"])
        if picked.get("base_url"):
            object.__setattr__(self, "GROQ_BASE_URL", picked["base_url"])
        if picked.get("max_tokens"):
            # The JSON value is usually the *model's* total output ceiling (e.g. 65536).
            # For grounded Q&A we want a much smaller per-request budget — capping at
            # 4096 keeps reasoning + answer well under any model's limit.
            try:
                object.__setattr__(self, "GROQ_MAX_TOKENS", min(int(picked["max_tokens"]), 4096))
            except (TypeError, ValueError):
                pass

        log.info(
            "Loaded model from %s: display=%r model=%s",
            path.name,
            picked.get("model_display_name"),
            picked.get("model"),
        )
        return self


settings = Settings()
