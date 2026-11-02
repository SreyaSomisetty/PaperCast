"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { DebugPanel } from "@/components/common/DebugPanel";
import { ApiError, createEpisode, listDocuments, uploadDocument } from "@/lib/api";
import { flowReducer, initialFlow } from "@/lib/flowReducer";
import { count, logger } from "@/lib/logger";
import type { NextAction } from "@/lib/messages";
import { failureFor } from "@/lib/messages";
import { checkPdf } from "@/lib/pdfCheck";
import { usePollDocument, usePollEpisode } from "@/lib/polling";
import { LAST_EPISODE_KEY, writeSession } from "@/lib/session";
import type { DocumentSummary, EpisodeRequest, EpisodeView } from "@/types/api";
import { CreateEpisodePanel } from "./CreateEpisodePanel";
import { DocumentList } from "./DocumentList";
import { EpisodeProgress, useRunFailureLog } from "./EpisodeProgress";
import { RunFailedCard } from "./RunFailedCard";
import { UploadZone } from "./UploadZone";

const upsert = (documents: DocumentSummary[], doc: DocumentSummary) => {
  const others = documents.filter((d) => d.document_id !== doc.document_id);
  return [doc, ...others];
};

export function LibraryScreen() {
  const router = useRouter();
  const [flow, dispatch] = useReducer(flowReducer, initialFlow);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [episode, setEpisode] = useState<EpisodeView | null>(null);
  const [lastRequest, setLastRequest] = useState<EpisodeRequest | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const submittedAt = useRef(0);

  useRunFailureLog(episode);

  useEffect(() => {
    const ctrl = new AbortController();
    listDocuments(ctrl.signal)
      .then((docs) => {
        // Merge, because an upload may have added a row while this loaded.
        setDocuments((current) => {
          const known = new Set(current.map((d) => d.document_id));
          return [...current, ...docs.filter((d) => !known.has(d.document_id))];
        });
        const processing = docs.find((d) => d.status === "processing");
        if (processing) {
          dispatch({
            type: "PROCESSING_RESUMED",
            documentId: processing.document_id,
          });
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setLoadFailed(true);
      });
    return () => ctrl.abort();
  }, []);

  const documentPoll = usePollDocument(
    flow.state === "processing" ? flow.documentId : null,
    (doc) => {
      setDocuments((docs) => upsert(docs, doc));
      if (doc.status === "ready") {
        dispatch({ type: "DOCUMENT_READY", documentId: doc.document_id });
      } else if (doc.status === "failed") {
        dispatch({
          type: "DOCUMENT_FAILED",
          documentId: doc.document_id,
          code: doc.error_code,
        });
      }
    }
  );

  const episodePoll = usePollEpisode(
    flow.state === "generating" ? flow.episodeId : null,
    (view) => {
      setEpisode(view);
      setDocuments((docs) =>
        docs.map((d) =>
          d.document_id === view.document.document_id
            ? {
                ...d,
                latest_episode: {
                  episode_id: view.episode_id,
                  status: view.status,
                  error_code: view.error_code,
                },
              }
            : d
        )
      );
      if (view.status === "COMPLETED") {
        logger.info("ui.episode.finished", {
          episode_id: view.episode_id,
          status: view.status,
          wait_ms: Date.now() - submittedAt.current,
        });
        dispatch({ type: "EPISODE_COMPLETED" });
      } else if (view.status === "FAILED") {
        dispatch({ type: "EPISODE_FAILED", code: view.error_code });
      }
    }
  );

  useEffect(() => {
    if (flow.state === "listening" && flow.episodeId) {
      writeSession(LAST_EPISODE_KEY, flow.episodeId);
      router.push(`/listen/${flow.episodeId}`);
    }
  }, [flow.state, flow.episodeId, router]);

  const handleFile = useCallback(async (file: File) => {
    const check = await checkPdf(file);
    if (!check.ok) {
      count("ui.upload_failures");
      dispatch({ type: "FILE_REJECTED", message: check.message });
      return;
    }
    dispatch({ type: "UPLOAD_STARTED", fileName: file.name });
    setEpisode(null);
    const started = Date.now();
    try {
      const accepted = await uploadDocument(file, (percent) =>
        dispatch({ type: "UPLOAD_PROGRESS", percent })
      );
      logger.info("ui.upload.completed", {
        size_bytes: file.size,
        duration_ms: Date.now() - started,
      });
      setDocuments((docs) =>
        upsert(docs, {
          document_id: accepted.document_id,
          title: file.name.replace(/\.pdf$/i, ""),
          pages: null,
          sections: null,
          status: "processing",
          stage: "extract",
          error_code: null,
          passages_indexed: null,
          latest_episode: null,
        })
      );
      dispatch({ type: "UPLOAD_ACCEPTED", documentId: accepted.document_id });
    } catch (e) {
      const error = e as ApiError;
      count("ui.upload_failures");
      logger.warn("ui.upload.failed", { error_code: error.code });
      dispatch({
        type: "UPLOAD_FAILED",
        code: error.code,
        message: error.code === "NETWORK"
          ? "We could not reach the server. Please try again."
          : failureFor(error.code).message,
      });
    }
  }, []);

  const handleGenerate = useCallback(async (request: EpisodeRequest) => {
    setLastRequest(request);
    setEpisode(null);
    dispatch({ type: "SUBMIT" });
    submittedAt.current = Date.now();
    try {
      const accepted = await createEpisode(request);
      logger.info("ui.episode.submitted", {
        episode_id: accepted.episode_id,
        profile: request.profile,
        mode: request.mode,
      });
      dispatch({ type: "EPISODE_ACCEPTED", episodeId: accepted.episode_id });
    } catch (e) {
      dispatch({ type: "SUBMIT_REJECTED", message: (e as ApiError).message });
    }
  }, []);

  const handleAction = (action: NextAction) => {
    if (action === "retry" && lastRequest) {
      dispatch({ type: "CHANGE_SETTINGS" });
      void handleGenerate(lastRequest);
    } else if (action === "changeSettings" || action === "retry") {
      setEpisode(null);
      dispatch({ type: "CHANGE_SETTINGS" });
    } else {
      setEpisode(null);
      dispatch({ type: "CHOOSE_ANOTHER_FILE" });
    }
  };

  const startOver = () => {
    setEpisode(null);
    dispatch({ type: "CHOOSE_ANOTHER_FILE" });
  };

  const selected = documents.find((d) => d.document_id === flow.documentId);
  const busy = flow.state === "uploading" || flow.state === "submitting";
  const running = flow.state === "generating" || flow.state === "processing";
  const timedOut =
    flow.state === "generating" ? episodePoll.timedOut : documentPoll.timedOut;
  const keepWaiting =
    flow.state === "generating"
      ? episodePoll.keepWaiting
      : documentPoll.keepWaiting;

  return (
    <main className="mx-auto grid max-w-6xl gap-4 px-6 py-6 lg:grid-cols-2">
      <h1 className="sr-only">Library</h1>
      <div className="space-y-4">
        <UploadZone
          disabled={busy || flow.state === "generating"}
          uploading={flow.state === "uploading"}
          percent={flow.uploadPercent}
          notice={flow.state === "docReady" ? null : flow.notice}
          onFile={handleFile}
        />
        {loadFailed && (
          <p role="alert" className="rounded bg-warn-soft px-3 py-2 text-sm text-warn">
            We could not load your documents.
          </p>
        )}
        {documentPoll.showBanner && (
          <p role="alert" className="rounded bg-warn-soft px-3 py-2 text-sm text-warn">
            We are having trouble reaching the server. Still trying.
          </p>
        )}
        <DocumentList
          documents={documents}
          selectedId={flow.documentId}
          canSelect={!busy && !running}
          onSelect={(documentId) =>
            dispatch({ type: "DOCUMENT_SELECTED", documentId })
          }
        />
      </div>

      <div className="space-y-4">
        {timedOut && (
          <div role="alert" className="rounded bg-warn-soft px-3 py-2 text-sm text-warn">
            <p>This is taking longer than expected.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={keepWaiting} className="underline">
                Keep waiting
              </button>
              <button type="button" onClick={startOver} className="underline">
                Start over
              </button>
            </div>
          </div>
        )}

        {(flow.state === "docReady" || flow.state === "submitting") && selected && (
          <CreateEpisodePanel
            key={selected.document_id}
            documentId={selected.document_id}
            title={selected.title}
            busy={flow.state === "submitting"}
            notice={flow.notice}
            onGenerate={handleGenerate}
          />
        )}

        {(flow.state === "generating" || flow.state === "listening") && (
          <EpisodeProgress episode={episode} showBanner={episodePoll.showBanner} />
        )}

        {flow.state === "runFailed" && episode && (
          <RunFailedCard episode={episode} onAction={handleAction} />
        )}

        {["idle", "uploading", "processing", "docFailed"].includes(flow.state) && (
          <section className="rounded-lg bg-card p-4 text-sm text-muted shadow-sm">
            {flow.state === "processing"
              ? "You can create an episode as soon as this paper is ready."
              : "Upload a paper, or pick one from your documents, to create an episode."}
          </section>
        )}

        <DebugPanel state={flow.state} events={flow.events} episode={episode ?? undefined} />
      </div>
    </main>
  );
}
