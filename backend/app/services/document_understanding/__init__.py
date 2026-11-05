"""Document Understanding service (FR-E2).

Extracts text and preserves page/section/paragraph locations via PyMuPDF.

Public API:
    extract(document_id, file_path) -> Document
    CorruptPdfError
"""
from __future__ import annotations

from pathlib import Path

from app.core.schemas import Document
from app.services.document_understanding.chunker import chunk_blocks
from app.services.document_understanding.errors import CorruptPdfError
from app.services.document_understanding.pdf_parser import extract_blocks, open_pdf

__all__ = ["CorruptPdfError", "extract"]


def extract(document_id: str, file_path: Path) -> Document:
    """Parse a PDF into paragraph chunks with source locations.

    Returns a Document with zero chunks when the PDF has no selectable text
    (e.g. a scanned page). Raises CorruptPdfError when the file cannot be opened.
    """
    doc = open_pdf(file_path)
    try:
        blocks = extract_blocks(doc)
        chunks = chunk_blocks(blocks, document_id)
        return Document(
            document_id=document_id,
            filename=file_path.name,
            num_pages=doc.page_count,
            chunks=chunks,
        )
    finally:
        doc.close()
