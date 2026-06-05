from __future__ import annotations

import logging
import math
import threading

from app.config import settings

from . import db

log = logging.getLogger("phd_bot.analytics.clustering")

# In-memory centroid cache for the *current* embedding model only. Vectors from
# different models/dimensions are never compared (a provider switch starts fresh
# clusters; old ones stay in the DB for history).
_lock = threading.Lock()
_centroids: list[dict] = []  # {id, vec (L2-normalized), count}
_model: str | None = None


def _normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vec))
    if norm == 0:
        return vec
    return [x / norm for x in vec]


def _dot(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def load_cache(embed_model: str) -> None:
    global _centroids, _model
    with _lock:
        _model = embed_model
        _centroids = [
            {**c, "vec": _normalize(c["vec"])} for c in db.load_centroids(embed_model)
        ]
    log.info("Loaded %d intent clusters for model %s", len(_centroids), embed_model)


def assign_or_create(embedding: list[float], embed_model: str) -> tuple[int, bool]:
    """Assign the query to its nearest intent cluster, or create a new one.

    Returns (cluster_id, is_new). Caller holds no locks; this is thread-safe and
    runs off the event loop (pure-Python math is a few ms at this scale).
    """
    emb = _normalize(embedding)
    with _lock:
        if _model != embed_model:
            # Provider switched at runtime (shouldn't happen) — reload defensively.
            _reload_locked(embed_model)
        best, best_sim = None, -1.0
        for c in _centroids:
            if len(c["vec"]) != len(emb):
                continue
            sim = _dot(c["vec"], emb)
            if sim > best_sim:
                best, best_sim = c, sim

        if best is not None and best_sim >= settings.CLUSTER_THRESHOLD:
            # Running-mean centroid update, re-normalized.
            n = best["count"]
            merged = [(cv * n + ev) / (n + 1) for cv, ev in zip(best["vec"], emb)]
            best["vec"] = _normalize(merged)
            best["count"] = n + 1
            db.update_cluster_centroid(
                best["id"], db.vec_to_blob(best["vec"]), best["count"]
            )
            return best["id"], False

        cluster_id = db.insert_cluster(db.vec_to_blob(emb), len(emb), embed_model)
        _centroids.append({"id": cluster_id, "vec": emb, "count": 1})
        return cluster_id, True


def _reload_locked(embed_model: str) -> None:
    global _centroids, _model
    _model = embed_model
    _centroids = [
        {**c, "vec": _normalize(c["vec"])} for c in db.load_centroids(embed_model)
    ]
