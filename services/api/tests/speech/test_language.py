import base64
import io
import json
import sqlite3
import threading
import time
import wave
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from fastapi.testclient import TestClient

from arogya_api.core.settings import Settings
from arogya_api.knowledge.store import Store
from arogya_api.main import create_app
from arogya_api.speech.client import LanguageClient
from arogya_api.speech.engine import PINS, LanguageEngine, decode_clip, translation_warnings
from arogya_api.speech.models import TranslationResult
from arogya_api.speech.worker import create_language_worker


def wav(frames=16000, rate=16000, channels=1, width=2):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(width)
        audio.setframerate(rate)
        audio.writeframes(b"\0" * frames * channels * width)
    return base64.b64encode(output.getvalue()).decode()


def translated(payload):
    return TranslationResult(
        text="नमस्कार",
        original_text=payload.text,
        source_language=payload.source_language,
        target_language=payload.target_language,
        status="draft",
        warnings=[],
        model=PINS["translation"]["repository"],
        revision=PINS["translation"]["revision"],
    )


class StubLanguage:
    def __init__(self):
        self.calls = []
        self.callback = None

    async def close(self):
        pass

    async def runtime(self):
        return []

    async def run(self, kind, payload, result_type):
        self.calls.append(kind)
        if self.callback:
            self.callback()
        return translated(payload)


@pytest.fixture
def gateway(tmp_path):
    worker = StubLanguage()
    app = create_app(Settings(database_path=tmp_path / "metadata.db"), language=worker)
    with TestClient(app) as client:
        headers = {
            "Authorization": "Bearer " + client.post("/api/v1/session").json()["access_token"]
        }

        def grant(purpose="translation", category="translation_text"):
            result = client.post(
                "/api/v1/consents",
                headers=headers,
                json={"purpose": purpose, "data_categories": [category]},
            )
            assert result.status_code == 200, result.text
            return result.json()["id"]

        yield client, app, headers, worker, grant


def test_translation_requires_scoped_owned_consent_and_never_persists_content(gateway):
    client, app, headers, worker, grant = gateway
    payload = {
        "text": "Hello",
        "source_language": "en",
        "target_language": "ne",
        "consent_id": "missing",
    }
    assert client.post("/api/v1/translation", json=payload).status_code == 401
    assert client.post("/api/v1/translation", headers=headers, json=payload).status_code == 403
    payload["consent_id"] = grant("server_chat", "message_text")
    assert client.post("/api/v1/translation", headers=headers, json=payload).status_code == 403
    payload["consent_id"] = grant()
    foreign = {"Authorization": "Bearer " + client.post("/api/v1/session").json()["access_token"]}
    assert client.post("/api/v1/translation", headers=foreign, json=payload).status_code == 403
    assert not worker.calls
    result = client.post("/api/v1/translation", headers=headers, json=payload)
    assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
    assert result.json()["original_text"] == "Hello"
    exported = client.get("/api/v1/me/data", headers=headers)
    assert exported.status_code == 200
    assert "Hello" not in exported.text and "नमस्कार" not in exported.text
    with app.state.store.connect() as db:
        dump = "\n".join(db.iterdump())
        assert "Hello" not in dump and "नमस्कार" not in dump
    assert (
        client.delete("/api/v1/consents/" + payload["consent_id"], headers=headers).status_code
        == 204
    )
    assert client.post("/api/v1/translation", headers=headers, json=payload).status_code == 403


@pytest.mark.parametrize("change", ["revoke", "expire", "delete_session"])
def test_consent_is_rechecked_after_inference(gateway, change):
    client, app, headers, worker, grant = gateway
    consent_id = grant()

    def mutate():
        with app.state.store.connect() as db:
            owner = db.execute("SELECT owner FROM consents WHERE id=?", (consent_id,)).fetchone()[0]
            if change == "delete_session":
                db.execute("DELETE FROM sessions WHERE id=?", (owner,))
            else:
                db.execute(
                    "UPDATE consents SET "
                    + ("revoked=1" if change == "revoke" else "expires=0")
                    + " WHERE id=?",
                    (consent_id,),
                )

    worker.callback = mutate
    result = client.post(
        "/api/v1/translation",
        headers=headers,
        json={
            "text": "Hello",
            "source_language": "en",
            "target_language": "ne",
            "consent_id": consent_id,
        },
    )
    assert result.status_code == 403 and "नमस्कार" not in result.text


