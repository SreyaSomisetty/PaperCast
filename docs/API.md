# Frontend to backend API

This is the contract the web client expects from the backend. It is for anyone
building the backend routes that connect the two.

The frontend already calls these endpoints, currently against mock responses in
`frontend/mocks/handlers.ts`. Most of them do not exist in the backend yet. When
they do, set `NEXT_PUBLIC_USE_MOCKS=false` and the screens need no other changes.

Fields marked **proposed** are not in the design spec. They fill gaps in it and
need agreement from the backend owners.

## Status

| Method | Path | Used for | Status |
|--------|------|----------|--------|
| POST | `/documents` | Upload a PDF | Exists, must change |
| GET | `/documents` | Document list (**proposed**) | Missing |
| GET | `/documents/{id}` | Document status polling | Missing |
| GET | `/documents/{id}/pdf` | Open in PDF | Missing |
| POST | `/episodes` | Start an episode | Exists, must change |
| GET | `/episodes/{id}` | Progress and playback | Exists, must change |
| GET | `/claims/{id}/evidence` | Evidence panel | Missing |
| GET | `/episodes/{id}/export` | Download button | Missing, needs real audio |
| GET | `/audio/{episode_id}/{file}` | Audio playback | Missing, needs real audio |
| POST | `/client-log` | Usability review logs (optional) | Missing |

`POST /questions`, `/ws/session/{document_id}`, and `/health` stay as they are.
The screens do not use them in Phase 1.

## General rules

**Base URL.** `http://localhost:8000/api`, set by `NEXT_PUBLIC_API_BASE_URL`. All
paths below are relative to it, including the `/api` prefix the design spec's
Table 15 leaves out.

**CORS.** Add the UI's origin to `CORS_ORIGINS` in `backend/.env` if it is not on
port 3000:

```
CORS_ORIGINS=["http://localhost:3000","http://localhost:3001"]
```

**Errors.** Return this shape for every error:

```json
{ "code": "NOT_PDF", "message": "PaperCast accepts PDF files only." }
```

The client maps `code` to the plain-language messages in
`frontend/lib/messages.ts`, so use the codes listed below. It also reads
FastAPI's default `{"detail": "..."}` when `detail` is a string, but then has no
code to act on. FastAPI's own 422 body has a list in `detail`, so the client
shows only the status text.

**Timeouts.** Every call except upload is cancelled after 15 seconds. This
includes `POST /episodes`, so it must start the work in the background and return
immediately.

**Polling.** The client calls the status endpoints every 2 seconds for 30
seconds, then backs off to every 5 seconds. It stops on a terminal status, and
gives up after 15 minutes with a Keep waiting option. Polling pauses while the
tab is hidden. These endpoints must be cheap and safe to call repeatedly.

## Documents

### POST /documents

Upload a PDF as `multipart/form-data` with one field, `file`. The route validates
the file, responds at once, and runs extraction and indexing in the background.

**201 Created**

```json
{ "document_id": "doc-1", "status": "processing", "stage": "extract" }
```

| Status | Code | When | Backend today |
|--------|------|------|---------------|
| 400 | `NOT_PDF` | Not a `.pdf`, or does not start with `%PDF-` | Done |
| 400 | `EMPTY_FILE` | File has no content | Done |
| 413 | `FILE_TOO_LARGE` | Over 20 MB (`max_upload_mb`) | Done |
| 400 | `CORRUPT_PDF` | The parser cannot read the file | Needs the real parser |

Today this route returns 200 with `{document_id, filename}` and runs extraction
and indexing inside the request. Move that work to a background thread.

### GET /documents

**Proposed.** Lists documents for the "Your documents" panel, so the list survives
a page refresh. Returns an array of `DocumentSummary`. If a document is still
`processing`, the client resumes polling it.

### GET /documents/{id}

Returns one `DocumentSummary`, or 404. Polling stops when `status` is not
`processing`.

```json
{
  "document_id": "doc-1",
  "title": "Attention Is All You Need",
  "pages": 15,
  "sections": 7,
  "status": "ready",
  "stage": null,
  "error_code": null,
  "passages_indexed": 212,
  "latest_episode": {
    "episode_id": "ep-1",
    "status": "COMPLETED",
    "error_code": null
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `status` | `processing`, `ready`, `failed` | |
| `stage` | `extract`, `index`, or null | The stage running, or the one that failed. Null when ready |
| `error_code` | string or null | Set when `failed`, for example `EMPTY_DOCUMENT` |
| `pages`, `sections`, `passages_indexed` | number or null | Null until known |
| `latest_episode` | object or null | **Proposed.** Drives the Plan to Render chips and the Listen link |

### GET /documents/{id}/pdf

Returns the stored PDF as `application/pdf`, or 404. The client opens it in a new
tab with `#page=N`. The upload route already stores the file at
`{storage_dir}/{document_id}.pdf`.

## Episodes

### POST /episodes

