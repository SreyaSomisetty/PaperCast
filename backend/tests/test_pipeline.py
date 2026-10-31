"""Unit tests for the agentic orchestration loop (FR-E7, NFR-3).

Covers the staged Plan/Execute/Evaluate/Retry/Render flow in
`app.orchestration.pipeline`:

- end-to-end on a multi-chunk document (real deterministic services),
- the retry budget is bounded (at most MAX_RETRIES revision attempts),
- an unapproved script is never rendered (NFR-3),
- an approved script renders audio.

Retry/approval behaviour is exercised by injecting stubbed verification via
monkeypatch so the tests do not depend on the real verification implementation.
The pipeline calls `verification.verify_script` / `verification.revise_unsupported`
through the module, so those module attributes are the patch targets. No
network/LLM is involved.
"""
from __future__ import annotations

import pytest

from app.core.schemas import (
    ClaimCheck,
    ClaimStatus,
    Document,
    DocumentChunk,
    Episode,
    EpisodePlan,
    ExplanationMode,
    ListenerProfile,
    Script,
    SourceLocation,
    VerificationReport,
)
from app.orchestration import pipeline
from app.services import verification


# --------------------------------------------------------------------------- #
# Fixtures / helpers
# --------------------------------------------------------------------------- #
def _multi_chunk_document() -> Document:
    """A document whose chunks carry distinct sections, so planning yields items."""
    sections = ["Abstract", "Introduction", "Methods", "Results"]
    chunks = [
        DocumentChunk(
            chunk_id=f"doc-c{i}",
            text=f"Content for the {section} section.",
            location=SourceLocation(page=i + 1, section=section, paragraph=1),
        )
        for i, section in enumerate(sections)
    ]
    return Document(document_id="doc-multi", filename="paper.pdf", chunks=chunks)


def _all_supported_report(script: Script, _evidence) -> VerificationReport:
    """Verify stub: every segment is SUPPORTED."""
    checks = [
        ClaimCheck(
            segment_id=seg.segment_id,
            claim=seg.text,
            status=ClaimStatus.SUPPORTED,
            evidence_ids=seg.evidence_ids,
        )
        for seg in script.segments
    ]
    return VerificationReport(document_id=script.document_id, checks=checks)


# --------------------------------------------------------------------------- #
# End-to-end
# --------------------------------------------------------------------------- #
def test_end_to_end_runs_all_stages(monkeypatch: pytest.MonkeyPatch) -> None:
    """A multi-chunk document runs through every stage and yields an Episode."""
    # Force approval via a stub so the path is deterministic regardless of the
    # real verification impl.
    monkeypatch.setattr(verification, "verify_script", _all_supported_report)

    document = _multi_chunk_document()
    episode = pipeline.run_episode(
        document, ListenerProfile.STUDENT, ExplanationMode.QUICK_BRIEF
    )

    assert isinstance(episode, Episode)
    assert episode.document_id == "doc-multi"
    assert isinstance(episode.script.plan, EpisodePlan)
    assert episode.script.plan.items, "plan should be non-empty"
    assert episode.script.segments, "script should have segments"
    assert episode.verification is not None


# --------------------------------------------------------------------------- #
# Retry budget bounded (NFR-3)
# --------------------------------------------------------------------------- #
def test_retry_budget_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    """With a never-fixing revise stub, at most MAX_RETRIES revisions run."""

    def always_unsupported(script: Script, _evidence) -> VerificationReport:
        checks = [
            ClaimCheck(
                segment_id=seg.segment_id,
                claim=seg.text,
                status=ClaimStatus.UNSUPPORTED,
                evidence_ids=seg.evidence_ids,
            )
            for seg in script.segments
        ]
        return VerificationReport(document_id=script.document_id, checks=checks)

    calls = {"revise": 0}

    def never_fixes(script: Script, _report) -> Script:
        calls["revise"] += 1
        return script  # never improves the report

    monkeypatch.setattr(verification, "verify_script", always_unsupported)
    monkeypatch.setattr(verification, "revise_unsupported", never_fixes)

    document = _multi_chunk_document()
    episode = pipeline.run_episode(
        document, ListenerProfile.STUDENT, ExplanationMode.QUICK_BRIEF
    )

    # The loop terminated and respected the budget.
    assert calls["revise"] <= pipeline.MAX_RETRIES
    assert isinstance(episode, Episode)


# --------------------------------------------------------------------------- #
# Never render an unapproved script (NFR-3)
# --------------------------------------------------------------------------- #
def test_never_renders_unapproved_script(monkeypatch: pytest.MonkeyPatch) -> None:
    """When a claim stays unsupported, no audio is produced and approved=False.

    The verify stub reports an UNSUPPORTED claim whose `segment_id` does not
    match any script segment, so the orchestrator's hedge/drop pass cannot locate
    a segment to hedge or drop and the claim remains UNSUPPORTED. The final
    script is therefore not approved, and an unapproved script must never be
    rendered (NFR-3).
    """

    def unresolvable_unsupported(script: Script, _evidence) -> VerificationReport:
        # One unsupported claim pointing at a segment that is not in the script,
        # so hedge/drop has nothing to act on and approval cannot be reached.
        check = ClaimCheck(
            segment_id="no-such-segment",
            claim="an unsupported claim with no backing segment",
            status=ClaimStatus.UNSUPPORTED,
            evidence_ids=[],
        )
        return VerificationReport(document_id=script.document_id, checks=[check])

    def never_fixes(script: Script, _report) -> Script:
        return script

    monkeypatch.setattr(verification, "verify_script", unresolvable_unsupported)
    monkeypatch.setattr(verification, "revise_unsupported", never_fixes)

    document = _multi_chunk_document()
    episode = pipeline.run_episode(
        document, ListenerProfile.RESEARCHER, ExplanationMode.QUICK_BRIEF
    )

    assert episode.script.approved is False
    assert episode.audio_segments == []
    assert episode.verification is not None


# --------------------------------------------------------------------------- #
# Approved path renders
# --------------------------------------------------------------------------- #
def test_approved_script_renders_audio(monkeypatch: pytest.MonkeyPatch) -> None:
    """With an all-SUPPORTED report, the approved script renders audio."""
    monkeypatch.setattr(verification, "verify_script", _all_supported_report)

    document = _multi_chunk_document()
    episode = pipeline.run_episode(
        document, ListenerProfile.STUDENT, ExplanationMode.QUICK_BRIEF
    )

    assert episode.script.approved is True
    assert episode.audio_segments, "approved script should render audio"
    assert len(episode.audio_segments) == len(episode.script.segments)