@pytest.mark.parametrize(
    "purpose,category",
    [
        ("translation", "message_text"),
        ("speech_transcription", "translation_text"),
        ("speech_synthesis", "audio_clip"),
        ("server_chat", "speech_text"),
    ],
)
def test_purpose_categories_cannot_expand_consent(gateway, purpose, category):
    client, _, headers, _, _ = gateway
    result = client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": purpose, "data_categories": [category]},
    )
    assert result.status_code == 422


def test_legacy_consent_migration_keeps_chat_scope(tmp_path):
    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as db:
        db.executescript(
            "CREATE TABLE schema_version(version INTEGER); INSERT INTO schema_version VALUES(4);"
            "CREATE TABLE sessions(id TEXT PRIMARY KEY,expires REAL);"
            "CREATE TABLE consents(id TEXT PRIMARY KEY,owner TEXT,expires REAL,revoked INTEGER);"
        )
        db.execute("INSERT INTO sessions VALUES('owner',?)", (time.time() + 100,))
        db.execute("INSERT INTO consents VALUES('old','owner',?,0)", (time.time() + 100,))
    store = Store(path)
    assert store.consent_valid("old", "owner")
    for purpose in ["translation", "speech_transcription", "speech_synthesis"]:
        assert not store.consent_valid("old", "owner", purpose)
    with store.connect() as db:
        assert db.execute("SELECT version FROM schema_version").fetchone()[0] == 5


@pytest.mark.parametrize(
    "encoded",
    [
        "!" * 100,
        wav(frames=4799),
        wav(frames=320001),
        wav(rate=22050),
        wav(channels=2),
        wav(width=1),
        wav()[:-8],
    ],
)
def test_audio_admission_rejects_corrupt_or_unbounded_pcm(encoded):
    with pytest.raises(ValueError, match="invalid_audio_clip"):
        decode_clip(encoded)


def test_audio_admission_and_number_term_checks():
    pcm, duration = decode_clip(wav(frames=320000))
    assert len(pcm) == 640000 and duration == 20
    assert translation_warnings("12.5 mg TEST", "१२.५ mg TEST", ["TEST"]) == []
    assert translation_warnings("12.5 mg TEST", "१२ mg", ["TEST"]) == [
        "numbers_changed",
        "protected_terms_changed",
    ]


def test_invalid_audio_and_nepali_text_fail_before_worker(gateway):
    client, _, headers, worker, grant = gateway
    consent_id = grant("speech_transcription", "audio_clip")
    result = client.post(
        "/api/v1/speech/transcribe",
        headers=headers,
        json={"consent_id": consent_id, "audio_base64": "!" * 100},
    )
    assert result.status_code == 422
    consent_id = grant("speech_synthesis", "speech_text")
    for text in [" ", "English only"]:
        result = client.post(
            "/api/v1/speech/synthesize",
            headers=headers,
            json={"consent_id": consent_id, "text": text},
        )
        assert result.status_code == 422 and text not in result.text
    assert not worker.calls


def test_missing_and_tampered_model_files_are_unavailable(tmp_path):
    engine = LanguageEngine(tmp_path)
    assert all(item.state == "unavailable" for item in engine.runtime().engines)
    profile = tmp_path / "tts"
    profile.mkdir()
    for name in PINS["tts"]["files"]:
        (profile / name).write_bytes(b"corrupted")
    with pytest.raises(ValueError, match="pinned_language_model_unavailable"):
        engine.load("tts")


