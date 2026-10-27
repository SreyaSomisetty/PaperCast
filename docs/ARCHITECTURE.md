# Architecture

PaperCast uses a layered, service-oriented architecture with an **agentic
orchestrator** at the center. Each layer talks only to the layer below it, and
each core capability is a separate service with a small, typed interface. That
lets us swap a PDF parser, an LLM, or a TTS voice without touching the rest of
the system.

```
┌──────────────────────────────────────────────────────────────┐
│ Presentation        Next.js / React web client                │
│                     upload · pick profile+mode · listen · ask  │
├──────────────────────────────────────────────────────────────┤
│ API & session       FastAPI (REST + WebSocket)                 │
│                     Redis (session state) · Celery (jobs)      │
├──────────────────────────────────────────────────────────────┤
│ Orchestration       Plan → Execute → Evaluate → Retry          │
│                     (LangGraph state machine)                  │
├──────────────────────────────────────────────────────────────┤
│ Core services       Document Understanding · Retrieval ·       │
│                     Script Generation · Integrity Verification │
│                     Adaptive Learning · Visual-to-Audio ·      │
│                     Speech                                      │
├──────────────────────────────────────────────────────────────┤
│ Data & evaluation   SQLite + FAISS → PostgreSQL + pgvector +   │
│                     S3 · per-run metrics (latency, cost)       │
└──────────────────────────────────────────────────────────────┘
```

## The Plan → Execute → Evaluate → Retry loop

Implemented in `backend/app/orchestration/pipeline.py`. In the scaffold it's
plain typed Python; the target is a LangGraph state machine with the same
contract.

1. **Plan** — build an episode outline from the document + profile + mode.
2. **Execute** — retrieve evidence per topic, then generate a cited two-host
   script.
3. **Evaluate** — verify every substantive claim against its evidence.
4. **Retry** — send failed claims back for revision, up to two times, then
   hedge or drop anything still unsupported.
5. **Render** — synthesize audio for the approved script only.

Each stage writes a typed artifact so a failed stage can be rerun on its own
(NFR-3, NFR-8).

## Typed contracts

All cross-stage data shapes live in `backend/app/core/schemas.py` (Pydantic) and
are mirrored for the UI in `frontend/lib/types.ts`. **Treat these as the API
between teammates.** Changing a shape means coordinating with whoever owns the
neighboring stage.

## Phase 1 acceptance path

Upload PDF → extract + index → retrieve evidence → generate evidence-linked
explanation → verify + revise claims → render approved audio → expose audio with
script and source evidence.

Interactive questions, advanced modes, figure/equation narration, and saved
sessions are **planned extensions** beyond Phase 1.

## Notes / known follow-ups

- The scaffold uses an in-memory store (`services/store.py`) and runs the
  pipeline synchronously in the request. Move long work to Celery and persist to
  SQLite/FAISS for real use.
- Frontend is pinned to Next.js 15.5.28 (patched). `npm audit` still flags two
  build-time `postcss` transitive advisories; the only `npm` "fix" is a breaking
  upgrade to Next 16. Deferred — revisit when the team is ready for Next 16.
