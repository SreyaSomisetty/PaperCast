"""Document Understanding service (FR-E2).

Extracts text and preserves page/section/paragraph/table/figure references.
Planned tech: PyMuPDF / Unstructured, with GROBID and Marker for structure.

TODO(owner): replace the stub with real PDF extraction. Keep the signature:
    extract(document_id, file_path) -> Document
"""
from __future__ import annotations

from pathlib import Path

from app.core.schemas import Document, DocumentChunk, SourceLocation


def extract(document_id: str, file_path: Path) -> Document:
    """Parse a PDF into chunks with source locations.

    Stub: returns a single placeholder chunk. Real implementation should split
    the document into retrievable chunks and populate `SourceLocation`.
    """
    # TODO(owner): use PyMuPDF to open `file_path`, iterate pages/blocks, and
    # emit one DocumentChunk per paragraph with accurate SourceLocation.
    placeholder = DocumentChunk(
        chunk_id=f"{document_id}-c0",
        text="[placeholder] Extracted document text will appear here.",
        location=SourceLocation(page=1, section="Abstract", paragraph=1),
    )
    return Document(
        document_id=document_id,
        filename=file_path.name,
        num_pages=1,
        chunks=[placeholder],
    )
