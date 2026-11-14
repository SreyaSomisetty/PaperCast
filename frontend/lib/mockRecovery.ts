// Mock mode only. Browsers stop idle service workers, after sleep or under
// memory pressure, and a restarted mock worker no longer answers for this page.
// Requests then fall through to whatever server is at the API address. Every
// mock response carries MOCK_HEADER, so a response without it, or a request that
// cannot reach a server, means the worker has stopped. MockGate registers a
// restart here, and the API client calls it once before retrying. This module
// imports nothing from msw, so the client can use it in every build.

export const MOCK_HEADER = "x-papercast-mock";

let restart: (() => Promise<void>) | null = null;
let pending: Promise<void> | null = null;

export function registerMockRestart(fn: () => Promise<void>): void {
  restart = fn;
}

// Returns whether mocks were restarted, so the caller knows a retry may work.
export async function recoverMocks(): Promise<boolean> {
  if (!restart) return false;
  pending ??= restart().finally(() => {
    pending = null;
  });
  await pending;
  return true;
}
