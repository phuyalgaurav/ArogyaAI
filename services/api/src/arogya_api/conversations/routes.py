"""Conversation endpoints; existing single-operation APIs remain compatible."""

import asyncio
import re
import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from arogya_api.conversations.models import (
    Conversation,
    ConversationCapabilities,
    ConversationCreate,
    ConversationFocus,
    ConversationIndex,
    ConversationRecognitionRequest,
    ConversationRestore,
    ConversationReview,
    ConversationSpeechRequest,
    ConversationSpeechResult,
    ConversationTextAttachment,
    ConversationTranscriptionRequest,
    ConversationTranscriptionResult,
    ConversationTurn,
    ConversationTurnRequest,
    RecognitionJob,
    ResourceId,
)
from arogya_api.conversations.service import recognition_id, reviewed_text, speech_chunks
from arogya_api.conversations.store import fail
from arogya_api.speech.models import SpeechRequest, SpeechResult, TranscriptionResult


async def connected(request, operation, seconds=165):
    task = asyncio.create_task(operation)
    try:
        async with asyncio.timeout(seconds):
            while not task.done():
                await asyncio.wait({task}, timeout=0.1)
                if not task.done() and await request.is_disconnected():
                    fail("request_cancelled", 499, True)
            return await task
    except TimeoutError:
        fail("processing_timeout", 504, True)
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


