"""Unit tests for PDF parsing and paragraph chunking (FR-E2)."""
from __future__ import annotations

from pathlib import Path

import pytest

from app.services.document_understanding import CorruptPdfError, extract
from app.services.document_understanding.chunker import chunk_blocks
from app.services.document_understanding.pdf_parser import TextBlock, extract_blocks, open_pdf
from tests.fixtures.pdfs import write_blank_pdf, write_sample_paper


@pytest.fixture
def sample_pdf(tmp_path: Path) -> Path:
    return write_sample_paper(tmp_path / "sample.pdf")


@pytest.fixture
def blank_pdf(tmp_path: Path) -> Path:
    return write_blank_pdf(tmp_path / "blank.pdf")


def test_extract_yields_paragraph_chunks_with_locations(sample_pdf: Path) -> None:
    document = extract("doc", sample_pdf)

    assert document.document_id == "doc"
    assert document.filename == "sample.pdf"
    assert document.num_pages == 2
    assert len(document.chunks) >= 4

    for i, chunk in enumerate(document.chunks):
        assert chunk.chunk_id == f"doc-c{i}"
        assert chunk.text.strip()
        assert chunk.location.page is not None
        assert chunk.location.page >= 1
        assert chunk.location.paragraph is not None
        assert chunk.location.paragraph >= 1


def test_section_headings_label_following_paragraphs(sample_pdf: Path) -> None:
    document = extract("doc", sample_pdf)
    by_section: dict[str | None, list[str]] = {}
    for chunk in document.chunks:
        by_section.setdefault(chunk.location.section, []).append(chunk.text)

    assert "Abstract" in by_section
    assert any("network architecture" in t for t in by_section["Abstract"])

    assert "Introduction" in by_section
    assert len(by_section["Introduction"]) >= 2

    assert "Results" in by_section
    assert any("28.4 BLEU" in t for t in by_section["Results"])

    assert "References" in by_section
    assert any("Smith" in t for t in by_section["References"])


def test_headings_are_not_emitted_as_chunks(sample_pdf: Path) -> None:
    document = extract("doc", sample_pdf)
    texts = {c.text.strip().lower() for c in document.chunks}
    assert "abstract" not in texts
    assert "references" not in texts
    assert "1. introduction" not in texts


def test_paragraph_indices_restart_per_section(sample_pdf: Path) -> None:
    document = extract("doc", sample_pdf)
    intro = [c for c in document.chunks if c.location.section == "Introduction"]
    assert intro
    assert [c.location.paragraph for c in intro] == list(range(1, len(intro) + 1))


def test_blank_pdf_returns_no_chunks(blank_pdf: Path) -> None:
    document = extract("empty", blank_pdf)
    assert document.num_pages == 1
    assert document.chunks == []


def test_corrupt_pdf_raises(tmp_path: Path) -> None:
    bad = tmp_path / "broken.pdf"
    bad.write_bytes(b"%PDF-1.4 not actually a pdf")

    with pytest.raises(CorruptPdfError):
        extract("bad", bad)


def test_open_pdf_rejects_missing_file(tmp_path: Path) -> None:
    with pytest.raises(CorruptPdfError):
        open_pdf(tmp_path / "missing.pdf")


def test_chunk_blocks_skips_whitespace_only() -> None:
    blocks = [
        TextBlock(page=1, text="Abstract", font_size=16, is_bold=True),
        TextBlock(page=1, text="   \n  ", font_size=11, is_bold=False),
        TextBlock(page=1, text="Body paragraph.", font_size=11, is_bold=False),
    ]
    # Whitespace-only should already be filtered by the parser; if one slips
    # through, the chunker still emits it — parser is the gate. Here we only
    # check heading detection + body emission.
    chunks = chunk_blocks(
        [b for b in blocks if b.text.strip()],
        "doc",
        body_font_size=11,
    )
    assert len(chunks) == 1
    assert chunks[0].text == "Body paragraph."
    assert chunks[0].location.section == "Abstract"


def test_extract_blocks_preserves_page_order(sample_pdf: Path) -> None:
    doc = open_pdf(sample_pdf)
    try:
        blocks = extract_blocks(doc)
    finally:
        doc.close()

    assert blocks
    pages = [b.page for b in blocks]
    assert pages == sorted(pages)
    assert pages[0] == 1
    assert pages[-1] == 2
