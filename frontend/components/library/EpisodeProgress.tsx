import { useEffect, useRef, useState } from "react";
import { modeOption } from "@/lib/modes";
import { count, logger } from "@/lib/logger";
import { chipsFor } from "@/lib/stages";
import type { EpisodeView, SegmentStatus } from "@/types/api";
import { StageChips } from "./StageChips";

const MAX_REVISIONS = 2;

const ROW: Record<SegmentStatus, { word: string; style: string; icon: string }> = {
  QUEUED: { word: "Queued", style: "bg-idle-soft text-idle", icon: "" },
  GENERATING: { word: "Writing", style: "bg-warn-soft text-warn", icon: "" },
  VERIFYING: { word: "Verifying", style: "bg-warn-soft text-warn", icon: "" },
  NEEDS_REVISION: { word: "Needs revision", style: "bg-warn-soft text-warn", icon: "↻" },
  APPROVED: { word: "Approved", style: "bg-ok-soft text-ok", icon: "✓" },
  REMOVED: { word: "Removed", style: "bg-bad-soft text-bad", icon: "✕" },
};

function statusLine(episode: EpisodeView): string {
  const { items_done: done, items_total: total } = episode.progress;
  switch (episode.status) {
    case "PENDING":
      return "Waiting to start";
    case "PLANNING":
      return "Planning the episode";
    case "GENERATING":
      return `Writing and checking segment ${Math.min(done + 1, total)} of ${total}`;
    case "APPROVED":
    case "RENDERING":
      return "Recording the approved script";
    case "COMPLETED":
      return "Episode ready";
    case "FAILED":
      return "Episode could not be made";
  }
}

export function EpisodeProgress({
  episode,
  showBanner,
}: {
  episode: EpisodeView | null;
  showBanner: boolean;
}) {
  const line = episode ? statusLine(episode) : "Waiting to start";
  const statusOf = (itemId: string) =>
    episode?.segments.find((s) => s.item_id === itemId);

  // Announce changes, not every poll.
  const previous = useRef(line);
  const [announcement, setAnnouncement] = useState(line);
  useEffect(() => {
    if (previous.current !== line) {
      previous.current = line;
      setAnnouncement(line);
    }
  }, [line]);

  return (
    <section
      aria-label="Episode in progress"
      className="space-y-3 rounded-lg bg-card p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Episode in progress</h2>
          {episode && (
            <p className="text-xs text-muted">
              {episode.document.title} · {modeOption(episode.mode).label}
            </p>
          )}
        </div>
        <span className="rounded bg-warn-soft px-1.5 py-0.5 text-xs font-medium text-warn">
          {episode?.status ?? "PENDING"}
        </span>
      </div>

      {episode && <StageChips chips={chipsFor(episode.document, episode)} />}

      <p className="text-xs text-muted">
        {line}
        {episode && ` · run ${episode.run_id}`}
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {showBanner && (
        <p role="alert" className="rounded bg-warn-soft px-3 py-2 text-sm text-warn">
          We are having trouble reaching the server. Still trying.
        </p>
      )}

      {episode?.plan && (
        <ol className="space-y-2">
          {episode.plan.map((item) => {
            const segment = statusOf(item.item_id);
            const status = segment?.status ?? "QUEUED";
            const row = ROW[status];
            return (
              <li
                key={item.item_id}
                className="flex items-center justify-between gap-2 rounded border border-line px-3 py-2"
              >
                <span className="text-sm font-medium">
                  {item.order}. {item.topic}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${row.style}`}
                >
                  {row.icon && <span aria-hidden="true">{row.icon} </span>}
                  {row.word}
                  {status === "NEEDS_REVISION" &&
                    ` · revision ${segment?.attempt ?? 1} of ${MAX_REVISIONS}`}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <p className="rounded bg-canvas px-3 py-2 text-xs text-muted">
        A segment is kept only if every claim is supported by the paper or qualified
        to match it. Segments that still fail after two revisions are left out of the
        audio.
      </p>
    </section>
  );
}

export function useRunFailureLog(episode: EpisodeView | null): void {
  const logged = useRef<string | null>(null);
  useEffect(() => {
    if (episode?.status === "FAILED" && logged.current !== episode.episode_id) {
      logged.current = episode.episode_id;
      count("ui.failed_runs");
      logger.info("ui.episode.finished", {
        episode_id: episode.episode_id,
        profile: episode.profile,
        mode: episode.mode,
        status: episode.status,
      });
    }
  }, [episode]);
}
