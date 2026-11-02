"""Embedding model access.

The model loads once per process, on first use, so importing this package stays
cheap and tests can run offline with a fake (`set_embedder`). Vectors are
L2-normalized float32, so FAISS inner product equals cosine similarity.
"""
from __future__ import annotations

import threading
from typing import Protocol

import numpy as np

from app.core.config import get_retrieval_settings
from app.schemas.retrieval import RetrievalError, RetrievalErrorCode


class Embedder(Protocol):
    @property
    def model_id(self) -> str:
        ...

    def encode(self, texts: list[str]) -> np.ndarray:
        """Return an (n, d) float32, L2-normalized matrix."""
        ...

    def count_truncated(self, texts: list[str]) -> int:
        """Return how many texts exceed the model's input window."""
        ...


class SentenceTransformerEmbedder:
    def __init__(self, model_id: str, batch_size: int, device: str) -> None:
        # See `load_faiss`: this import must happen before faiss is imported.
        import sentence_transformers  # noqa: F401

        self._model_id = model_id
        self._batch_size = batch_size
        self._device = device
        self._model = None
        self._load_lock = threading.Lock()

    @property
    def model_id(self) -> str:
        return self._model_id

    def encode(self, texts: list[str]) -> np.ndarray:
        try:
            vectors = self._load().encode(
                texts,
                batch_size=self._batch_size,
                normalize_embeddings=True,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
        except RetrievalError:
            raise
        except Exception as e:
            raise RetrievalError(RetrievalErrorCode.EMBEDDING_ERROR, str(e)) from e
        return np.asarray(vectors, dtype=np.float32)

    def count_truncated(self, texts: list[str]) -> int:
        model = self._load()
        tokenized = model.tokenizer(texts, truncation=False)["input_ids"]
        return sum(len(ids) > model.max_seq_length for ids in tokenized)

    def _load(self):
        if self._model is None:
            with self._load_lock:
                if self._model is None:
                    try:
                        from sentence_transformers import SentenceTransformer

                        self._model = SentenceTransformer(
                            self._model_id, device=self._device
                        )
                    except Exception as e:
                        raise RetrievalError(
                            RetrievalErrorCode.EMBEDDING_ERROR, str(e)
                        ) from e
        return self._model


_embedder: Embedder | None = None
_embedder_lock = threading.Lock()


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        with _embedder_lock:
            if _embedder is None:
                cfg = get_retrieval_settings()
                _embedder = SentenceTransformerEmbedder(
                    cfg.embedding_model, cfg.embedding_batch_size, cfg.embedding_device
                )
    return _embedder


def set_embedder(embedder: Embedder | None) -> None:
    """Replace the process embedder. `None` restores the configured model."""
    global _embedder
    _embedder = embedder


def load_faiss():
    """Import faiss after the embedder's libraries. Always import faiss this way.

    On Apple Silicon, importing faiss before torch makes the first model encode
    segfault, because both load their own OpenMP runtime. A segfault kills the
    server process, so no exception handler can catch it. Creating the embedder
    first fixes the order.
    """
    get_embedder()
    import faiss

    return faiss
