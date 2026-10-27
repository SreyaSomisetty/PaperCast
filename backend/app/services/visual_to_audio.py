"""Visual-to-Audio service (FR-D5 — desired, post Phase 1).

Turns figures, tables, and equations into spoken explanations while preserving
their source location.

TODO(owner): detect visual elements during extraction and describe them. This
module is a placeholder interface only.
"""
from __future__ import annotations

from app.core.schemas import DocumentChunk


def describe_visual(chunk: DocumentChunk) -> str:
    """Produce a spoken-language description of a figure/table/equation.

    Stub: returns a placeholder string.
    """
    # TODO(owner): route figures/tables/equations to a multimodal model and
    # return an audio-friendly description.
    return "[placeholder] visual description not yet implemented."
