from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

import fitz  # PyMuPDF
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.config import settings
from app.core.embeddings import Embedder
from app.core.vectorstore import VectorStore


@dataclass
class Chunk:
    id: str
    text: str
    source: str
    page: int


_WS = re.compile(r"[ \t]+")
_NL = re.compile(r"\n{3,}")


def _clean(text: str) -> str:
    text = text.replace("\r", "\n")
    text = _WS.sub(" ", text)
    text = _NL.sub("\n\n", text)
    return text.strip()


def _splitter() -> RecursiveCharacterTextSplitter:
    return RecursiveCharacterTextSplitter(
        chunk_size=settings.CHUNK_SIZE,
        chunk_overlap=settings.CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
        length_function=len,
    )


def _hash_id(source: str, page: int, idx: int, text: str) -> str:
    h = hashlib.sha1()
    h.update(source.encode("utf-8"))
    h.update(b"|")
    h.update(str(page).encode("utf-8"))
    h.update(b"|")
    h.update(str(idx).encode("utf-8"))
    h.update(b"|")
    h.update(text[:64].encode("utf-8"))
    return h.hexdigest()


def parse_pdf(path: Path) -> list[Chunk]:
    """Parse a PDF into page-aware chunks."""
    source = path.name
    splitter = _splitter()
    chunks: list[Chunk] = []
    with fitz.open(path) as doc:
        for page_idx, page in enumerate(doc, start=1):
            raw = page.get_text("text") or ""
            text = _clean(raw)
            if not text:
                continue
            pieces = splitter.split_text(text)
            for i, piece in enumerate(pieces):
                piece = piece.strip()
                if len(piece) < 40:  # skip tiny noise chunks
                    continue
                chunks.append(
                    Chunk(
                        id=_hash_id(source, page_idx, i, piece),
                        text=piece,
                        source=source,
                        page=page_idx,
                    )
                )
    return chunks


def list_pdfs(data_dir: Path) -> list[Path]:
    if not data_dir.exists():
        return []
    return sorted([p for p in data_dir.iterdir() if p.suffix.lower() == ".pdf"])


async def ingest_file(path: Path, embedder: Embedder, store: VectorStore) -> int:
    chunks = parse_pdf(path)
    if not chunks:
        return 0
    texts = [c.text for c in chunks]
    embeddings = await embedder.embed_documents(texts)
    store.add(
        ids=[c.id for c in chunks],
        embeddings=embeddings,
        documents=texts,
        metadatas=[{"source": c.source, "page": c.page} for c in chunks],
    )
    return len(chunks)


async def refresh_all(embedder: Embedder, store: VectorStore) -> dict:
    store.reset()
    data_dir = Path(settings.DATA_DIR)
    pdfs = list_pdfs(data_dir)
    per_file: dict[str, int] = {}
    for pdf in pdfs:
        count = await ingest_file(pdf, embedder, store)
        per_file[pdf.name] = count
    return {"files": per_file, "total_chunks": sum(per_file.values())}