@pytest.mark.parametrize(
    "mutation",
    ["model", "revision", "original_text", "source_language", "target_language", "numbers"],
)
def test_gateway_validates_worker_identity_and_recomputes_warnings(tmp_path, mutation):
    from arogya_api.speech.models import TranslationRequest

    payload = TranslationRequest(
        text="TEST 12",
        source_language="en",
        target_language="ne",
        consent_id="scope",
        protected_terms=["TEST"],
    )
    observed = []

    def serve(request):
        observed.append(json.loads(request.content))
        output = translated(payload).model_dump()
        if mutation == "numbers":
            output["text"] = "TEST 13"
        else:
            output[mutation] = {"source_language": "tam", "target_language": "en"}.get(
                mutation, "wrong"
            )
        return httpx.Response(200, json=output)

    settings = Settings(
        database_path=tmp_path / "metadata.db",
        language_worker_url="http://127.0.0.1:8002",
        language_worker_token="w" * 64,
    )
    worker = LanguageClient(settings, httpx.MockTransport(serve))
    app = create_app(settings, language=worker)
    with TestClient(app) as client:
        headers = {
            "Authorization": "Bearer " + client.post("/api/v1/session").json()["access_token"]
        }
        grant = client.post(
            "/api/v1/consents",
            headers=headers,
            json={"purpose": "translation", "data_categories": ["translation_text"]},
        ).json()
        result = client.post(
            "/api/v1/translation",
            headers=headers,
            json={**payload.model_dump(), "consent_id": grant["id"]},
        )
        if mutation == "numbers":
            assert result.status_code == 200 and result.json()["status"] == "needs_review"
            assert result.json()["warnings"] == ["numbers_changed"]
        else:
            assert result.status_code == 503 and "नमस्कार" not in result.text
    assert "consent_id" not in observed[0]


def test_private_worker_authentication_and_busy_slot():
    started, release = threading.Event(), threading.Event()

    class HeldEngine:
        def runtime(self, busy=False):
            return LanguageEngine(None).runtime(busy)

        def run(self, kind, payload):
            started.set()
            assert release.wait(5)
            return translated(payload)

    settings = Settings(language_worker_token="w" * 64)
    with TestClient(create_language_worker(settings, HeldEngine())) as client:
        assert client.get("/internal/v1/language/runtime").status_code == 401
        headers = {"Authorization": "Bearer " + "w" * 64}
        payload = {"text": "Hello", "source_language": "en", "target_language": "ne"}
        with ThreadPoolExecutor() as pool:
            future = pool.submit(
                client.post, "/internal/v1/language/translation", headers=headers, json=payload
            )
            try:
                assert started.wait(2)
                result = client.post(
                    "/internal/v1/language/translation", headers=headers, json=payload
                )
                assert result.status_code == 503 and result.headers["retry-after"] == "3"
            finally:
                release.set()
            assert future.result(timeout=5).status_code == 200
        assert client.get("/internal/v1/language/runtime", headers=headers).status_code == 200


@pytest.mark.parametrize(
    "kind,mutation",
    [
        ("stt", "processor"),
        ("stt", "duration"),
        ("tts", "format"),
        ("tts", "duration"),
        ("tts", "speaker"),
    ],
)
def test_gateway_rejects_mismatched_voice_results(tmp_path, kind, mutation):
    import asyncio

    from fastapi import HTTPException

    from arogya_api.speech.models import (
        SpeechRequest,
        SpeechResult,
        TranscriptionRequest,
        TranscriptionResult,
    )

    if kind == "stt":
        payload = TranscriptionRequest(audio_base64=wav(), consent_id="scope")
        result = TranscriptionResult(
            text="नमस्कार",
            duration_seconds=1,
            model=PINS[kind]["repository"],
            revision=PINS[kind]["revision"],
            processor_model=PINS["stt_processor"]["repository"],
            processor_revision=PINS["stt_processor"]["revision"],
        )
        if mutation == "processor":
            result.processor_revision = "wrong"
        else:
            result.duration_seconds = 2
    else:
        payload = SpeechRequest(text="नमस्कार", consent_id="scope")
        result = SpeechResult(
            text=payload.text,
            speaker="kala",
            duration_seconds=1,
            audio_base64=wav(frames=22050, rate=22050),
            model=PINS[kind]["repository"],
            revision=PINS[kind]["revision"],
        )
        if mutation == "format":
            result.audio_base64 = wav()
        elif mutation == "duration":
            result.duration_seconds = 2
        else:
            result.speaker = "barsha"
    settings = Settings(language_worker_url="http://worker.invalid", language_worker_token="w" * 64)
    client = LanguageClient(
        settings, httpx.MockTransport(lambda request: httpx.Response(200, json=result.model_dump()))
    )

    async def check():
        try:
            with pytest.raises(HTTPException) as error:
                await client.run(kind, payload, type(result))
            assert error.value.status_code == 503
        finally:
            await client.close()

    asyncio.run(check())
