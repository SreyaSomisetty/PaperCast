"use client";

import { useEffect, useState } from "react";
import { DEBUG } from "@/lib/config";

// Shown with NEXT_PUBLIC_DEBUG set and ?debug=1 in the URL.
export function useDebug(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(
      DEBUG && new URLSearchParams(window.location.search).get("debug") === "1"
    );
  }, []);
  return enabled;
}

export function DebugPanel({
  state,
  events,
  episode,
}: {
  state?: string;
  events?: string[];
  episode?: unknown;
}) {
  const enabled = useDebug();
  if (!enabled) return null;
  return (
    <details className="mt-4 rounded border border-line bg-card p-3 text-xs">
      <summary className="cursor-pointer font-medium">Debug</summary>
      {state && <p className="mt-2">State: {state}</p>}
      {events && <p>Last events: {events.join(" → ") || "none"}</p>}
      {episode !== undefined && (
        <pre className="mt-2 max-h-96 overflow-auto">
          {JSON.stringify(episode, null, 2)}
        </pre>
      )}
    </details>
  );
}
