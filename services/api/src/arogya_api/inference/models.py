from typing import Literal

from pydantic import Field

from arogya_api.core.contracts import Contract, Language
from arogya_api.knowledge.models import EvidenceSentence


class GenerateRequest(Contract):
    user_context: str = Field(default="", max_length=4000)
    model_profile: Literal["qwen", "bonsai"] | None = None
    message: str = Field(min_length=1, max_length=2000)
    language: Language
    sentences: list[EvidenceSentence] = Field(min_length=1, max_length=8)


class IntentRequest(Contract):
    message: str = Field(min_length=1, max_length=2000)
    language: Language


class ExtractiveSelection(Contract):
    relevant: bool
    sentence_ids: list[str] = Field(max_length=3)


class GenerationResult(Contract):
    selection: ExtractiveSelection
    model: str
    digest: str = Field(pattern=r"^[a-f0-9]{64}$")


class IntentResult(Contract):
    intent: Literal["medicine_info", "document_scan", "education", "other"]
    provider: Literal["laya", "rules"]
    model_revision: str | None
