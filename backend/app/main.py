"""PaperCast FastAPI application entrypoint.

Run locally:
    uvicorn app.main:app --reload
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.core.config import get_settings
from app.schemas.retrieval import RetrievalError, RetrievalErrorCode

settings = get_settings()

# Fixed messages, because `RetrievalError.detail` can hold validation output,
# model errors, and file paths. Those stay in the logs.
_RETRIEVAL_ERROR_RESPONSE = {
    RetrievalErrorCode.INVALID_QUERY: (
        422,
        "The search text must be at least 3 characters long.",
    ),
    RetrievalErrorCode.DOCUMENT_NOT_FOUND: (404, "We could not find this document."),
    RetrievalErrorCode.EMPTY_DOCUMENT: (
        422,
        "This PDF has no selectable text. Scanned papers are not supported yet.",
    ),
    RetrievalErrorCode.EMBEDDING_ERROR: (500, "We could not index this paper."),
    RetrievalErrorCode.INDEX_CORRUPT: (500, "We could not search this paper's text."),
}

app = FastAPI(
    title=settings.app_name,
    description="Interactive, evidence-grounded audio learning assistant.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.exception_handler(RetrievalError)
def handle_retrieval_error(_request: Request, error: RetrievalError) -> JSONResponse:
    status_code, message = _RETRIEVAL_ERROR_RESPONSE[error.code]
    return JSONResponse(
        status_code=status_code,
        content={"code": error.code.value, "message": message},
    )


@app.get("/")
def root() -> dict[str, str]:
    return {"app": settings.app_name, "docs": "/docs"}
