"""Tokenizer and BM25 lexical index (BM25Okapi over `rank_bm25`).

Numbers such as 28.4 and terms such as self-attention stay single tokens, and no
stemming is applied, because exact term forms carry meaning in technical text.
The same tokenizer is used for chunks and queries.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

import numpy as np
from rank_bm25 import BM25Okapi

_TOKEN = re.compile(r"[a-z0-9]+(?:[.\-][a-z0-9]+)*")

STOPWORDS = frozenset(
    """
    a about above after again all also am an and any are as at be because been
    before being below between both but by can could did do does doing down
    during each few for from further had has have having he her here hers him
    his how i if in into is it its itself just me more most my no nor not of
    off on once only or other our out over own same she should so some such
    than that the their them then there these they this those through to too
    under until up very was we were what when where which while who whom why
    will with would you your
    """.split()
)


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in STOPWORDS]


class BM25Index:
    """BM25 over tokenized chunks. Row i corresponds to `chunk_ids[i]`."""

    def __init__(self, tokens: list[list[str]], k1: float, b: float) -> None:
        self._tokens = tokens
        self._terms = [frozenset(t) for t in tokens]
        self.k1 = k1
        self.b = b
        # BM25Okapi cannot be built over a corpus with no tokens at all, which
        # happens when every chunk is stopwords or non-Latin text.
        self._bm25 = BM25Okapi(tokens, k1=k1, b=b) if any(tokens) else None

    @classmethod
    def build(cls, texts: list[str], k1: float, b: float) -> BM25Index:
        return cls([tokenize(t) for t in texts], k1=k1, b=b)

    @property
    def size(self) -> int:
        return len(self._tokens)

    def terms(self, row: int) -> frozenset[str]:
        return self._terms[row]

    def scores(self, query: str) -> np.ndarray:
        """Return one BM25 score per row, floored at 0.

        A term present in most chunks of a small corpus gets a non-positive IDF
        from BM25Okapi, which is not evidence of a match.
        """
        if self._bm25 is None:
            return np.zeros(self.size)
        return np.maximum(self._bm25.get_scores(tokenize(query)), 0.0)

    def top(self, query: str, n: int) -> list[int]:
        """Return up to `n` rows with a positive score, best first."""
        scores = self.scores(query)
        matched = [r for r in range(self.size) if scores[r] > 0.0]
        return sorted(matched, key=lambda r: (-scores[r], r))[:n]

    def save(self, path: Path) -> None:
        doc_freq = Counter(term for terms in self._terms for term in terms)
        lengths = [len(t) for t in self._tokens]
        payload = {
            "k1": self.k1,
            "b": self.b,
            "avg_length": sum(lengths) / len(lengths),
            "doc_freq": dict(sorted(doc_freq.items())),
            "tokens": self._tokens,
        }
        path.write_text(json.dumps(payload), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> BM25Index:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return cls(payload["tokens"], k1=payload["k1"], b=payload["b"])
