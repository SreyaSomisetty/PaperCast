"""Low-level PDF open + page text extraction via PyMuPDF."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import fitz

from app.services.document_understanding.errors import CorruptPdfError


@dataclass(frozen=True)
class TextBlock:
    """One contiguous text block from a PDF page."""

    page: int  # 1-based
    text: str
    font_size: float
    is_bold: bool


def open_pdf(file_path: Path) -> fitz.Document:
    """Open a PDF or raise CorruptPdfError."""
    try:
        doc = fitz.open(file_path)
    except Exception as exc:  # PyMuPDF raises assorted RuntimeError/FileDataError
        raise CorruptPdfError("The PDF could not be read.") from exc

    if doc.page_count == 0:
        doc.close()
        raise CorruptPdfError("The PDF has no pages.")

    if doc.is_encrypted:
        # Empty password unlocks many "open" encrypted PDFs; anything else fails.
        try:
            unlocked = doc.authenticate("")
        except Exception as exc:
            doc.close()
            raise CorruptPdfError("The PDF could not be read.") from exc
        if not unlocked:
            doc.close()
            raise CorruptPdfError("The PDF is encrypted and cannot be read.")

    return doc


def extract_blocks(doc: fitz.Document) -> list[TextBlock]:
    """Return reading-order text blocks across all pages.

    Uses the dict extractor so we can see font size / bold for section heuristics.
    """
    blocks: list[TextBlock] = []
    for page_index in range(doc.page_count):
        page = doc.load_page(page_index)
        page_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
        for raw in page_dict.get("blocks", []):
            if raw.get("type", 0) != 0:  # 0 = text, 1 = image
                continue
            text, font_size, is_bold = _block_text_and_style(raw)
            if not text.strip():
                continue
            blocks.append(
                TextBlock(
                    page=page_index + 1,
                    text=text.strip(),
                    font_size=font_size,
                    is_bold=is_bold,
                )
            )
    return blocks


def _block_text_and_style(block: dict) -> tuple[str, float, bool]:
    """Join a dict-block's lines and pick a representative font size / bold flag."""
    lines: list[str] = []
    sizes: list[float] = []
    bold_flags: list[bool] = []
    for line in block.get("lines", []):
        spans = line.get("spans", [])
        if not spans:
            continue
        line_text = "".join(span.get("text", "") for span in spans)
        if line_text.strip():
            lines.append(line_text.rstrip())
        for span in spans:
            size = float(span.get("size") or 0.0)
            if size > 0:
                sizes.append(size)
            font = (span.get("font") or "").lower()
            flags = int(span.get("flags") or 0)
            # bit 4 (16) is bold in MuPDF span flags; font name is a backup.
            bold_flags.append(bool(flags & 2**4) or "bold" in font)
    text = "\n".join(lines)
    font_size = max(sizes) if sizes else 0.0
    is_bold = any(bold_flags)
    return text, font_size, is_bold
