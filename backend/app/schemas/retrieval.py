"""Retrieval-only data contracts (spec: Data Structures).

`EvidencePassage` is shared across stages and stays in `app.core.schemas`. The
types here are used only by the retrieval service, its debug tools, and the API
error handler.
"""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field

from app.core.schemas import EvidencePassage

MAX_QUERY_CHARS = 200


class IndexStatus(str, Enum):
    NOT_BUILT = "not_built"
    BUILDING = "building"
    READY = "ready"
    STALE = "stale"  # model id or content hash no longer matches
    FAILED = "failed"


class RetrievalErrorCode(str, Enum):
    INVALID_QUERY = "INVALID_QUERY"
    DOCUMENT_NOT_FOUND = "DOCUMENT_NOT_FOUND"
    EMPTY_DOCUMENT = "EMPTY_DOCUMENT"
    EMBEDDING_ERROR = "EMBEDDING_ERROR"
    INDEX_CORRUPT = "INDEX_CORRUPT"


class RetrievalError(Exception):
    """Raised for invalid input or an internal failure, never for no matches."""

    def __init__(self, code: RetrievalErrorCode, detail: str = "") -> None:
        super().__init__(f"{code.value}: {detail}" if detail else code.value)
        self.code = code
        self.detail = detail


class RetrievalQuery(BaseModel):
    document_id: str
    query: str = Field(min_length=3, max_length=MAX_QUERY_CHARS)
    k: int = Field(default=5, ge=1, le=20)  # top-k = 5, workbook Table 7.4
    sections: list[str] | None = None  # section filter, ranked first


class IndexInfo(BaseModel):
    document_id: str
    status: IndexStatus
    model_id: str
    dim: int
    chunk_count: int
    excluded_count: int  # empty or reference chunks
    truncated_count: int  # chunks longer than the model window
    content_hash: str  # sha256 of ids and texts, hex
    built_at: str  # ISO 8601 UTC
    build_ms: int
    error: str | None = None


class RetrievalResult(BaseModel):
    """Returned by the debug endpoint."""

    query: RetrievalQuery
    passages: list[EvidencePassage]
    candidates: int  # size of the dense and lexical union
    latency_ms: int
