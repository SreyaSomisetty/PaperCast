"""REST + WebSocket routes.

Thin HTTP layer over the orchestrator and services. Keeps no business logic of
its own. The WebSocket endpoint is a placeholder for the live listening session
(playback position + interruptions) described in the architecture.
"""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, WebSocket
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.schemas import (
    Episode,
    EpisodeRequest,
    QuestionAnswer,
    QuestionRequest,
    UploadResponse,
)
from app.orchestration import pipeline
from app.services import adaptive_learning, document_understanding, retrieval, store

router = APIRouter()


def _reject_upload(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code, content={"code": code, "message": message}
    )


@router.post("/documents", response_model=UploadResponse)
async def upload_document(file: UploadFile = File(...)) -> UploadResponse | JSONResponse:
    """Accept a PDF, persist it, and extract its content (FR-E1, FR-E2).

    The browser checks files too, but the API must not rely on that. A damaged
    PDF that still starts with %PDF- can only be caught by the parser.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        return _reject_upload(400, "NOT_PDF", "PaperCast accepts PDF files only.")

    settings = get_settings()
    limit = settings.max_upload_mb * 1024 * 1024
    content = await file.read(limit + 1)
    if not content:
        return _reject_upload(400, "EMPTY_FILE", "This file is empty.")
    if len(content) > limit:
        return _reject_upload(
            413,
            "FILE_TOO_LARGE",
            f"This file is too large. The limit is {settings.max_upload_mb} MB.",
        )
    if not content.startswith(b"%PDF-"):
        return _reject_upload(400, "NOT_PDF", "PaperCast accepts PDF files only.")

    document_id = uuid.uuid4().hex[:12]
    dest = Path(settings.storage_dir) / f"{document_id}.pdf"
    dest.write_bytes(content)

    document = document_understanding.extract(document_id, dest)
    retrieval.build_index(document)
    store.save_document(document)
    return UploadResponse(document_id=document_id, filename=file.filename)


@router.post("/episodes", response_model=Episode)
def create_episode(req: EpisodeRequest) -> Episode:
    """Run the full pipeline and return the episode (Phase 1 happy path).

    NOTE: runs synchronously in the scaffold. Move to a Celery background job
    and report progress over the WebSocket for real workloads.
    """
    document = store.get_document(req.document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Unknown document_id.")

    episode = pipeline.run_episode(document, req.profile, req.mode)
    store.save_episode(episode)
    return episode


@router.get("/episodes/{document_id}", response_model=Episode)
def get_episode(document_id: str) -> Episode:
    episode = store.get_episode(document_id)
    if episode is None:
        raise HTTPException(status_code=404, detail="No episode for this document.")
    return episode


@router.post("/questions", response_model=QuestionAnswer)
def ask_question(req: QuestionRequest) -> QuestionAnswer:
    """Answer a listener question with evidence (FR-D2 — desired)."""
    document = store.get_document(req.document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Unknown document_id.")
    return adaptive_learning.answer_question(document, req.question)


@router.websocket("/ws/session/{document_id}")
async def listening_session(websocket: WebSocket, document_id: str) -> None:
    """Live listening session: playback position + interruptions.

    TODO(owner, session layer): track playback position in Redis, stream
    answers to interruptions, and keep recent conversation context.
    """
    await websocket.accept()
    await websocket.send_json({"type": "connected", "document_id": document_id})
    try:
        while True:
            message = await websocket.receive_json()
            # Echo for now — real handler routes questions / seeks / mode changes.
            await websocket.send_json({"type": "echo", "payload": message})
    except Exception:
        # Client disconnected or sent a non-JSON frame; close quietly.
        return


@router.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})
