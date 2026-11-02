"use client";

import { SPEEDS } from "@/lib/useAudioPlayer";
import type { SegmentVM } from "@/types/view";

export const formatTime = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const buttonClass =
  "rounded border border-navy px-3 py-1.5 text-sm font-medium text-navy hover:bg-idle-soft";

export function Player({
  title,
  segments,
  segmentIndex,
  currentMs,
  durationMs,
  playing,
  speed,
  failed,
  placeholder,
  downloadUrl,
  onToggle,
  onSkip,
  onSpeed,
  onSeek,
}: {
  title: string;
  segments: SegmentVM[];
  segmentIndex: number;
  currentMs: number;
  durationMs: number;
  playing: boolean;
  speed: number;
  failed: boolean;
  placeholder: boolean;
  downloadUrl: string | null;
  onToggle: () => void;
  onSkip: (direction: 1 | -1) => void;
  onSpeed: (speed: number) => void;
  onSeek: (ms: number) => void;
}) {
  const current = segments[segmentIndex];
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];

  return (
    <section aria-label="Player" className="rounded-lg bg-card p-4 shadow-sm">
      <p className="text-xs text-muted">{title}</p>
      <h2 className="text-sm font-semibold">
        Segment {segmentIndex + 1} of {segments.length}: {current?.topic}
      </h2>

      <div className="mt-3 flex gap-1">
        {segments.map((segment, i) => {
          const start = segment.startMs ?? 0;
          const end = segments[i + 1]?.startMs ?? durationMs;
          const span = Math.max(1, end - start);
          const filled = Math.min(1, Math.max(0, (currentMs - start) / span));
          return (
            <button
              key={segment.id}
              type="button"
              aria-label={`Go to segment ${i + 1}: ${segment.topic}`}
              aria-current={i === segmentIndex ? "true" : undefined}
              onClick={() => onSeek(start)}
              style={{ flexGrow: span }}
              className="h-3 basis-0 overflow-hidden rounded bg-line"
            >
              <span
                className="block h-full bg-navy"
                style={{ width: `${filled * 100}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>{formatTime(currentMs)}</span>
        <span>{formatTime(durationMs)}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={() => onSkip(-1)}
        >
          <span aria-hidden="true">⟲ </span>
          <span className="sr-only">Back</span> 15s
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="rounded bg-navy px-4 py-1.5 text-sm font-medium text-white hover:bg-navy-dark"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => onSkip(1)}
        >
          <span className="sr-only">Forward</span> 15s
          <span aria-hidden="true"> ⟳</span>
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label={`Playback speed ${speed}x. Change to ${nextSpeed}x`}
          onClick={() => onSpeed(nextSpeed)}
        >
          {speed}x
        </button>
        {downloadUrl ? (
          <a href={downloadUrl} download className={buttonClass}>
            Download
          </a>
        ) : (
          <span
            className="rounded border border-line px-3 py-1.5 text-sm text-muted"
            title="Available once audio is recorded"
          >
            Download unavailable
          </span>
        )}
      </div>

      {placeholder && (
        <p className="mt-2 text-center text-xs text-muted">
          Silent placeholder audio: recording is not available yet.
        </p>
      )}
      {failed && (
        <p role="alert" className="mt-2 rounded bg-bad-soft px-3 py-2 text-sm text-bad">
          This audio could not be played. The script and evidence are still available.
        </p>
      )}
    </section>
  );
}
