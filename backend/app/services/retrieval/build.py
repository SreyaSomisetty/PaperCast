"""Index build and freshness.

`build_index` runs once when ingestion finishes. `ensure_index` is called on
every query: it serves the cache, and rebuilds when the stored model id or content
hash no longer matches, so a stale index is never searched.
"""
from __future__ import annotations

import hashlib
import logging
import re
import time

from app.core.config import get_retrieval_settings
from app.core.schemas import Document, DocumentChunk
from app.schemas.retrieval import (
    IndexInfo,
    IndexStatus,
    RetrievalError,
    RetrievalErrorCode,
)
from app.services.retrieval import index_store, lexical
from app.services.retrieval.embedder import get_embedder, load_faiss
from app.services.retrieval.index_store import LoadedIndex
from app.services.retrieval.telemetry import counters, emit, utc_now

# Section titles are usually numbered ("7 References", "VII. References"), and
# exclusion matches on a prefix of the title itself.
_SECTION_NUMBER = re.compile(r"^(?:\d+(?:\.\d+)*|[ivxlc]+)[.)]?\s+")


# --------------------------------------------------------------------------- #
# Row selection
# --------------------------------------------------------------------------- #
def _is_excluded(chunk: DocumentChunk, excluded: list[str]) -> bool:
    title = _SECTION_NUMBER.sub("", (chunk.location.section or "").strip().lower())
    return title.startswith(tuple(excluded))


def select_rows(document: Document) -> list[DocumentChunk]:
    """Return the indexable chunks in order. Row i of every structure is rows[i]."""
    excluded = [s.lower() for s in get_retrieval_settings().exclude_sections]
    return [
        c
        for c in document.chunks
        if c.text.strip() and not _is_excluded(c, excluded)
    ]


def content_hash(rows: list[DocumentChunk]) -> str:
    h = hashlib.sha256()
    for chunk in rows:
        h.update(chunk.chunk_id.encode())
        h.update(b"\x00")
        h.update(chunk.text.encode())
        h.update(b"\x01")
    return h.hexdigest()


def _embedding_text(chunk: DocumentChunk) -> str:
    # The section title gives short chunks context: "it improves by 2 points" is
    # easier to match when it is known to be in Results.
    title = chunk.location.section
    return f"{title}: {chunk.text}" if title else chunk.text


def _row_meta(row: int, chunk: DocumentChunk) -> dict:
    # Ingestion has no section ids yet, so the title serves as the id. This is
    # the one place to change when `DocumentChunk` gains a `section_id`.
    return {
        "row": row,
        "chunk_id": chunk.chunk_id,
        "page": chunk.location.page,
        "section_id": chunk.location.section,
        "section_title": chunk.location.section,
        "paragraph": chunk.location.paragraph,
        "words": len(chunk.text.split()),
    }


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #
def _is_current(info: IndexInfo | None, digest: str, model_id: str) -> bool:
    return (
        info is not None
        and info.status is IndexStatus.READY
        and info.content_hash == digest
        and info.model_id == model_id
        and index_store.index_dir(info.document_id).is_dir()
    )


