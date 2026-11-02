// Silent audio of the estimated length, used until text-to-speech is available.
// It has the same shape as a real manifest, so the player, timeline, and sync
// code are exercised before real audio exists.
import { spread, wordCount } from "./audioSync";
import type { AudioSegment, EpisodeView } from "@/types/api";

const WORDS_PER_MINUTE = 150;
const SAMPLE_RATE = 4000; // silence, so this only sets the file size

export function placeholderManifest(episode: EpisodeView): {
  durationMs: number;
  segments: AudioSegment[];
} {
  let cursor = 0;
  const segments = episode.segments
    .filter((segment) => segment.status === "APPROVED")
    .map((segment) => {
      const words = segment.turns.map((turn) =>
        turn.sentences.reduce((n, s) => n + wordCount(s.text), 0)
      );
      const total = words.reduce((x, y) => x + y, 0);
      const durationMs = Math.round((total / WORDS_PER_MINUTE) * 60_000);
      const audio: AudioSegment = {
        segment_id: segment.segment_id,
        url: "",
        start_ms: cursor,
        duration_ms: durationMs,
        turn_starts_ms: spread(cursor, durationMs, words).map(Math.round),
      };
      cursor += durationMs;
      return audio;
    });
  return { durationMs: cursor, segments };
}

export function silentWav(durationMs: number): Blob {
  const samples = Math.ceil((durationMs / 1000) * SAMPLE_RATE);
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE, true); // bytes per second
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples, true);
  new Uint8Array(buffer, 44).fill(128); // 8-bit PCM silence

  return new Blob([buffer], { type: "audio/wav" });
}
