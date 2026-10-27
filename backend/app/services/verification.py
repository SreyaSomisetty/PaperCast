"""Integrity Verification service (FR-E6, FR-E7).

Splits the script into claims and checks each against source evidence — numbers,
names, dates, qualifiers. Unsupported/overconfident claims are revised, hedged,
or dropped before audio. Planned tech: deterministic checks + NLI model + LLM
judge.

TODO(owner): implement real claim extraction + entailment checking. Keep the
signatures below stable.
"""
from __future__ import annotations

from app.core.schemas import (
    ClaimCheck,
    ClaimStatus,
    EvidencePassage,
    Script,
    VerificationReport,
)


def verify_script(
    script: Script,
    evidence_by_chunk: dict[str, EvidencePassage],
) -> VerificationReport:
    """Check every substantive claim in the script against evidence.

    Stub: marks any segment that carries evidence ids as SUPPORTED, others as
    UNSUPPORTED.
    """
    # TODO(owner): extract atomic claims per segment, run an NLI model and/or
    # LLM judge against the cited evidence, preserve numbers/entities/negation.
    checks: list[ClaimCheck] = []
    for seg in script.segments:
        status = (
            ClaimStatus.SUPPORTED if seg.evidence_ids else ClaimStatus.UNSUPPORTED
        )
        checks.append(
            ClaimCheck(
                segment_id=seg.segment_id,
                claim=seg.text,
                status=status,
                explanation="[placeholder] verification not yet implemented.",
                evidence_ids=seg.evidence_ids,
            )
        )
    return VerificationReport(document_id=script.document_id, checks=checks)


def revise_unsupported(script: Script, report: VerificationReport) -> Script:
    """Hedge or drop segments whose claims did not pass verification.

    Stub: leaves the script unchanged but flips `approved` based on the report.
    """
    # TODO(owner): for each UNSUPPORTED/PARTIAL claim, request a revision from
    # the generator, re-verify, and hedge or drop after the retry budget.
    script.approved = report.all_supported
    return script
