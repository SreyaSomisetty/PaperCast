"""Score calibration, fusion, and candidate selection.

The orchestration loop filters by an absolute threshold, so a fused score must
mean the same thing for every query. These functions take plain arrays and
dataclasses so the rules can be unit-tested without an index.
"""
from __future__ import annotations

from collections.abc import Set
from dataclasses import dataclass

import numpy as np

from app.services.retrieval.lexical import BM25Index, tokenize

# Below this best raw BM25 score, the lexical signal is treated as absent.
_MIN_BM25 = 0.5


def lexical_scores(bm25: BM25Index, query: str, rows: list[int]) -> np.ndarray:
    """Return BM25 normalized over `rows`, multiplied by query-term coverage.

    Coverage stops the best of a set of weak matches from receiving a full 1.0.
    """
    terms = set(tokenize(query))
    raw = bm25.scores(query)[rows]
    if not terms or raw.max(initial=0.0) < _MIN_BM25:
        return np.zeros(len(rows))
    coverage = np.array([len(terms & bm25.terms(r)) / len(terms) for r in rows])
    return (raw / raw.max()) * coverage


def weighted(dense: np.ndarray, lex: np.ndarray, w: float = 0.7) -> np.ndarray:
    return np.minimum(1.0, w * dense + (1 - w) * lex)


def jaccard(a: Set[str], b: Set[str]) -> float:
    return len(a & b) / len(a | b) if a or b else 1.0


@dataclass(frozen=True)
class Candidate:
    row: int
    chunk_id: str
    page: int
    score: float
    dense: float
    lexical: float
    terms: frozenset[str]
    in_section: bool


def _score_key(c: Candidate) -> tuple[float, int, str]:
    # Rounded so float noise cannot reorder equal scores between runs.
    return (-round(c.score, 6), c.page, c.chunk_id)


def select(
    candidates: list[Candidate],
    k: int,
    floor: float,
    dedup_threshold: float,
) -> tuple[list[Candidate], int]:
    """Pick the top `k` candidates and return them with the duplicates dropped.

    Candidates in the requested sections are taken first and the others only fill
    the remaining slots, so a wrong section in the plan cannot hide the only
    supporting passage. Output order is score descending, then page, then
    chunk_id, whichever section a passage came from.
    """
    visit = sorted(candidates, key=lambda c: (not c.in_section, *_score_key(c)))
    kept: list[Candidate] = []
    duplicates = 0
    for candidate in visit:
        if len(kept) == k:
            break
        if candidate.score < floor:
            continue
        if any(
            jaccard(candidate.terms, other.terms) >= dedup_threshold for other in kept
        ):
            duplicates += 1
            continue
        kept.append(candidate)
    return sorted(kept, key=_score_key), duplicates
