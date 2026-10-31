"""Script Generation service (FR-E5).

Writes a two-host conversational dialogue grounded in retrieved evidence. The
workbook's "Core services layer" calls for a two-host dialogue in which every
factual sentence cites its source; that citation contract is the point of this
service and the thing downstream verification (FR-E6/FR-E7) depends on.

Phase 1 is a deterministic prototype. For each plan item the generator emits a
small fixed number of alternating host turns in an interviewer/explainer
pattern: `host_a` frames or asks, `host_b` explains directly from specific
`EvidencePassage` objects. An explanatory (factual) turn is composed from real
passage text and carries EXACTLY the `chunk_id`s of the passages it draws from,
so a traceable evidence id backs every substantive claim (FR-E5). Framing and
connective turns state nothing from the source and carry no evidence ids, so
verification will treat them accordingly.

The LLM seam is already in place — a `ScriptProvider` can be swapped for a
structured-output LLM later with no change to `generate_script` or the
orchestrator. The prompt template is assembled now (pure, inspectable) and
encodes the citation contract in words so the future model is bound by the same
rule the deterministic provider enforces structurally (NFR-5).

TODO(owner): add an LLM-backed `ScriptProvider` that consumes
`build_script_prompt` and returns the same turn drafts (text + evidence ids per
turn). Keep the signature:
    generate_script(plan, evidence_by_topic) -> Script
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from app.core.schemas import (
    EpisodePlan,
    EvidencePassage,
    PlanItem,
    Script,
    ScriptSegment,
)

# Speakers alternate consistently across the whole script: `host_a` opens each
# item by framing/asking, `host_b` answers from the evidence.
_HOST_A = "host_a"
_HOST_B = "host_b"

# Phase-1 dialogue is sized by a small fixed turn count, NOT by
# `PlanItem.target_seconds` (that is a later tuning concern). Each item yields at
# most this many explanatory passages after the opening framing turn.
_MAX_EXPLANATORY_TURNS = 3


# --------------------------------------------------------------------------- #
# Turn drafts (frozen; provider output, pre-validation)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class TurnDraft:
    """One un-validated dialogue turn returned by a provider.

    `factual` marks whether the turn states something drawn from the source.
    A factual turn MUST carry at least one `evidence_id`, and every id MUST be a
    real `chunk_id` from the item's evidence. A framing/connective turn states
    nothing from the source and carries no evidence ids.
    """

    speaker: str
    text: str
    factual: bool
    evidence_ids: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Factual vs framing classification
# --------------------------------------------------------------------------- #
def is_factual_turn(draft: TurnDraft) -> bool:
    """Return whether `draft` states a source-grounded (factual) claim.

    A turn is factual iff its provider marked it so AND it carries at least one
    evidence id. This is the structural guard behind the citation contract: a
    turn cannot be treated as factual unless it is backed by real evidence.
    """
    return draft.factual and bool(draft.evidence_ids)


# --------------------------------------------------------------------------- #
# Prompt template (pure, inspectable — the LLM seam)
# --------------------------------------------------------------------------- #
def build_script_prompt(
    item: PlanItem,
    evidence: list[EvidencePassage],
) -> str:
    """Assemble the generation prompt for one plan item + its evidence.

    Pure: no I/O, no model call. Returned so it is testable and inspectable,
    which supports reproducibility (NFR-5). The prompt encodes the citation
    contract in words — every factual sentence must cite the evidence ids it is
    drawn from — so a future LLM `ScriptProvider` is bound by the same rule the
    deterministic provider enforces structurally.
    """
    if evidence:
        evidence_lines = "\n".join(
            f"- [{p.chunk_id}] {p.text}" for p in evidence
        )
    else:
        evidence_lines = "- (no evidence retrieved for this topic)"

    return (
        "You are writing a two-host audio dialogue segment for one topic.\n"
        f"Topic: {item.topic}\n"
        f"Objective: {item.objective}\n"
        "\n"
        "Hosts:\n"
        f"- {_HOST_A} frames the topic and asks questions.\n"
        f"- {_HOST_B} explains the answer using only the evidence below.\n"
        "\n"
        "Evidence passages (cite by the bracketed id):\n"
        f"{evidence_lines}\n"
        "\n"
        "Rules:\n"
        "- Write a short interviewer/explainer exchange with alternating hosts.\n"
        "- Every factual sentence MUST cite at least one evidence id, and every "
        "cited id MUST be one of the ids listed above. Never invent an id.\n"
        "- Framing or connective lines that state nothing from the source carry "
        "no evidence ids.\n"
        "- If no evidence is listed, say so plainly and cite nothing rather than "
        "inventing a claim or a citation.\n"
        "- Do not emit placeholder text."
    )


# --------------------------------------------------------------------------- #
# Provider seam
# --------------------------------------------------------------------------- #
class ScriptProvider(Protocol):
    """Produces ordered dialogue turns for one plan item under its evidence.

    Implementations may be deterministic (Phase 1) or LLM-backed (later). The
    orchestrator and `generate_script` depend only on this interface. Providers
    MUST honor the citation contract: every factual turn carries only real
    `chunk_id`s drawn from `evidence`.
    """

    def propose_turns(
        self,
        item: PlanItem,
        evidence: list[EvidencePassage],
        prompt: str,
    ) -> list[TurnDraft]:
        ...


class _DeterministicScriptProvider:
    """Phase-1 provider: template real passage text into spoken turns.

    For a topic with evidence, `host_a` opens by grounding the topic in the first
    passage (a cited, factual turn) and `host_b` follows with one explanatory,
    cited turn per remaining passage (the whole exchange capped at
    `_MAX_EXPLANATORY_TURNS` factual turns). For a topic with no evidence, emits a
    single clearly-uncited "no source found" turn so downstream verification
    flags it rather than letting an unsupported claim through.
    """

    def propose_turns(
        self,
        item: PlanItem,
        evidence: list[EvidencePassage],
        prompt: str,
    ) -> list[TurnDraft]:
        if not evidence:
            return [
                TurnDraft(
                    speaker=_HOST_A,
                    text=(
                        f"We wanted to cover {item.topic}, but we don't have a "
                        "source passage for it, so we'll flag this rather than "
                        "guess."
                    ),
                    factual=False,
                    evidence_ids=[],
                )
            ]

        turns: list[TurnDraft] = []
        for offset, passage in enumerate(evidence[:_MAX_EXPLANATORY_TURNS]):
            # Alternate hosts: host_a opens (interviewer grounding the topic),
            # host_b explains, and so on. Every turn is drawn from a real passage
            # and cites exactly that passage's chunk_id.
            speaker = _HOST_A if offset % 2 == 0 else _HOST_B
            turns.append(
                TurnDraft(
                    speaker=speaker,
                    text=_spoken_from_passage(item.topic, passage),
                    factual=True,
                    evidence_ids=[passage.chunk_id],
                )
            )
        return turns


# Default provider used by `generate_script`. Swap for an LLM provider later.
_DEFAULT_PROVIDER: ScriptProvider = _DeterministicScriptProvider()


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _spoken_from_passage(topic: str, passage: EvidencePassage) -> str:
    """Lightly template a passage into a spoken explanatory sentence.

    Reflects what the passage actually says (its text is carried through, lightly
    trimmed) so the turn is grounded — no placeholder or invented content.
    """
    said = " ".join(passage.text.split()).strip()
    return f"On {topic}, the paper reports: {said}"


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def generate_script(
    plan: EpisodePlan,
    evidence_by_topic: dict[str, list[EvidencePassage]],
    provider: ScriptProvider | None = None,
) -> Script:
    """Turn a plan + per-topic evidence into a cited two-host script.

    For each plan item the provider proposes alternating host turns; turns are
    validated into `ScriptSegment`s with deterministic, script-unique ids
    (`seg-{item_index}-{turn_index}`). A factual turn's `evidence_ids` are set to
    exactly the `chunk_id`s it drew from; framing/uncited turns carry none. An
    empty plan yields a valid `Script` with no segments. `approved` is left at
    its default `False` — approval is the verification/orchestrator's job, not
    the generator's.
    """
    provider = provider or _DEFAULT_PROVIDER

    segments: list[ScriptSegment] = []
    for item_index, item in enumerate(plan.items):
        evidence = evidence_by_topic.get(item.topic, [])
        valid_ids = {p.chunk_id for p in evidence}
        prompt = build_script_prompt(item, evidence)
        drafts = provider.propose_turns(item, evidence, prompt)

        for turn_index, draft in enumerate(drafts):
            if is_factual_turn(draft):
                # Keep only real ids from this topic's evidence; never fabricate.
                evidence_ids = [cid for cid in draft.evidence_ids if cid in valid_ids]
            else:
                evidence_ids = []
            segments.append(
                ScriptSegment(
                    segment_id=f"seg-{item_index}-{turn_index}",
                    speaker=draft.speaker,
                    text=draft.text,
                    evidence_ids=evidence_ids,
                )
            )

    return Script(document_id=plan.document_id, plan=plan, segments=segments)
