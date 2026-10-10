from typing import Literal

from pydantic import Field, model_validator

from arogya_api.core.contracts import Contract, Language


class ChatRequest(Contract):
    user_context: str = Field(default="", max_length=4000)
    include_user_context: bool = False
    model_profile: Literal["qwen", "bonsai"] | None = None
    request_id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    language: Language
    message: str = Field(min_length=1, max_length=2000)
    medicine_id: str | None = Field(default=None, max_length=100)
    preferred_mode: Literal["auto", "server", "local"] = "auto"
    server_processing_consent_id: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def context_permission(self):
        if self.user_context and not self.include_user_context:
            raise ValueError("Explicit permission to include saved user context is required")
        return self
