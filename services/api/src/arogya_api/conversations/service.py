"""Shared context, bounded recognition jobs and session-associated speech operations."""

import asyncio
import hashlib
import json
import re
import uuid
from datetime import UTC, datetime

from fastapi import HTTPException

from arogya_api.conversations.models import (
    ConversationAttachment,
    ConversationReference,
    ConversationTurn,
    RecognitionJob,
    ReviewedContextRevision,
)
from arogya_api.conversations.store import fail
from arogya_api.core.safety import precheck
from arogya_api.documents.models import (
    DocumentContextTurn,
    DocumentExplainRequest,
    DocumentExplainResult,
    ReviewedQuestionCandidate,
    ReviewedQuestionSelectionRequest,
)
from arogya_api.documents.service import explain
from arogya_api.health.models import ChatRequest
from arogya_api.health.references import available_questions
from arogya_api.health.service import answer
from arogya_api.inference.errors import ProviderUnavailable
from arogya_api.knowledge.store import normalized_question


def fingerprint(payload):
    data = payload.model_dump(mode="json")
    data.pop("consent_id", None)
    if "image" in data:
        data["image"].pop("consent_id", None)
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def recognition_id(owner, conversation_id, request_id):
    return hashlib.sha256(f"{owner}:{conversation_id}:{request_id}".encode()).hexdigest()[:32]


def reviewed_text(text, kind):
    try:
        DocumentExplainRequest(
            text=text,
            kind="prescription" if kind == "medicine" else kind,
            text_checked=True,
            consent_id="validation",
        )
    except ValueError:
        fail("document_text_limit_or_empty", 422)
    if "[page exceeds transcription limit]" in text:
        fail("document_limit_exceeded", 413)


def speech_chunks(text):
    """Lossless splitting: concatenating chunks exactly reconstructs the displayed answer."""
    chunks = []
    while text:
        end = min(300, len(text))
        if end < len(text):
            candidates = [m.end() for m in re.finditer(r"[।.!?]\s+|\s+", text[:end])]
            if candidates:
                end = candidates[-1]
        chunks.append(text[:end])
        text = text[end:]
    return chunks


