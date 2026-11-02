"""On-disk index layout, the `document_index` table, and the in-process cache.

Layout under `index_root/{document_id}/`:
    vectors.faiss    faiss.IndexFlatIP, row i = rows[i].chunk_id
    embeddings.npy   the same float32 matrix
    lexical.json     tokenized chunks and BM25 parameters
    meta.json        IndexInfo and row metadata

The store interface does not offer index paths or a database yet, so this module
owns its directory and creates `document_index` in `papercast.db` beside
`index_root`. Move both behind the store once it is backed by SQLite; the table's
foreign key to `document` is left out until that table exists.
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
import threading
from collections import OrderedDict
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from filelock import FileLock

from app.core.config import get_retrieval_settings
from app.schemas.retrieval import (
    IndexInfo,
    IndexStatus,
    RetrievalError,
    RetrievalErrorCode,
)
from app.services.retrieval.embedder import load_faiss
from app.services.retrieval.lexical import BM25Index
from app.services.retrieval.telemetry import utc_now

_VECTORS = "vectors.faiss"
_EMBEDDINGS = "embeddings.npy"
_LEXICAL = "lexical.json"
_META = "meta.json"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS document_index (
    document_id     TEXT PRIMARY KEY,
    status          TEXT NOT NULL CHECK (status IN
                      ('not_built','building','ready','stale','failed')),
    model_id        TEXT NOT NULL,
    dim             INTEGER NOT NULL,
    chunk_count     INTEGER NOT NULL,
    excluded_count  INTEGER NOT NULL DEFAULT 0,
    truncated_count INTEGER NOT NULL DEFAULT 0,
    content_hash    TEXT NOT NULL,
    index_dir       TEXT NOT NULL,
    built_at        TEXT NOT NULL,
    build_ms        INTEGER NOT NULL,
    error           TEXT
)
"""


@dataclass(frozen=True)
class RowMeta:
    row: int
    chunk_id: str
    page: int | None
    section_id: str | None
    section_title: str | None
    paragraph: int | None
    words: int


@dataclass(frozen=True)
class LoadedIndex:
    dense: object  # faiss.IndexFlatIP
    vectors: np.ndarray
    lexical: BM25Index
    rows: list[RowMeta]

    @property
    def size(self) -> int:
        return len(self.rows)


CacheKey = tuple[str, str, str]  # document_id, content_hash, model_id

_cache: OrderedDict[CacheKey, LoadedIndex] = OrderedDict()
_cache_lock = threading.Lock()


# --------------------------------------------------------------------------- #
# Paths and locks
# --------------------------------------------------------------------------- #
def _root() -> Path:
    root = Path(get_retrieval_settings().index_root)
    root.mkdir(parents=True, exist_ok=True)
    return root


def index_dir(document_id: str) -> Path:
    return _root() / document_id


def lock(document_id: str) -> FileLock:
    """Per-document lock, so two builds cannot write one directory at once."""
    locks = _root() / ".locks"
    locks.mkdir(exist_ok=True)
    return FileLock(locks / f"{document_id}.lock")


# --------------------------------------------------------------------------- #
# Index files
# --------------------------------------------------------------------------- #
def write_atomic(
    document_id: str,
    dense: object,
    vectors: np.ndarray,
    lexical: BM25Index,
    meta: dict,
) -> None:
    """Write all files, renaming into place only after every write succeeds."""
    faiss = load_faiss()
    root = _root()
    tmp = Path(tempfile.mkdtemp(dir=root, prefix=f".{document_id}-"))
    try:
        faiss.write_index(dense, str(tmp / _VECTORS))
        np.save(tmp / _EMBEDDINGS, vectors)
        lexical.save(tmp / _LEXICAL)
        (tmp / _META).write_text(json.dumps(meta), encoding="utf-8")

        final = root / document_id
        if final.exists():
            shutil.rmtree(final)
        tmp.rename(final)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def read(document_id: str) -> LoadedIndex:
    """Load an index, raising INDEX_CORRUPT if files are missing or disagree."""
    faiss = load_faiss()
    path = index_dir(document_id)
    try:
        dense = faiss.read_index(str(path / _VECTORS))
        vectors = np.load(path / _EMBEDDINGS)
        lexical = BM25Index.load(path / _LEXICAL)
        meta = json.loads((path / _META).read_text(encoding="utf-8"))
        rows = [RowMeta(**row) for row in meta["rows"]]
    except (OSError, RuntimeError, ValueError, KeyError, TypeError) as e:
        raise RetrievalError(RetrievalErrorCode.INDEX_CORRUPT, str(e)) from e

    if not dense.ntotal == len(vectors) == lexical.size == len(rows):
        raise RetrievalError(
            RetrievalErrorCode.INDEX_CORRUPT, "row counts disagree with meta.json"
        )
    return LoadedIndex(dense=dense, vectors=vectors, lexical=lexical, rows=rows)


# --------------------------------------------------------------------------- #
# document_index table
# --------------------------------------------------------------------------- #
def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_root().parent / "papercast.db", timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute(_SCHEMA)
    return conn


def upsert_row(info: IndexInfo) -> None:
    with closing(_connect()) as conn, conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO document_index (
                document_id, status, model_id, dim, chunk_count, excluded_count,
                truncated_count, content_hash, index_dir, built_at, build_ms, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                info.document_id,
                info.status.value,
                info.model_id,
                info.dim,
                info.chunk_count,
                info.excluded_count,
                info.truncated_count,
                info.content_hash,
                str(index_dir(info.document_id)),
                info.built_at,
                info.build_ms,
                info.error,
            ),
        )


def mark(
    document_id: str,
    status: IndexStatus,
    model_id: str,
    content_hash: str,
    error: str | None = None,
) -> None:
    """Record a non-READY status, for a build that is running or has failed."""
    upsert_row(
        IndexInfo(
            document_id=document_id,
            status=status,
            model_id=model_id,
            dim=0,
            chunk_count=0,
            excluded_count=0,
            truncated_count=0,
            content_hash=content_hash,
            built_at=utc_now(),
            build_ms=0,
            error=error,
        )
    )


def get_info(document_id: str) -> IndexInfo | None:
    with closing(_connect()) as conn:
        row = conn.execute(
            "SELECT * FROM document_index WHERE document_id = ?", (document_id,)
        ).fetchone()
    if row is None:
        return None
    fields = {k: row[k] for k in row.keys() if k != "index_dir"}
    return IndexInfo(**fields)


# --------------------------------------------------------------------------- #
# LRU cache
# --------------------------------------------------------------------------- #
def cache_get(key: CacheKey) -> LoadedIndex | None:
    with _cache_lock:
        loaded = _cache.get(key)
        if loaded is not None:
            _cache.move_to_end(key)
        return loaded


def cache_put(key: CacheKey, loaded: LoadedIndex) -> None:
    with _cache_lock:
        _cache[key] = loaded
        _cache.move_to_end(key)
        while len(_cache) > get_retrieval_settings().cache_size:
            _cache.popitem(last=False)


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()
