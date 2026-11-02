"""Upload builds the index, and retrieval errors reach clients with their code."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.core.config import Settings
from app.core.schemas import Document
from app.main import app
from app.services import document_understanding, retrieval


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    settings = Settings(storage_dir=tmp_path, data_dir=tmp_path)
    monkeypatch.setattr(routes, "get_settings", lambda: settings)
    return TestClient(app, raise_server_exceptions=False)


def _upload(
    client: TestClient, name: str = "paper.pdf", content: bytes = b"%PDF-1.4 test"
):
    return client.post(
        "/api/documents", files={"file": (name, content, "application/pdf")}
    )


def test_upload_builds_the_index(client: TestClient) -> None:
    response = _upload(client)

    assert response.status_code == 200
    info = retrieval.get_index_info(response.json()["document_id"])
    assert info is not None
    assert info.chunk_count == 1


def test_document_with_nothing_to_index_returns_422(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        document_understanding,
        "extract",
        lambda document_id, _path: Document(
            document_id=document_id, filename="paper.pdf"
        ),
    )

    response = _upload(client)

    assert response.status_code == 422
    assert response.json()["code"] == "EMPTY_DOCUMENT"


def test_episode_runs_after_upload(client: TestClient) -> None:
    document_id = _upload(client).json()["document_id"]

    response = client.post("/api/episodes", json={"document_id": document_id})

    assert response.status_code == 200
    assert response.json()["script"]["segments"]


@pytest.mark.parametrize(
    ("name", "content", "status", "code"),
    [
        ("notes.txt", b"%PDF-1.4 test", 400, "NOT_PDF"),
        ("notes.pdf", b"plain text", 400, "NOT_PDF"),
        ("empty.pdf", b"", 400, "EMPTY_FILE"),
    ],
)
def test_bad_uploads_are_rejected_and_not_stored(
    client: TestClient,
    tmp_path: Path,
    name: str,
    content: bytes,
    status: int,
    code: str,
) -> None:
    response = _upload(client, name, content)

    assert response.status_code == status
    assert response.json()["code"] == code
    assert response.json()["message"]
    assert list(tmp_path.glob("*.pdf")) == []


def test_oversize_upload_returns_413(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = Settings(storage_dir=tmp_path, data_dir=tmp_path, max_upload_mb=1)
    monkeypatch.setattr(routes, "get_settings", lambda: settings)

    response = _upload(client, content=b"%PDF-" + b"x" * (1024 * 1024))

    assert response.status_code == 413
    assert response.json()["code"] == "FILE_TOO_LARGE"
    assert "1 MB" in response.json()["message"]
    assert list(tmp_path.glob("*.pdf")) == []


def test_upload_exactly_at_the_limit_is_accepted(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = Settings(storage_dir=tmp_path, data_dir=tmp_path, max_upload_mb=1)
    monkeypatch.setattr(routes, "get_settings", lambda: settings)

    response = _upload(client, content=b"%PDF-" + b"x" * (1024 * 1024 - 5))

    assert response.status_code == 200


def test_error_messages_do_not_expose_internal_detail(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    document_id = _upload(client).json()["document_id"]

    invalid = client.post(
        "/api/questions", json={"document_id": document_id, "question": "ab"}
    )
    assert invalid.status_code == 422
    assert invalid.json() == {
        "code": "INVALID_QUERY",
        "message": "The search text must be at least 3 characters long.",
    }

    def fail(_document: Document) -> None:
        raise retrieval.RetrievalError(
            retrieval.RetrievalErrorCode.EMBEDDING_ERROR,
            "/Users/secret/model/path exploded",
        )

    monkeypatch.setattr(retrieval, "build_index", fail)
    failed = _upload(client)
    assert failed.status_code == 500
    assert "secret" not in failed.text
    assert failed.json()["code"] == "EMBEDDING_ERROR"


def test_long_listener_question_is_answered(client: TestClient) -> None:
    document_id = _upload(client).json()["document_id"]

    response = client.post(
        "/api/questions",
        json={"document_id": document_id, "question": "why " * 200},
    )

    assert response.status_code == 200
