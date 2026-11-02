"""Shared test setup.

Every test gets a deterministic fake embedder and a temporary index directory,
so the suite runs offline, never downloads a model, and leaves nothing on disk
(SR-NF-9).
"""
from __future__ import annotations

import hashlib
import re
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest

from app.core.config import get_retrieval_settings
from app.services.retrieval import embedder, index_store
from app.services.retrieval.telemetry import counters

_DIM = 256


class FakeEmbedder:
    """Maps text to a vector by hashing its tokens, so shared words mean overlap."""

    def __init__(self, model_id: str = "fake-embedder") -> None:
        self._model_id = model_id
        self.encoded = 0

    @property
    def model_id(self) -> str:
        return self._model_id

    def encode(self, texts: list[str]) -> np.ndarray:
        self.encoded += len(texts)
        vectors = np.zeros((len(texts), _DIM), dtype=np.float32)
        for i, text in enumerate(texts):
            for token in re.findall(r"[a-z0-9.\-]+", text.lower()):
                digest = hashlib.sha256(token.encode()).digest()
                vectors[i, int.from_bytes(digest[:4], "big") % _DIM] += 1.0
            norm = np.linalg.norm(vectors[i])
            if norm:
                vectors[i] /= norm
        return vectors

    def count_truncated(self, texts: list[str]) -> int:
        return sum(len(t.split()) > 256 for t in texts)


@pytest.fixture(autouse=True)
def fake_embedder(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[FakeEmbedder]:
    monkeypatch.setenv("PAPERCAST_RETRIEVAL_INDEX_ROOT", str(tmp_path / "indexes"))
    get_retrieval_settings.cache_clear()
    index_store.clear_cache()
    counters.clear()

    fake = FakeEmbedder()
    embedder.set_embedder(fake)
    yield fake

    embedder.set_embedder(None)
    index_store.clear_cache()
    get_retrieval_settings.cache_clear()
