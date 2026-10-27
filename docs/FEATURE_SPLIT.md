# Feature split

Each core service is an independent stub with a typed input/output contract.
Claim one, replace its `TODO(owner)`, and keep the signature stable so the rest
of the pipeline keeps running. The smoke test
(`backend/tests/test_pipeline_smoke.py`) guards the contracts between stages.

## Suggested ownership

| Area | File(s) | Requirement | What "done" looks like |
|------|---------|-------------|------------------------|
| **Document Understanding** | `backend/app/services/document_understanding.py` | FR-E2 | Real PDF → chunks with accurate page/section/paragraph locations (PyMuPDF). |
| **Retrieval** | `backend/app/services/retrieval.py` | FR-E3 | Hybrid lexical + embedding search over an index built at ingest; ranked `EvidencePassage`s. |
| **Planning** | `backend/app/services/planning.py` | FR-E4 | Structured-output LLM produces an audience-aware outline validated against `EpisodePlan`. |
| **Script Generation** | `backend/app/services/script_generation.py` | FR-E5 | Two-host dialogue where every factual sentence cites evidence ids. |
| **Integrity Verification** | `backend/app/services/verification.py` | FR-E6/E7 | Claim extraction + NLI/LLM-judge entailment; hedge/drop with a retry budget. |
| **Speech / Audio** | `backend/app/services/speech.py` | FR-E8 | TTS per segment + FFmpeg concat; Whisper for spoken questions. |
| **Orchestration** | `backend/app/orchestration/pipeline.py` | — | Port the loop to LangGraph; add artifact persistence + eval logging. |
| **API & session** | `backend/app/api/routes.py` | — | Background jobs via Celery; real WebSocket session (Redis). |
| **Data layer** | `backend/app/services/store.py` | — | SQLite + FAISS, then Postgres + pgvector + S3, behind the same interface. |
| **Adaptive Learning** | `backend/app/services/adaptive_learning.py` | FR-D2/D3 | Grounded Q&A + listener knowledge model (post Phase 1). |
| **Visual-to-Audio** | `backend/app/services/visual_to_audio.py` | FR-D5 | Spoken descriptions of figures/tables/equations (post Phase 1). |
| **Frontend** | `frontend/app/*`, `frontend/lib/*` | NFR-2/7 | Player, live Q&A UI, evidence drill-down, topic navigation. |

## Working agreement

1. One service per person/pair; open a branch off this one per feature
   (e.g. `feat/retrieval`).
2. Don't change shapes in `schemas.py` / `types.ts` without a heads-up — they're
   the shared contract.
3. Keep the smoke test green. Add real unit tests for your own stage as you go.
4. Uncomment your stage's dependencies in `backend/requirements.txt` when you
   need them.
5. Secrets go in `.env` (never committed). See `.env.example`.