def build_index(document: Document, force: bool = False) -> IndexInfo:
    """Build the dense and lexical indexes for `document`.

    A second build for the same document waits on a per-document lock and then
    reuses the result, unless `force` is set.
    """
    started = time.perf_counter()
    document_id = document.document_id
    embedder = get_embedder()
    with index_store.lock(document_id):
        rows = select_rows(document)
        if not rows:
            raise RetrievalError(RetrievalErrorCode.EMPTY_DOCUMENT, document_id)

        digest = content_hash(rows)
        existing = index_store.get_info(document_id)
        if not force and _is_current(existing, digest, embedder.model_id):
            return existing

        emit(
            logging.INFO,
            "index.build_started",
            document_id=document_id,
            chunks=len(rows),
            model_id=embedder.model_id,
        )
        index_store.mark(
            document_id, IndexStatus.BUILDING, embedder.model_id, digest
        )
        try:
            texts = [_embedding_text(c) for c in rows]
            vectors = embedder.encode(texts)
            dense = load_faiss().IndexFlatIP(vectors.shape[1])
            dense.add(vectors)

            cfg = get_retrieval_settings()
            bm25 = lexical.BM25Index.build(
                [c.text for c in rows], k1=cfg.bm25_k1, b=cfg.bm25_b
            )
            info = IndexInfo(
                document_id=document_id,
                status=IndexStatus.READY,
                model_id=embedder.model_id,
                dim=vectors.shape[1],
                chunk_count=len(rows),
                excluded_count=len(document.chunks) - len(rows),
                truncated_count=embedder.count_truncated(texts),
                content_hash=digest,
                built_at=utc_now(),
                build_ms=int((time.perf_counter() - started) * 1000),
            )
            meta = {
                "info": info.model_dump(mode="json"),
                "params": {
                    "bm25": {"k1": cfg.bm25_k1, "b": cfg.bm25_b},
                    "embedding_text": "section_title: text",
                },
                "rows": [_row_meta(i, c) for i, c in enumerate(rows)],
            }
            index_store.write_atomic(
                document_id, dense=dense, vectors=vectors, lexical=bm25, meta=meta
            )
        except Exception as e:
            code = (
                e.code
                if isinstance(e, RetrievalError)
                else RetrievalErrorCode.EMBEDDING_ERROR
            )
            index_store.mark(
                document_id,
                IndexStatus.FAILED,
                embedder.model_id,
                digest,
                error=str(e),
            )
            emit(
                logging.ERROR,
                "index.build_failed",
                document_id=document_id,
                error_code=code.value,
                message=str(e),
            )
            if isinstance(e, RetrievalError):
                raise
            raise RetrievalError(code, str(e)) from e

        index_store.upsert_row(info)

    counters["index_builds"] += 1
    counters["index_build_ms"] += info.build_ms
    counters["chunks_indexed"] += info.chunk_count
    counters["chunks_excluded"] += info.excluded_count
    counters["chunks_truncated"] += info.truncated_count
    emit(
        logging.INFO,
        "index.built",
        document_id=document_id,
        chunk_count=info.chunk_count,
        excluded_count=info.excluded_count,
        truncated_count=info.truncated_count,
        dim=info.dim,
        build_ms=info.build_ms,
    )
    return info


# --------------------------------------------------------------------------- #
# Freshness
# --------------------------------------------------------------------------- #
def _stale_reason(info: IndexInfo, digest: str, model_id: str) -> str | None:
    if info.model_id != model_id:
        return "model_changed"
    if info.content_hash != digest:
        return "content_changed"
    if info.status is not IndexStatus.READY:
        return "not_ready"
    return None


def ensure_index(document: Document) -> LoadedIndex:
    """Return a loaded index matching `document`, rebuilding it if needed."""
    document_id = document.document_id
    rows = select_rows(document)
    if not rows:
        raise RetrievalError(RetrievalErrorCode.EMPTY_DOCUMENT, document_id)

    digest = content_hash(rows)
    model_id = get_embedder().model_id
    key = (document_id, digest, model_id)
    cached = index_store.cache_get(key)
    if cached is not None:
        counters["index_cache_hits"] += 1
        return cached
    counters["index_cache_misses"] += 1

    info = index_store.get_info(document_id)
    reason = _stale_reason(info, digest, model_id) if info else None
    if reason:
        counters["index_rebuilds_stale"] += 1
        emit(logging.WARNING, "index.stale", document_id=document_id, reason=reason)
        index_store.mark(document_id, IndexStatus.STALE, info.model_id, info.content_hash)
    if info is None or reason:
        build_index(document)

    try:
        loaded = index_store.read(document_id)
    except RetrievalError:
        # One automatic rebuild. If the fresh files are also unreadable, the
        # failure is not in the index, so report it as a build failure.
        build_index(document, force=True)
        try:
            loaded = index_store.read(document_id)
        except RetrievalError as e:
            raise RetrievalError(
                RetrievalErrorCode.EMBEDDING_ERROR, str(e)
            ) from e

    index_store.cache_put(key, loaded)
    return loaded
