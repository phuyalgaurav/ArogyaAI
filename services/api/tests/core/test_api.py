import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from arogya_api.core.contracts import ArogyaResponse
from arogya_api.core.settings import Settings
from arogya_api.main import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(database_path=tmp_path / "api.sqlite3"))) as client:
        yield client


def test_health_and_disabled_capabilities(client):
    assert client.get("/healthz").json()["status"] == "ok"
    data = client.get("/api/v1/capabilities").json()
    assert data["stage"] == "backend"
    assert {feature["id"] for feature in data["features"]} == {
        "browser_qwen",
        "server_qwen",
        "ocr",
        "laya",
        "tmt",
        "offline_library",
        "sync",
    }
    assert all(not feature["available"] and feature["reason"] for feature in data["features"])


def test_chat_requires_session_and_ocr_is_not_exposed(client):
    assert client.post("/api/v1/chat", json={"message": "synthetic"}).status_code == 401
    assert client.post("/api/v1/documents/ocr").status_code == 404


def test_answer_requires_evidence():
    with pytest.raises(ValidationError, match="requires evidence"):
        ArogyaResponse(
            request_id="synthetic-test",
            status="answered",
            language="en",
            answer="Test only",
            evidence=[],
            safety={"rule_ids": [], "abstained": False},
            provenance={"mode": "static", "model": None, "knowledge_version": "none"},
        )


def test_cors_allows_only_local_web(client):
    assert (
        client.get("/api/v1/capabilities", headers={"Origin": "http://127.0.0.1:3000"}).headers[
            "access-control-allow-origin"
        ]
        == "http://127.0.0.1:3000"
    )
    assert (
        "access-control-allow-origin"
        not in client.get("/api/v1/capabilities", headers={"Origin": "https://example.com"}).headers
    )
