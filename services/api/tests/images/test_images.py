import asyncio
import base64
import hashlib
import io
import json
import os
import sys

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from arogya_api.core.settings import Settings
from arogya_api.images.models import ImageReadRequest, ImageReadResult
from arogya_api.images.ocr_process import recognize
from arogya_api.images.reader import ImageReader
from arogya_api.main import create_app


class StubReader:
    calls = 0
    callback = None

    async def read(self, payload):
        self.calls += 1
        if self.callback:
            self.callback()
        return ImageReadResult(
            text="BLUE TRIANGLE",
            language=payload.language,
            engine="test fixture",
            revision="a" * 64,
        )


@pytest.fixture
def images(tmp_path):
    reader = StubReader()
    app = create_app(Settings(database_path=tmp_path / "metadata.db"), images=reader)
    with TestClient(app) as client:
        token = client.post("/api/v1/session").json()["access_token"]
        headers = {"Authorization": "Bearer " + token}
        grant = client.post(
            "/api/v1/consents",
            headers=headers,
            json={
                "purpose": "image_transcription",
                "data_categories": ["image_bytes"],
            },
        ).json()["id"]
        payload = {"consent_id": grant, "image_base64": base64.b64encode(b"example image").decode()}
        yield app, client, headers, reader, payload


def test_image_consent_ownership_and_content_is_not_persisted(images):
    app, client, headers, reader, payload = images
    assert client.post("/api/v1/images/read", json=payload).status_code == 401
    foreign = {"Authorization": "Bearer " + client.post("/api/v1/session").json()["access_token"]}
    assert client.post("/api/v1/images/read", headers=foreign, json=payload).status_code == 403
    chat = client.post(
        "/api/v1/consents",
        headers=headers,
        json={
            "purpose": "server_chat",
            "data_categories": ["message_text"],
        },
    ).json()["id"]
    assert (
        client.post(
            "/api/v1/images/read", headers=headers, json={**payload, "consent_id": chat}
        ).status_code
        == 403
    )
    assert reader.calls == 0
    result = client.post("/api/v1/images/read", headers=headers, json=payload)
    assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
    assert result.json()["status"] == "unverified"
    with app.state.store.connect() as db:
        dump = "\n".join(db.iterdump())
        assert "BLUE TRIANGLE" not in dump and payload["image_base64"] not in dump
    client.delete("/api/v1/consents/" + payload["consent_id"], headers=headers)
    assert client.post("/api/v1/images/read", headers=headers, json=payload).status_code == 403


@pytest.mark.parametrize("change", ["revoke", "expire", "delete"])
def test_image_result_discarded_after_permission_changes(images, change):
    app, client, headers, reader, payload = images

    def mutate():
        with app.state.store.connect() as db:
            if change == "delete":
                db.execute("DELETE FROM sessions")
            else:
                db.execute(
                    "UPDATE consents SET " + ("revoked=1" if change == "revoke" else "expires=0")
                )

    reader.callback = mutate
    assert client.post("/api/v1/images/read", headers=headers, json=payload).status_code == 403


def test_image_admission_and_redacted_validation(images):
    _, client, headers, reader, payload = images
    for update in ({"rotation": 45}, {"language": "../../eng"}, {"image_base64": "PRIVATE"}):
        result = client.post("/api/v1/images/read", headers=headers, json={**payload, **update})
        assert result.status_code == 422 and "PRIVATE" not in result.text
    result = client.post("/api/v1/images/read", headers=headers, content=b"x" * 11200001)
    assert result.status_code == 413 and reader.calls == 0


def test_ocr_verifies_both_language_assets_and_binary(tmp_path, monkeypatch):
    monkeypatch.setattr("arogya_api.images.reader.importlib.util.find_spec", lambda _: True)
    binary = tmp_path / "tesseract"
    binary.write_bytes(b"binary fixture")
    manifest = {
        "binary": str(binary),
        "version": "tesseract 5.fixture",
        "binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
        "languages": {},
    }
    for code in ("eng", "nep"):
        data = code.encode()
        (tmp_path / f"{code}.traineddata").write_bytes(data)
        manifest["languages"][code] = hashlib.sha256(data).hexdigest()
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    reader = ImageReader(tmp_path)
    assert asyncio.run(reader.runtime()).state == "ready"
    (tmp_path / "nep.traineddata").write_bytes(b"changed")
    assert asyncio.run(reader.runtime()).state == "unavailable"
    with pytest.raises(ValueError):
        reader.verify()


