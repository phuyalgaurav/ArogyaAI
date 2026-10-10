import hashlib
import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from arogya_api.core.settings import Settings
from arogya_api.inference.client import InferenceClient
from arogya_api.inference.worker import create_worker_app
from arogya_api.main import create_app
from arogya_api.runtime.routes import unavailable_runtime

DIGEST = "a" * 64
TOKEN = "w" * 64
HEADERS = {"Authorization": "Bearer " + TOKEN}


@pytest.mark.parametrize(
    "mode", ["cold", "loaded", "ps_failure", "malformed", "wrong_running", "wrong_pin"]
)
def test_worker_observes_installed_loaded_and_unknown_states(mode):
    def serve(request):
        if request.url.path == "/api/tags":
            return httpx.Response(
                200,
                json={
                    "models": [
                        {
                            "name": "qwen3.5:0.8b",
                            "digest": "b" * 64 if mode == "wrong_pin" else DIGEST,
                        }
                    ]
                },
            )
        if mode == "ps_failure":
            return httpx.Response(503)
        if mode == "malformed":
            return httpx.Response(200, json={"models": None})
        return httpx.Response(
            200,
            json={
                "models": []
                if mode == "cold"
                else [
                    {
                        "name": "qwen3.5:0.8b",
                        "digest": "b" * 64 if mode == "wrong_running" else DIGEST,
                        "size_vram": 500000,
                        "context_length": 4096,
                    }
                ]
            },
        )

    settings = Settings(worker_token=TOKEN, qwen_digest=DIGEST)
    with TestClient(create_worker_app(settings, httpx.MockTransport(serve))) as client:
        assert client.get("/internal/v1/runtime").status_code == 401
        result = client.get("/internal/v1/runtime", headers=HEADERS).json()
    engine = result["engines"][0]
    assert engine["state"] == ("unavailable" if mode in {"wrong_pin", "wrong_running"} else "ready")
    assert engine["loaded"] == (False if mode == "cold" else True if mode == "loaded" else None)
    assert engine["memory_bytes"] == (500000 if mode == "loaded" else None)
    assert "ollama_url" not in json.dumps(result) and TOKEN not in json.dumps(result)


@pytest.mark.parametrize("action", ["warm", "unload"])
def test_private_model_actions_use_fixed_pin_without_prompt_or_download(action):
    calls = []

    def serve(request):
        calls.append(request)
        if request.url.path == "/api/tags":
            return httpx.Response(
                200, json={"models": [{"name": "qwen3.5:0.8b", "digest": DIGEST}]}
            )
        if request.url.path == "/api/ps":
            return httpx.Response(200, json={"models": []})
        return httpx.Response(200, json={"model": "qwen3.5:0.8b", "done": True})

    with TestClient(
        create_worker_app(
            Settings(worker_token=TOKEN, qwen_digest=DIGEST), httpx.MockTransport(serve)
        )
    ) as client:
        path = "/internal/v1/models/qwen"
        assert (
            client.post(path, json={"action": action, "expected_revision": DIGEST}).status_code
            == 401
        )
        assert (
            client.post(
                path, headers=HEADERS, json={"action": action, "expected_revision": "b" * 64}
            ).status_code
            == 409
        )
        assert calls == []
        assert (
            client.post(
                path, headers=HEADERS, json={"action": action, "expected_revision": DIGEST}
            ).status_code
            == 200
        )
    body = json.loads(
        next(request.content for request in calls if request.url.path == "/api/generate")
    )
    assert body["prompt"] == "" and body["model"] == "qwen3.5:0.8b"
    assert body["keep_alive"] == ("5m" if action == "warm" else 0)
    assert not any(request.url.path == "/api/pull" for request in calls)


@pytest.mark.parametrize("tamper", ["revision", "name", "duplicate", "missing_time"])
def test_gateway_rejects_forged_runtime_identity(tmp_path, tamper):
    settings = Settings(
        database_path=tmp_path / "catalog.db",
        worker_url="http://private.test",
        worker_token=TOKEN,
        qwen_digest=DIGEST,
    )
    runtime = unavailable_runtime(settings).model_dump(mode="json")
    runtime["engines"][0]["state"] = "ready"
    if tamper == "revision":
        runtime["engines"][0]["revision"] = "b" * 64
    elif tamper == "name":
        runtime["engines"][0]["name"] = "unreviewed-model"
    elif tamper == "missing_time":
        del runtime["checked_at"]
    else:
        runtime["engines"][1] = runtime["engines"][0]
    provider = InferenceClient(
        settings, httpx.MockTransport(lambda request: httpx.Response(200, json=runtime))
    )
    with TestClient(create_app(settings, provider)) as client:
        result = client.get("/api/v1/runtime")
    assert result.status_code == 200
    assert result.headers["cache-control"] == "no-store"
    assert result.json()["engines"][0]["state"] == "unavailable"
    assert result.json()["reviewed_sources"] == 0


def test_operator_model_actions_require_admin_and_current_revision(tmp_path):
    registry = tmp_path / "registry.json"
    registry.write_text(
        json.dumps(
            [
                {
                    "id": who,
                    "roles": [role],
                    "token_sha256": hashlib.sha256(who.encode()).hexdigest(),
                    "expires_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
                }
                for who, role in [("admin", "administrator"), ("editor", "content_editor")]
            ]
        )
    )
    settings = Settings(
        database_path=tmp_path / "catalog.db",
        operator_registry_path=registry,
        worker_url="http://private.test",
        worker_token=TOKEN,
        qwen_digest=DIGEST,
    )
    calls = []

    def serve(request):
        calls.append(request)
        return httpx.Response(200, json=unavailable_runtime(settings).model_dump(mode="json"))

    with TestClient(
        create_app(settings, InferenceClient(settings, httpx.MockTransport(serve)))
    ) as client:
        path = "/api/v1/operator/models/qwen"
        payload = {"action": "warm", "expected_revision": DIGEST}
        assert client.post(path, json=payload).status_code == 401
        assert (
            client.post(path, json=payload, headers={"Authorization": "Bearer editor"}).status_code
            == 403
        )
        assert (
            client.post(
                path,
                json={**payload, "expected_revision": "b" * 64},
                headers={"Authorization": "Bearer admin"},
            ).status_code
            == 409
        )
        assert calls == []
        assert (
            client.post(path, json=payload, headers={"Authorization": "Bearer admin"}).status_code
            == 200
        )
    assert len(calls) == 1
