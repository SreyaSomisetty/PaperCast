# PaperCast

**An Interactive, Evidence-Grounded Audio Learning Assistant**

PaperCast turns academic PDFs into conversational, evidence-grounded audio that
listeners can interrupt, question, and navigate. Every factual claim is traced
back to the source and verified before audio is rendered.

> CMPE 295A — Asha Vinodhini Vijayan, Gayathri Rukmadhavan, Manasa Sadhu, Sreya
> Somisetty. Advisor: Prof. Chandrasekar Vuppalapati.

---

## Current status

PaperCast is a Phase 1 prototype. Stages are being replaced one at a time, so
some are real and others still return placeholder data.

| Area | Status |
|------|--------|
| Orchestration loop, planner, script generator | Working, deterministic (no LLM yet) |
| Evidence retrieval | Working: hybrid FAISS + BM25 search |
| Library and Listening screens | Working against mock data |
| Frontend connected to backend | **Not yet** (see below) |
| Document extraction, claim verification, speech, persistence | Stubs, marked `TODO(owner)` |

**The frontend runs in mock mode for now.** It needs document status and
episode view endpoints that the backend does not have yet, so with mocks off
the flow stops after upload. See [`docs/API.md`](docs/API.md) for the endpoints
and shapes it expects. Fields marked "proposed" still need team agreement.

## Repo layout

```
PaperCast/
├── backend/                FastAPI service
│   ├── app/
│   │   ├── api/            REST + WebSocket routes
│   │   ├── core/           config, shared schemas
│   │   ├── orchestration/  Plan → Execute → Evaluate → Retry loop
│   │   ├── schemas/        retrieval-only types and error codes
│   │   └── services/       one module per core service
│   │       └── retrieval/  index build, hybrid ranking, index store
│   ├── tests/
│   └── requirements.txt
├── frontend/               Next.js (React) web client
│   ├── app/                routes: / (Library), /listen/[episodeId] (Listening)
│   ├── components/         library/, listening/, common/
│   ├── lib/                API client, polling, state machine, view model, audio sync
│   ├── mocks/              Mock Service Worker handlers and fixture episodes
│   ├── tests/              unit/ (Vitest), e2e/ (Playwright)
│   └── types/              API and view-model types
└── docs/                   architecture notes + the feature split
```

## Architecture (from the workbook)

Layered, service-oriented, with an agentic orchestrator at the center:

| Layer | Responsibility | Planned tech |
|-------|----------------|--------------|
| Presentation | upload, pick profile/mode, listen, ask, trace claims | Next.js / React |
| API & session | REST + WebSocket, session state, background jobs | FastAPI, Redis, Celery |
| Orchestration | Plan → Execute → Evaluate → Retry loop | LangGraph |
| Core services | extract, retrieve, generate, verify, adapt, visual→audio, speech | PyMuPDF, FAISS, LLM, NLI, TTS, Whisper |
| Data & eval | storage + per-run metrics | SQLite/FAISS → Postgres/pgvector/S3 |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/FEATURE_SPLIT.md`](docs/FEATURE_SPLIT.md).

## Getting started

### Backend

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Use Python 3.11. The requirements include torch, so the install is large, and
the first upload downloads the embedding model.

API docs at http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

UI at http://localhost:3000. If that port is taken, use
`npm run dev -- --port 3001`.

The example file turns on mock mode, so no backend is needed. In mock mode:

- Upload any file that is a real PDF. Its contents are ignored, and every
  episode uses the same fixture script.
- A filename containing `scan` shows a failed document, and one containing
  `unverifiable` shows a failed run.
- Audio is silent placeholder audio.
- Refreshing the page clears the mock data.

Settings are in [`frontend/.env.local.example`](frontend/.env.local.example). To
call a backend directly, set `NEXT_PUBLIC_USE_MOCKS=false`. If the UI is not on
port 3000, add its origin to `CORS_ORIGINS` in `backend/.env`.

## Running the tests

```bash
# Backend: offline, using a fake embedder
cd backend
python -m pytest

# Frontend
cd frontend
npm test                          # unit tests
npx playwright install chromium   # first time only
npm run e2e                       # browser tests with accessibility checks
```

## Evidence retrieval

`retrieval.retrieve(document, query, k, sections)` returns ranked
`EvidencePassage` objects. `document` is a `Document` or a document id held by
the store. Scores are calibrated between 0 and 1, and an empty list means
nothing matched. Callers apply their own minimum score.

- Passages from `sections` are taken first, and other sections fill any
  remaining slots.
- An index is built on upload, and rebuilt automatically if the chunks or the
  model change.
- Index files are written under `backend/data/indexes/`.
- Queries over 200 characters are shortened at a word boundary.
- Settings are in `RetrievalSettings` in `backend/app/core/config.py`. Override
  them with `PAPERCAST_RETRIEVAL_<KEY>`, for example
  `PAPERCAST_RETRIEVAL_K=6`.

**Import faiss only through `embedder.load_faiss()`.** Importing it before torch
makes the first model encode segfault on Apple Silicon, which kills the server.

## How the team splits work

Each core service in `backend/app/services/` has a typed input/output contract.
Pick one that is still marked `TODO`, replace it, and keep the interface stable
so the rest of the system keeps working. See
[`docs/FEATURE_SPLIT.md`](docs/FEATURE_SPLIT.md) for suggested ownership.