def conversation_router(contexts, service, metadata, sessions, history, limits, language):
    router = APIRouter(prefix="/api/v1/conversations", tags=["Contextual conversations"])
    bearer = HTTPBearer(auto_error=False)

    def identity(
        response: Response,
        credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
        x_history_token: str | None = Header(default=None, max_length=72),
    ):
        response.headers["Cache-Control"] = "no-store"
        session = sessions.verify(credentials.credentials if credentials else None)
        owner = "h:" + history.owner(x_history_token) if x_history_token else "s:" + session
        limits.check("conversation-api:" + session, 120)
        return owner, session

    @router.get("/capabilities", response_model=ConversationCapabilities)
    def capabilities():
        return ConversationCapabilities()

    @router.post("", response_model=Conversation, status_code=201)
    def create(payload: ConversationCreate, who=Depends(identity)):
        owner, session = who
        if (payload.storage == "server_history") != owner.startswith("h:"):
            fail("storage_identity_mismatch", 422)
        if owner.startswith("h:"):
            with history.connect() as db:
                expires = history.require_active(db, owner[2:])
        else:
            with metadata.connect() as db:
                expires = db.execute(
                    "SELECT expires FROM sessions WHERE id=?", (session,)
                ).fetchone()[0]
        now = datetime.now(UTC)
        return contexts.save(
            owner,
            Conversation(
                id=payload.id or uuid.uuid4().hex,
                mode=payload.mode,
                user_context=payload.user_context if payload.include_user_context else "",
                title=payload.title,
                language=payload.language,
                storage=payload.storage,
                created_at=now,
                updated_at=now,
                expires_at=datetime.fromtimestamp(expires, UTC),
            ),
            create=True,
        )

    @router.get("", response_model=ConversationIndex)
    def index(
        query: str = Query(default="", max_length=100),
        mode: Literal["document", "medicine", "health"] | None = None,
        offset: int = Query(default=0, ge=0, le=1000),
        limit: int = Query(default=20, ge=1, le=50),
        who=Depends(identity),
    ):
        return contexts.index(who[0], query, mode, offset, limit)

    @router.get("/{conversation_id}", response_model=Conversation)
    def detail(conversation_id: ResourceId, who=Depends(identity)):
        return contexts.load(who[0], conversation_id)

    @router.post("/restore", response_model=Conversation, status_code=201)
    def restore(payload: ConversationRestore, who=Depends(identity)):
        if not who[0].startswith("s:"):
            fail("restore_requires_session_storage", 422)
        service.consent(payload.consent_id, who[1], "conversation_restore")
        value = payload.snapshot.model_copy(deep=True)
        if len(value.model_dump_json().encode()) > 800000:
            fail("conversation_storage_limit", 413)
        ids = {a.id for a in value.attachments}
        if len(ids) != len(value.attachments) or (
            value.active_attachment_id and value.active_attachment_id not in ids
        ):
            fail("invalid_restored_context", 422)
        if len({t.id for t in value.turns}) != len(value.turns):
            fail("invalid_restored_context", 422)
        for attachment in value.attachments:
            if (attachment.kind == "medicine") != (value.mode == "medicine"):
                fail("attachment_mode_mismatch", 422)
            if value.mode == "health":
                fail("attachment_mode_mismatch", 422)
            if attachment.reviewed_text is not None:
                reviewed_text(attachment.reviewed_text, attachment.kind)
            # Browser snapshots are untrusted. Never accept a supplied retrieval index.
            attachment.document_context = None
            if attachment.reviewed_text is not None and attachment.kind != "medicine":
                service.document_context(attachment)
            supplied = attachment.selected_medicine
            attachment.medicine_candidates = service.candidates(attachment.reviewed_text or "")
            attachment.selected_medicine = next(
                (c for c in attachment.medicine_candidates if supplied and c.id == supplied.id),
                None,
            )
        with metadata.connect() as db:
            expires = db.execute("SELECT expires FROM sessions WHERE id=?", (who[1],)).fetchone()[0]
        value.storage, value.restored_from_client = "session", True
        for turn in value.turns:
            turn.restored_from_client = True
        value.expires_at, value.version = datetime.fromtimestamp(expires, UTC), 0
        return contexts.save(who[0], value, create=True)

    @router.delete("/{conversation_id}", status_code=204)
    async def delete(conversation_id: ResourceId, who=Depends(identity)):
        await service.cancel(who[0], conversation_id)
        contexts.delete(who[0], conversation_id)
        service.forget(who[0], conversation_id)

    @router.post("/{conversation_id}/cancel", status_code=204)
    async def cancel(conversation_id: ResourceId, who=Depends(identity)):
        await service.cancel(who[0], conversation_id)

    @router.post("/{conversation_id}/focus", response_model=Conversation)
    def focus(conversation_id: ResourceId, payload: ConversationFocus, who=Depends(identity)):
        service.available(who[0], conversation_id)
        value = contexts.load(who[0], conversation_id)
        service.revision(value, payload.expected_context_revision)
        service.attachment(value, payload.attachment_id)
        value.active_attachment_id = payload.attachment_id
        value.context_revision += 1
        return contexts.save(who[0], value)

    @router.post("/{conversation_id}/attachments/text", response_model=Conversation)
    def text(
        conversation_id: ResourceId, payload: ConversationTextAttachment, who=Depends(identity)
    ):
        service.available(who[0], conversation_id)
        service.consent(payload.consent_id, who[1], "document_explanation")
        value = contexts.load(who[0], conversation_id)
        return service.add_attachment(who[0], value, payload, payload.text)

    @router.put(
        "/{conversation_id}/attachments/{attachment_id}/review", response_model=Conversation
    )
    def review(
        conversation_id: ResourceId,
        attachment_id: ResourceId,
        payload: ConversationReview,
        who=Depends(identity),
    ):
        return service.review(who[0], conversation_id, attachment_id, payload, who[1])

    @router.post("/{conversation_id}/recognitions", response_model=RecognitionJob, status_code=202)
    async def recognize(
        conversation_id: ResourceId,
        payload: ConversationRecognitionRequest,
        who=Depends(identity),
    ):
        limits.check("recognition:" + who[1], 8)
        return service.recognize(who[0], who[1], conversation_id, payload)

    @router.get("/{conversation_id}/recognitions/{job_id}", response_model=RecognitionJob)
    def job(conversation_id: ResourceId, job_id: ResourceId, who=Depends(identity)):
        value = contexts.load(who[0], conversation_id)
        entry = service.jobs.get((who[0], job_id))
        if not entry:
            for attachment in value.attachments:
                if (
                    attachment.recognition
                    and recognition_id(who[0], conversation_id, attachment.request_id) == job_id
                ):
                    return RecognitionJob(
                        id=job_id,
                        conversation_id=conversation_id,
                        request_id=attachment.request_id,
                        status="completed",
                        stage="completed",
                        created_at=attachment.created_at,
                        attachment_id=attachment.id,
                    )
        if not entry or entry[0].conversation_id != conversation_id:
            fail("recognition_job_not_found", 404)
        return entry[0]

    @router.post("/{conversation_id}/turns", response_model=ConversationTurn)
    async def turn(
        conversation_id: ResourceId,
        payload: ConversationTurnRequest,
        request: Request,
        who=Depends(identity),
    ):
        limits.check("conversation-turn:" + who[1], 20)
        return await connected(request, service.turn(who[0], who[1], conversation_id, payload))

    async def voice_operation(
        conversation_id, expected, consent_id, purpose, kind, payload, result, who
    ):
        value = contexts.load(who[0], conversation_id)
        service.revision(value, expected)
        service.consent(consent_id, who[1], purpose)
        service.available(who[0], conversation_id)
        key = (who[0], conversation_id)
        service.pending[key] = asyncio.current_task()
        service.pending_sessions[key] = who[1]
        try:
            output = await language.run(kind, payload, result)
            service.consent(consent_id, who[1], purpose)
            service.revision(contexts.load(who[0], conversation_id), expected)
            return output
        except asyncio.CancelledError:
            fail("voice_cancelled", 409, True)
        finally:
            service.pending.pop(key, None)
            service.pending_sessions.pop(key, None)

    @router.post(
        "/{conversation_id}/speech/transcribe", response_model=ConversationTranscriptionResult
    )
    async def transcribe(
        conversation_id: ResourceId,
        payload: ConversationTranscriptionRequest,
        request: Request,
        who=Depends(identity),
    ):
        limits.check("conversation-stt:" + who[1], 10)
        result = await connected(
            request,
            voice_operation(
                conversation_id,
                payload.expected_context_revision,
                payload.audio.consent_id,
                "speech_transcription",
                "stt",
                payload.audio,
                TranscriptionResult,
                who,
            ),
            seconds=85,
        )
        return ConversationTranscriptionResult(
            conversation_id=conversation_id,
            request_id=payload.request_id,
            context_revision=payload.expected_context_revision,
            transcription=result,
        )

    @router.post("/{conversation_id}/speech/synthesize", response_model=ConversationSpeechResult)
    async def speak(
        conversation_id: ResourceId,
        payload: ConversationSpeechRequest,
        request: Request,
        who=Depends(identity),
    ):
        limits.check("conversation-tts:" + who[1], 60)
        value = contexts.load(who[0], conversation_id)
        service.revision(value, payload.expected_context_revision)
        selected = next((t for t in value.turns if t.id == payload.turn_id), None)
        if not selected or selected.context_revision != value.context_revision:
            fail("stale_turn", 409)
        if selected.restored_from_client:
            fail("historical_turn_requires_new_request")
        if selected.language != "ne":
            fail("speech_language_unsupported", 422)
        chunks = speech_chunks(selected.answer)
        if payload.chunk_index >= len(chunks):
            fail("speech_chunk_not_found", 404)
        if not re.search(r"[\u0900-\u097f]", chunks[payload.chunk_index]):
            fail("speech_chunk_language_unsupported", 422)
        speech_payload = SpeechRequest(
            text=chunks[payload.chunk_index],
            speaker=payload.speaker,
            consent_id=payload.consent_id,
        )
        result = await connected(
            request,
            voice_operation(
                conversation_id,
                payload.expected_context_revision,
                payload.consent_id,
                "speech_synthesis",
                "tts",
                speech_payload,
                SpeechResult,
                who,
            ),
            seconds=85,
        )
        return ConversationSpeechResult(
            conversation_id=conversation_id,
            turn_id=payload.turn_id,
            context_revision=value.context_revision,
            chunk_index=payload.chunk_index,
            chunk_count=len(chunks),
            speech=result,
        )

    return router