```json
{
  "document_id": "doc-1",
  "profile": "student",
  "mode": "quick_brief",
  "format": "two_host",
  "target_minutes": 6
}
```

`target_minutes` is optional and sent only if the listener moved the slider.
`format` is always `two_host` in Phase 1. Neither is in `EpisodeRequest` yet.

**202 Accepted**

```json
{ "episode_id": "ep-1", "status": "PENDING" }
```

| Status | When |
|--------|------|
| 404 | Unknown document |
| 409 | Document is not `ready` |
| 422 | Validation failed |

The client shows `message` next to the Generate button, so write it for a
listener. Today this route runs the whole pipeline in the request and returns an
`Episode`.

### GET /episodes/{id}

Returns an `EpisodeView`, or 404. The same response serves progress and playback.
Polling stops on `COMPLETED` or `FAILED`.

Today `{id}` is a document id and the response is an `Episode`. It must become an
episode id. No screen uses the current route.

```json
{
  "episode_id": "ep-1",
  "run_id": "r-7f3a",
  "status": "COMPLETED",
  "error_code": null,
  "profile": "student",
  "mode": "quick_brief",
  "format": "two_host",
  "document": { "document_id": "doc-1", "title": "Attention Is All You Need" },
  "progress": { "items_total": 3, "items_done": 3, "current_item_id": null },
  "plan": [
    { "item_id": "item-02", "order": 2, "topic": "Self-attention", "role": "explain" }
  ],
  "segments": [
    {
      "segment_id": "item-02",
      "item_id": "item-02",
      "topic": "Self-attention",
      "status": "APPROVED",
      "attempt": 1,
      "turns": [
        {
          "speaker": "host_a",
          "sentences": [
            {
              "text": "The authors replace recurrence with self-attention.",
              "kind": "claim",
              "evidence_ids": ["c-0012"]
            }
          ]
        }
      ]
    }
  ],
  "script_version": 3,
  "checks": [
    {
      "claim_id": "cl-0207",
      "status": "supported",
      "hedged": false,
      "support_score": 0.94,
      "reason": "The passage says the model uses attention only.",
      "sentence_ref": { "segment_id": "item-02", "turn_index": 0, "sentence_index": 0 }
    }
  ],
  "evidence": {
    "c-0012": {
      "chunk_id": "c-0012",
      "text": "In this work we propose the Transformer...",
      "score": 0.82,
      "page": 2,
      "section_id": "1 Introduction",
      "section_title": "1 Introduction",
      "paragraph": 4
    }
  },
  "audio": null,
  "rejected": [],
  "removed_claims": [
    {
      "segment_id": "item-03",
      "text": "The model trained in a single hour.",
      "reason": "No supporting evidence was found in the paper."
    }
  ],
  "updated_at": "2026-11-05T19:06:40Z"
}
```

`document` above is shortened. It is a full `DocumentSummary`.

**Values**

| Field | Values |
|-------|--------|
| `status` (run) | `PENDING`, `PLANNING`, `GENERATING`, `APPROVED`, `RENDERING`, `COMPLETED`, `FAILED` |
| `profile` | `student`, `researcher` |
| `mode` | `quick_brief`, `deep_dive`, `discussion`, `study_review` |
| `segments[].status` | `QUEUED`, `GENERATING`, `VERIFYING`, `NEEDS_REVISION`, `APPROVED`, `REMOVED` |
| `speaker` | `host_a` (Maya), `host_b` (Leo) |
| `kind` | `claim`, `background`, `question`, `transition` |
| `checks[].status` | `supported`, `partial`, `unsupported`, `contradicted` |

`profile` and `mode` must be valid, because the screens look up their labels.

**Failure codes.** On `FAILED`, set `error_code` to one of the following. The
code also decides which stage chip turns red.

| Code | Chip | Offered action |
|------|------|----------------|
| `PLAN_INVALID` | Plan | Retry |
| `LLM_TIMEOUT` | Generate | Retry |
| `RETRIEVAL_ERROR` | Generate | Upload again |
| `NOTHING_APPROVED` | Verify | Change mode, or choose another paper |
| `VERIFICATION_ERROR` | Verify | Retry |
| `RENDER_ERROR` | Render | Retry |

**What the client relies on**

- **Only `APPROVED` segments are played or shown.** The Listening screen refuses
  any status except `COMPLETED`, so a failed run is never shown as an episode.
- **Progress rows** come from `plan`, joined to `segments` by `item_id`. A plan
  item with no segment shows as Queued. `plan` can be null while `PLANNING`.
- **`attempt`** is the revision number shown beside `NEEDS_REVISION`.
- **Every `claim` sentence needs a matching check.** `sentence_ref` must point at
  it exactly. Without one, the client shows "Not checked" and logs an invariant
  violation.
- **Every id in `evidence_ids` must be a key in `evidence`.** Otherwise the label
  shows "p.?" and a violation is logged.