class Conversations:
    def __init__(self, contexts, metadata, provider, images):
        self.contexts = contexts
        self.metadata = metadata
        self.provider = provider
        self.images = images
        self.pending = {}
        self.pending_sessions = {}
        self.jobs = {}

    async def close(self):
        tasks = list(self.pending.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.pending.clear()
        self.pending_sessions.clear()

    def forget(self, owner, conversation_id):
        self.jobs = {
            key: value
            for key, value in self.jobs.items()
            if not (key[0] == owner and value[0].conversation_id == conversation_id)
        }

    async def purge(self):
        expired = set()
        for owner, conversation_id in set(self.pending) | {
            (owner, job.conversation_id) for (owner, _), (job, _) in self.jobs.items()
        }:
            try:
                self.contexts.load(owner, conversation_id)
                session = self.pending_sessions.get((owner, conversation_id))
                if session and not self.metadata.session_active(session):
                    expired.add((owner, conversation_id))
            except HTTPException:
                expired.add((owner, conversation_id))
        for key in expired:
            task = self.pending.get(key)
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                self.pending.pop(key, None)
                self.pending_sessions.pop(key, None)
            self.forget(*key)

    def consent(self, consent_id, session, purpose):
        if not self.metadata.consent_valid(consent_id, session, purpose):
            fail("processing_permission_required", 403)

    def available(self, owner, conversation_id):
        if (owner, conversation_id) in self.pending:
            fail("conversation_busy", 409, True)

    def revision(self, conversation, expected):
        if expected != conversation.context_revision:
            fail("stale_context")

    def attachment(self, conversation, attachment_id=None):
        attachment_id = attachment_id or conversation.active_attachment_id
        for item in conversation.attachments:
            if item.id == attachment_id:
                return item
        fail("attachment_not_found", 404)

    def candidates(self, text):
        found = {}
        for line in text.splitlines()[:40]:
            # Remove only a trailing explicit strength/form; never fuzzy-correct a drug name.
            name = re.sub(
                r"\s+\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|मि\.ग्रा\.)(?:\s+.*)?$",
                "",
                line,
                flags=re.I,
            )
            for candidate in {line.strip(), name.strip()}:
                if len(candidate) > 200:
                    continue
                for item in self.metadata.medicine_resolve(candidate):
                    found[item.id] = item
        return list(found.values())[:20]

    def add_attachment(self, owner, conversation, payload, text, recognition=None):
        digest = fingerprint(payload)
        for item in conversation.attachments:
            if item.request_id == payload.request_id:
                if item.request_fingerprint != digest:
                    fail("request_id_conflict")
                return conversation
        self.revision(conversation, payload.expected_context_revision)
        if conversation.mode == "health" or (
            (payload.kind == "medicine") != (conversation.mode == "medicine")
        ):
            fail("attachment_mode_mismatch", 422)
        if len(conversation.attachments) >= 8:
            fail("attachment_count_limit")
        if not text.strip():
            fail("unreadable_image", 422, True)
        conversation.attachments.append(
            ConversationAttachment(
                id=uuid.uuid4().hex,
                request_id=payload.request_id,
                request_fingerprint=digest,
                kind=payload.kind,
                created_at=datetime.now(UTC),
                original_text=text,
                recognition=recognition,
                medicine_candidates=self.candidates(text) if payload.kind == "medicine" else [],
                observed_strengths=list(
                    dict.fromkeys(
                        re.findall(r"\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|मि\.ग्रा\.)\b", text, re.I)
                    )
                )[:20]
                if payload.kind == "medicine"
                else [],
            )
        )
        conversation.active_attachment_id = conversation.attachments[-1].id
        conversation.context_revision += 1
        return self.contexts.save(owner, conversation)

    def review(self, owner, conversation_id, attachment_id, payload, session):
        self.available(owner, conversation_id)
        self.consent(payload.consent_id, session, "document_explanation")
        conversation = self.contexts.load(owner, conversation_id)
        self.revision(conversation, payload.expected_context_revision)
        attachment = self.attachment(conversation, attachment_id)
        reviewed_text(payload.text, attachment.kind)
        selected_id = attachment.selected_medicine.id if attachment.selected_medicine else None
        if attachment.reviewed_text == payload.text and selected_id == payload.medicine_id:
            return conversation
        if len(attachment.review_history) >= 20:
            fail("attachment_review_limit")
        if payload.medicine_id:
            if attachment.kind != "medicine":
                fail("medicine_context_required", 422)
            medicine = self.metadata.medicine_get(payload.medicine_id)
            if not medicine:
                fail("reviewed_medicine_not_found", 404)
            candidates = self.candidates(payload.text)
            if medicine.id not in {c.id for c in candidates}:
                fail("medicine_not_supported_by_label", 422)
            attachment.selected_medicine = medicine
            attachment.medicine_candidates = candidates
        else:
            attachment.selected_medicine = None
            if attachment.kind == "medicine":
                attachment.medicine_candidates = self.candidates(payload.text)
        if attachment.kind == "medicine":
            attachment.observed_strengths = list(
                dict.fromkeys(
                    re.findall(r"\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|मि\.ग्रा\.)\b", payload.text, re.I)
                )
            )[:20]
        attachment.reviewed_text = payload.text
        attachment.reviewed_revision += 1
        conversation.active_attachment_id = attachment.id
        conversation.context_revision += 1
        attachment.review_history.append(
            ReviewedContextRevision(
                revision=attachment.reviewed_revision,
                context_revision=conversation.context_revision,
                reviewed_at=datetime.now(UTC),
                text=payload.text,
                selected_medicine_id=payload.medicine_id,
            )
        )
        return self.contexts.save(owner, conversation)

    async def resolve_question(self, conversation, payload, medicine):
        if precheck(payload.message):
            return payload.message
        questions = (
            self.metadata.questions(payload.language, 100)
            if medicine
            else available_questions(self.metadata, payload.language)
        )
        if medicine:
            questions = [q for q in questions if q.source_id in medicine.source_ids]
        for question in questions:
            if normalized_question(question.question) == normalized_question(payload.message):
                return payload.message
        if not questions:
            return payload.message
        previous = [
            t.resolved_question or t.message
            for t in conversation.turns
            if t.context_revision == conversation.context_revision
        ][-3:]
        # Bound candidates; the model must reject unrelated topics.
        words = set(re.findall(r"\w+", (payload.message + " " + " ".join(previous)).casefold()))
        questions.sort(
            key=lambda q: len(words & set(re.findall(r"\w+", q.question.casefold()))), reverse=True
        )
        candidates = [
            ReviewedQuestionCandidate(id=f"Q{i + 1}", question=q.question)
            for i, q in enumerate(questions[:20])
        ]
        try:
            result = await self.provider.select_reviewed_question(
                ReviewedQuestionSelectionRequest(
                    message=payload.message,
                    language=payload.language,
                    previous_questions=previous,
                    user_context=conversation.user_context,
                    candidates=candidates,
                    model_profile=payload.model_profile,
                )
            )
        except (ProviderUnavailable, AttributeError):
            return payload.message
        return next(
            (c.question for c in candidates if c.id == result.selection.question_id),
            payload.message,
        )

    async def turn(self, owner, session, conversation_id, payload):
        conversation = self.contexts.load(owner, conversation_id)
        purpose = "document_explanation" if conversation.mode == "document" else "server_chat"
        self.consent(payload.consent_id, session, purpose)
        digest = fingerprint(payload)
        for turn in conversation.turns:
            if turn.id == payload.request_id:
                if turn.restored_from_client:
                    fail("historical_turn_requires_new_request")
                if turn.request_fingerprint != digest:
                    fail("request_id_conflict")
                return turn
        self.available(owner, conversation_id)
        self.revision(conversation, payload.expected_context_revision)
        if len(conversation.turns) >= 50:
            fail("conversation_turn_limit")
        key = (owner, conversation_id)
        self.pending[key] = asyncio.current_task()
        self.pending_sessions[key] = session
        try:
            document, health, references = None, None, []
            resolved_question = None
            if conversation.mode == "document":
                attachment = self.attachment(conversation, payload.attachment_id)
                if attachment.reviewed_text is None:
                    fail("transcription_review_required", 422)
                if len(payload.message) > 400:
                    fail("document_question_limit", 413)
                previous = [
                    DocumentContextTurn(
                        question=t.message,
                        answer_line_ids=[r.line_id for r in t.references][:3],
                        answer_excerpt=t.answer[:1500],
                        answer_excerpt_truncated=len(t.answer) > 1500,
                    )
                    for t in conversation.turns
                    if t.context_revision == conversation.context_revision
                    and t.references
                    and all(r.attachment_id == attachment.id for r in t.references)
                ][-6:]
                ambiguous = (
                    not payload.line_ids
                    and re.search(r"\b(?:that|this) line\b|त्यो हरफ|त्यो लाइन", payload.message, re.I)
                    and (not previous or len(previous[-1].answer_line_ids) != 1)
                )
                document = (
                    await explain(
                        DocumentExplainRequest(
                            text=attachment.reviewed_text,
                            text_checked=True,
                            kind=attachment.kind,
                            language=payload.language,
                            question="" if payload.operation == "explain" else payload.message,
                            model_profile=payload.model_profile,
                            consent_id=payload.consent_id,
                            previous_turns=previous,
                            user_context=conversation.user_context,
                            focus_line_ids=payload.line_ids,
                        ),
                        self.provider,
                    )
                    if not ambiguous
                    else DocumentExplainResult(
                        status="no_match",
                        items=[],
                        answer_line_ids=[],
                        document_sha256=hashlib.sha256(
                            attachment.reviewed_text.encode()
                        ).hexdigest(),
                        notice="कुन हरफबारे सोध्नुभएको हो? हरफ छान्नुहोस्।"
                        if payload.language == "ne"
                        else "Which line do you mean? Select a line or name the passage.",
                        speech_text_ne="कुन हरफबारे सोध्नुभएको हो? हरफ छान्नुहोस्।",
                    )
                )
                selected = [
                    item for item in document.items if item.line_id in document.answer_line_ids
                ]
                if not selected and document.status == "draft":
                    selected = document.items
                references = [
                    ConversationReference(
                        attachment_id=attachment.id,
                        context_revision=conversation.context_revision,
                        line_id=item.line_id,
                        quote=item.quote,
                    )
                    for item in selected
                ]
                text = (
                    "\n\n".join(
                        f"{item.line_id}: “{item.quote}”\n{item.meaning}"
                        + "".join(
                            f"\n{definition.term}: {definition.meaning}"
                            for definition in item.definitions
                        )
                        for item in selected
                    )
                    or document.notice
                )
                status = document.status
            else:
                medicine = None
                if conversation.mode == "medicine":
                    attachment = self.attachment(conversation, payload.attachment_id)
                    medicine = attachment.selected_medicine
                    if not medicine:
                        fail("medicine_identity_review_required", 422)
                resolved_question = await self.resolve_question(conversation, payload, medicine)
                self.consent(payload.consent_id, session, purpose)
                health = await answer(
                    ChatRequest(
                        request_id=payload.request_id,
                        message=resolved_question,
                        language=payload.language,
                        medicine_id=medicine.id if medicine else None,
                        model_profile=payload.model_profile,
                        user_context=conversation.user_context,
                        include_user_context=bool(conversation.user_context),
                        server_processing_consent_id=payload.consent_id,
                    ),
                    session,
                    self.metadata,
                    self.provider,
                )
                text, status = health.answer, health.status
            self.consent(payload.consent_id, session, purpose)
            # Reload checks durable-vault revocation/deletion and prevents resurrection.
            self.contexts.load(owner, conversation_id)
            result = ConversationTurn(
                id=payload.request_id,
                message=payload.message,
                answer=text,
                language=payload.language,
                timestamp=datetime.now(UTC),
                context_revision=conversation.context_revision,
                status=status,
                references=references,
                document=document,
                health=health,
                request_fingerprint=digest,
                resolved_question=resolved_question,
            )
            conversation.turns.append(result)
            if len(conversation.turns) == 1 and conversation.title == "New conversation":
                conversation.title = payload.message[:80]
            conversation.language = payload.language
            self.contexts.save(owner, conversation)
            return result
        except asyncio.CancelledError:
            fail("turn_cancelled", 409, True)
        finally:
            self.pending.pop(key, None)
            self.pending_sessions.pop(key, None)

    def recognize(self, owner, session, conversation_id, payload):
        self.consent(payload.image.consent_id, session, "image_transcription")
        conversation = self.contexts.load(owner, conversation_id)
        digest = fingerprint(payload)
        # Completed recognition receipts can be reconstructed after a server restart without pixels.
        for attachment in conversation.attachments:
            if attachment.request_id == payload.request_id:
                if attachment.request_fingerprint != digest:
                    fail("request_id_conflict")
                return RecognitionJob(
                    id=recognition_id(owner, conversation_id, payload.request_id),
                    conversation_id=conversation_id,
                    request_id=payload.request_id,
                    status="completed",
                    stage="completed",
                    created_at=attachment.created_at,
                    attachment_id=attachment.id,
                )
        previous_job_key = None
        for (job_owner, job_id), (job, job_digest) in self.jobs.items():
            if (
                job_owner == owner
                and job.conversation_id == conversation_id
                and job.request_id == payload.request_id
            ):
                if job_digest != digest:
                    fail("request_id_conflict")
                if job.status in {"processing", "completed"}:
                    return job
                previous_job_key = (job_owner, job_id)
                break
        self.available(owner, conversation_id)
        self.revision(conversation, payload.expected_context_revision)
        if conversation.mode == "health" or (
            (payload.kind == "medicine") != (conversation.mode == "medicine")
        ):
            fail("attachment_mode_mismatch", 422)
        if len(conversation.attachments) >= 8:
            fail("attachment_count_limit")
        if len(self.pending) >= 4:
            fail("recognition_capacity", 503, True)
        if previous_job_key:
            self.jobs.pop(previous_job_key)
        if len(self.jobs) >= 100:
            oldest = next((k for k, (j, _) in self.jobs.items() if j.status != "processing"), None)
            if oldest:
                self.jobs.pop(oldest)
        job = RecognitionJob(
            id=recognition_id(owner, conversation_id, payload.request_id),
            conversation_id=conversation_id,
            request_id=payload.request_id,
            status="processing",
            stage="recognizing",
            created_at=datetime.now(UTC),
        )
        self.jobs[(owner, job.id)] = (job, digest)
        key = (owner, conversation_id)

        async def run():
            try:
                image = payload.image.model_copy(update={"kind": payload.kind})
                async with asyncio.timeout(165):
                    result = await (
                        self.provider.read_prescription(image)
                        if payload.method == "vision"
                        else self.images.read(image)
                    )
                self.consent(payload.image.consent_id, session, "image_transcription")
                result.method = payload.method
                result.warnings = ["unverified_transcription"]
                if "[illegible]" in result.text:
                    result.warnings.append("illegible_regions")
                if "[page exceeds transcription limit]" in result.text:
                    fail("document_limit_exceeded", 413)
                current = self.contexts.load(owner, conversation_id)
                saved = self.add_attachment(owner, current, payload, result.text, result)
                job.attachment_id = saved.active_attachment_id
                job.status, job.stage = "completed", "completed"
            except asyncio.CancelledError:
                job.status, job.stage = "cancelled", "cancelled"
            except (HTTPException, ProviderUnavailable, TimeoutError) as error:
                if isinstance(error, HTTPException):
                    detail = error.detail
                elif isinstance(error, ProviderUnavailable) and str(error) in {
                    "model_busy",
                    "bonsai_busy",
                    "invalid_photo_draft",
                    "bonsai_unavailable_or_invalid",
                    "qwen_could_not_unload",
                }:
                    detail = str(error)
                else:
                    detail = "recognition_unavailable"
                job.error_code = detail.get("code") if isinstance(detail, dict) else detail
                job.status, job.stage = "failed", "failed"
                job.retryable = not isinstance(error, HTTPException) or error.status_code >= 500
            except Exception:
                # Keep model/decoder diagnostics and private inputs out of API responses.
                job.status, job.stage = "failed", "failed"
                job.error_code, job.retryable = "recognition_failed", True
            finally:
                self.pending.pop(key, None)
                self.pending_sessions.pop(key, None)

        self.pending[key] = asyncio.create_task(run())
        self.pending_sessions[key] = session
        return job

    async def cancel(self, owner, conversation_id):
        self.contexts.load(owner, conversation_id)
        task = self.pending.get((owner, conversation_id))
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            self.pending.pop((owner, conversation_id), None)
            self.pending_sessions.pop((owner, conversation_id), None)
            for (job_owner, _), (job, _) in self.jobs.items():
                if (
                    job_owner == owner
                    and job.conversation_id == conversation_id
                    and job.status == "processing"
                ):
                    job.status, job.stage = "cancelled", "cancelled"
