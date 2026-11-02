"""Shared data contracts for PaperCast.

These Pydantic models are the typed interfaces between every stage of the
pipeline. Services and the orchestrator depend on these shapes — keep them
stable so teammates can work on their stage in isolation. Extend with care.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Enums
# --------------------------------------------------------------------------- #
class ListenerProfile(str, Enum):
    STUDENT = "student"
    RESEARCHER = "researcher"


class ExplanationMode(str, Enum):
    QUICK_BRIEF = "quick_brief"
    DEEP_DIVE = "deep_dive"
    DISCUSSION = "discussion"
    STUDY_REVIEW = "study_review"


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class ClaimStatus(str, Enum):
    SUPPORTED = "supported"
    UNSUPPORTED = "unsupported"
    PARTIAL = "partial"
    HEDGED = "hedged"
    DROPPED = "dropped"


# --------------------------------------------------------------------------- #
# Document understanding
# --------------------------------------------------------------------------- #
class SourceLocation(BaseModel):
    """Where a piece of content lives in the source document."""

    page: Optional[int] = None
    section: Optional[str] = None
    paragraph: Optional[int] = None
    char_start: Optional[int] = None
    char_end: Optional[int] = None


class DocumentChunk(BaseModel):
    chunk_id: str
    text: str
    location: SourceLocation = Field(default_factory=SourceLocation)


class Document(BaseModel):
    document_id: str
    filename: str
    uploaded_at: datetime = Field(default_factory=_now)
    num_pages: Optional[int] = None
    chunks: list[DocumentChunk] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Retrieval
# --------------------------------------------------------------------------- #
class EvidencePassage(BaseModel):
    document_id: str
    chunk_id: str
    text: str
    location: SourceLocation = Field(default_factory=SourceLocation)
    score: float = Field(default=0.0, ge=0.0, le=1.0)  # fused, calibrated
    # Optional additions from retrieval. `location` stays for existing consumers.
    page: Optional[int] = None
    section_id: Optional[str] = None
    section_title: Optional[str] = None
    paragraph: Optional[int] = None
    rank: Optional[int] = None  # 1-based position in this result
    dense_score: Optional[float] = None  # cosine, clamped to [0, 1]
    lexical_score: Optional[float] = None  # normalized BM25 x term coverage


# --------------------------------------------------------------------------- #
# Planning
# --------------------------------------------------------------------------- #
class PlanItem(BaseModel):
    topic: str
    objective: str
    target_seconds: Optional[int] = None


class EpisodePlan(BaseModel):
    document_id: str
    profile: ListenerProfile
    mode: ExplanationMode
    items: list[PlanItem] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Script generation
# --------------------------------------------------------------------------- #
class ScriptSegment(BaseModel):
    """One spoken turn. `evidence_ids` traces factual claims to source chunks."""

    segment_id: str
    speaker: str  # e.g. "host_a" / "host_b"
    text: str
    evidence_ids: list[str] = Field(default_factory=list)


class Script(BaseModel):
    document_id: str
    plan: EpisodePlan
    segments: list[ScriptSegment] = Field(default_factory=list)
    approved: bool = False


# --------------------------------------------------------------------------- #
# Verification
# --------------------------------------------------------------------------- #
class ClaimCheck(BaseModel):
    segment_id: str
    claim: str
    status: ClaimStatus
    explanation: str = ""
    evidence_ids: list[str] = Field(default_factory=list)


class VerificationReport(BaseModel):
    document_id: str
    checks: list[ClaimCheck] = Field(default_factory=list)

    @property
    def all_supported(self) -> bool:
        return all(
            c.status in (ClaimStatus.SUPPORTED, ClaimStatus.HEDGED)
            for c in self.checks
        )


# --------------------------------------------------------------------------- #
# Audio
# --------------------------------------------------------------------------- #
class AudioSegment(BaseModel):
    segment_id: str
    audio_url: str
    duration_seconds: float = 0.0


class Episode(BaseModel):
    document_id: str
    script: Script
    audio_segments: list[AudioSegment] = Field(default_factory=list)
    verification: Optional[VerificationReport] = None


# --------------------------------------------------------------------------- #
# API request / response helpers
# --------------------------------------------------------------------------- #
class UploadResponse(BaseModel):
    document_id: str
    filename: str


class EpisodeRequest(BaseModel):
    document_id: str
    profile: ListenerProfile = ListenerProfile.STUDENT
    mode: ExplanationMode = ExplanationMode.QUICK_BRIEF


class JobRef(BaseModel):
    job_id: str
    status: JobStatus = JobStatus.PENDING


class QuestionRequest(BaseModel):
    document_id: str
    question: str
    at_segment_id: Optional[str] = None


class QuestionAnswer(BaseModel):
    answer: str
    evidence: list[EvidencePassage] = Field(default_factory=list)
