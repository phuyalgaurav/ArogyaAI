import re
from typing import Literal

from pydantic import Field, model_validator

from arogya_api.core.contracts import Contract, Language

ConsentPurpose = Literal[
    "server_chat",
    "translation",
    "speech_transcription",
    "speech_synthesis",
    "image_transcription",
    "document_explanation",
    "conversation_restore",
]
CONSENT_CATEGORIES = {
    "server_chat": "message_text",
    "translation": "translation_text",
    "speech_transcription": "audio_clip",
    "speech_synthesis": "speech_text",
    "image_transcription": "image_bytes",
    "document_explanation": "document_text",
    "conversation_restore": "conversation_context",
}


class TranslationInput(Contract):
    text: str = Field(min_length=1, max_length=600)
    source_language: Language
    target_language: Language
    protected_terms: list[str] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def validate_pair(self):
        if not self.text.strip() or self.source_language == self.target_language:
            raise ValueError("Choose different languages and non-empty text")
        if any(
            not term.strip() or len(term) > 80 or term not in self.text
            for term in self.protected_terms
        ):
            raise ValueError("Protected terms must occur in the original text")
        return self


class TranslationRequest(TranslationInput):
    consent_id: str = Field(min_length=1, max_length=100)


class TranslationResult(Contract):
    text: str = Field(min_length=1, max_length=4000)
    original_text: str
    source_language: Language
    target_language: Language
    status: Literal["draft", "needs_review"]
    warnings: list[Literal["numbers_changed", "protected_terms_changed", "output_truncated"]]
    model: str
    revision: str


class TranscriptionInput(Contract):
    audio_base64: str = Field(min_length=44, max_length=900000)
    language: Literal["ne"] = "ne"


class TranscriptionRequest(TranscriptionInput):
    consent_id: str = Field(min_length=1, max_length=100)


class TranscriptionResult(Contract):
    text: str = Field(min_length=1, max_length=4000)
    language: Literal["ne"] = "ne"
    status: Literal["draft", "needs_review"] = "draft"
    duration_seconds: float = Field(gt=0, le=20)
    model: str
    revision: str
    processor_model: str
    processor_revision: str


class SpeechInput(Contract):
    text: str = Field(min_length=1, max_length=300)
    language: Literal["ne"] = "ne"
    speaker: Literal["kala", "barsha"] = "kala"

    @model_validator(mode="after")
    def validate_text(self):
        if not self.text.strip() or not re.search(r"[\u0900-\u097f]", self.text):
            raise ValueError("Nepali text is required")
        return self


class SpeechRequest(SpeechInput):
    consent_id: str = Field(min_length=1, max_length=100)


class SpeechResult(Contract):
    audio_base64: str = Field(min_length=44, max_length=2600000)
    mime_type: Literal["audio/wav"] = "audio/wav"
    text: str
    language: Literal["ne"] = "ne"
    speaker: Literal["kala", "barsha"]
    duration_seconds: float = Field(gt=0, le=40)
    sample_rate: Literal[22050] = 22050
    model: str
    revision: str
