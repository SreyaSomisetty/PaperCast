// Typed client for the PaperCast backend. Components never handle raw responses.
import { API_BASE } from "./config";
import type {
  ClaimEvidence,
  DocumentSummary,
  EpisodeAccepted,
  EpisodeRequest,
  EpisodeView,
  UploadAccepted,
} from "@/types/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

// Reads the spec's {code, message} body, and FastAPI's default {detail}.
function toApiError(status: number, statusText: string, body: unknown): ApiError {
  const parsed = (body ?? {}) as {
    code?: string;
    message?: string;
    detail?: unknown;
  };
  const detail = typeof parsed.detail === "string" ? parsed.detail : undefined;
  return new ApiError(
    status,
    parsed.code ?? `HTTP_${status}`,
    parsed.message ?? detail ?? statusText
  );
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const forwardAbort = () => ctrl.abort();
  init.signal?.addEventListener("abort", forwardAbort);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { Accept: "application/json", ...init.headers },
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw toApiError(res.status, res.statusText, body);
    return body as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, ctrl.signal.aborted ? "TIMEOUT" : "NETWORK", String(e));
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", forwardAbort);
  }
}

export const listDocuments = (signal?: AbortSignal) =>
  request<DocumentSummary[]>("/documents", { signal });

export const getDocument = (id: string, signal?: AbortSignal) =>
  request<DocumentSummary>(`/documents/${encodeURIComponent(id)}`, { signal });

export const getEpisode = (id: string, signal?: AbortSignal) =>
  request<EpisodeView>(`/episodes/${encodeURIComponent(id)}`, { signal });

export const createEpisode = (body: EpisodeRequest) =>
  request<EpisodeAccepted>("/episodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const getClaimEvidence = (claimId: string, signal?: AbortSignal) =>
  request<ClaimEvidence[]>(`/claims/${encodeURIComponent(claimId)}/evidence`, {
    signal,
  });

export const pdfUrl = (documentId: string, page: number) =>
  `${API_BASE}/documents/${encodeURIComponent(documentId)}/pdf#page=${page}`;

export const exportUrl = (episodeId: string) =>
  `${API_BASE}/episodes/${encodeURIComponent(episodeId)}/export`;

// The manifest holds server-relative paths such as /audio/ep-1/episode.mp3.
export const mediaUrl = (path: string) =>
  /^(https?:|blob:|data:)/.test(path) ? path : `${API_BASE}${path}`;

// XMLHttpRequest because only it reports upload progress.
export function uploadDocument(
  file: File,
  onProgress: (percent: number) => void
): Promise<UploadAccepted> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/documents`);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK", "Upload failed."));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // A non-JSON error page falls through to the status text.
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadAccepted);
      else reject(toApiError(xhr.status, xhr.statusText, body));
    };
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
