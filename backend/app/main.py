from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat as chat_api
from app.api import documents as docs_api
from app.api import health as health_api
from app.config import settings
from app.core.embeddings import make_embedder
from app.core.llm import make_llm
from app.core.rag import RAGPipeline
from app.core.reranker import make_reranker
from app.core.vectorstore import get_store

log = logging.getLogger("phd_bot")
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting up with provider=%s", settings.PROVIDER)
    embedder = make_embedder()
    llm = make_llm()
    store = get_store()
    reranker = make_reranker()
    app.state.rag = RAGPipeline(embedder=embedder, llm=llm, store=store, reranker=reranker)
    app.state.store = store
    log.info(
        "Ready. embed=%s llm=%s reranker=%s chunks=%d",
        embedder.name,
        llm.name,
        reranker.name if reranker else "off",
        store.count(),
    )
    yield


app = FastAPI(
    title="PhD Admission Q&A",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_api.router, prefix="/api")
app.include_router(chat_api.router, prefix="/api")
app.include_router(docs_api.router, prefix="/api")


@app.get("/")
async def root() -> dict:
    return {"name": "phd-admission-qa", "docs": "/docs"}
