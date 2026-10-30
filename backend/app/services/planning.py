"""Explanation Planning service (FR-E4).

Builds a structured episode plan (requested mode, target depth/duration, topics,
and explanation objectives) before any dialogue is written. A plan is produced
before script generation so the rest of the pipeline has a typed outline to
retrieve against.

Phase 1 is a deterministic prototype: the plan is derived from the document's
chunk structure under a mode/profile policy table, then validated by
constructing the `EpisodePlan`/`PlanItem` Pydantic models (the schema validation
FR-E4 calls for). The LLM seam is already in place — a `PlanProvider` can be
swapped for a structured-output LLM later with no change to `build_plan` or the
orchestrator. The prompt template is assembled now (pure, inspectable) so the
plan is reproducible (NFR-5) and ready to feed a model.

TODO(owner): add an LLM-backed `PlanProvider` that consumes `build_planning_prompt`
and returns the same ordered item data. Keep the signature:
    build_plan(document, profile, mode) -> EpisodePlan
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.core.schemas import (
    Document,
    DocumentChunk,
    EpisodePlan,
    ExplanationMode,
    ListenerProfile,
    PlanItem,
)


# --------------------------------------------------------------------------- #
# Policy tables
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class ModePolicy:
    """Depth/length shape for one explanation mode.

    `max_topics` and `target_seconds_per_topic` bound how many plan items are
    produced and how long each one should run; `target_total_seconds` is the
    nominal episode budget the mode aims for.
    """

    max_topics: int
    target_seconds_per_topic: int
    target_total_seconds: int
    depth: str


@dataclass(frozen=True)
class ProfilePolicy:
    """Audience emphasis for one listener profile."""

    emphasis: str
    objective_template: str


# Per-mode depth/length policy (workbook: Audience-Adaptive modes).
# Quick Brief = few topics + short (most important claims only); Deep Dive =
# more topics + longer (detailed explanations and connections); Discussion =
# conversational/comparative; Study/Review = recall-oriented with review framing.
_MODE_POLICY: dict[ExplanationMode, ModePolicy] = {
    ExplanationMode.QUICK_BRIEF: ModePolicy(
        max_topics=3,
        target_seconds_per_topic=45,
        target_total_seconds=180,
        depth="Only the most important claims, stated concisely.",
    ),
    ExplanationMode.DEEP_DIVE: ModePolicy(
        max_topics=8,
        target_seconds_per_topic=120,
        target_total_seconds=900,
        depth="Detailed explanations with connections between ideas.",
    ),
    ExplanationMode.DISCUSSION: ModePolicy(
        max_topics=6,
        target_seconds_per_topic=90,
        target_total_seconds=540,
        depth="Conversational, comparative back-and-forth between viewpoints.",
    ),
    ExplanationMode.STUDY_REVIEW: ModePolicy(
        max_topics=6,
        target_seconds_per_topic=75,
        target_total_seconds=450,
        depth="Recall-oriented review that reinforces the key takeaways.",
    ),
}

# Per-profile emphasis (workbook: STUDENT vs RESEARCHER). `objective_template`
# has a single `{topic}` slot and is kept short so objectives read naturally.
_PROFILE_POLICY: dict[ListenerProfile, ProfilePolicy] = {
    ListenerProfile.STUDENT: ProfilePolicy(
        emphasis=(
            "Emphasize clear definitions, concrete examples, and the background "
            "concepts a learner needs."
        ),
        objective_template=(
            "Explain {topic} with plain-language definitions, a concrete "
            "example, and the background concepts a student needs to follow it."
        ),
    ),
    ListenerProfile.RESEARCHER: ProfilePolicy(
        emphasis=(
            "Emphasize methodology, results, limitations, and precise "
            "terminology."
        ),
        objective_template=(
            "Analyze {topic} with attention to methodology, results, "
            "limitations, and precise terminology."
        ),
    ),
}


def get_mode_policy(mode: ExplanationMode) -> ModePolicy:
    """Return the depth/length policy for `mode`."""
    return _MODE_POLICY[mode]


def get_profile_policy(profile: ListenerProfile) -> ProfilePolicy:
    """Return the audience-emphasis policy for `profile`."""
    return _PROFILE_POLICY[profile]


# --------------------------------------------------------------------------- #
# Prompt template (pure, inspectable — the LLM seam)
# --------------------------------------------------------------------------- #
def build_planning_prompt(
    document: Document,
    profile: ListenerProfile,
    mode: ExplanationMode,
) -> str:
    """Assemble the planning prompt string from document context + policy.

    Pure: no I/O, no model call. Returned so it is testable and inspectable,
    which supports reproducibility (NFR-5). A future LLM `PlanProvider` feeds
    this string to a structured-output model.
    """
    mode_policy = get_mode_policy(mode)
    profile_policy = get_profile_policy(profile)

    sections = _ordered_sections(document.chunks)
    if sections:
        context_lines = "\n".join(
            f"- {name} ({len(chunks)} passage(s))" for name, chunks in sections
        )
    else:
        context_lines = "- (no extracted content)"

    return (
        "You are planning an audio explanation of a document.\n"
        f"Document: {document.filename} (id={document.document_id})\n"
        f"Listener profile: {profile.value}\n"
        f"Explanation mode: {mode.value}\n"
        "\n"
        "Mode policy:\n"
        f"- Depth: {mode_policy.depth}\n"
        f"- Max topics: {mode_policy.max_topics}\n"
        f"- Target seconds per topic: {mode_policy.target_seconds_per_topic}\n"
        f"- Target total seconds: {mode_policy.target_total_seconds}\n"
        "\n"
        "Audience emphasis:\n"
        f"- {profile_policy.emphasis}\n"
        "\n"
        "Document sections:\n"
        f"{context_lines}\n"
        "\n"
        "Produce an ordered list of topics. For each topic give a short title "
        "and an explanation objective that reflects the audience emphasis. Keep "
        "within the mode's topic count and per-topic length budget."
    )


# --------------------------------------------------------------------------- #
# Provider seam
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class PlanItemDraft:
    """Un-validated plan item data returned by a provider."""

    topic: str
    objective: str
    target_seconds: int


class PlanProvider(Protocol):
    """Produces ordered plan-item drafts for a document under a policy.

    Implementations may be deterministic (Phase 1) or LLM-backed (later). The
    orchestrator and `build_plan` depend only on this interface.
    """

    def propose_items(
        self,
        document: Document,
        profile: ListenerProfile,
        mode: ExplanationMode,
        prompt: str,
    ) -> list[PlanItemDraft]:
        ...


class _DeterministicPlanProvider:
    """Phase-1 provider: derive topics from the document's section structure.

    Groups chunks by `SourceLocation.section` (falling back to sensible topic
    names), applies the mode policy's topic count and per-topic target seconds,
    and writes profile-appropriate objectives.
    """

    def propose_items(
        self,
        document: Document,
        profile: ListenerProfile,
        mode: ExplanationMode,
        prompt: str,
    ) -> list[PlanItemDraft]:
        mode_policy = get_mode_policy(mode)
        profile_policy = get_profile_policy(profile)

        sections = _ordered_sections(document.chunks)
        if not sections:
            return []

        drafts: list[PlanItemDraft] = []
        for topic, _chunks in sections[: mode_policy.max_topics]:
            drafts.append(
                PlanItemDraft(
                    topic=topic,
                    objective=profile_policy.objective_template.format(topic=topic),
                    target_seconds=mode_policy.target_seconds_per_topic,
                )
            )
        return drafts


# Default provider used by `build_plan`. Swap for an LLM provider later.
_DEFAULT_PROVIDER: PlanProvider = _DeterministicPlanProvider()


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _ordered_sections(
    chunks: list[DocumentChunk],
) -> list[tuple[str, list[DocumentChunk]]]:
    """Group chunks into ordered (topic_name, chunks) pairs.

    Preserves first-appearance order. Chunks that share a `SourceLocation.section`
    are grouped together; chunks without a section get a stable fallback name
    derived from their position so every topic has a non-empty title.
    """
    groups: dict[str, list[DocumentChunk]] = {}
    order: list[str] = []
    for i, chunk in enumerate(chunks):
        section = (chunk.location.section or "").strip()
        name = section or f"Topic {i + 1}"
        if name not in groups:
            groups[name] = []
            order.append(name)
        groups[name].append(chunk)
    return [(name, groups[name]) for name in order]


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def build_plan(
    document: Document,
    profile: ListenerProfile,
    mode: ExplanationMode,
    provider: PlanProvider | None = None,
) -> EpisodePlan:
    """Produce a mode- and profile-aware outline of topics/objectives.

    Runs the provider against the assembled prompt, then validates the result by
    constructing `PlanItem`/`EpisodePlan` Pydantic models. An empty document
    (no chunks) yields a valid, empty `EpisodePlan` rather than raising.
    """
    provider = provider or _DEFAULT_PROVIDER
    prompt = build_planning_prompt(document, profile, mode)
    drafts = provider.propose_items(document, profile, mode, prompt)

    items = [
        PlanItem(
            topic=draft.topic,
            objective=draft.objective,
            target_seconds=draft.target_seconds,
        )
        for draft in drafts
    ]
    return EpisodePlan(
        document_id=document.document_id,
        profile=profile,
        mode=mode,
        items=items,
    )
