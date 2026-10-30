"""Agentic orchestration — Plan, Execute, Evaluate, Retry.

This is the center of the architecture. The workbook calls for a LangGraph state
machine; this scaffold implements the same loop as plain, typed Python so the
pipeline is runnable today. Swap the body for LangGraph without changing
`run_episode`'s contract.

Flow:
    Plan      -> build an episode outline (planning service)
    Execute   -> retrieve evidence + generate a cited script
    Evaluate  -> verify claims against evidence
    Retry     -> revise unsupported claims (bounded), then hedge/drop
    Render    -> synthesize audio for the approved script

Each stage produces a typed artifact so a failed stage can be rerun on its own
(NFR-3, NFR-8).
"""
from __future__ import annotations

from app.core.schemas import (
    Document,
    Episode,
    EvidencePassage,
    ExplanationMode,
    ListenerProfile,
    Script,
)
from app.services import (
    planning,
    retrieval,
    script_generation,
    speech,
    verification,
)

MAX_RETRIES = 2


def run_episode(
    document: Document,
    profile: ListenerProfile,
    mode: ExplanationMode,
) -> Episode:
    """Run the full Plan/Execute/Evaluate/Retry/Render loop for one episode.

    TODO(owner, orchestration): port to a LangGraph state machine, add
    per-stage artifact persistence and evaluation logging (latency, retries).
    """
    # --- Plan --------------------------------------------------------------
    plan = planning.build_plan(document, profile, mode)

    # --- Execute: retrieve evidence per topic, then generate a cited script -
    evidence_by_topic: dict[str, list[EvidencePassage]] = {}
    evidence_by_chunk: dict[str, EvidencePassage] = {}
    for item in plan.items:
        passages = retrieval.retrieve(document, item.topic)
        evidence_by_topic[item.topic] = passages
        for p in passages:
            evidence_by_chunk[p.chunk_id] = p

    script: Script = script_generation.generate_script(plan, evidence_by_topic)

    # --- Evaluate + Retry (bounded) ----------------------------------------
    report = verification.verify_script(script, evidence_by_chunk)
    attempts = 0
    while not report.all_supported and attempts < MAX_RETRIES:
        # TODO(owner): send only the failed segments back to the generator for
        # a targeted revision instead of re-verifying the whole script.
        script = verification.revise_unsupported(script, report)
        report = verification.verify_script(script, evidence_by_chunk)
        attempts += 1

    script = verification.revise_unsupported(script, report)

    # --- Render ------------------------------------------------------------
    audio_segments = speech.render_audio(script) if script.approved else []

    return Episode(
        document_id=document.document_id,
        script=script,
        audio_segments=audio_segments,
        verification=report,
    )
