"""Adaptive Learning service (FR-D2, FR-D3 — desired, post Phase 1).

Tracks what the listener understands, guides questioning, adds check-in
questions, and addresses misconceptions.

TODO(owner): design the learner model and answer flow. Signature is a
starting point and may evolve.
"""
from __future__ import annotations

from app.core.schemas import Document, QuestionAnswer
from app.services import retrieval


def answer_question(document: Document, question: str) -> QuestionAnswer:
    """Answer a listener question with evidence from the document.

    Stub: retrieves passages and returns a placeholder answer.
    """
    # TODO(owner): combine retrieval with a grounded-answer LLM call; track the
    # listener's knowledge state across the session.
    evidence = retrieval.retrieve(document, question, k=3)
    return QuestionAnswer(
        answer="[placeholder] evidence-grounded answer not yet implemented.",
        evidence=evidence,
    )
