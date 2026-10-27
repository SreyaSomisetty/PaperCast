"""Explanation Planning service (FR-E4).

Builds a structured episode plan (mode, depth, topics, objectives) before any
script is written. Planned tech: a structured-output LLM with schema validation.

TODO(owner): generate the plan from the document + profile + mode. Keep the
signature: build_plan(document, profile, mode) -> EpisodePlan
"""
from __future__ import annotations

from app.core.schemas import (
    Document,
    EpisodePlan,
    ExplanationMode,
    ListenerProfile,
    PlanItem,
)


def build_plan(
    document: Document,
    profile: ListenerProfile,
    mode: ExplanationMode,
) -> EpisodePlan:
    """Produce an outline of topics/objectives for the episode.

    Stub: one plan item per document chunk.
    """
    # TODO(owner): prompt a structured-output LLM to produce an audience-aware
    # outline; validate against the EpisodePlan schema.
    items = [
        PlanItem(
            topic=chunk.location.section or f"Topic {i + 1}",
            objective="Explain this section's key idea.",
            target_seconds=60,
        )
        for i, chunk in enumerate(document.chunks)
    ]
    return EpisodePlan(
        document_id=document.document_id,
        profile=profile,
        mode=mode,
        items=items,
    )
