"""In-memory store (dev only).

A tiny process-local store so the scaffold runs without a database. Swap for
SQLite + FAISS, then PostgreSQL + pgvector + S3 as the data layer matures.

TODO(owner, data layer): replace with a real persistence layer behind this same
dict-like interface.
"""
from __future__ import annotations

from app.core.schemas import Document, Episode

_documents: dict[str, Document] = {}
_episodes: dict[str, Episode] = {}


def save_document(doc: Document) -> None:
    _documents[doc.document_id] = doc


def get_document(document_id: str) -> Document | None:
    return _documents.get(document_id)


def save_episode(episode: Episode) -> None:
    _episodes[episode.document_id] = episode


def get_episode(document_id: str) -> Episode | None:
    return _episodes.get(document_id)
