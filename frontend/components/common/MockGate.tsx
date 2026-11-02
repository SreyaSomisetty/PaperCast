"use client";

import { setupWorker } from "msw/browser";
import { useEffect, useState, type ReactNode } from "react";
import { handlers } from "@/mocks/handlers";

// Module-level because Strict Mode runs effects twice in development, and the
// worker can only start once per page.
let started: Promise<unknown> | null = null;

// Browser-only: `msw/browser` has no server build, so MockProvider loads this
// file with `ssr: false`. Children wait until the worker can answer them.
export default function MockGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    started ??= setupWorker(...handlers).start({
      onUnhandledFrame: "bypass",
      quiet: true,
    });
    void started.then(() => setReady(true));
  }, []);

  return ready ? children : null;
}
