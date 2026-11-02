import Link from "next/link";
import { failureFor } from "@/lib/messages";
import { chipsFor } from "@/lib/stages";
import type { DocumentSummary } from "@/types/api";
import { StageChips } from "./StageChips";

const STATUS: Record<DocumentSummary["status"], { word: string; style: string }> = {
  ready: { word: "Ready", style: "bg-ok-soft text-ok" },
  processing: { word: "Processing", style: "bg-warn-soft text-warn" },
  failed: { word: "Failed", style: "bg-bad-soft text-bad" },
};

function Details({ doc }: { doc: DocumentSummary }) {
  if (doc.status === "failed") {
    return <p className="text-xs text-bad">{failureFor(doc.error_code).message}</p>;
  }
  if (doc.status === "processing") {
    const stage = doc.stage === "index" ? "Indexing passages" : "Extracting text";
    return <p className="text-xs text-muted">{stage}</p>;
  }
  return (
    <p className="text-xs text-muted">
      {doc.pages} pages · {doc.passages_indexed} passages indexed
    </p>
  );
}

export function DocumentList({
  documents,
  selectedId,
  canSelect,
  onSelect,
}: {
  documents: DocumentSummary[];
  selectedId: string | null;
  canSelect: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-label="Your documents" className="rounded-lg bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold">Your documents</h2>
      {documents.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Papers you upload appear here.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {documents.map((doc) => {
            const status = STATUS[doc.status];
            const latest = doc.latest_episode;
            return (
              <li
                key={doc.document_id}
                className={`-mx-2 px-2 py-3 ${doc.document_id === selectedId ? "rounded bg-canvas" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{doc.title}</p>
                    <Details doc={doc} />
                  </div>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${status.style}`}
                  >
                    {status.word}
                  </span>
                </div>
                <div className="mt-2">
                  <StageChips chips={chipsFor(doc)} />
                </div>
                <div className="mt-2 flex gap-3 text-xs">
                  {doc.status === "ready" && doc.document_id !== selectedId && (
                    <button
                      type="button"
                      disabled={!canSelect}
                      onClick={() => onSelect(doc.document_id)}
                      className="font-medium text-navy underline disabled:no-underline disabled:opacity-60"
                    >
                      Create an episode
                      <span className="sr-only"> for {doc.title}</span>
                    </button>
                  )}
                  {latest?.status === "COMPLETED" && (
                    <Link
                      href={`/listen/${latest.episode_id}`}
                      className="font-medium text-navy underline"
                    >
                      Listen<span className="sr-only"> to {doc.title}</span>
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
