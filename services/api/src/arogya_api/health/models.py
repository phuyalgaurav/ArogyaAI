from typing import Literal

from pydantic import Field

from arogya_api.core.contracts import Contract, Language


class ChatRequest(Contract):
    model_profile: Literal["qwen", "bonsai"] | None = None
    request_id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    language: Language
    message: str = Field(min_length=1, max_length=2000)
    medicine_id: str | None = Field(default=None, max_length=100)
    preferred_mode: Literal["auto", "server", "local"] = "auto"
    server_processing_consent_id: str | None = Field(default=None, max_length=100)
