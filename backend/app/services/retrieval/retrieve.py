"""Hybrid ranking.

Read-only and safe to call from several threads, because verification runs a
fresh retrieval per claim. An empty list means nothing matched; an exception
means invalid input or an internal failure.
"""
from __future__ import annotations

import logging
import time

import numpy as np
from pydantic import ValidationError

from app.core.config import get_retrieval_settings
from app.core.schemas import Document, DocumentChunk, EvidencePassage
from app.schemas.retrieval import (
    MAX_QUERY_CHARS,
    RetrievalError,
    RetrievalErrorCode,
    RetrievalQuery,
)
from app.services import store
from app.services.retrieval import fusion
from app.services.retrieval.build import ensure_index
from app.services.retrieval.embedder import get_embedder
from app.services.retrieval.fusion import Candidate
from app.services.retrieval.index_store import LoadedIndex, RowMeta
from app.services.retrieval.telemetry import counters, emit, query_hash


def _shorten(query: str) -> str:
    """Cut a long query at a word boundary.

    Verification searches on full claim text, and one long claim must not fail a
    whole run. The opening words are enough to find the passage.
    """
    if len(query) <= MAX_QUERY_CHARS:
        return query
    counters["queries_shortened"] += 1
    emit(logging.WARNING, "retrieve.query_shortened", query_length=len(query))
    cut = query[: MAX_QUERY_CHARS + 1].rpartition(" ")[0]
    return cut or query[:MAX_QUERY_CHARS]


def _validate(
    document_id: str, query: str, k: int, sections: list[str] | None
) -> RetrievalQuery:
    try:
        return RetrievalQuery(
            document_id=document_id,
            query=_shorten(" ".join(query.split())),
            k=k,
            sections=sections,
        )
    except ValidationError as e:
        emit(
            logging.WARNING,
            "retrieve.invalid_query",
            reason=e.errors()[0]["msg"],
            query_length=len(query),
            k=k,
        )
        raise RetrievalError(RetrievalErrorCode.INVALID_QUERY, str(e)) from e


def _candidates(q: RetrievalQuery, idx: LoadedIndex) -> list[Candidate]:
    """Search both indexes and score the union of their results."""
    cfg = get_retrieval_settings()
    query_vector = get_embedder().encode([cfg.embedding_query_prefix + q.query])[0]

    n = min(cfg.candidates, idx.size)
    _, dense_rows = idx.dense.search(query_vector[None, :], n)
    rows = sorted(set(dense_rows[0].tolist()) | set(idx.lexical.top(q.query, n)))

    dense = np.clip(idx.vectors[rows] @ query_vector, 0.0, 1.0)
    lex = fusion.lexical_scores(idx.lexical, q.query, rows)
    fused = fusion.weighted(dense, lex, w=cfg.dense_weight)

    sections = set(q.sections or ()) if cfg.section_filter else set()
    return [
        Candidate(
            row=row,
            chunk_id=idx.rows[row].chunk_id,
            page=idx.rows[row].page or 0,
            score=float(fused[i]),
            dense=float(dense[i]),
            lexical=float(lex[i]),
            terms=idx.lexical.terms(row),
            in_section=idx.rows[row].section_id in sections,
        )
        for i, row in enumerate(rows)
    ]


def _to_passage(
    document_id: str,
    chunk: DocumentChunk,
    meta: RowMeta,
    candidate: Candidate,
    rank: int,
) -> EvidencePassage:
    return EvidencePassage(
        document_id=document_id,
        chunk_id=chunk.chunk_id,
        text=chunk.text,
        location=chunk.location,
        score=round(candidate.score, 6),
        page=meta.page,
        section_id=meta.section_id,
        section_title=meta.section_title,
        paragraph=meta.paragraph,
        rank=rank,
        dense_score=round(candidate.dense, 6),
        lexical_score=round(candidate.lexical, 6),
    )


def retrieve(
    document: Document | str,
    query: str,
    k: int | None = None,
    sections: list[str] | None = None,
) -> list[EvidencePassage]:
    """Rank chunks against `query` and return the top `k` passages by score.

    `document` is a `Document` or a document id held by the store. `k` defaults
    to the configured `k`. Passages from `sections` are taken first, and other
    sections fill any remaining slots. Returns an empty list when nothing scores
    above the retrieval floor.
    """
    started = time.perf_counter()
    cfg = get_retrieval_settings()
    document_id = document if isinstance(document, str) else document.document_id
    q = _validate(document_id, query, cfg.k if k is None else k, sections)

    if isinstance(document, str):
        document = store.get_document(document)
        if document is None:
            raise RetrievalError(RetrievalErrorCode.DOCUMENT_NOT_FOUND, document_id)

    try:
        idx = ensure_index(document)
        candidates = _candidates(q, idx)
    except RetrievalError as e:
        emit(
            logging.ERROR,
            "retrieve.error",
            document_id=document_id,
            error_code=e.code.value,
            message=e.detail,
        )
        raise

    kept, duplicates = fusion.select(
        candidates, q.k, cfg.floor, cfg.dedup_threshold
    )

    chunks = {c.chunk_id: c for c in document.chunks}
    passages = [
        _to_passage(document_id, chunks[c.chunk_id], idx.rows[c.row], c, rank)
        for rank, c in enumerate(kept, start=1)
    ]

    counters["queries_total"] += 1
    counters["dedup_removed"] += duplicates
    digest = query_hash(q.query)
    if not passages:
        counters["queries_empty"] += 1
        emit(
            logging.WARNING,
            "retrieve.empty",
            document_id=document_id,
            query_hash=digest,
            best_score_below_floor=max((c.score for c in candidates), default=0.0),
        )
    emit(
        logging.INFO,
        "retrieve.query",
        document_id=document_id,
        query_hash=digest,
        k=q.k,
        sections=q.sections,
        candidates=len(candidates),
        returned=len(passages),
        top_score=passages[0].score if passages else 0.0,
        latency_ms=int((time.perf_counter() - started) * 1000),
    )
    emit(
        logging.DEBUG,
        "retrieve.result",
        query=q.query[:80],
        passages=[
            [p.chunk_id, p.score, p.dense_score, p.lexical_score] for p in passages
        ],
    )
    return passages
