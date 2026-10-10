import hashlib
import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from arogya_api.core.settings import Settings
from arogya_api.inference.models import GenerationResult, IntentResult
from arogya_api.knowledge.models import KnowledgeSource
from arogya_api.main import create_app


class FakeInference:
    def __init__(self):
        self.calls = []
        self.ids = ["s1"]
        self.intent = "education"
        self.callback = None

    async def close(self):
        pass

    async def status(self):
        return {"qwen_ready": False, "laya_ready": False}

    async def classify(self, message, language):
        self.calls.append("classify")
        return IntentResult(intent=self.intent, provider="rules", model_revision=None)

    async def generate(self, request):
        self.calls.append("generate")
        if self.callback:
            self.callback()
        return GenerationResult(
            selection={"relevant": bool(self.ids), "sentence_ids": self.ids},
            model="unit-test-provider",
            digest="a" * 64,
        )


@pytest.fixture
def source():
    return KnowledgeSource(
        source_id="synthetic-symbol",
        title="Non-medical synthetic test reference",
        version="test-1",
        language="en",
        source_url="https://example.invalid/synthetic-symbol",
        license="test-only",
        review_status="test_fixture",
        valid_until=datetime.now(UTC) + timedelta(days=1),
        sections=[
            {
                "id": "shape",
                "questions": ["What is the blue triangle?"],
                "sentences": ["The blue triangle is a fictional test symbol."],
            }
        ],
    )


@pytest.fixture
def backend(tmp_path, source):
    settings = Settings(
        database_path=tmp_path / "metadata.sqlite3", allow_test_knowledge=True, signing_key="s" * 64
    )
    inference = FakeInference()
    app = create_app(settings, inference)
    app.state.store.source_put(source)
    with TestClient(app) as client:
        token = client.post("/api/v1/session").json()["access_token"]
        headers = {"Authorization": "Bearer " + token}
        grant = client.post(
            "/api/v1/consents",
            headers=headers,
            json={"purpose": "server_chat", "data_categories": ["message_text"]},
        ).json()
        payload = {
            "request_id": "test_request",
            "language": "en",
            "message": "What is the blue triangle?",
            "server_processing_consent_id": grant["id"],
        }
        yield client, app.state.store, inference, headers, grant, payload


@pytest.fixture
def governed(tmp_path, source):
    registry = tmp_path / "operators.json"
    roles = {
        "editor": ["content_editor"],
        "clinical": ["clinical_reviewer"],
        "license": ["license_reviewer"],
        "admin": ["administrator"],
        "self-reviewer": ["content_editor", "clinical_reviewer", "license_reviewer"],
    }
    tokens = {name: f"synthetic-test-operator-{name}" for name in roles}
    registry.write_text(
        json.dumps(
            [
                {
                    "id": name,
                    "roles": role,
                    "token_sha256": hashlib.sha256(tokens[name].encode()).hexdigest(),
                    "expires_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
                }
                for name, role in roles.items()
            ]
        )
    )
    settings = Settings(
        database_path=tmp_path / "catalog.db",
        signing_key="s" * 64,
        knowledge_audit_key="a" * 64,
        operator_registry_path=registry,
    )
    inference = FakeInference()
    app = create_app(settings, inference)
    source = source.model_dump(mode="json")
    source.update(review_status="pending", reviewed_by=None, reviewed_at=None)
    with TestClient(app) as client:

        def call(path, data=None, who="editor", method="post"):
            return (
                getattr(client, method)(
                    "/api/v1/operator" + path,
                    json=data,
                    headers={"Authorization": "Bearer " + tokens[who]},
                )
                if method == "post"
                else getattr(client, method)(
                    "/api/v1/operator" + path, headers={"Authorization": "Bearer " + tokens[who]}
                )
            )

        def activate(source_id="synthetic-symbol", version="test-1", redistribute=True):
            draft = {**source, "source_id": source_id, "version": version}
            result = call("/sources", draft)
            assert result.status_code == 201, result.text
            digest = result.json()["content_hash"]
            path = f"/sources/{source_id}/{version}"
            for kind in ("clinical", "license"):
                data = {
                    "kind": kind,
                    "decision": "approve",
                    "expected_hash": digest,
                    "reason": "Synthetic non-medical test review only.",
                }
                if kind == "license":
                    data.update(
                        license_evidence_url="https://example.invalid/test-license",
                        redistribution_allowed=redistribute,
                    )
                result = call(path + "/reviews", data, kind)
                assert result.status_code == 200, result.text
            result = call(
                path + "/activate",
                {"expected_hash": digest, "reason": "Activate non-medical test reference."},
                "admin",
            )
            assert result.status_code == 200, result.text
            return result.json()

        yield client, app, source, call, activate, settings, registry
