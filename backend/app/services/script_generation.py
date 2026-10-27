"""Script Generation service (FR-E5).

Writes a two-host conversational dialogue grounded in retrieved evidence. Every
substantive factual sentence must carry traceable evidence ids.

TODO(owner): generate grounded dialogue per plan item. Keep the signature:
    generate_script(plan, evidence_by_topic) -> Script
"""
from __future__ import annotations

from app.core.schemas import (
    EpisodePlan,
    EvidencePassage,
    Script,
    ScriptSegment,
)


def generate_script(
    plan: EpisodePlan,
    evidence_by_topic: dict[str, list[EvidencePassage]],
) -> Script:
    """Turn a plan + evidence into a cited two-host script.

    Stub: emits two alternating turns per plan item referencing the evidence.
    """
    # TODO(owner): prompt the LLM with the plan item + its evidence; require the
    # model to cite evidence ids for every factual sentence.
    segments: list[ScriptSegment] = []
    for i, item in enumerate(plan.items):
        evidence = evidence_by_topic.get(item.topic, [])
        evidence_ids = [e.chunk_id for e in evidence]
        segments.append(
            ScriptSegment(
                segment_id=f"seg-{i}-a",
                speaker="host_a",
                text=f"[placeholder] Let's talk about {item.topic}.",
                evidence_ids=evidence_ids,
            )
        )
        segments.append(
            ScriptSegment(
                segment_id=f"seg-{i}-b",
                speaker="host_b",
                text=f"[placeholder] Here is what the paper says about {item.topic}.",
                evidence_ids=evidence_ids,
            )
        )
    return Script(document_id=plan.document_id, plan=plan, segments=segments)
