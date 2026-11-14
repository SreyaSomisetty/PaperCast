"use client";

import { setupWorker } from "msw/browser";
import { useEffect, useState, type ReactNode } from "react";
import { logger } from "@/lib/logger";
import { registerMockRestart } from "@/lib/mockRecovery";
import { handlers } from "@/mocks/handlers";

const START_OPTIONS = { onUnhandledFrame: "bypass", quiet: true } as const;

// Module-level because Strict Mode runs effects twice in development, and the
// worker can only start once per page.
const worker = setupWorker(...handlers);
let started: Promise<unknown> | null = null;

registerMockRestart(async () => {
  logger.warn("ui.mocks.restarted");
  await worker.stop();
  await worker.start(START_OPTIONS);
});

// Browser-only: `msw/browser` has no server build, so MockProvider loads this
// file with `ssr: false`. Children wait until the worker can answer them.
export default function MockGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    started ??= worker.start(START_OPTIONS);
    void started.then(() => setReady(true));
  }, []);

  return ready ? children : null;
}
