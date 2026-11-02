// Joins the script with verification checks and evidence, and computes labels
// and start times. Components render only the view model, so the joining rules
// are tested in one place.
import { estimateSentenceStarts } from "./audioSync";
import { SPEAKER } from "./config";
import { count, logger } from "./logger";
import type {
  AudioSegment,
  ClaimCheck,
  EpisodeView,
  EvidencePassage,
  Sentence,
  SentenceRef,
} from "@/types/api";
import type { Badge, SegmentVM } from "@/types/view";

const refKey = (ref: SentenceRef) =>
  `${ref.segment_id}.t${ref.turn_index}.s${ref.sentence_index}`;

// Polling and re-rendering rebuild the view model, so each violation is recorded
// once per episode and sentence.
const reported = new Set<string>();

function reportViolation(episodeId: string, key: string, kind: string): void {
  const id = `${episodeId}:${key}:${kind}`;
  if (reported.has(id)) return;
  reported.add(id);
  count("ui.invariant_violations");
  logger.error("ui.invariant.violation", { episode_id: episodeId, key, kind });
}

export function badgeFor(kind: Sentence["kind"], check?: ClaimCheck): Badge {
  if (kind === "background") return "background";
  if (kind !== "claim") return "none";
  if (!check) return "none";
  if (check.hedged && (check.status === "supported" || check.status === "partial")) {
    return "qualified"; // qualifier restored, workbook Table 6.5
  }
  return check.status;
}

const VIOLATION_KIND: Partial<Record<Badge, string>> = {
  unsupported: "unsupported_in_approved",
  contradicted: "contradicted_in_approved",
  none: "claim_without_check",
};

const pageLabel = (passage?: EvidencePassage) =>
  passage ? `p.${passage.page}` : "p.?";

export function toViewModel(
  episode: EpisodeView,
  audioSegments: AudioSegment[] = episode.audio?.segments ?? []
): SegmentVM[] {
  const checks = new Map(episode.checks.map((c) => [refKey(c.sentence_ref), c]));
  const timing = new Map(audioSegments.map((a) => [a.segment_id, a]));

  return episode.segments
    .filter((segment) => segment.status === "APPROVED")
    .map((segment) => {
      const audio = timing.get(segment.segment_id);
      const starts = estimateSentenceStarts(segment, audio);
      return {
        id: segment.segment_id,
        topic: segment.topic,
        startMs: audio?.start_ms ?? null,
        turns: segment.turns.map((turn, turnIndex) => ({
          speakerName: SPEAKER[turn.speaker],
          sentences: turn.sentences.map((sentence, sentenceIndex) => {
            const key = `${segment.segment_id}.t${turnIndex}.s${sentenceIndex}`;
            const check = checks.get(key);
            const badge = badgeFor(sentence.kind, check);
            const violation = VIOLATION_KIND[badge];
            if (sentence.kind === "claim" && violation) {
              reportViolation(episode.episode_id, key, violation);
            }
            return {
              key,
              text: sentence.text,
              kind: sentence.kind,
              badge,
              reason: check?.reason ?? null,
              claimId: check?.claim_id ?? null,
              startMs: starts.get(key) ?? null,
              evidence: sentence.evidence_ids.map((chunkId) => {
                const passage = episode.evidence[chunkId];
                if (!passage) {
                  reportViolation(episode.episode_id, key, "unknown_chunk_id");
                }
                return { chunkId, label: pageLabel(passage) };
              }),
            };
          }),
        })),
      };
    });
}
