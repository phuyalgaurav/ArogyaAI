"""Versioned conversation contracts. Processing and durable storage are distinct choices."""

from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, model_validator

from arogya_api.core.contracts import ArogyaResponse, Contract
from arogya_api.documents.models import DocumentExplainResult, DocumentKind
from arogya_api.images.models import ImageReadRequest, ImageReadResult
from arogya_api.knowledge.models import MedicineRecord
from arogya_api.speech.models import SpeechResult, TranscriptionRequest, TranscriptionResult

ResourceId = Annotated[str, Field(pattern=r"^[a-f0-9]{32}$")]
RequestId = Annotated[str, Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")]


class ConversationCreate(Contract):
    id: ResourceId | None = None
    mode: Literal["document", "medicine", "health"]
    language: Literal["en", "ne"] = "en"
    title: str = Field(default="New conversation", min_length=1, max_length=80)
    storage: Literal["session", "server_history"] = "session"
    allow_context_storage: bool = False

    @model_validator(mode="after")
    def storage_permission(self):
        if self.storage == "server_history" and not self.allow_context_storage:
            raise ValueError(
                "Explicit permission to store messages and reviewed context is required"
            )
        return self


class ConversationReference(Contract):
    attachment_id: ResourceId
    context_revision: int = Field(ge=0)
    line_id: str = Field(pattern=r"^L[1-9][0-9]?$")
    quote: str = Field(max_length=500)


class ReviewedContextRevision(Contract):
    revision: int = Field(ge=1)
    context_revision: int = Field(ge=1)
    reviewed_at: AwareDatetime
    text: str = Field(min_length=1, max_length=8000)
    selected_medicine_id: str | None = None


class ConversationAttachment(Contract):
    id: ResourceId
    request_id: RequestId
    request_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    kind: Literal["prescription", "doctor_note", "report", "medicine"]
    created_at: AwareDatetime
    original_available: Literal[False] = False
    original_text: str = Field(max_length=30000)
    reviewed_text: str | None = Field(default=None, max_length=8000)
    reviewed_revision: int = Field(default=0, ge=0)
    review_history: list[ReviewedContextRevision] = Field(default_factory=list, max_length=20)
    recognition: ImageReadResult | None = None
    medicine_candidates: list[MedicineRecord] = Field(default_factory=list, max_length=20)
    observed_strengths: list[str] = Field(default_factory=list, max_length=20)
    selected_medicine: MedicineRecord | None = None


class ConversationTurn(Contract):
    id: RequestId
    message: str = Field(min_length=1, max_length=2000)
    answer: str = Field(max_length=30000)
    language: Literal["en", "ne"]
    timestamp: AwareDatetime
    context_revision: int = Field(ge=0)
    status: str = Field(max_length=60)
    references: list[ConversationReference] = Field(default_factory=list, max_length=40)
    document: DocumentExplainResult | None = None
    health: ArogyaResponse | None = None
    request_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    resolved_question: str | None = Field(default=None, max_length=2000)
    restored_from_client: bool = False


class Conversation(Contract):
    schema_version: Literal[1] = 1
    id: ResourceId
    mode: Literal["document", "medicine", "health"]
    title: str = Field(min_length=1, max_length=80)
    language: Literal["en", "ne"]
    storage: Literal["session", "server_history"]
    created_at: AwareDatetime
    updated_at: AwareDatetime
    expires_at: AwareDatetime
    version: int = Field(default=0, ge=0)
    restored_from_client: bool = False
    context_revision: int = Field(default=0, ge=0)
    active_attachment_id: ResourceId | None = None
    attachments: list[ConversationAttachment] = Field(default_factory=list, max_length=8)
    turns: list[ConversationTurn] = Field(default_factory=list, max_length=50)


class ConversationRestore(Contract):
    snapshot: Conversation
    consent_id: str = Field(min_length=1, max_length=100)


class ConversationSummary(Contract):
    id: ResourceId
    mode: Literal["document", "medicine", "health"]
    title: str
    updated_at: AwareDatetime
    storage: Literal["session", "server_history"]
    turn_count: int
    preview: str


class ConversationIndex(Contract):
    conversations: list[ConversationSummary]
    total: int
    offset: int
    limit: int


class ConversationTextAttachment(Contract):
    request_id: RequestId
    expected_context_revision: int = Field(ge=0)
    kind: DocumentKind | Literal["medicine"] = "prescription"
    text: str = Field(min_length=1, max_length=8000)
    consent_id: str = Field(min_length=1, max_length=100)


class ConversationReview(Contract):
    expected_context_revision: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=8000)
    text_checked: Literal[True]
    consent_id: str = Field(min_length=1, max_length=100)
    medicine_id: str | None = Field(default=None, max_length=100)


class ConversationFocus(Contract):
    expected_context_revision: int = Field(ge=0)
    attachment_id: ResourceId


class ConversationTurnRequest(Contract):
    operation: Literal["question", "explain"] = "question"
    request_id: RequestId
    message: str = Field(min_length=1, max_length=2000)
    expected_context_revision: int = Field(ge=0)
    attachment_id: ResourceId | None = None
    line_ids: list[str] = Field(default_factory=list, max_length=3)
    language: Literal["en", "ne"] = "en"
    model_profile: Literal["qwen", "bonsai"] | None = None
    consent_id: str = Field(min_length=1, max_length=100)


class ConversationRecognitionRequest(Contract):
    request_id: RequestId
    expected_context_revision: int = Field(ge=0)
    kind: DocumentKind | Literal["medicine"] = "prescription"
    method: Literal["vision", "printed_ocr"] = "vision"
    image: ImageReadRequest


class RecognitionJob(Contract):
    id: ResourceId
    conversation_id: ResourceId
    request_id: RequestId
    status: Literal["processing", "completed", "failed", "cancelled"]
    stage: Literal["recognizing", "completed", "failed", "cancelled"]
    created_at: AwareDatetime
    attachment_id: ResourceId | None = None
    error_code: str | None = None
    retryable: bool = False


class ConversationTranscriptionRequest(Contract):
    request_id: RequestId
    expected_context_revision: int = Field(ge=0)
    audio: TranscriptionRequest


class ConversationTranscriptionResult(Contract):
    conversation_id: ResourceId
    request_id: RequestId
    context_revision: int
    transcription: TranscriptionResult
    automatically_submitted: Literal[False] = False


class ConversationSpeechRequest(Contract):
    turn_id: RequestId
    expected_context_revision: int = Field(ge=0)
    chunk_index: int = Field(ge=0, le=200)
    speaker: Literal["kala", "barsha"] = "kala"
    consent_id: str = Field(min_length=1, max_length=100)


class ConversationSpeechResult(Contract):
    conversation_id: ResourceId
    turn_id: RequestId
    context_revision: int
    chunk_index: int
    chunk_count: int
    speech: SpeechResult


class ConversationCapabilities(Contract):
    schema_version: Literal[1] = 1
    modes: list[str] = ["document", "medicine", "health"]
    processing: Literal["server"] = "server"
    original_retention: Literal[False] = False
    session_storage: Literal["memory_until_session_expiry"] = "memory_until_session_expiry"
    history_retention_days: Literal[30] = 30
    image_formats: list[str] = ["JPEG", "PNG", "WebP"]
    maximum_attachments: Literal[8] = 8
    maximum_turns: Literal[50] = 50
    text_streaming: Literal[False] = False
    stt_transport: Literal["whole_clip"] = "whole_clip"
    tts_transport: Literal["ordered_chunks"] = "ordered_chunks"
    local_inference: Literal[False] = False
