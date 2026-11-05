"""Errors raised by document understanding."""
from __future__ import annotations


class CorruptPdfError(Exception):
    """Raised when a file looks like a PDF but PyMuPDF cannot open it."""

    def __init__(self, message: str = "The PDF could not be read.") -> None:
        super().__init__(message)
        self.message = message
