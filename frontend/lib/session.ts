// Per-tab conveniences. Storage can be blocked, so every access is guarded and
// the interface works without it.
export function readSession<T>(key: string): T | null {
  try {
    const value = sessionStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

export function writeSession(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing is lost beyond the remembered choice.
  }
}

export const LAST_EPISODE_KEY = "papercast.lastEpisode";
export const LAST_CHOICES_KEY = "papercast.lastChoices";
