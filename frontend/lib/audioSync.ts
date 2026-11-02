// Audio sync. The AudioManifest gives the start of every turn, so the turn being
// spoken is exact; only sentences inside a turn are estimated.
import type { AudioSegment, ScriptSegment } from "@/types/api";

export const wordCount = (text: string) =>
  text.trim().split(/\s+/).filter(Boolean).length;

// Index of the last start <= t (ms). `starts` is sorted ascending.
export function indexAt(starts: number[], t: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

// Start offsets that divide `span` in proportion to word counts.
export function spread(start: number, span: number, words: number[]): number[] {
  const total = Math.max(1, words.reduce((x, y) => x + y, 0));
  let t = start;
  return words.map((w) => {
    const s = t;
    t += (w / total) * span;
    return s;
  });
}

// Sentence starts: exact turn starts from the manifest, sentences inside a turn
// placed in proportion to their word count. If the manifest does not have one
// start per turn, turn starts are estimated the same way.
export function estimateSentenceStarts(
  segment: ScriptSegment,
  audio?: AudioSegment
): Map<string, number> {
  const out = new Map<string, number>();
  if (!audio) return out;

  const turnWords = segment.turns.map((turn) =>
    turn.sentences.reduce((n, s) => n + wordCount(s.text), 0)
  );
  const starts =
    audio.turn_starts_ms?.length === segment.turns.length
      ? audio.turn_starts_ms
      : spread(audio.start_ms, audio.duration_ms, turnWords);
  const end = (turnIndex: number) =>
    turnIndex + 1 < starts.length
      ? starts[turnIndex + 1]
      : audio.start_ms + audio.duration_ms;

  segment.turns.forEach((turn, turnIndex) => {
    const sentenceStarts = spread(
      starts[turnIndex],
      end(turnIndex) - starts[turnIndex],
      turn.sentences.map((s) => wordCount(s.text))
    );
    sentenceStarts.forEach((t, sentenceIndex) => {
      out.set(
        `${segment.segment_id}.t${turnIndex}.s${sentenceIndex}`,
        Math.round(t)
      );
    });
  });
  return out;
}
