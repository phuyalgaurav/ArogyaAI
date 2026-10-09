from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from arogya_api.core.contracts import Contract
from arogya_api.speech.models import CONSENT_CATEGORIES, ConsentPurpose


class SessionResponse(Contract):
    access_token: str
    token_type: Literal["Bearer"] = "Bearer"
    expires_at: datetime


class ConsentRequest(Contract):
    purpose: ConsentPurpose
    data_categories: list[
        Literal[
            "message_text",
            "translation_text",
            "audio_clip",
            "speech_text",
            "image_bytes",
            "document_text",
            "conversation_context",
        ]
    ] = Field(min_length=1, max_length=1)
    expires_in_seconds: int = Field(default=900, ge=60, le=3600)

    @model_validator(mode="after")
    def match_purpose(self):
        if self.data_categories != [CONSENT_CATEGORIES[self.purpose]]:
            raise ValueError("Consent data category must match its purpose")
        return self


class ConsentGrant(Contract):
    id: str
    purpose: ConsentPurpose
    data_categories: list[
        Literal[
            "message_text",
            "translation_text",
            "audio_clip",
            "speech_text",
            "image_bytes",
            "document_text",
            "conversation_context",
        ]
    ]
    expires_at: datetime
    revoked: bool
