from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from app.config import settings
from app.core.ingestion import ingest_file, list_pdfs, refresh_all
from app.deps import require_admin

router = APIRouter()


def _safe_filename(name: str) -> str:
    name = Path(name).name  # strip any path components
    if not name.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Only .pdf files are accepted."
        )
    return name


@router.get("/documents")
async def list_documents(request: Request) -> dict:
    store = request.app.state.store
    counts = store.list_sources()
    data_dir = Path(settings.DATA_DIR)
    files = []
    for p in list_pdfs(data_dir):
        try:
            size = p.stat().st_size
        except OSError:
            size = 0
        files.append(
            {
                "name": p.name,
                "size_bytes": size,
                "chunks": counts.get(p.name, 0),
            }
        )
    # Also surface sources indexed but missing on disk (shouldn't happen normally)
    on_disk = {f["name"] for f in files}
    for src, n in counts.items():
        if src not in on_disk:
            files.append({"name": src, "size_bytes": 0, "chunks": n, "missing": True})
    return {"files": files, "total_chunks": sum(f["chunks"] for f in files)}


@router.post("/documents/upload", dependencies=[Depends(require_admin)])
async def upload_document(request: Request, file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    name = _safe_filename(file.filename)
    data_dir = Path(settings.DATA_DIR)
    data_dir.mkdir(parents=True, exist_ok=True)
    dest = data_dir / name
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file")
    dest.write_bytes(contents)

    rag = request.app.state.rag
    store = request.app.state.store
    # Remove any prior chunks for this filename so re-uploads are clean
    store.delete_by_source(name)
    added = await ingest_file(dest, rag.embedder, store)
    return {"name": name, "size_bytes": len(contents), "chunks_added": added}


@router.post("/documents/refresh", dependencies=[Depends(require_admin)])
async def refresh(request: Request) -> dict:
    rag = request.app.state.rag
    store = request.app.state.store
    result = await refresh_all(rag.embedder, store)
    return result


@router.delete("/documents/{filename}", dependencies=[Depends(require_admin)])
async def delete_document(filename: str, request: Request) -> dict:
    name = _safe_filename(filename)
    store = request.app.state.store
    removed = store.delete_by_source(name)
    data_dir = Path(settings.DATA_DIR)
    path = data_dir / name
    file_removed = False
    if path.exists() and path.is_file():
        path.unlink()
        file_removed = True
    return {"name": name, "chunks_removed": removed, "file_removed": file_removed}
