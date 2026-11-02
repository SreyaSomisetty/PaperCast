// Interface log events (spec Table 17) and per-session counters (Table 18).
// Events go to the console, and to POST /client-log when NEXT_PUBLIC_CLIENT_LOG
// is set, which is how timings are collected for the usability review.
import { API_BASE, CLIENT_LOG } from "./config";

type Fields = Record<string, unknown>;
type Level = "debug" | "info" | "warn" | "error";

export const counters = new Map<string, number>();

let pending: (Fields & { level: Level; event: string })[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function count(name: string): void {
  counters.set(name, (counters.get(name) ?? 0) + 1);
}

function flush(): void {
  flushTimer = null;
  const batch = pending;
  pending = [];
  void fetch(`${API_BASE}/client-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: batch, counters: Object.fromEntries(counters) }),
  }).catch(() => undefined); // logging must never break the interface
}

function write(level: Level, event: string, fields: Fields = {}): void {
  console[level](event, fields);
  if (!CLIENT_LOG) return;
  pending.push({ level, event, ...fields });
  flushTimer ??= setTimeout(flush, 10_000);
}

export const logger = {
  debug: (event: string, fields?: Fields) => write("debug", event, fields),
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};
