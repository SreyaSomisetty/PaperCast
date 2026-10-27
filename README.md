# PaperCast

**An Interactive, Evidence-Grounded Audio Learning Assistant**

PaperCast turns academic PDFs into conversational, evidence-grounded audio that
listeners can interrupt, question, and navigate. Every factual claim is traced
back to the source and verified before audio is rendered.

> CMPE 295A — Asha Vinodhini Vijayan, Gayathri Rukmadhavan, Manasa Sadhu, Sreya
> Somisetty. Advisor: Prof. Chandrasekar Vuppalapati.

---

## What this branch is

This is a **scaffold**. It gives the team a working skeleton — a basic UI and a
backend with every core service stubbed behind a typed interface — so we can
split up and each own a feature. Nothing is wired end-to-end yet; the stubs
return placeholder data and are marked with `TODO(owner)`.

## Repo layout

```
PaperCast/
├── backend/            FastAPI service (API + session + orchestration + core services)
│   ├── app/
│   │   ├── api/        REST + WebSocket routes
│   │   ├── core/       config, shared types/schemas
│   │   ├── orchestration/  Plan → Execute → Evaluate → Retry skeleton
│   │   └── services/   one stub module per core service (claim these!)
│   └── requirements.txt
├── frontend/           Next.js (React) web client — upload, pick mode, player
└── docs/               architecture notes + the feature split
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
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API docs at http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

UI at http://localhost:3000 (expects the backend on :8000).

## How the team splits work

Each core service in `backend/app/services/` is an independent stub with a typed
input/output contract. Pick one, replace the `TODO`, and keep the interface
stable so the rest of the system keeps working. See
[`docs/FEATURE_SPLIT.md`](docs/FEATURE_SPLIT.md) for suggested ownership.
