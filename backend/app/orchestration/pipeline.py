"""Agentic orchestration — Plan, Execute, Evaluate, Retry, Render (FR-E7, NFR-3).

This is the center of the architecture. The workbook (Workbook2 Ch.5) calls for a
LangGraph state machine; Phase 1 implements the same agentic loop as plain, typed
Python so the pipeline is runnable today. Each stage is a named function with an
explicit typed input and output, so the body can be ported to LangGraph later
without changing `run_episode`'s contract.

Flow:
    Plan      -> build an episode outline (planning service)
    Execute   -> retrieve evidence + generate a cited script
    Evaluate  -> verify claims against evidence
    Retry     -> revise unsupported claims (bounded by MAX_RETRIES)
    (Hedge/   -> orchestrator-owned final pass: hedge or drop any claim still
     drop)       unsupported after the retry budget, so nothing unsupported is
                 presented as fact (FR-E7)
    Render    -> synthesize audio for the approved script ONLY (NFR-3)

Each stage produces a typed artifact gathered in `PipelineState` so a failed
stage is inspectable and rerunnable on its own (NFR-8).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.core.schemas import (
    AudioSegment,
    ClaimStatus,
    Document,
    Episode,
    EpisodePlan,
    EvidencePassage,
    ExplanationMode,
    ListenerProfile,
    Script,
    ScriptSegment,
    VerificationReport,
)
from app.services import (
    planning,
    retrieval,
    script_generation,
    speech,
    verification,
)

# At most this many revision attempts before the orchestrator falls back to the
# hedge/drop pass. Bounds the loop so it terminates even if a revision never
# improves the report (NFR-3).
MAX_RETRIES = 2

# Claim statuses that leave a segment unfit to present as fact. The final
# hedge/drop pass rewrites or removes the segments backing these claims.
_UNFIT_STATUSES = (ClaimStatus.UNSUPPORTED, ClaimStatus.PARTIAL)


# --------------------------------------------------------------------------- #
# Intermediate state (frozen; one typed artifact per stage — NFR-8)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class PipelineState:
    """Typed artifacts produced as the episode moves through the stages.

    Holding each stage's output explicitly makes a failed stage inspectable and
    lets a future LangGraph port rerun one stage in isolation (NFR-8). Instances
    are frozen; a stage returns a new state rather than mutating in place.
    """

    document: Document
    plan: EpisodePlan | None = None
    script: Script | None = None
    evidence_by_topic: dict[str, list[EvidencePassage]] = field(default_factory=dict)
    evidence_by_chunk: dict[str, EvidencePassage] = field(default_factory=dict)
    report: VerificationReport | None = None
    audio_segments: list[AudioSegment] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Stage: Plan
# --------------------------------------------------------------------------- #
def _plan(
    document: Document,
    profile: ListenerProfile,
    mode: ExplanationMode,
) -> EpisodePlan:
    """Build the episode outline for `document` under the listener's choices.

    Thin wrapper over `planning.build_plan` so the Plan stage is a named,
    typed step in the loop.
    """
    return planning.build_plan(document, profile, mode)


# --------------------------------------------------------------------------- #
# Stage: Execute
# --------------------------------------------------------------------------- #
def _execute(
    document: Document,
    plan: EpisodePlan,
) -> tuple[Script, dict[str, list[EvidencePassage]], dict[str, EvidencePassage]]:
    """Retrieve evidence per plan topic, then generate a cited script.

    Returns the generated `Script`, the `evidence_by_topic` map (keyed by
    `PlanItem.topic`, consumed by script generation), and the
    `evidence_by_chunk` map (keyed by `chunk_id`, consumed by verification).
    Keeps the existing retrieval + generation wiring.
    """
    evidence_by_topic: dict[str, list[EvidencePassage]] = {}
    evidence_by_chunk: dict[str, EvidencePassage] = {}
    for item in plan.items:
        passages = retrieval.retrieve(document, item.topic)
        evidence_by_topic[item.topic] = passages
        for p in passages:
            evidence_by_chunk[p.chunk_id] = p

    script = script_generation.generate_script(plan, evidence_by_topic)
    return script, evidence_by_topic, evidence_by_chunk


# --------------------------------------------------------------------------- #
# Stage: Evaluate
# --------------------------------------------------------------------------- #
def _evaluate(
    script: Script,
    evidence_by_chunk: dict[str, EvidencePassage],
) -> VerificationReport:
    """Verify every substantive claim in `script` against its evidence.

    Thin wrapper over `verification.verify_script` so the Evaluate stage is a
    named, typed step in the loop.
    """
    return verification.verify_script(script, evidence_by_chunk)


# --------------------------------------------------------------------------- #
# Stage: Retry (bounded)
# --------------------------------------------------------------------------- #
def _retry_until_approved(
    script: Script,
    report: VerificationReport,
    evidence_by_chunk: dict[str, EvidencePassage],
) -> tuple[Script, VerificationReport]:
    """Revise unsupported claims, at most `MAX_RETRIES` times, re-verifying each.

    Each iteration asks the verification service to revise the unsupported
    segments, then re-verifies the result. The attempt count is tracked and
    bounded explicitly, so the loop terminates even if `revise_unsupported`
    never improves the report (NFR-3). Stops early once the report is fully
    supported. Returns the latest script and its matching report.
    """
    attempts = 0
    while not report.all_supported and attempts < MAX_RETRIES:
        script = verification.revise_unsupported(script, report)
        report = verification.verify_script(script, evidence_by_chunk)
        attempts += 1
    return script, report


# --------------------------------------------------------------------------- #
# Hedge / drop (orchestrator-owned final pass — FR-E7)
# --------------------------------------------------------------------------- #
def _hedge_or_drop(
    script: Script,
    report: VerificationReport,
) -> tuple[Script, VerificationReport]:
    """Hedge or drop any segment still backing an unfit claim after retries.

    Owned by the orchestrator (user-approved approach 'a'). For each claim still
    UNSUPPORTED/PARTIAL in `report`, the backing segment is softened into a
    hedged form and its check is marked HEDGED; a segment that carries no
    evidence at all is dropped (omitted) rather than hedged, since there is
    nothing to qualify. This is expressed purely through existing schema field
    VALUES — rewriting `ScriptSegment.text`, removing segments, and updating
    `ClaimCheck.status` — so nothing unsupported is presented as fact (FR-E7)
    without introducing any new schema field.

    Approval is then recomputed from the report: the script is approved iff
    every remaining check is SUPPORTED or HEDGED (`report.all_supported`).
    """
    unfit_by_segment = {
        c.segment_id: c for c in report.checks if c.status in _UNFIT_STATUSES
    }

    kept_segments: list[ScriptSegment] = []
    dropped_ids: set[str] = set()
    for seg in script.segments:
        check = unfit_by_segment.get(seg.segment_id)
        if check is None:
            kept_segments.append(seg)
            continue

        if seg.evidence_ids:
            # There is cited evidence to qualify against: hedge the wording and
            # mark the claim HEDGED so it is no longer presented as fact.
            kept_segments.append(seg.model_copy(update={"text": _hedged_text(seg.text)}))
            check.status = ClaimStatus.HEDGED
        else:
            # No evidence to stand on: drop the segment and record it DROPPED.
            dropped_ids.add(seg.segment_id)
            check.status = ClaimStatus.DROPPED

    # A dropped segment's check must no longer block approval; DROPPED claims are
    # removed from the report because they are no longer in the script.
    remaining_checks = [c for c in report.checks if c.segment_id not in dropped_ids]
    revised_report = report.model_copy(update={"checks": remaining_checks})
    revised_script = script.model_copy(update={"segments": kept_segments})
    revised_script.approved = revised_report.all_supported
    return revised_script, revised_report


def _hedged_text(text: str) -> str:
    """Soften a segment's wording so its claim is no longer stated as fact.

    Prefixes a hedge so the listener hears the claim as tentative rather than
    asserted. Idempotent: text already hedged is returned unchanged.
    """
    hedge = "The paper appears to suggest that "
    stripped = text.strip()
    if stripped.startswith(hedge):
        return text
    body = stripped[0].lower() + stripped[1:] if stripped else stripped
    return f"{hedge}{body}"


# --------------------------------------------------------------------------- #
# Stage: Render
# --------------------------------------------------------------------------- #
def _render(script: Script) -> list[AudioSegment]:
    """Synthesize audio — ONLY for an approved script (NFR-3).

    An unapproved script is never rendered: the stage returns an empty list
    instead of calling the speech service, so a script that failed verification
    cannot reach audio.
    """
    if not script.approved:
        return []
    return speech.render_audio(script)


# --------------------------------------------------------------------------- #
# Orchestrator
# --------------------------------------------------------------------------- #
def run_episode(
    document: Document,
    profile: ListenerProfile,
    mode: ExplanationMode,
) -> Episode:
    """Run the full Plan/Execute/Evaluate/Retry/Render loop for one episode.

    Drives the named stages in order, threading a typed `PipelineState` so each
    stage's input and output is explicit (NFR-8). Approval is the orchestrator's
    call, derived from the verification report: if the retry budget leaves every
    claim SUPPORTED/HEDGED the script is approved; otherwise a final hedge/drop
    pass guarantees no unsupported claim is presented as fact (FR-E7) before
    approval is recomputed. Audio is rendered only if the resulting script is
    approved (NFR-3).

    TODO(owner, orchestration): port to a LangGraph state machine, add per-stage
    artifact persistence and evaluation logging (latency, retries).
    """
    # --- Plan --------------------------------------------------------------
    plan = _plan(document, profile, mode)
    state = PipelineState(document=document, plan=plan)

    # --- Execute -----------------------------------------------------------
    script, evidence_by_topic, evidence_by_chunk = _execute(document, plan)
    state = PipelineState(
        document=document,
        plan=plan,
        script=script,
        evidence_by_topic=evidence_by_topic,
        evidence_by_chunk=evidence_by_chunk,
    )

    # --- Evaluate ----------------------------------------------------------
    report = _evaluate(script, evidence_by_chunk)

    # --- Retry (bounded) ---------------------------------------------------
    script, report = _retry_until_approved(script, report, evidence_by_chunk)

    # --- Hedge / drop (final pass, FR-E7) ----------------------------------
    if report.all_supported:
        # Approval is the orchestrator's call, derived from the report rather
        # than any revision side effect: every claim is SUPPORTED or HEDGED.
        script.approved = True
    else:
        script, report = _hedge_or_drop(script, report)

    # --- Render (approved scripts only, NFR-3) -----------------------------
    audio_segments = _render(script)

    state = PipelineState(
        document=document,
        plan=plan,
        script=script,
        evidence_by_topic=evidence_by_topic,
        evidence_by_chunk=evidence_by_chunk,
        report=report,
        audio_segments=audio_segments,
    )

    return Episode(
        document_id=state.document.document_id,
        script=state.script,
        audio_segments=state.audio_segments,
        verification=state.report,
    )
