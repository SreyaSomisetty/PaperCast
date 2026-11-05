"""Smoke test: the scaffold pipeline runs end-to-end on placeholder data.

This does not test correctness of any real implementation — it guards the typed
contracts between stages so teammates know when a change breaks the skeleton.
"""
from pathlib import Path

from app.core.schemas import ExplanationMode, ListenerProfile
from app.orchestration import pipeline
from app.services import document_understanding
from tests.fixtures.pdfs import write_sample_paper


def test_pipeline_runs_end_to_end(tmp_path: Path) -> None:
    pdf = write_sample_paper(tmp_path / "paper.pdf")

    document = document_understanding.extract("doc123", pdf)
    assert document.chunks, "extraction should yield at least one chunk"

    episode = pipeline.run_episode(
        document,
        ListenerProfile.STUDENT,
        ExplanationMode.QUICK_BRIEF,
    )

    assert episode.document_id == "doc123"
    assert episode.script.segments, "script should have segments"
    assert episode.verification is not None
    # Stub verification marks evidence-carrying segments as supported, so the
    # script is approved and audio is rendered.
    assert episode.script.approved
    assert episode.audio_segments
