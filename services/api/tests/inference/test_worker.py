import json
import threading

import httpx
import pytest
from fastapi.testclient import TestClient

from arogya_api.core.settings import Settings
from arogya_api.inference.worker import create_worker_app

DIGEST = "a" * 64
TOKEN = "w" * 64
HEADERS = {"Authorization": "Bearer " + TOKEN}
PAYLOAD = {
    "message": "What is the blue triangle?",
    "language": "en",
    "sentences": [
        {
            "id": "s1",
            "source_id": "synthetic-symbol",
            "section_id": "shape",
            "version": "test-1",
            "text": "The blue triangle is a fictional test symbol.",
        }
    ],
}


def worker_client(selection=None, tag_digest=DIGEST, returned_model="qwen3.5:0.8b"):
    calls = []

    def handle(request):
        calls.append(request)
        if request.url.path == "/api/tags":
            return httpx.Response(
                200, json={"models": [{"name": "qwen3.5:0.8b", "digest": tag_digest}]}
            )
        return httpx.Response(
            200,
            json={
                "model": returned_model,
                "message": {
                    "content": json.dumps(selection or {"relevant": True, "sentence_ids": ["s1"]})
                },
            },
        )

    settings = Settings(worker_token=TOKEN, qwen_digest=DIGEST)
    return TestClient(create_worker_app(settings, httpx.MockTransport(handle))), calls


def test_worker_uses_only_supplied_ids_and_pinned_model():
    client, calls = worker_client()
    with client:
        result = client.post("/internal/v1/generate", headers=HEADERS, json=PAYLOAD)
    assert result.status_code == 200
    assert result.json()["digest"] == DIGEST
    body = json.loads(next(r.content for r in calls if r.url.path == "/api/chat"))
    assert body["format"]["properties"]["sentence_ids"]["items"]["enum"] == ["s1"]
    assert body["stream"] is False and body["think"] is False
    assert body["options"]["num_ctx"] == 4096
    assert len(calls) == 3  # Identity is checked both before and after inference.


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}])
def test_worker_rejects_missing_or_wrong_service_token(headers):
    client, calls = worker_client()
    with client:
        assert (
            client.post("/internal/v1/generate", headers=headers, json=PAYLOAD).status_code == 401
        )
    assert calls == []


def test_pin_mismatch_prevents_generation():
    client, calls = worker_client(tag_digest="b" * 64)
    with client:
        assert client.get("/healthz", headers=HEADERS).json()["qwen_ready"] is False
        assert (
            client.post("/internal/v1/generate", headers=HEADERS, json=PAYLOAD).status_code == 503
        )
    assert all(r.url.path == "/api/tags" for r in calls)


@pytest.mark.parametrize("ids", [["invented"], ["s1", "s1"]])
def test_worker_rejects_invented_or_duplicate_selection(ids):
    client, _ = worker_client(selection={"relevant": True, "sentence_ids": ids})
    with client:
        assert (
            client.post("/internal/v1/generate", headers=HEADERS, json=PAYLOAD).status_code == 503
        )


def test_worker_rejects_unexpected_response_model():
    client, _ = worker_client(returned_model="another-model")
    with client:
        assert (
            client.post("/internal/v1/generate", headers=HEADERS, json=PAYLOAD).status_code == 503
        )


def test_worker_validation_does_not_echo_input():
    client, calls = worker_client()
    with client:
        request = {**PAYLOAD, "message": "SensitiveSentinel" * 200}
        result = client.post("/internal/v1/generate", headers=HEADERS, json=request)
        assert result.status_code == 422 and "SensitiveSentinel" not in result.text
        request["message"] *= 20
        assert (
            client.post("/internal/v1/generate", headers=HEADERS, json=request).status_code == 413
        )
    assert calls == []


def test_laya_classification_is_typed_and_runs_outside_event_loop():
    main_thread = threading.get_ident()

    class Classifier:
        def predict(self, message, questions, *, lang):
            assert threading.get_ident() != main_thread
            assert lang == "ne"
            return {"answers": {"intent": {"choice": "education"}}, "usage": {"truncated": False}}

    settings = Settings(worker_token=TOKEN, laya_revision="a" * 40)
    with TestClient(create_worker_app(settings, classifier=Classifier())) as client:
        result = client.post(
            "/internal/v1/classify",
            headers=HEADERS,
            json={"message": "सामान्य जानकारी", "language": "ne"},
        )
        assert result.json() == {
            "intent": "education",
            "provider": "laya",
            "model_revision": "a" * 40,
        }


def test_laya_truncated_result_is_unavailable():
    class Classifier:
        def predict(self, *args, **kwargs):
            return {"answers": {"intent": {"choice": "education"}}, "usage": {"truncated": True}}

    with TestClient(
        create_worker_app(Settings(worker_token=TOKEN), classifier=Classifier())
    ) as client:
        assert (
            client.post(
                "/internal/v1/classify",
                headers=HEADERS,
                json={"message": "question", "language": "en"},
            ).status_code
            == 503
        )
