"""Turn extracted PDF text blocks into DocumentChunk list with SourceLocation."""
from __future__ import annotations

import re

from app.core.schemas import DocumentChunk, SourceLocation
from app.services.document_understanding.pdf_parser import TextBlock

# Common paper headings. Matching is case-insensitive after stripping numbering.
_KNOWN_SECTIONS = frozenset(
    {
        "abstract",
        "introduction",
        "background",
        "related work",
        "related works",
        "method",
        "methods",
        "methodology",
        "approach",
        "model",
        "experiment",
        "experiments",
        "experimental setup",
        "results",
        "evaluation",
        "discussion",
        "analysis",
        "conclusion",
        "conclusions",
        "future work",
        "acknowledgements",
        "acknowledgments",
        "references",
        "bibliography",
        "appendix",
        "appendices",
    }
)

_SECTION_NUMBER = re.compile(
    r"^(?:(?:\d+(?:\.\d+)*)|(?:[IVXLCDM]+)|(?:[A-Z]))[.)]?\s+",
    re.IGNORECASE,
)
_ALL_CAPS = re.compile(r"^[A-Z0-9][A-Z0-9\s\-:,]{1,80}$")


def chunk_blocks(
    blocks: list[TextBlock],
    document_id: str,
    *,
    body_font_size: float | None = None,
) -> list[DocumentChunk]:
    """Emit one DocumentChunk per body paragraph, carrying page/section/paragraph.

    Section titles are detected heuristically and applied to following paragraphs
    until the next heading. They are not emitted as their own chunks.
    """
    if not blocks:
        return []

    median_size = body_font_size if body_font_size is not None else _median_font(blocks)
    chunks: list[DocumentChunk] = []
    current_section: str | None = None
    paragraph_in_section = 0
    chunk_index = 0

    for block in blocks:
        if _looks_like_heading(block, median_size):
            current_section = _normalize_heading(block.text)
            paragraph_in_section = 0
            continue

        paragraph_in_section += 1
        chunks.append(
            DocumentChunk(
                chunk_id=f"{document_id}-c{chunk_index}",
                text=block.text,
                location=SourceLocation(
                    page=block.page,
                    section=current_section,
                    paragraph=paragraph_in_section,
                ),
            )
        )
        chunk_index += 1

    return chunks


def _median_font(blocks: list[TextBlock]) -> float:
    sizes = sorted(b.font_size for b in blocks if b.font_size > 0)
    if not sizes:
        return 11.0
    return sizes[len(sizes) // 2]


def _looks_like_heading(block: TextBlock, body_font_size: float) -> bool:
    text = block.text.strip()
    if not text or "\n" in text:
        # Multi-line blocks are almost always body paragraphs.
        return False

    # Single short line.
    if len(text) > 90:
        return False
    if len(text.split()) > 12:
        return False

    normalized = _normalize_heading(text).lower()
    if normalized in _KNOWN_SECTIONS:
        return True

    # Larger / bold short line → likely a heading.
    larger = body_font_size > 0 and block.font_size >= body_font_size + 1.5
    if (larger or block.is_bold) and len(text.split()) <= 8:
        return True

    if _ALL_CAPS.match(text) and len(text.split()) <= 8:
        return True

    return False


_CANONICAL_SECTION = {
    "related works": "Related Work",
    "related work": "Related Work",
    "acknowledgements": "Acknowledgements",
    "acknowledgments": "Acknowledgments",
}


def _normalize_heading(text: str) -> str:
    """Strip numbering ('1. Introduction' → 'Introduction') and collapse space."""
    cleaned = _SECTION_NUMBER.sub("", text.strip())
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .:")
    lower = cleaned.lower()
    if lower in _CANONICAL_SECTION:
        return _CANONICAL_SECTION[lower]
    if lower in _KNOWN_SECTIONS:
        return " ".join(w.capitalize() for w in lower.split())
    return cleaned