- **A hedged claim** is `status: supported` or `partial` with `hedged: true`, and
  shows as Qualified.
- **`unsupported` or `contradicted` in an approved script** is a pipeline bug. The
  client shows it in red and logs it, rather than hiding it.
- **`removed_claims`** is **proposed**. It drives "1 claim was removed during
  verification".

### Audio

`audio` may be null. A completed episode with no `episode_url` plays silent
placeholder audio, and the player says so, so the speech service does not block
connecting the frontend.

```json
{
  "episode_url": "/audio/ep-1/episode.mp3",
  "export_url": "/episodes/ep-1/export",
  "duration_ms": 298000,
  "segments": [
    {
      "segment_id": "item-02",
      "url": "/audio/ep-1/item-02.mp3",
      "start_ms": 74000,
      "duration_ms": 77000,
      "turn_starts_ms": [74000, 110000, 125000]
    }
  ]
}
```

- `episode_url` is what plays. A relative path is resolved against the API base
  URL, and an absolute URL is used as it is.
- All times are in milliseconds from the start of the episode, including
  `turn_starts_ms`.
- `turn_starts_ms` needs one entry per turn. If the count differs, the client
  estimates turn starts from word counts.
- Any non-null `export_url` enables Download, which always calls
  `/episodes/{id}/export`.

### GET /episodes/{id}/export

Returns a zip of the audio, approved script, and verification report.

### GET /audio/{episode_id}/{file}

Returns `audio/mpeg`, and must support the `Range` header (200 or 206) so seeking
works.

## Claims

### GET /claims/{id}/evidence

Called when a listener selects a claim. The response is cached per claim. `{id}`
is `claim_id` from `checks`.

**200 OK**, or 404

```json
[
  {
    "evidence": {
      "chunk_id": "c-0012",
      "text": "In this work we propose the Transformer...",
      "score": 0.82,
      "page": 2,
      "section_id": "1 Introduction",
      "section_title": "1 Introduction",
      "paragraph": 4
    },
    "retrieval_score": 0.82,
    "support_score": 0.94,
    "bbox": null,
    "cited_span": [28, 39]
  }
]
```

The first item is shown first, and the rest appear under "Also cited".

| Field | Notes |
|-------|-------|
| `support_score` | Null is allowed, and shows as "n/a" |
| `cited_span` | **Proposed.** `[start, end]` character offsets in `evidence.text`. Without it, the passage shows with no highlight |

## Logging (optional)

### POST /client-log

Sent every 10 seconds only when `NEXT_PUBLIC_CLIENT_LOG=true`. Failures are
ignored by the client.

```json
{ "events": [{ "level": "info", "event": "ui.upload.completed" }], "counters": {} }
```

## Connecting to today's pipeline

Most of this can sit in an adapter that converts the current `Episode` into an
`EpisodeView`, without changing the pipeline first.

| `EpisodeView` | Comes from |
|---------------|-----------|
| `plan` | `script.plan.items` |
| `segments` | Group `script.segments` by item. Segment ids are `seg-{item}-{turn}` |
| `turns` | One turn per `ScriptSegment`, holding one sentence |
| `kind` | `claim` if `evidence_ids` is not empty, otherwise `transition` |
| `checks[].reason` | `ClaimCheck.explanation` |
| `checks[].status` | `SUPPORTED` to `supported`. `HEDGED` to `supported` with `hedged: true` |
| `audio` | `null` until speech is real |

Four things cannot be built from `Episode` today, and need small changes in
`backend/app/orchestration/pipeline.py`:

| Need | Why | Change |
|------|-----|--------|
| `evidence` | `run_episode` holds `evidence_by_chunk` but does not return it | Add it to `Episode`. As a stopgap, rebuild passages from document chunks, but retrieval scores are lost |
| `removed_claims` | `_hedge_or_drop` removes dropped claims from the report | Keep them on the report |
| Live `status` | The pipeline reports nothing until it finishes, so the chips jump to the end | Add a progress callback to `run_episode` |
| `error_code` | Failures are not coded, and an all-dropped script is approved with no segments | Return `NOTHING_APPROVED` and the other codes |

## Checklist

1. Add the schemas, and `format` and `target_minutes`, to `core/schemas.py`.
2. Store document status, and store episodes by `episode_id`, in `services/store.py`.
3. Run ingestion and episodes in background threads, and return 201 and 202.
4. Add `GET /documents` and `GET /documents/{id}`.
5. Add the `EpisodeView` adapter and change `GET /episodes/{id}`.
6. Add `GET /claims/{id}/evidence` and `GET /documents/{id}/pdf`.
7. Add the UI's origin to `CORS_ORIGINS`.
8. Set `NEXT_PUBLIC_USE_MOCKS=false`, then run upload to playback in a browser.

`frontend/types/api.ts` holds the same shapes as TypeScript. Once the backend
exposes them, replace it with types generated from the OpenAPI schema (SR-UI-8).