@pytest.mark.parametrize("end", ["cancel", "timeout"])
def test_ocr_cancellation_kills_owned_process_and_releases_slot(monkeypatch, tmp_path, end):
    reader = ImageReader(tmp_path)
    monkeypatch.setattr(reader, "verify", lambda: ({"binary": "unused"}, "a" * 64))
    if end == "timeout":
        monkeypatch.setattr("arogya_api.images.reader.OCR_TIMEOUT_SECONDS", 0.15)
    original = asyncio.create_subprocess_exec
    children = []

    async def spawn(*args, **kwargs):
        child = await original(sys.executable, "-c", "import time; time.sleep(60)", **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)

    async def run():
        task = asyncio.create_task(
            reader.read(
                ImageReadRequest(
                    image_base64=base64.b64encode(b"image fixture").decode(), consent_id="fixture"
                )
            )
        )
        for _ in range(100):
            if children:
                break
            await asyncio.sleep(0.01)
        assert children and reader.busy
        with pytest.raises(HTTPException) as busy:
            await reader.read(
                ImageReadRequest(
                    image_base64=base64.b64encode(b"another fixture").decode(), consent_id="fixture"
                )
            )
        assert busy.value.detail == "image_reader_busy"
        if end == "cancel":
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            with pytest.raises(HTTPException) as expired:
                await task
            assert expired.value.status_code == 504
        assert not reader.busy and children[0].returncode is not None
        with pytest.raises(ProcessLookupError):
            os.kill(children[0].pid, 0)

    asyncio.run(run())


@pytest.mark.parametrize("kind", ["corrupt", "gif", "animated", "edge", "pixels"])
def test_decoder_rejects_invalid_formats_frames_and_geometry(monkeypatch, kind):
    image_module = pytest.importorskip("PIL.Image")
    if kind == "corrupt":
        data = b"PRIVATE-not-an-image"
    else:
        size = (12001, 1) if kind == "edge" else (4001, 4000) if kind == "pixels" else (10, 10)
        image = image_module.new("RGB", size, "white")
        output = io.BytesIO()
        if kind == "animated":
            image.save(
                output,
                format="PNG",
                save_all=True,
                append_images=[image_module.new("RGB", size, "black")],
            )
        else:
            image.save(output, format="GIF" if kind == "gif" else "PNG")
        data = output.getvalue()

    def forbidden(*args, **kwargs):
        pytest.fail("Native OCR must not run on rejected image input")

    monkeypatch.setattr("arogya_api.images.ocr_process.subprocess.run", forbidden)
    with pytest.raises(Exception):
        recognize(data, "unused", "unused", "eng", 0)


def test_python_website_serves_only_export_directory(tmp_path):
    web = tmp_path / "out"
    web.mkdir()
    (web / "index.html").write_text("<h1>Website fixture</h1>")
    (tmp_path / "secret.txt").write_text("PRIVATE")
    app = create_app(Settings(database_path=tmp_path / "db", web_dir=web))
    with TestClient(app) as client:
        assert "Website fixture" in client.get("/").text
        assert client.get("/api/v1/unknown").status_code == 404
        assert client.get("/%2e%2e/secret.txt").status_code == 404
        assert client.get("/healthz").json()["status"] == "ok"


def test_gateway_cancels_reader_when_browser_disconnects(images):
    app, _, headers, reader, payload = images

    async def run():
        started = asyncio.Event()
        cancelled = asyncio.Event()
        delivered = False

        async def slow_read(_):
            started.set()
            try:
                await asyncio.sleep(60)
            finally:
                cancelled.set()

        reader.read = slow_read

        async def receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": json.dumps(payload).encode()}
            if started.is_set():
                return {"type": "http.disconnect"}
            await asyncio.sleep(60)

        responses = []

        async def send(message):
            responses.append(message)

        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/v1/images/read",
            "query_string": b"",
            "root_path": "",
            "server": ("localhost", 8000),
            "client": ("localhost", 12345),
            "headers": [
                (b"content-type", b"application/json"),
                (b"authorization", headers["Authorization"].encode()),
            ],
        }
        await asyncio.wait_for(app(scope, receive, send), timeout=2)
        assert cancelled.is_set()
        assert next(m["status"] for m in responses if m["type"] == "http.response.start") == 499

    asyncio.run(run())


def test_prescription_route_checks_consent_and_discards_revoked_results(images, monkeypatch):
    from arogya_api.inference.client import InferenceClient

    app, client, headers, reader, payload = images

    async def recognize(self, value):
        return await reader.read(value)

    monkeypatch.setattr(InferenceClient, "read_prescription", recognize)
    assert client.post("/api/v1/images/prescription", json=payload).status_code == 401
    result = client.post("/api/v1/images/prescription", headers=headers, json=payload)
    assert result.status_code == 200 and result.json()["status"] == "unverified"

    def revoke():
        with app.state.store.connect() as db:
            db.execute("UPDATE consents SET revoked=1")

    reader.callback = revoke
    assert (
        client.post("/api/v1/images/prescription", headers=headers, json=payload).status_code == 403
    )
