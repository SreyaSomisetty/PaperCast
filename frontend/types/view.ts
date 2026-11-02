// View model built by lib/viewModel.ts. Components render only these shapes.
import type { Sentence } from "./api";

export type Badge =
  | "supported"
  | "qualified"
  | "partial"
  | "unsupported"
  | "contradicted"
  | "background"
  | "none";

export interface SentenceVM {
  key: string; // "item-02.t1.s0"
  text: string;
  kind: Sentence["kind"];
  evidence: { chunkId: string; label: string }[]; // label "p.2"
  badge: Badge;
  reason: string | null;
  startMs: number | null;
  claimId: string | null;
}

export interface TurnVM {
  speakerName: string;
  sentences: SentenceVM[];
}

export interface SegmentVM {
  id: string;
  topic: string;
  startMs: number | null;
  turns: TurnVM[];
}
