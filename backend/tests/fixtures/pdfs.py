"""Helpers that build tiny real PDFs for document-understanding tests."""
from __future__ import annotations

from pathlib import Path

import fitz


def write_sample_paper(path: Path) -> Path:
    """Two-page paper with Abstract / Introduction / References sections."""
    doc = fitz.open()

    page1 = doc.new_page()
    # Larger bold-ish title line acts as a heading via font size.
    page1.insert_text((72, 72), "Abstract", fontsize=16)
    page1.insert_text(
        (72, 100),
        "We propose a new network architecture for sequence transduction.",
        fontsize=11,
    )
    page1.insert_text((72, 140), "1. Introduction", fontsize=14)
    page1.insert_text(
        (72, 168),
        "Recurrent layers process tokens sequentially and struggle with long range.",
        fontsize=11,
    )
    page1.insert_text(
        (72, 196),
        "Self-attention relates all positions of a sequence in parallel.",
        fontsize=11,
    )

    page2 = doc.new_page()
    page2.insert_text((72, 72), "Results", fontsize=14)
    page2.insert_text(
        (72, 100),
        "The model reached 28.4 BLEU on English-to-German translation.",
        fontsize=11,
    )
    page2.insert_text((72, 140), "References", fontsize=14)
    page2.insert_text(
        (72, 168),
        "Smith et al. Attention survey, 2015.",
        fontsize=11,
    )

    doc.save(path)
    doc.close()
    return path


def write_blank_pdf(path: Path) -> Path:
    """A valid PDF with a page but no selectable text."""
    doc = fitz.open()
    doc.new_page()
    doc.save(path)
    doc.close()
    return path


def sample_pdf_bytes() -> bytes:
    """In-memory sample paper for upload API tests."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        path = write_sample_paper(Path(tmp) / "sample.pdf")
        return path.read_bytes()


def blank_pdf_bytes() -> bytes:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        path = write_blank_pdf(Path(tmp) / "blank.pdf")
        return path.read_bytes()


def padded_pdf_bytes(target_size: int) -> bytes:
    """A valid PDF padded with trailing bytes to reach exactly `target_size`."""
    raw = sample_pdf_bytes()
    if len(raw) > target_size:
        raise ValueError(f"sample PDF is already {len(raw)} bytes")
    return raw + b"\x00" * (target_size - len(raw))
