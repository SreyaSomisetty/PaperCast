"use client";

import { useEffect, useState } from "react";
import { formatTime } from "@/components/listening/Player";
import type { RemovedClaim } from "@/types/api";
import type { SegmentVM, SentenceVM } from "@/types/view";
import { SentenceLine, sentenceDomId } from "./SentenceLine";

export function ScriptPanel({
  segments,
  removed,
  activeKey,
  selectedKey,
  onSelect,
}: {
  segments: SegmentVM[];
  removed: RemovedClaim[];
  activeKey: string | null;
  selectedKey: string | null;
  onSelect: (sentence: SentenceVM) => void;
}) {
  const [claimsOnly, setClaimsOnly] = useState(false);
  const [follow, setFollow] = useState(true);
  const [showRemoved, setShowRemoved] = useState(false);

  useEffect(() => {
    if (follow && activeKey) {
      document
        .getElementById(sentenceDomId(activeKey))
        ?.scrollIntoView?.({ block: "nearest" });
    }
  }, [follow, activeKey]);

  const stopFollowing = () => setFollow(false); // the listener scrolled by hand

  return (
    <section aria-label="Script" className="rounded-lg bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Script with verification status</h2>
        <div className="flex gap-3 text-xs text-muted">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={claimsOnly}
              onChange={(e) => setClaimsOnly(e.target.checked)}
            />
            Claims only
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
            />
            Follow along
          </label>
        </div>
      </div>

      <div
        data-testid="script-scroll"
        onWheel={stopFollowing}
        onTouchMove={stopFollowing}
        className="mt-3 max-h-[28rem] space-y-4 overflow-y-auto"
      >
        {segments.map((segment, index) => (
          <article key={segment.id} aria-label={segment.topic}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold text-muted">
                {index + 1} · {segment.topic}
              </h3>
              {segment.startMs !== null && (
                <span className="text-xs text-muted">
                  {formatTime(segment.startMs)}
                </span>
              )}
            </div>
            <div className="mt-1">
              {segment.turns.map((turn) => {
                const visible = claimsOnly
                  ? turn.sentences.filter((s) => s.kind === "claim")
                  : turn.sentences;
                return visible.map((sentence, sentenceIndex) => (
                  <SentenceLine
                    key={sentence.key}
                    sentence={sentence}
                    speaker={sentenceIndex === 0 ? turn.speakerName : null}
                    active={sentence.key === activeKey}
                    selected={sentence.key === selectedKey}
                    onSelect={onSelect}
                  />
                ));
              })}
            </div>
          </article>
        ))}
      </div>

      {removed.length > 0 && (
        <div className="mt-3 text-xs text-muted">
          {removed.length === 1
            ? "1 claim was"
            : `${removed.length} claims were`}{" "}
          removed during verification ·{" "}
          <button
            type="button"
            aria-expanded={showRemoved}
            onClick={() => setShowRemoved((v) => !v)}
            className="underline"
          >
            {showRemoved ? "hide" : "show"}
          </button>
          {showRemoved && (
            <ul className="mt-1 list-disc pl-4">
              {removed.map((claim) => (
                <li key={claim.text}>
                  {claim.text} <span className="italic">{claim.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
