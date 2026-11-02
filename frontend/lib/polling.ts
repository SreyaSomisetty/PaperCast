// Status polling (spec: Polling policy). Every 2 s for the first 30 s, then the
// interval grows by 1.5 up to 5 s. Pauses while the tab is hidden, and resumes
// at once when it is shown. Stops on a terminal status or after 15 minutes.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getDocument, getEpisode } from "./api";
import { POLL_MAX_MS, POLL_MS, POLL_TIMEOUT_MS } from "./config";
import { count, logger } from "./logger";
import { TERMINAL_RUN } from "./stages";
import type { DocumentSummary, EpisodeView } from "@/types/api";

const BANNER_AFTER_ERRORS = 3;
const GROW_AFTER_MS = 30_000;

export interface PollState {
  showBanner: boolean; // three consecutive network errors
  timedOut: boolean;
  keepWaiting: () => void;
}

export function usePoll<T>(
  id: string | null,
  fetcher: (id: string, signal: AbortSignal) => Promise<T>,
  isTerminal: (value: T) => boolean,
  onUpdate: (value: T) => void
): PollState {
  const callbacks = useRef({ fetcher, isTerminal, onUpdate });
  useEffect(() => {
    callbacks.current = { fetcher, isTerminal, onUpdate };
  });

  const [showBanner, setShowBanner] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    const started = Date.now();
    let delay = POLL_MS;
    let errors = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waitingForVisible = false;

    const tick = async () => {
      if (document.visibilityState === "hidden") {
        waitingForVisible = true;
        return;
      }
      try {
        const value = await callbacks.current.fetcher(id, ctrl.signal);
        if (ctrl.signal.aborted) return;
        errors = 0;
        setShowBanner(false);
        callbacks.current.onUpdate(value);
        if (callbacks.current.isTerminal(value)) return;
      } catch {
        if (ctrl.signal.aborted) return;
        errors += 1;
        count("ui.poll_errors");
        logger.warn("ui.poll.error", { id, consecutive_errors: errors });
        if (errors >= BANNER_AFTER_ERRORS) setShowBanner(true);
      }

      const elapsed = Date.now() - started;
      if (elapsed > POLL_TIMEOUT_MS) {
        setTimedOut(true);
        return;
      }
      if (elapsed > GROW_AFTER_MS) delay = Math.min(delay * 1.5, POLL_MAX_MS);
      timer = setTimeout(tick, delay);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && waitingForVisible) {
        waitingForVisible = false;
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();

    return () => {
      ctrl.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [id, generation]);

  const keepWaiting = useCallback(() => {
    setTimedOut(false);
    setGeneration((g) => g + 1);
  }, []);

  return { showBanner, timedOut, keepWaiting };
}

export const usePollEpisode = (
  id: string | null,
  onUpdate: (episode: EpisodeView) => void
) =>
  usePoll(
    id,
    getEpisode,
    (episode) => TERMINAL_RUN.has(episode.status),
    onUpdate
  );

export const usePollDocument = (
  id: string | null,
  onUpdate: (doc: DocumentSummary) => void
) => usePoll(id, getDocument, (doc) => doc.status !== "processing", onUpdate);
