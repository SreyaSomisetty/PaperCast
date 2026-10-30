// Thin client for the PaperCast backend.
import type {
  Episode,
  ExplanationMode,
  ListenerProfile,
  UploadResponse,
} from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000/api";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return (await res.json()) as T;
}

export async function uploadDocument(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/documents`, {
    method: "POST",
    body: form,
  });
  return handle<UploadResponse>(res);
}

export async function createEpisode(
  documentId: string,
  profile: ListenerProfile,
  mode: ExplanationMode
): Promise<Episode> {
  const res = await fetch(`${API_BASE}/episodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document_id: documentId, profile, mode }),
  });
  return handle<Episode>(res);
}
