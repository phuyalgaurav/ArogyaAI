import base64
import io
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from arogya_api.core.settings import Settings
from arogya_api.images.models import ImageReadRequest
from arogya_api.images.vision import prepare_photo
from arogya_api.inference.worker import create_worker_app

DIGEST = "a" * 64
HEADERS = {"Authorization": "Bearer " + "w" * 64}


def photo():
    image = pytest.importorskip("PIL.Image")
    output = io.BytesIO()
    image.new("RGB", (2000, 1000), "white").save(output, "PNG")
    return base64.b64encode(output.getvalue()).decode()


@pytest.mark.parametrize(
    "change", [None, "pin", "vision", "model", "truncated", "large", "context"]
)
def test_visual_reader_validates_model_admission_and_preserves_literal_draft(change):
    calls = []

    def handle(request):
        calls.append(request)
        if request.url.path == "/api/tags":
            return httpx.Response(
                200,
                json={
                    "models": [
                        {"name": "qwen3.5:0.8b", "digest": "b" * 64 if change == "pin" else DIGEST}
                    ]
                },
            )
        if request.url.path == "/api/show":
            return httpx.Response(
                200, json={"capabilities": [] if change == "vision" else ["vision"]}
            )
        body = json.loads(request.content)
        assert body["messages"][1]["images"] and body["think"] is False
        assert body["options"]["temperature"] == 0
        assert "Never guess medicine names" in body["messages"][0]["content"]
        return httpx.Response(
            200,
            json={
                "model": "other" if change == "model" else "qwen3.5:0.8b",
                "done_reason": "length" if change == "truncated" else "stop",
                "prompt_eval_count": 8000 if change == "context" else 1000,
                "message": {
                    "content": json.dumps(
                        {
                            "lines": ["x" * 501]
                            if change == "large"
                            else ["Synthetic example: 2.5 mg", "[illegible]"]
                        }
                    )
                },
            },
        )

    settings = Settings(worker_token="w" * 64, qwen_digest=DIGEST)
    with TestClient(create_worker_app(settings, httpx.MockTransport(handle))) as client:
        payload = {"image_base64": photo(), "consent_id": "fixture"}
        path = "/internal/v1/images/prescription"
        assert client.post(path, json=payload).status_code == 401
        response = client.post(path, headers=HEADERS, json=payload)
        assert response.status_code == (503 if change else 200)
        if not change:
            assert response.json()["text"] == "Synthetic example: 2.5 mg\n[illegible]"
            assert (
                response.json()["status"] == "unverified" and response.json()["revision"] == DIGEST
            )
        if change in {"pin", "vision"}:
            assert all(request.url.path != "/api/chat" for request in calls)


def test_visual_decode_rotates_downsizes_and_rejects_non_images():
    image = pytest.importorskip("PIL.Image")
    payload = ImageReadRequest(image_base64=photo(), consent_id="fixture", rotation=90)
    output = prepare_photo(payload)
    with image.open(io.BytesIO(base64.b64decode(output))) as result:
        assert result.size == (768, 1536) and result.format == "JPEG"
    with pytest.raises(Exception):
        prepare_photo(
            ImageReadRequest(
                image_base64=base64.b64encode(b"PRIVATE invalid photo").decode(),
                consent_id="fixture",
            )
        )
