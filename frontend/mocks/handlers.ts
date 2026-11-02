// In-memory API used by mock mode and the tests. Each status poll advances a
// simulated pipeline by one step. To see failure states, upload a file whose
// name contains "scan" (no selectable text) or "unverifiable" (NOTHING_APPROVED).
import { delay, http, HttpResponse } from "msw";
import { API_BASE, MOCK_DELAY_MS } from "@/lib/config";
import type {
  DocumentSummary,
  EpisodeRequest,
  EpisodeView,
  ErrorCode,
} from "@/types/api";
import {
  attentionDocument,
  claimEvidence,
  completedEpisode,
  episodeAtStep,
  failedEpisode,
  RUN_STEP_COUNT,
} from "./fixtures/episode";

interface MockDocument {
  summary: DocumentSummary;
  pollsLeft: number;
  failWith: ErrorCode | null;
}

interface MockEpisode {
  documentId: string;
  request: EpisodeRequest;
  step: number;
  failWith: ErrorCode | null;
}

const documents = new Map<string, MockDocument>();
const episodes = new Map<string, MockEpisode>();
let nextId = 1;

export function resetMockApi(): void {
  documents.clear();
  episodes.clear();
  nextId = 1;
}

function viewOf(id: string, episode: MockEpisode): EpisodeView {
  const document = documents.get(episode.documentId)?.summary ?? attentionDocument;
  const failed =
    episode.failWith && episode.step >= 2 ? failedEpisode(episode.failWith) : null;
  const view = failed ?? episodeAtStep(episode.step);
  return {
    ...view,
    episode_id: id,
    profile: episode.request.profile,
    mode: episode.request.mode,
    format: episode.request.format,
    document,
  };
}

function advance(id: string, doc: MockDocument): DocumentSummary {
  if (doc.summary.status !== "processing") return doc.summary;
  doc.pollsLeft -= 1;
  if (doc.pollsLeft === 1) doc.summary = { ...doc.summary, stage: "index" };
  if (doc.pollsLeft <= 0) {
    doc.summary = doc.failWith
      ? { ...doc.summary, status: "failed", stage: "extract", error_code: doc.failWith }
      : { ...attentionDocument, document_id: id, title: doc.summary.title };
  }
  return doc.summary;
}

const notFound = () =>
  HttpResponse.json({ code: "NOT_FOUND", message: "Not found." }, { status: 404 });

export const handlers = [
  http.get(`${API_BASE}/documents`, () =>
    HttpResponse.json([...documents.values()].map((d) => d.summary))
  ),

  http.post(`${API_BASE}/documents`, async ({ request }) => {
    // Read from the raw body, because jsdom's XHR multipart can't be parsed by
    // `request.formData()`.
    const body = await request.text();
    const fileName = /filename="([^"]+)"/.exec(body)?.[1] ?? "paper.pdf";
    await delay(MOCK_DELAY_MS);

    const id = `doc-${nextId++}`;
    const name = fileName.toLowerCase();
    documents.set(id, {
      pollsLeft: 2,
      failWith: name.includes("scan") ? "EMPTY_DOCUMENT" : null,
      summary: {
        document_id: id,
        title: fileName.replace(/\.pdf$/i, ""),
        pages: null,
        sections: null,
        status: "processing",
        stage: "extract",
        error_code: null,
        passages_indexed: null,
        latest_episode: null,
      },
    });
    return HttpResponse.json(
      { document_id: id, status: "processing", stage: "extract" },
      { status: 201 }
    );
  }),

  http.get(`${API_BASE}/documents/:id`, async ({ params }) => {
    const id = params.id as string;
    const doc = documents.get(id);
    if (!doc) return notFound();
    await delay(MOCK_DELAY_MS);
    return HttpResponse.json(advance(id, doc));
  }),

  http.post(`${API_BASE}/episodes`, async ({ request }) => {
    const body = (await request.json()) as EpisodeRequest;
    const doc = documents.get(body.document_id);
    if (!doc) return notFound();
    if (doc.summary.status !== "ready") {
      return HttpResponse.json(
        { code: "DOCUMENT_NOT_READY", message: "This paper is not ready yet." },
        { status: 409 }
      );
    }
    const id = `ep-${nextId++}`;
    episodes.set(id, {
      documentId: body.document_id,
      request: body,
      step: -1,
      failWith: doc.summary.title.toLowerCase().includes("unverifiable")
        ? "NOTHING_APPROVED"
        : null,
    });
    return HttpResponse.json({ episode_id: id, status: "PENDING" }, { status: 202 });
  }),

  http.get(`${API_BASE}/episodes/:id`, async ({ params }) => {
    const id = params.id as string;
    const episode = episodes.get(id);
    if (!episode) {
      // A demo link still works after a reload clears this in-memory store.
      return id === "ep-demo"
        ? HttpResponse.json(completedEpisode({ episode_id: id }))
        : notFound();
    }
    await delay(MOCK_DELAY_MS);
    if (episode.step < RUN_STEP_COUNT) episode.step += 1;
    const view = viewOf(id, episode);
    const doc = documents.get(episode.documentId);
    if (doc) {
      doc.summary = {
        ...doc.summary,
        latest_episode: {
          episode_id: id,
          status: view.status,
          error_code: view.error_code,
        },
      };
    }
    return HttpResponse.json(view);
  }),

  http.get(`${API_BASE}/claims/:id/evidence`, ({ params }) => {
    const found = claimEvidence[params.id as string];
    return found ? HttpResponse.json(found) : notFound();
  }),
];
