// API response shapes from the design spec (Data Structures, Table 15).
//
// Provisional: written by hand because the backend does not expose these yet.
// Replace with `openapi-typescript` output once it does (SR-UI-8). Fields marked
// "proposed" fill gaps in the spec and need agreement with the backend owners.

export type Profile = "student" | "researcher";
export type Mode = "quick_brief" | "deep_dive" | "discussion" | "study_review";
export type Format = "two_host" | "single_narrator";

export type RunStatus =
  | "PENDING"
  | "PLANNING"
  | "GENERATING"
  | "APPROVED"
  | "RENDERING"
  | "COMPLETED"
  | "FAILED";

export type SegmentStatus =
  | "QUEUED"
  | "GENERATING"
  | "VERIFYING"
  | "NEEDS_REVISION"
  | "APPROVED"
  | "REMOVED";

export type ClaimStatus =
  | "supported"
  | "partial"
  | "unsupported"
  | "contradicted";

export type ErrorCode =
  | "NOTHING_APPROVED"
  | "PLAN_INVALID"
  | "LLM_TIMEOUT"
  | "RETRIEVAL_ERROR"
  | "VERIFICATION_ERROR"
  | "RENDER_ERROR"
  | "NOT_PDF"
  | "FILE_TOO_LARGE"
  | "EMPTY_FILE"
  | "CORRUPT_PDF"
  | "EMPTY_DOCUMENT";

export interface LatestEpisode {
  // proposed: lets a document row show Plan to Render without fetching episodes
  episode_id: string;
  status: RunStatus;
  error_code: ErrorCode | null;
}

export interface DocumentSummary {
  document_id: string;
  title: string;
  pages: number | null;
  sections: number | null;
  status: "processing" | "ready" | "failed";
  stage: "extract" | "index" | null;
  error_code: string | null;
  passages_indexed: number | null;
  latest_episode: LatestEpisode | null;
}

export interface UploadAccepted {
  document_id: string;
  status: "processing";
  stage: "extract";
}

export interface EpisodeAccepted {
  episode_id: string;
  status: "PENDING";
}

export interface EpisodeRequest {
  document_id: string;
  profile: Profile;
  mode: Mode;
  format: Format;
  target_minutes?: number;
}

export interface Sentence {
  text: string;
  kind: "claim" | "background" | "question" | "transition";
  evidence_ids: string[];
}

export interface Turn {
  speaker: "host_a" | "host_b";
  sentences: Sentence[];
}

export interface ScriptSegment {
  segment_id: string;
  item_id: string;
  turns: Turn[];
  status: SegmentStatus;
  attempt: number;
}

export interface SentenceRef {
  segment_id: string;
  turn_index: number;
  sentence_index: number;
}

export interface ClaimCheck {
  claim_id: string;
  status: ClaimStatus;
  reason: string;
  hedged: boolean;
  support_score: number | null;
  sentence_ref: SentenceRef;
}

export interface EvidencePassage {
  chunk_id: string;
  text: string;
  score: number;
  page: number;
  section_id: string;
  document_id?: string | null;
  section_title?: string | null;
  paragraph?: number | null;
  rank?: number | null;
  dense_score?: number | null;
  lexical_score?: number | null;
}

export interface ClaimEvidence {
  evidence: EvidencePassage;
  retrieval_score: number;
  support_score: number | null;
  bbox: string | null;
  // proposed: character offsets of the cited span within `evidence.text`
  cited_span?: [number, number] | null;
}

export interface AudioSegment {
  segment_id: string;
  url: string;
  start_ms: number;
  duration_ms: number;
  turn_starts_ms: number[];
}

export interface EpisodeAudio {
  episode_url: string | null;
  export_url: string | null;
  duration_ms: number;
  segments: AudioSegment[];
}

export interface PlanEntry {
  item_id: string;
  order: number;
  topic: string;
  role: string;
}

export interface RemovedClaim {
  // proposed: lets the script show "1 claim was removed during verification"
  segment_id: string;
  text: string;
  reason: string;
}

export interface EpisodeView {
  episode_id: string;
  run_id: string;
  status: RunStatus;
  error_code: ErrorCode | null;
  profile: Profile;
  mode: Mode;
  format: Format;
  document: DocumentSummary;
  progress: {
    items_total: number;
    items_done: number;
    current_item_id: string | null;
  };
  plan: PlanEntry[] | null;
  segments: (ScriptSegment & { topic: string })[]; // includes in-progress ones
  script_version: number | null;
  checks: ClaimCheck[];
  evidence: Record<string, EvidencePassage>; // every cited chunk_id
  audio: EpisodeAudio | null;
  rejected: { item_id: string; topic: string; reason: string }[];
  removed_claims: RemovedClaim[];
  updated_at: string;
}
