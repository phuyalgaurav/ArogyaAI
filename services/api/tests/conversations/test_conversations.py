"""Integration checks for owned context, resumption, revisions and cancellation."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from arogya_api.conversations.service import speech_chunks
from arogya_api.core.settings import Settings
from arogya_api.documents.models import DocumentSelectionResult
from arogya_api.images.models import ImageReadResult
from arogya_api.inference.models import GenerationResult, IntentResult
from arogya_api.knowledge.models import KnowledgeSource, MedicineRecord
from arogya_api.main import create_app


class Provider:
    def __init__(self):
        self.requests = []
        self.callback = None
        self.photo_callback = None
        self.cancelled = False
        self.slow = False

    async def close(self):
        pass

    async def select_document(self, request):
        self.requests.append(request)
        if self.slow:
            try:
                await asyncio.sleep(60)
            finally:
                self.cancelled = True
        if self.callback:
            self.callback()
        return DocumentSelectionResult(
            selection={"highlights": [], "answer_line_ids": ["L2"]},
            model="fixture",
            revision="a" * 64,
        )

    async def read_prescription(self, request):
        self.requests.append(request)
        if self.photo_callback:
            self.photo_callback()
        if self.slow:
            try:
                await asyncio.sleep(60)
            finally:
                self.cancelled = True
        return ImageReadResult(
            text="Examplemed 2.5 mg\n[illegible]",
            language=request.language,
            engine="fixture vision",
            revision="a" * 64,
        )

    async def generate(self, request):
        self.requests.append(request)
        return GenerationResult(
            selection={"relevant": True, "sentence_ids": [request.sentences[0].id]},
            model="fixture",
            digest="a" * 64,
        )

    async def classify(self, message, language):
        return IntentResult(intent="education", provider="rules", model_revision=None)


@pytest.fixture
def setup(tmp_path):
    provider = Provider()
    settings = Settings(
        database_path=tmp_path / "metadata.db", signing_key="s" * 64, allow_test_knowledge=True
    )
    app = create_app(settings, inference=provider)
    with TestClient(app) as client:
        token = client.post("/api/v1/session").json()["access_token"]
        headers = {"Authorization": "Bearer " + token}
        grants = {}
        for purpose, category in [
            ("document_explanation", "document_text"),
            ("image_transcription", "image_bytes"),
            ("server_chat", "message_text"),
        ]:
            grants[purpose] = client.post(
                "/api/v1/consents",
                headers=headers,
                json={"purpose": purpose, "data_categories": [category]},
            ).json()["id"]
        yield app, client, headers, grants, provider, settings


def create(client, headers, mode="document", **values):
    result = client.post("/api/v1/conversations", headers=headers, json={"mode": mode, **values})
    assert result.status_code == 201, result.text
    return result.json()


def add_text(
    client,
    headers,
    grants,
    conversation,
    text="Hb: 12.5 g/dL\nFollow-up Friday",
    kind="report",
    rid="photo",
):
    result = client.post(
        f"/api/v1/conversations/{conversation['id']}/attachments/text",
        headers=headers,
        json={
            "request_id": rid,
            "expected_context_revision": conversation["context_revision"],
            "kind": kind,
            "text": text,
            "consent_id": grants["document_explanation"],
        },
    )
    assert result.status_code == 200, result.text
    return result.json()


def review(client, headers, grants, conversation, text=None, **values):
    attachment = conversation["attachments"][-1]
    result = client.put(
        f"/api/v1/conversations/{conversation['id']}/attachments/{attachment['id']}/review",
        headers=headers,
        json={
            "expected_context_revision": conversation["context_revision"],
            "text": text or attachment["original_text"],
            "text_checked": True,
            "consent_id": grants["document_explanation"],
            **values,
        },
    )
    assert result.status_code == 200, result.text
    return result.json()


def turn(
    client, headers, grants, conversation, message="When is follow-up?", rid="turn1", **values
):
    purpose = "document_explanation" if conversation["mode"] == "document" else "server_chat"
    return client.post(
        f"/api/v1/conversations/{conversation['id']}/turns",
        headers=headers,
        json={
            "request_id": rid,
            "expected_context_revision": conversation["context_revision"],
            "message": message,
            "consent_id": grants[purpose],
            **values,
        },
    )


def test_document_followups_review_correction_and_idempotency(setup):
    app, client, headers, grants, provider, _ = setup
    c = add_text(client, headers, grants, create(client, headers))
    assert turn(client, headers, grants, c).status_code == 422
    c = review(client, headers, grants, c)
    first = turn(client, headers, grants, c)
    assert first.status_code == 200 and first.headers["cache-control"] == "no-store"
    assert first.json()["references"][0]["quote"] == "Follow-up Friday"
    assert turn(client, headers, grants, c).json() == first.json()
    assert len(provider.requests) == 1
    assert turn(client, headers, grants, c, message="Changed message").status_code == 409
    second = turn(client, headers, grants, c, "Explain that line", "turn2")
    assert second.json()["references"][0]["line_id"] == "L2"
    assert provider.requests[-1].previous_turns[0].question == "When is follow-up?"
    third = turn(client, headers, grants, c, "Which line mentions follow-up?", "turn3")
    assert third.status_code == 200
    old_revision = c["context_revision"]
    c = review(client, headers, grants, c, text="Hb: 12.5 g/dL\nFollow-up Monday")
    assert c["attachments"][0]["original_text"].endswith("Friday")
    assert (
        turn(
            client, headers, grants, c, rid="stale", expected_context_revision=old_revision
        ).status_code
        == 409
    )
    fourth = turn(client, headers, grants, c, rid="turn4")
    assert fourth.json()["references"][0]["quote"] == "Follow-up Monday"
    assert provider.requests[-1].previous_turns == []
    detail = client.get(f"/api/v1/conversations/{c['id']}", headers=headers).json()
    assert len(detail["turns"]) == 4
    with app.state.history.connect() as db:
        assert db.execute("SELECT count(*) FROM context_conversations").fetchone()[0] == 0


def test_two_attachments_explicit_focus_and_foreign_access(setup):
    _, client, headers, grants, _, _ = setup
    c = review(client, headers, grants, add_text(client, headers, grants, create(client, headers)))
    first_id = c["active_attachment_id"]
    c = review(
        client,
        headers,
        grants,
        add_text(client, headers, grants, c, text="Hb: 13 g/dL\nFollow-up Monday", rid="second"),
    )
    response = turn(client, headers, grants, c, attachment_id=first_id)
    assert response.json()["references"][0]["quote"] == "Follow-up Friday"
    foreign = {"Authorization": "Bearer " + client.post("/api/v1/session").json()["access_token"]}
    assert client.get(f"/api/v1/conversations/{c['id']}", headers=foreign).status_code == 404
    assert client.delete(f"/api/v1/conversations/{c['id']}", headers=foreign).status_code == 404
    assert client.get(f"/api/v1/conversations/{c['id']}").status_code == 401


def test_durable_history_opt_in_resume_after_new_session_and_restart(setup):
    _, client, headers, grants, provider, settings = setup
    vault = client.post(
        "/api/v1/history/vault",
        headers=headers,
        json={"allow_server_storage": True, "client_access_token": "history_" + "b" * 64},
    ).json()
    durable = {**headers, "X-History-Token": vault["access_token"]}
    assert (
        client.post(
            "/api/v1/conversations",
            headers=durable,
            json={"mode": "document", "storage": "server_history"},
        ).status_code
        == 422
    )
    c = create(client, durable, storage="server_history", allow_context_storage=True)
    c = review(client, durable, grants, add_text(client, durable, grants, c))
    assert turn(client, durable, grants, c).status_code == 200
    restarted = create_app(settings, inference=provider)
    with TestClient(restarted) as next_client:
        new_token = next_client.post("/api/v1/session").json()["access_token"]
        new_headers = {
            "Authorization": "Bearer " + new_token,
            "X-History-Token": vault["access_token"],
        }
        resumed = next_client.get(f"/api/v1/conversations/{c['id']}", headers=new_headers)
        assert resumed.status_code == 200 and len(resumed.json()["turns"]) == 1
        consent = next_client.post(
            "/api/v1/consents",
            headers=new_headers,
            json={"purpose": "document_explanation", "data_categories": ["document_text"]},
        ).json()["id"]
        assert (
            turn(
                next_client,
                new_headers,
                {"document_explanation": consent},
                resumed.json(),
                "Explain that line",
                "resume",
            ).status_code
            == 200
        )
        assert (
            next_client.delete(f"/api/v1/conversations/{c['id']}", headers=new_headers).status_code
            == 204
        )
        assert (
            next_client.get(f"/api/v1/conversations/{c['id']}", headers=new_headers).status_code
            == 404
        )


@pytest.mark.parametrize(
    "change", ["revoke", "session_delete", "conversation_delete", "vault_delete"]
)
def test_no_result_persisted_after_inflight_revocation_or_deletion(setup, change):
    app, client, headers, grants, provider, _ = setup
    if change == "vault_delete":
        token = "history_" + "c" * 64
        client.post(
            "/api/v1/history/vault",
            headers=headers,
            json={"allow_server_storage": True, "client_access_token": token},
        )
        headers = {**headers, "X-History-Token": token}
        c = create(client, headers, storage="server_history", allow_context_storage=True)
    else:
        c = create(client, headers)
    c = review(client, headers, grants, add_text(client, headers, grants, c))
    owner = (
        next(iter(app.state.contexts.memory))[0]
        if change != "vault_delete"
        else "h:" + app.state.history.owner(token)
    )

    def mutate():
        if change == "conversation_delete":
            app.state.contexts.delete(owner, c["id"])
        elif change == "vault_delete":
            app.state.history.revoke(owner[2:])
        else:
            with app.state.store.connect() as db:
                db.execute(
                    "UPDATE consents SET revoked=1"
                    if change == "revoke"
                    else "DELETE FROM sessions"
                )

    provider.callback = mutate
    result = turn(client, headers, grants, c)
    assert result.status_code in (401, 403, 404), result.text
    if change == "revoke":
        assert client.get(f"/api/v1/conversations/{c['id']}", headers=headers).json()["turns"] == []


def test_recognition_job_kind_provenance_idempotency_and_no_raw_image_storage(setup):
    app, client, headers, grants, provider, _ = setup
    c = create(client, headers, mode="medicine")
    data = {
        "request_id": "recognize",
        "expected_context_revision": 0,
        "kind": "medicine",
        "image": {
            "image_base64": "U1lOVEhFVElDX1RFTVBP",
            "consent_id": grants["image_transcription"],
        },
    }
    path = f"/api/v1/conversations/{c['id']}/recognitions"
    result = client.post(path, headers=headers, json=data)
    assert result.status_code == 202
    job = result.json()
    for _ in range(20):
        job = client.get(path + "/" + job["id"], headers=headers).json()
        if job["status"] != "processing":
            break
    assert job["status"] == "completed", job
    assert client.post(path, headers=headers, json=data).json()["id"] == job["id"]
    assert provider.requests[0].kind == "medicine"
    c = client.get(f"/api/v1/conversations/{c['id']}", headers=headers).json()
    item = c["attachments"][0]
    assert item["recognition"]["method"] == "vision"
    assert "illegible_regions" in item["recognition"]["warnings"]
    assert item["original_available"] is False and item["observed_strengths"] == ["2.5 mg"]
    assert "U1lOVEhFVElDX1RFTVBP" not in str(app.state.contexts.memory)


def test_recognition_revocation_withholds_attachment(setup):
    app, client, headers, grants, provider, _ = setup
    c = create(client, headers)

    def revoke():
        with app.state.store.connect() as db:
            db.execute("UPDATE consents SET revoked=1")

    provider.photo_callback = revoke
    path = f"/api/v1/conversations/{c['id']}/recognitions"
    job = client.post(
        path,
        headers=headers,
        json={
            "request_id": "photo",
            "expected_context_revision": 0,
            "image": {
                "image_base64": "U1lOVEhFVElDX1RFTVBP",
                "consent_id": grants["image_transcription"],
            },
        },
    ).json()
    for _ in range(20):
        job = client.get(path + "/" + job["id"], headers=headers).json()
        if job["status"] != "processing":
            break
    assert job["status"] == "failed" and job["error_code"] == "processing_permission_required"
    assert (
        client.get(f"/api/v1/conversations/{c['id']}", headers=headers).json()["attachments"] == []
    )


def test_session_expiry_clears_memory_and_history_search(setup):
    app, client, headers, grants, _, _ = setup
    c = review(client, headers, grants, add_text(client, headers, grants, create(client, headers)))
    assert turn(client, headers, grants, c).status_code == 200
    result = client.get(
        "/api/v1/conversations?query=follow-up&mode=document&limit=1", headers=headers
    ).json()
    assert result["total"] == 1 and result["conversations"][0]["id"] == c["id"]
    client.delete("/api/v1/me/data", headers=headers)
    assert app.state.contexts.memory == {}


def test_medicine_review_is_required_and_cannot_select_unrelated_identity(setup):
    app, client, headers, grants, _, _ = setup
    source = KnowledgeSource(
        source_id="synthetic-medicine",
        title="Fictional test medicine",
        version="test",
        language="en",
        source_url="https://example.invalid/test",
        license="test-only",
        review_status="test_fixture",
        valid_until=datetime.now(UTC) + timedelta(days=1),
        sections=[
            {
                "id": "info",
                "task": "medicine_info",
                "questions": ["What is Examplemed?"],
                "sentences": ["Examplemed is a fictional test label."],
            }
        ],
    )
    app.state.store.source_put(source)
    for name in ["Examplemed", "Unrelated"]:
        app.state.store.medicine_put(
            MedicineRecord(
                id=name,
                canonical_name=name,
                active_ingredients=["fictional ingredient"],
                aliases=[],
                jurisdiction="test",
                source_ids=["synthetic-medicine"],
            )
        )
    c = add_text(
        client,
        headers,
        grants,
        create(client, headers, mode="medicine"),
        text="Examplemed 2.5 mg",
        kind="medicine",
    )
    assert c["attachments"][0]["medicine_candidates"][0]["id"] == "Examplemed"
    assert turn(client, headers, grants, c).status_code == 422
    path = f"/api/v1/conversations/{c['id']}/attachments/{c['attachments'][0]['id']}/review"
    bad = client.put(
        path,
        headers=headers,
        json={
            "expected_context_revision": c["context_revision"],
            "text": "Examplemed 2.5 mg",
            "text_checked": True,
            "medicine_id": "Unrelated",
            "consent_id": grants["document_explanation"],
        },
    )
    assert bad.status_code == 422
    c = review(client, headers, grants, c, medicine_id="Examplemed")
    result = turn(client, headers, grants, c, "What is Examplemed?")
    assert result.status_code == 200 and result.json()["health"]["status"] == "answered"
    c = review(client, headers, grants, c, text="Unrelated 5 mg")
    assert c["attachments"][0]["selected_medicine"] is None


def test_wrong_permission_and_unknown_line_and_medical_decision(setup):
    _, client, headers, grants, provider, _ = setup
    c = review(client, headers, grants, add_text(client, headers, grants, create(client, headers)))
    assert turn(client, headers, grants, c, consent_id=grants["server_chat"]).status_code == 403
    assert turn(client, headers, grants, c, line_ids=["L99"]).status_code == 422
    before = len(provider.requests)
    result = turn(client, headers, grants, c, "Should I change my dose?", rid="personal")
    assert result.json()["status"] == "professional_review"
    assert len(provider.requests) == before


def test_cancel_recognition_releases_conversation(setup):
    _, client, headers, grants, provider, _ = setup
    provider.slow = True
    c = create(client, headers)
    path = f"/api/v1/conversations/{c['id']}"
    job = client.post(
        path + "/recognitions",
        headers=headers,
        json={
            "request_id": "photo",
            "expected_context_revision": 0,
            "image": {
                "image_base64": "U1lOVEhFVElDX1RFTVBP",
                "consent_id": grants["image_transcription"],
            },
        },
    ).json()
    assert client.post(path + "/cancel", headers=headers).status_code == 204
    assert (
        client.get(path + "/recognitions/" + job["id"], headers=headers).json()["status"]
        == "cancelled"
    )
    assert client.get(path, headers=headers).json()["attachments"] == []
    add_text(client, headers, grants, c)


def test_speech_chunking_does_not_drop_or_change_text():
    text = ("यो परीक्षणका लागि मात्र हो। १२.५ mg लेखिएको छ।\n" * 30) + "अन्त्य।"
    chunks = speech_chunks(text)
    assert "".join(chunks) == text and all(0 < len(chunk) <= 300 for chunk in chunks)


def test_contextual_question_resolution_preserves_user_question_and_rechecks_evidence(setup):
    from arogya_api.documents.models import ReviewedQuestionSelectionResult

    app, client, headers, grants, provider, _ = setup
    source = KnowledgeSource(
        source_id="synthetic-context",
        title="Synthetic symbol reference",
        version="test",
        language="en",
        source_url="https://example.invalid/context",
        license="test-only",
        review_status="test_fixture",
        valid_until=datetime.now(UTC) + timedelta(days=1),
        sections=[
            {
                "id": "symbol",
                "questions": ["What is the blue triangle?"],
                "sentences": ["The blue triangle is a fictional symbol."],
            }
        ],
    )
    app.state.store.source_put(source)
    selection_requests = []

    async def select(request):
        selection_requests.append(request)
        return ReviewedQuestionSelectionResult(
            selection={"question_id": "Q1"}, model="fixture", revision="a" * 64
        )

    provider.select_reviewed_question = select
    c = create(client, headers, mode="health")
    assert (
        turn(client, headers, grants, c, "What is the blue triangle?").json()["status"]
        == "answered"
    )
    response = turn(client, headers, grants, c, "Tell me more about that symbol", "followup")
    assert response.json()["message"] == "Tell me more about that symbol"
    assert response.json()["resolved_question"] == "What is the blue triangle?"
    assert response.json()["health"]["evidence"][0]["source_id"] == "synthetic-context"
    assert selection_requests[-1].previous_questions == ["What is the blue triangle?"]
    before = len(selection_requests)
    result = turn(client, headers, grants, c, "Should I change my dose?", "decision")
    assert result.json()["status"] == "needs_professional_review"
    assert len(selection_requests) == before


def test_turn_cancellation_discards_result_and_releases_worker(setup):
    from fastapi import HTTPException

    from arogya_api.conversations.models import ConversationTurnRequest

    app, client, headers, grants, provider, _ = setup
    c = review(client, headers, grants, add_text(client, headers, grants, create(client, headers)))
    owner = next(iter(app.state.contexts.memory))[0]
    provider.slow = True

    async def run():
        payload = ConversationTurnRequest(
            request_id="cancelled",
            message="When is follow-up?",
            expected_context_revision=c["context_revision"],
            consent_id=grants["document_explanation"],
        )
        task = asyncio.create_task(app.state.conversations.turn(owner, owner[2:], c["id"], payload))
        await asyncio.sleep(0)
        assert (owner, c["id"]) in app.state.conversations.pending
        await app.state.conversations.cancel(owner, c["id"])
        with pytest.raises(HTTPException) as error:
            await task
        assert error.value.detail["code"] == "turn_cancelled"

    asyncio.run(run())
    assert provider.cancelled
    assert app.state.contexts.load(owner, c["id"]).turns == []
    assert app.state.conversations.pending == {}


def test_voice_is_bound_to_context_separate_permissions_and_exact_turn_text(tmp_path):
    from arogya_api.speech.models import SpeechResult, TranscriptionResult

    class Language:
        calls = []
        callback = None

        async def close(self):
            pass

        async def run(self, kind, payload, result):
            self.calls.append((kind, payload))
            if self.callback:
                self.callback()
            if kind == "stt":
                return TranscriptionResult(
                    text="पुनः भेट कहिले हो?",
                    duration_seconds=1,
                    model="fixture",
                    revision="a" * 40,
                    processor_model="fixture",
                    processor_revision="b" * 40,
                )
            return SpeechResult(
                text=payload.text,
                speaker=payload.speaker,
                audio_base64="a" * 44,
                duration_seconds=1,
                model="fixture",
                revision="a" * 40,
            )

    language = Language()
    provider = Provider()
    app = create_app(
        Settings(database_path=tmp_path / "voice.db"), inference=provider, language=language
    )
    with TestClient(app) as client:
        headers = {
            "Authorization": "Bearer " + client.post("/api/v1/session").json()["access_token"]
        }
        grants = {}
        for purpose, category in [
            ("speech_transcription", "audio_clip"),
            ("speech_synthesis", "speech_text"),
            ("document_explanation", "document_text"),
        ]:
            grants[purpose] = client.post(
                "/api/v1/consents",
                headers=headers,
                json={"purpose": purpose, "data_categories": [category]},
            ).json()["id"]
        c = review(
            client, headers, grants, add_text(client, headers, grants, create(client, headers))
        )
        path = f"/api/v1/conversations/{c['id']}"
        audio = {
            "request_id": "voice1",
            "expected_context_revision": c["context_revision"],
            "audio": {"audio_base64": "a" * 44, "consent_id": grants["speech_transcription"]},
        }
        transcript = client.post(path + "/speech/transcribe", headers=headers, json=audio)
        assert transcript.json()["automatically_submitted"] is False
        assert client.get(path, headers=headers).json()["turns"] == []
        answered = turn(
            client,
            headers,
            grants,
            c,
            transcript.json()["transcription"]["text"],
            rid="voice-turn",
            language="ne",
        )
        assert answered.status_code == 200
        speech = {
            "turn_id": "voice-turn",
            "expected_context_revision": c["context_revision"],
            "chunk_index": 0,
            "consent_id": grants["speech_synthesis"],
        }
        result = client.post(path + "/speech/synthesize", headers=headers, json=speech)
        assert result.status_code == 200, result.text
        assert result.json()["speech"]["text"] == speech_chunks(answered.json()["answer"])[0]
        assert (
            client.post(
                path + "/speech/synthesize",
                headers=headers,
                json={**speech, "consent_id": grants["speech_transcription"]},
            ).status_code
            == 403
        )
        c = review(client, headers, grants, c, text="Hb: 12.5 g/dL\nFollow-up Monday")
        assert (
            client.post(
                path + "/speech/synthesize",
                headers=headers,
                json={**speech, "expected_context_revision": c["context_revision"]},
            ).status_code
            == 409
        )
        assert "audio_base64" not in client.get(path, headers=headers).text


def test_ambiguous_followup_and_oversized_review_fail_without_inference(setup):
    _, client, headers, grants, provider, _ = setup
    c = review(client, headers, grants, add_text(client, headers, grants, create(client, headers)))
    result = turn(client, headers, grants, c, "Explain that line")
    assert result.json()["status"] == "no_match"
    assert "Which line" in result.json()["answer"] and provider.requests == []
    path = f"/api/v1/conversations/{c['id']}/attachments/{c['attachments'][0]['id']}/review"
    result = client.put(
        path,
        headers=headers,
        json={
            "expected_context_revision": c["context_revision"],
            "text": "line\n" * 41,
            "text_checked": True,
            "consent_id": grants["document_explanation"],
        },
    )
    assert result.status_code == 422
    assert result.json()["detail"]["code"] == "document_text_limit_or_empty"


def test_cancelled_recognition_can_retry_same_request_and_deletion_purges_receipts(setup):
    app, client, headers, grants, provider, _ = setup
    provider.slow = True
    c = create(client, headers)
    path = f"/api/v1/conversations/{c['id']}"
    data = {
        "request_id": "retry",
        "expected_context_revision": 0,
        "image": {
            "image_base64": "U1lOVEhFVElDX1RFTVBP",
            "consent_id": grants["image_transcription"],
        },
    }
    job = client.post(path + "/recognitions", headers=headers, json=data).json()
    client.post(path + "/cancel", headers=headers)
    provider.slow = False
    repeated = client.post(path + "/recognitions", headers=headers, json=data).json()
    assert repeated["id"] == job["id"]
    for _ in range(20):
        repeated = client.get(path + "/recognitions/" + job["id"], headers=headers).json()
        if repeated["status"] != "processing":
            break
    assert repeated["status"] == "completed"
    saved = client.get(path, headers=headers).json()
    assert len(saved["attachments"]) == 1
    app.state.conversations.jobs.clear()  # Completed job reconstructed from durable metadata.
    assert (
        client.get(path + "/recognitions/" + job["id"], headers=headers).json()["status"]
        == "completed"
    )
    assert client.delete(path, headers=headers).status_code == 204
    assert app.state.conversations.jobs == {}


def test_draft_explanation_rejects_new_quantities_and_normalizes_nepali_digits():
    from arogya_api.documents.models import DocumentLine, DocumentSelection

    lines = [DocumentLine(id="L1", text="Examplemed १२.५ mg")]
    valid = DocumentSelection(
        highlights=[
            {"line_id": "L1", "kind": "medicine", "meaning": "The wording records 12.5 mg."}
        ],
        answer_line_ids=[],
    )
    valid.validate_ids(lines)
    bad = DocumentSelection(
        highlights=[{"line_id": "L1", "kind": "medicine", "meaning": "The wording records 25 mg."}],
        answer_line_ids=[],
    )
    with pytest.raises(ValueError, match="quantity"):
        bad.validate_ids(lines)


def test_local_snapshot_restore_needs_new_permission_and_revalidates_history(setup):
    app, client, headers, grants, _, _ = setup
    c = review(client, headers, grants, add_text(client, headers, grants, create(client, headers)))
    assert turn(client, headers, grants, c).status_code == 200
    snapshot = client.get(f"/api/v1/conversations/{c['id']}", headers=headers).json()
    client.delete("/api/v1/me/data", headers=headers)
    next_headers = {
        "Authorization": "Bearer " + client.post("/api/v1/session").json()["access_token"]
    }
    document = client.post(
        "/api/v1/consents",
        headers=next_headers,
        json={
            "purpose": "document_explanation",
            "data_categories": ["document_text"],
        },
    ).json()["id"]
    assert (
        client.post(
            "/api/v1/conversations/restore",
            headers=next_headers,
            json={"snapshot": snapshot, "consent_id": document},
        ).status_code
        == 403
    )
    consent = client.post(
        "/api/v1/consents",
        headers=next_headers,
        json={
            "purpose": "conversation_restore",
            "data_categories": ["conversation_context"],
        },
    ).json()["id"]
    response = client.post(
        "/api/v1/conversations/restore",
        headers=next_headers,
        json={"snapshot": snapshot, "consent_id": consent},
    )
    assert response.status_code == 201, response.text
    restored = response.json()
    assert restored["id"] == c["id"] and restored["restored_from_client"]
    assert restored["turns"][0]["restored_from_client"]
    assert (
        turn(client, next_headers, {"document_explanation": document}, restored).status_code == 409
    )
    fresh = turn(
        client,
        next_headers,
        {"document_explanation": document},
        restored,
        "Explain that line",
        "new-turn",
    )
    assert fresh.status_code == 200 and not fresh.json()["restored_from_client"]
    assert fresh.json()["references"][0]["quote"] == "Follow-up Friday"
    with app.state.history.connect() as db:
        assert db.execute("SELECT count(*) FROM context_conversations").fetchone()[0] == 0


def test_context_storage_revoke_deletes_new_conversations_and_completed_jobs(setup):
    app, client, headers, grants, _, _ = setup
    token = "history_" + "d" * 64
    client.post(
        "/api/v1/history/vault",
        headers=headers,
        json={"allow_server_storage": True, "client_access_token": token},
    )
    headers = {**headers, "X-History-Token": token}
    c = create(client, headers, storage="server_history", allow_context_storage=True)
    add_text(client, headers, grants, c)
    assert (
        client.delete(
            "/api/v1/history/vault", headers={"Authorization": "Bearer " + token}
        ).status_code
        == 204
    )
    assert client.get(f"/api/v1/conversations/{c['id']}", headers=headers).status_code == 401
    with app.state.history.connect() as db:
        assert db.execute("SELECT count(*) FROM context_conversations").fetchone()[0] == 0
    assert app.state.conversations.jobs == {}


def test_expired_processing_session_cancels_durable_turn_without_deleting_opted_in_history(setup):
    from fastapi import HTTPException

    from arogya_api.conversations.models import ConversationTurnRequest

    app, client, headers, grants, provider, _ = setup
    token = "history_" + "e" * 64
    client.post(
        "/api/v1/history/vault",
        headers=headers,
        json={"allow_server_storage": True, "client_access_token": token},
    )
    headers = {**headers, "X-History-Token": token}
    c = create(client, headers, storage="server_history", allow_context_storage=True)
    c = review(client, headers, grants, add_text(client, headers, grants, c))
    owner = "h:" + app.state.history.owner(token)
    with app.state.store.connect() as db:
        session_id = db.execute("SELECT id FROM sessions").fetchone()[0]
    provider.slow = True

    async def run():
        task = asyncio.create_task(
            app.state.conversations.turn(
                owner,
                session_id,
                c["id"],
                ConversationTurnRequest(
                    request_id="expired",
                    message="When is follow-up?",
                    expected_context_revision=c["context_revision"],
                    consent_id=grants["document_explanation"],
                ),
            )
        )
        await asyncio.sleep(0)
        with app.state.store.connect() as db:
            db.execute("DELETE FROM sessions")
        await app.state.conversations.purge()
        with pytest.raises(HTTPException) as error:
            await task
        assert error.value.detail["code"] == "turn_cancelled"

    asyncio.run(run())
    assert provider.cancelled
    assert app.state.contexts.load(owner, c["id"]).turns == []
    assert app.state.conversations.pending_sessions == {}


def test_client_history_identity_is_validated_and_scoped_to_owner(setup):
    _, client, headers, _, _, _ = setup
    value = create(client, headers, id="a" * 32)
    assert value["id"] == "a" * 32
    assert (
        client.post(
            "/api/v1/conversations", headers=headers, json={"mode": "document", "id": "bad-id"}
        ).status_code
        == 422
    )
    duplicate = client.post(
        "/api/v1/conversations", headers=headers, json={"mode": "medicine", "id": value["id"]}
    )
    assert duplicate.status_code == 409
    token = client.post("/api/v1/session").json()["access_token"]
    foreign = {"Authorization": "Bearer " + token}
    assert client.get(f"/api/v1/conversations/{value['id']}", headers=foreign).status_code == 404
    assert create(client, foreign, id=value["id"])["id"] == value["id"]


def test_general_explanation_is_distinct_from_targeted_question(setup):
    _, client, headers, grants, provider, _ = setup
    c = review(client, headers, grants, add_text(client, headers, grants, create(client, headers)))
    result = turn(
        client,
        headers,
        grants,
        c,
        message="Explain the wording of this document.",
        operation="explain",
    )
    assert result.status_code == 200
    assert result.json()["document"]["status"] == "draft"
    assert provider.requests[-1].question == ""
    assert {ref["line_id"] for ref in result.json()["references"]} == {"L1", "L2"}
    # A retry with changed operation must never reuse the explanation response.
    assert (
        turn(
            client, headers, grants, c, message="Explain the wording of this document."
        ).status_code
        == 409
    )
    targeted = turn(client, headers, grants, c, message="When is follow-up?", rid="question")
    assert targeted.status_code == 200
    assert provider.requests[-1].question == "When is follow-up?"
