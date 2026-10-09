"""Live worker check with an isolated, non-medical fixture. Never import clinical data."""

import json
import os
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from arogya_api.core.settings import Settings
from arogya_api.knowledge.models import KnowledgeSource
from arogya_api.main import create_app
from dotenv import load_dotenv
from fastapi.testclient import TestClient


def main():
    root = Path(__file__).resolve().parents[2]
    load_dotenv(root / ".local/backend.env", override=True)
    start = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="arogya-live-check-") as directory:
        settings = Settings.from_environment().model_copy(
            update={
                "database_path": Path(directory) / "metadata.db",
                "allow_test_knowledge": True,
            }
        )
        assert settings.mode == "development"
        app = create_app(settings)
        store = app.state.store
        source = KnowledgeSource(
            source_id="synthetic-symbol",
            title="Non-medical synthetic reference",
            version="test-1",
            language="en",
            source_url="https://example.invalid/test-reference",
            license="test-only",
            review_status="test_fixture",
            valid_until=datetime.now(UTC) + timedelta(minutes=10),
            sections=[
                {
                    "id": "shape",
                    "questions": ["What is the blue triangle?"],
                    "sentences": ["The blue triangle is a fictional test symbol."],
                }
            ],
        )
        store.source_put(source)
        with TestClient(app) as client:
            caps = client.get("/api/v1/capabilities").json()
            assert all(
                f["available"]
                for f in caps["features"]
                if f["id"] in {"server_qwen", "laya"}
            )
            session = client.post("/api/v1/session").json()
            headers = {"Authorization": "Bearer " + session["access_token"]}
            request = {
                "request_id": "live_test",
                "language": "en",
                "message": "What is the blue triangle?",
            }
            assert (
                client.post("/api/v1/chat", headers=headers, json=request).status_code
                == 403
            )
            grant = client.post(
                "/api/v1/consents",
                headers=headers,
                json={"purpose": "server_chat", "data_categories": ["message_text"]},
            ).json()
            request["server_processing_consent_id"] = grant["id"]
            response = client.post("/api/v1/chat", headers=headers, json=request)
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["status"] == "answered", data
            assert data["answer"] == source.sections[0].sentences[0]
            assert data["provenance"]["router"] == "laya"
            assert data["provenance"]["model_revision"] == settings.qwen_digest
            assert data["evidence"][0]["source_id"] == source.source_id
            assert (
                request["request_id"].encode()
                not in settings.database_path.read_bytes()
            )
            unknown = {**request, "message": "Who invented the blue triangle?"}
            result = client.post("/api/v1/chat", headers=headers, json=unknown).json()
            assert result["status"] == "needs_clarification"
            assert (
                client.delete(
                    f"/api/v1/consents/{grant['id']}", headers=headers
                ).status_code
                == 204
            )
            assert (
                client.post("/api/v1/chat", headers=headers, json=request).status_code
                == 403
            )
            emergency = {**request, "message": "I cannot breathe"}
            urgent = client.post("/api/v1/chat", headers=headers, json=emergency).json()
            assert (
                urgent["status"] == "urgent" and urgent["provenance"]["model"] is None
            )
            assert client.delete("/api/v1/me/data", headers=headers).status_code == 204
            assert client.get("/api/v1/me/data", headers=headers).status_code == 401
        receipt = {
            "checked_at": datetime.now(UTC).isoformat(),
            "kind": "non-medical live inference test",
            "gateway": "actual ASGI gateway with isolated temporary SQLite",
            "worker": "live HTTP worker using actual Qwen and Laya checkpoints",
            "result": "passed",
            "elapsed_seconds": round(time.monotonic() - start, 2),
            "provenance": data["provenance"],
            "evidence": data["evidence"],
            "checks": [
                "no-consent blocked",
                "exact evidence answer",
                "pinned Qwen",
                "live Laya",
                "no stored chat request",
                "unreviewed question blocked",
                "revocation blocked",
                "static emergency",
                "session deletion",
            ],
            "clinical_validation": False,
        }
        destination = root / ".local/live-backend-check.json"
        destination.write_text(json.dumps(receipt, indent=2) + "\n")
        os.chmod(destination, 0o600)
        print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
