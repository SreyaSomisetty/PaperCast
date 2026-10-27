"""Retrieval service (FR-E3).

Returns source passages relevant to a topic, plan item, or generated claim.
Planned tech: hybrid lexical + embedding search (Sentence Transformers, FAISS /
Chroma), backed by SQLite / JSONL.

TODO(owner): build an index at ingest time and query it here. Keep the
signature: retrieve(document, query, k) -> list[EvidencePassage]
"""
from __future__ import annotations

from app.core.schemas import Document, EvidencePassage


def retrieve(document: Document, query: str, k: int = 5) -> list[EvidencePassage]:
    """Rank document chunks against `query` and return the top `k`.

    Stub: returns the first `k` chunks with a flat score.
    """
    # TODO(owner): embed `query`, search the vector index, fuse with a lexical
    # (BM25) score, and return ranked EvidencePassage objects.
    passages: list[EvidencePassage] = []
    for chunk in document.chunks[:k]:
        passages.append(
            EvidencePassage(
                document_id=document.document_id,
                chunk_id=chunk.chunk_id,
                text=chunk.text,
                location=chunk.location,
                score=1.0,
            )
        )
    return passages
