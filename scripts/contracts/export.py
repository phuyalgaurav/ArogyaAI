"""Export API models; fail if committed schemas drift from the canonical models."""

import json
import sys
from pathlib import Path

from arogya_api.conversations.models import (
    Conversation,
    ConversationAttachment,
    ConversationCapabilities,
    ConversationCreate,
    ConversationFocus,
    ConversationIndex,
    ConversationRecognitionRequest,
    ConversationReference,
    ConversationRestore,
    ConversationReview,
    ConversationSpeechRequest,
    ConversationSpeechResult,
    ConversationSummary,
    ConversationTextAttachment,
    ConversationTranscriptionRequest,
    ConversationTranscriptionResult,
    ConversationTurn,
    ConversationTurnRequest,
    RecognitionJob,
    ReviewedContextRevision,
)
from arogya_api.core.contracts import ArogyaResponse, Capabilities
from arogya_api.core.models import ConsentGrant, ConsentRequest, SessionResponse
from arogya_api.documents.models import (
    DocumentContext,
    DocumentExplainRequest,
    DocumentExplainResult,
    DocumentRetrieval,
)
from arogya_api.health.models import ChatRequest
from arogya_api.history.models import (
    HistoryConsent,
    HistoryConversation,
    HistoryIndex,
    HistoryMessage,
    HistoryVault,
)
from arogya_api.images.models import ImageReadRequest, ImageReadResult
from arogya_api.knowledge.bundle_models import (
    BundleManifest,
    BundlePayload,
    BundlePublishRequest,
)
from arogya_api.knowledge.models import (
    KnowledgeSource,
    MedicineRecord,
    MedicineResolution,
    MedicineResolveRequest,
    ReviewedQuestion,
)
from arogya_api.knowledge.review_models import (
    AuditEvent,
    ConflictLookup,
    MedicineImport,
    OperatorIdentity,
    QuestionConflict,
    ResolveQuestionRequest,
    ReviewRequest,
    SourceDraft,
    SourceRevision,
    VersionAction,
)
from arogya_api.runtime.models import (
    EngineRuntime,
    HostSpecs,
    ModelAction,
    RuntimeStatus,
    WorkerRuntime,
)
from arogya_api.speech.models import (
    SpeechRequest,
    SpeechResult,
    TranscriptionRequest,
    TranscriptionResult,
    TranslationRequest,
    TranslationResult,
)

output = Path(__file__).resolve().parents[2] / "packages/contracts/schema"
output.mkdir(parents=True, exist_ok=True)
check = "--check" in sys.argv
models = (
    ArogyaResponse,
    Capabilities,
    ChatRequest,
    ConsentRequest,
    ConsentGrant,
    SessionResponse,
    KnowledgeSource,
    MedicineRecord,
    MedicineResolution,
    MedicineResolveRequest,
    ReviewedQuestion,
    SourceDraft,
    SourceRevision,
    ReviewRequest,
    VersionAction,
    QuestionConflict,
    ResolveQuestionRequest,
    ConflictLookup,
    AuditEvent,
    MedicineImport,
    OperatorIdentity,
    BundleManifest,
    BundlePayload,
    BundlePublishRequest,
    EngineRuntime,
    HostSpecs,
    WorkerRuntime,
    RuntimeStatus,
    ModelAction,
    TranslationRequest,
    TranslationResult,
    TranscriptionRequest,
    TranscriptionResult,
    SpeechRequest,
    SpeechResult,
    ImageReadRequest,
    ImageReadResult,
    DocumentExplainRequest,
    DocumentExplainResult,
    DocumentContext,
    DocumentRetrieval,
    HistoryMessage,
    HistoryConversation,
    HistoryConsent,
    HistoryVault,
    HistoryIndex,
    Conversation,
    ConversationCreate,
    ConversationAttachment,
    ConversationReference,
    ConversationTurn,
    ConversationTurnRequest,
    ConversationSummary,
    ConversationIndex,
    ConversationTextAttachment,
    ConversationReview,
    ConversationRestore,
    ConversationFocus,
    ConversationRecognitionRequest,
    RecognitionJob,
    ReviewedContextRevision,
    ConversationTranscriptionRequest,
    ConversationTranscriptionResult,
    ConversationSpeechRequest,
    ConversationSpeechResult,
    ConversationCapabilities,
)


def export(target, value):
    content = json.dumps(value, indent=2) + "\n"
    if check:
        if not target.exists() or target.read_text() != content:
            raise SystemExit(f"Contract drift: regenerate {target.name}")
    else:
        target.write_text(content)


for model in models:
    target = output / f"{model.__name__}.json"
    export(target, model.model_json_schema(mode="serialization"))
export(output / "manifest.json", [model.__name__ for model in models])
print("Contract schemas verified." if check else "Contract schemas exported.")
