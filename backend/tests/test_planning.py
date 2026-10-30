"""Unit tests for the Explanation Planning service (FR-E4).

Covers schema-valid output, mode depth/length differences, non-empty
topics/objectives, profile-driven emphasis, and graceful handling of an empty
document. No network/LLM is involved — the Phase-1 provider is deterministic.
"""
from __future__ import annotations

from app.core.schemas import (
    Document,
    DocumentChunk,
    EpisodePlan,
    ExplanationMode,
    ListenerProfile,
    PlanItem,
    SourceLocation,
)
from app.services import planning


def _document_with_sections() -> Document:
    """A small document whose chunks carry distinct section labels."""
    sections = [
        "Abstract",
        "Introduction",
        "Methods",
        "Results",
        "Discussion",
        "Conclusion",
    ]
    chunks = [
        DocumentChunk(
            chunk_id=f"doc-c{i}",
            text=f"Content for the {section} section.",
            location=SourceLocation(page=i + 1, section=section, paragraph=1),
        )
        for i, section in enumerate(sections)
    ]
    return Document(document_id="doc-sections", filename="paper.pdf", chunks=chunks)


def _empty_document() -> Document:
    return Document(document_id="doc-empty", filename="empty.pdf", chunks=[])


def _total_seconds(plan: EpisodePlan) -> int:
    return sum(item.target_seconds or 0 for item in plan.items)


def test_build_plan_returns_schema_valid_plan() -> None:
    document = _document_with_sections()
    plan = planning.build_plan(
        document, ListenerProfile.STUDENT, ExplanationMode.DEEP_DIVE
    )

    assert isinstance(plan, EpisodePlan)
    assert plan.document_id == "doc-sections"
    assert plan.profile is ListenerProfile.STUDENT
    assert plan.mode is ExplanationMode.DEEP_DIVE
    assert plan.items
    assert all(isinstance(item, PlanItem) for item in plan.items)


def test_quick_brief_is_fewer_and_shorter_than_deep_dive() -> None:
    document = _document_with_sections()

    quick = planning.build_plan(
        document, ListenerProfile.STUDENT, ExplanationMode.QUICK_BRIEF
    )
    deep = planning.build_plan(
        document, ListenerProfile.STUDENT, ExplanationMode.DEEP_DIVE
    )

    assert len(quick.items) < len(deep.items)
    assert _total_seconds(quick) < _total_seconds(deep)


def test_every_item_has_nonempty_topic_and_objective() -> None:
    document = _document_with_sections()
    for mode in ExplanationMode:
        for profile in ListenerProfile:
            plan = planning.build_plan(document, profile, mode)
            for item in plan.items:
                assert item.topic.strip(), f"empty topic for {mode}/{profile}"
                assert item.objective.strip(), f"empty objective for {mode}/{profile}"


def test_profile_changes_objective_emphasis() -> None:
    document = _document_with_sections()

    student = planning.build_plan(
        document, ListenerProfile.STUDENT, ExplanationMode.DEEP_DIVE
    )
    researcher = planning.build_plan(
        document, ListenerProfile.RESEARCHER, ExplanationMode.DEEP_DIVE
    )

    student_objectives = [item.objective for item in student.items]
    researcher_objectives = [item.objective for item in researcher.items]

    # Topics are the same; objectives must differ by audience emphasis.
    assert [i.topic for i in student.items] == [i.topic for i in researcher.items]
    assert student_objectives != researcher_objectives
    assert any("example" in o.lower() for o in student_objectives)
    assert any("methodology" in o.lower() for o in researcher_objectives)


def test_empty_document_returns_valid_plan_without_raising() -> None:
    document = _empty_document()
    plan = planning.build_plan(
        document, ListenerProfile.RESEARCHER, ExplanationMode.QUICK_BRIEF
    )

    assert isinstance(plan, EpisodePlan)
    assert plan.document_id == "doc-empty"
    assert plan.items == []


def test_chunks_without_section_get_fallback_topic_names() -> None:
    chunks = [
        DocumentChunk(chunk_id="c0", text="first", location=SourceLocation()),
        DocumentChunk(chunk_id="c1", text="second", location=SourceLocation()),
    ]
    document = Document(document_id="doc-nosec", filename="x.pdf", chunks=chunks)

    plan = planning.build_plan(
        document, ListenerProfile.STUDENT, ExplanationMode.DEEP_DIVE
    )

    assert plan.items
    assert all(item.topic.strip() for item in plan.items)
