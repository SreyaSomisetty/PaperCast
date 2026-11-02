"use client";

import { useEffect, useRef, useState } from "react";
import { useDebug } from "@/components/common/DebugPanel";
import { Label } from "@/components/common/Label";
import { getClaimEvidence, pdfUrl } from "@/lib/api";
import { count, logger } from "@/lib/logger";
import type { ClaimEvidence } from "@/types/api";
import type { SentenceVM } from "@/types/view";

const score = (value: number | null | undefined) =>
  value === null || value === undefined ? "n/a" : value.toFixed(2);

function PassageText({ item }: { item: ClaimEvidence }) {
  const { text } = item.evidence;
  const span = item.cited_span;
  if (!span) return <>{text}</>;
  return (
    <>
      {text.slice(0, span[0])}
      <mark className="bg-highlight text-ink">{text.slice(span[0], span[1])}</mark>
      {text.slice(span[1])}
    </>
  );
}

export function EvidencePanel({
  documentId,
  sentence,
  panelRef,
}: {
  documentId: string;
  sentence: SentenceVM | null;
  panelRef: React.RefObject<HTMLElement | null>;
}) {
  const cache = useRef(new Map<string, ClaimEvidence[]>());
  const [items, setItems] = useState<ClaimEvidence[] | null>(null);
  const [shown, setShown] = useState(0);
  const [failed, setFailed] = useState(false);
  const debug = useDebug();

  const claimId = sentence?.claimId ?? null;

  useEffect(() => {
    setShown(0);
    setFailed(false);
    if (!claimId) {
      setItems(null);
      return;
    }
    const cached = cache.current.get(claimId);
    if (cached) {
      setItems(cached);
      return;
    }
    setItems(null);
    const ctrl = new AbortController();
    getClaimEvidence(claimId, ctrl.signal)
      .then((found) => {
        cache.current.set(claimId, found);
        setItems(found);
        count("ui.evidence_opens");
        logger.debug("ui.evidence.opened", { claim_id: claimId });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setFailed(true);
      });
    return () => ctrl.abort();
  }, [claimId]);

  const item = items?.[shown];
  const passage = item?.evidence;

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-label="Evidence"
      className="rounded-lg bg-card p-4 shadow-sm"
    >
      <h2 className="text-sm font-semibold">Evidence</h2>

      {!claimId && (
        <p className="mt-2 text-sm text-muted">
          Select a claim in the script to see the passage that supports it.
        </p>
      )}
      {claimId && failed && (
        <p role="alert" className="mt-2 rounded bg-bad-soft px-3 py-2 text-sm text-bad">
          We could not load the evidence for this claim.
        </p>
      )}
      {claimId && !failed && !items && (
        <p className="mt-2 text-sm text-muted">Loading the evidence…</p>
      )}
      {items?.length === 0 && (
        <p className="mt-2 text-sm text-muted">No evidence is linked to this claim.</p>
      )}

      {passage && item && sentence && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted">
            {passage.section_title ? `${passage.section_title} · ` : ""}
            page {passage.page}
            {passage.paragraph ? ` · paragraph ${passage.paragraph}` : ""}
          </p>
          <blockquote className="rounded border border-line bg-canvas p-3 font-serif text-sm">
            <PassageText item={item} />
          </blockquote>
          <p className="text-xs">
            <span>Support score {score(item.support_score)}</span>
            {" · "}
            <span>retrieval score {score(item.retrieval_score)}</span>
            {" · "}
            <a
              href={pdfUrl(documentId, passage.page)}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-navy underline"
            >
              Open in PDF
            </a>
          </p>
          {debug && (
            <p className="text-xs text-muted">
              dense {score(passage.dense_score)} · lexical{" "}
              {score(passage.lexical_score)}
            </p>
          )}
          <div className="rounded bg-canvas px-3 py-2 text-sm">
            <Label badge={sentence.badge} isClaim={sentence.kind === "claim"} />
            {sentence.reason && <p className="mt-1">{sentence.reason}</p>}
          </div>
          {items && items.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              Also cited:
              {items.map(
                (other, i) =>
                  i !== shown && (
                    <button
                      key={other.evidence.chunk_id}
                      type="button"
                      onClick={() => setShown(i)}
                      className="rounded bg-idle-soft px-1.5 py-0.5 font-medium text-navy"
                    >
                      p.{other.evidence.page} {other.evidence.section_title}
                    </button>
                  )
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
