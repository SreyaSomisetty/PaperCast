"use client";

import { useState } from "react";
import { ACTION_LABEL, failureFor, type NextAction } from "@/lib/messages";
import { modeOption } from "@/lib/modes";
import { chipsFor } from "@/lib/stages";
import type { EpisodeView } from "@/types/api";
import { StageChips } from "./StageChips";

// No script is offered here: a failed run may hold segments that were never
// approved.
export function RunFailedCard({
  episode,
  onAction,
}: {
  episode: EpisodeView;
  onAction: (action: NextAction) => void;
}) {
  const failure = failureFor(episode.error_code);
  const [copied, setCopied] = useState(false);

  const copyRunId = async () => {
    await navigator.clipboard?.writeText(episode.run_id);
    setCopied(true);
  };

  return (
    <section
      aria-label="Episode could not be made"
      className="space-y-3 rounded-lg bg-card p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Episode could not be made</h2>
          <p className="text-xs text-muted">
            {episode.document.title} · {modeOption(episode.mode).label}
          </p>
        </div>
        <span className="rounded bg-bad-soft px-1.5 py-0.5 text-xs font-medium text-bad">
          FAILED
        </span>
      </div>

      <StageChips chips={chipsFor(episode.document, episode)} />

      <div role="alert" className="rounded bg-bad-soft px-3 py-2 text-sm text-bad">
        <p className="font-semibold">{failure.message}</p>
        {failure.hint && <p className="mt-1 text-xs">{failure.hint}</p>}
        <p className="mt-1 text-xs">Error code {episode.error_code}.</p>
      </div>

      <div>
        <h3 className="text-sm font-medium">What you can do</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {failure.actions.map((action, i) => (
            <button
              key={action}
              type="button"
              onClick={() => onAction(action)}
              className={
                i === 0
                  ? "rounded bg-navy px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-dark"
                  : "rounded border border-navy px-3 py-1.5 text-sm font-medium text-navy"
              }
            >
              {ACTION_LABEL[action]}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted">
        Run {episode.run_id} ·{" "}
        <button type="button" onClick={copyRunId} className="underline">
          {copied ? "Copied" : "Copy run id"}
        </button>{" "}
        for a bug report
      </p>
    </section>
  );
}
