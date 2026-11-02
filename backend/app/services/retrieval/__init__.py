"""Retrieval service (FR-E3).

Returns source passages relevant to a topic, plan item, or generated claim.
Hybrid search: a dense index (Sentence Transformers + FAISS) and a lexical index
(BM25) are built per document, and their scores are fused into one calibrated
score between 0 and 1 so the pipeline's absolute threshold stays meaningful.

Public API: `build_index`, `retrieve`, `get_index_info`, `RetrievalError`.
"""
from __future__ import annotations

from app.schemas.retrieval import RetrievalError, RetrievalErrorCode
from app.services.retrieval.build import build_index
from app.services.retrieval.index_store import get_info as get_index_info
from app.services.retrieval.retrieve import retrieve

__all__ = [
    "RetrievalError",
    "RetrievalErrorCode",
    "build_index",
    "get_index_info",
    "retrieve",
]
