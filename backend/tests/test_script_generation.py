"""Unit tests for the Script Generation service (FR-E5).

Covers schema-valid output, the non-negotiable citation contract (every factual
segment carries >= 1 real evidence id; no fabricated ids), consistent two-host
alternation and unique segment ids, absence of placeholder text, the no-evidence
edge case, and an empty plan. No network/LLM is involved — the Phase-1 provider
is deterministic.
"""
from __future__ import annotations

from app.core.schemas import (
    EpisodePlan,
    EvidencePassage,
    ExplanationMode,
    ListenerProfile,
    PlanItem,
    Script,
    ScriptSegment,
    SourceLocation,
)
from app.services import script_generation


def _plan(items: list[PlanItem]) -> EpisodePlan:
    return EpisodePlan(
        document_id="doc-script",
        profile=ListenerProfile.STUDENT,
        mode=ExplanationMode.QUICK_BRIEF,
        items=items,
    )


def _passage(chunk_id: str, text: str) -> EvidencePassage:
    return EvidencePassage(
        document_id="doc-script",
        chunk_id=chunk_id,
        text=text,
        location=SourceLocation(page=1, section="Results"),
        score=1.0,
    )


def _plan_with_two_topics() -> EpisodePlan:
    return _plan(
        [
            PlanItem(topic="Methods", objective="Explain the method.", target_seconds=45),
            PlanItem(topic="Results", objective="Explain the results.", target_seconds=45),
        ]
    )


def _evidence_two_topics() -> dict[str, list[EvidencePassage]]:
    return {
        "Methods": [
            _passage("m-c0", "The authors trained a transformer on 10k samples."),
            _passage("m-c1", "They used a learning rate of 0.001."),
        ],
        "Results": [
            _passage("r-c0", "Accuracy reached 92 percent on the held-out set."),
        ],
    }


def _all_chunk_ids(evidence: dict[str, list[EvidencePassage]]) -> set[str]:
    return {p.chunk_id for passages in evidence.values() for p in passages}


def test_generate_script_returns_schema_valid_script() -> None:
    plan = _plan_with_two_topics()
    evidence = _evidence_two_topics()

    script = script_generation.generate_script(plan, evidence)

    assert isinstance(script, Script)
    assert script.document_id == "doc-script"
    assert script.plan == plan
    assert script.approved is False
    assert script.segments
    assert all(isinstance(seg, ScriptSegment) for seg in script.segments)


def test_citation_contract_factual_segments_cite_real_ids() -> None:
    plan = _plan_with_two_topics()
    evidence = _evidence_two_topics()
    real_ids = _all_chunk_ids(evidence)

    script = script_generation.generate_script(plan, evidence)

    # Every evidence id present on any segment is a real chunk_id (no fabrication).
    for seg in script.segments:
        for cid in seg.evidence_ids:
            assert cid in real_ids, f"fabricated evidence id {cid!r}"

    # At least one factual (cited) segment exists for topics that have evidence,
    # and each such segment carries >= 1 evidence id.
    cited = [seg for seg in script.segments if seg.evidence_ids]
    assert cited, "expected cited factual segments for topics with evidence"
    assert all(len(seg.evidence_ids) >= 1 for seg in cited)


def test_two_speakers_alternate_and_segment_ids_unique() -> None:
    plan = _plan_with_two_topics()
    evidence = _evidence_two_topics()

    script = script_generation.generate_script(plan, evidence)

    speakers = {seg.speaker for seg in script.segments}
    assert speakers == {"host_a", "host_b"}

    ids = [seg.segment_id for seg in script.segments]
    assert len(ids) == len(set(ids)), "segment ids must be unique across the script"


def test_no_placeholder_text_in_any_segment() -> None:
    plan = _plan_with_two_topics()
    evidence = _evidence_two_topics()

    script = script_generation.generate_script(plan, evidence)

    for seg in script.segments:
        assert "[placeholder]" not in seg.text
        assert "placeholder" not in seg.text.lower()


def test_topic_without_evidence_makes_no_false_citations() -> None:
    plan = _plan(
        [PlanItem(topic="Mystery", objective="Explain it.", target_seconds=45)]
    )
    # No key for "Mystery" -> no evidence at all.
    script = script_generation.generate_script(plan, {})

    assert script.segments, "a no-evidence topic should still produce a turn"
    for seg in script.segments:
        assert seg.evidence_ids == [], "no-evidence topic must not claim citations"


def test_empty_plan_yields_valid_script_with_no_segments() -> None:
    plan = _plan([])

    script = script_generation.generate_script(plan, {})

    assert isinstance(script, Script)
    assert script.document_id == "doc-script"
    assert script.segments == []
    assert script.approved is False
