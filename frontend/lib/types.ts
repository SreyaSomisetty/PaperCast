// Mirrors backend/app/core/schemas.py. Keep in sync with the backend contracts.

export type ListenerProfile = "student" | "researcher";

export type ExplanationMode =
  | "quick_brief"
  | "deep_dive"
  | "discussion"
  | "study_review";

export type ClaimStatus =
  | "supported"
  | "unsupported"
  | "partial"
  | "hedged"
  | "dropped";

export interface UploadResponse {
  document_id: string;
  filename: string;
}

export interface SourceLocation {
  page?: number | null;
  section?: string | null;
  paragraph?: number | null;
}

export interface ScriptSegment {
  segment_id: string;
  speaker: string;
  text: string;
  evidence_ids: string[];
}

export interface ClaimCheck {
  segment_id: string;
  claim: string;
  status: ClaimStatus;
  explanation: string;
  evidence_ids: string[];
}

export interface AudioSegment {
  segment_id: string;
  audio_url: string;
  duration_seconds: number;
}

export interface Episode {
  document_id: string;
  script: {
    document_id: string;
    approved: boolean;
    segments: ScriptSegment[];
  };
  audio_segments: AudioSegment[];
  verification: { checks: ClaimCheck[] } | null;
}
