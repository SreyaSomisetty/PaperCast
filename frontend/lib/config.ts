// Build-time settings. Only NEXT_PUBLIC_ values reach the browser, and none of
// them may contain a key (SR-NF-10).
const number = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) ? parsed : fallback;
};

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api";
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true";
export const MOCK_DELAY_MS = number(process.env.NEXT_PUBLIC_MOCK_DELAY_MS, 900);
export const MAX_UPLOAD_MB = number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB, 20);
export const POLL_MS = number(process.env.NEXT_PUBLIC_POLL_MS, 2000);
export const POLL_MAX_MS = number(process.env.NEXT_PUBLIC_POLL_MAX_MS, 5000);
export const POLL_TIMEOUT_MS =
  number(process.env.NEXT_PUBLIC_POLL_TIMEOUT_MIN, 15) * 60_000;
export const CLIENT_LOG = process.env.NEXT_PUBLIC_CLIENT_LOG === "true";
export const DEBUG = process.env.NEXT_PUBLIC_DEBUG === "true";

export const SPEAKER = { host_a: "Maya", host_b: "Leo" } as const;
