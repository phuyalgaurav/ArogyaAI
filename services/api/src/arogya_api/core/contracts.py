"""Canonical models exported as JSON Schema and TypeScript declarations."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Language = Literal["en", "ne", "tam"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def valid_text(cls, value):
        def inspect(item, depth=0):
            if depth > 20:
                raise ValueError("Input nesting exceeds the supported limit")
            if isinstance(item, str):
                try:
                    item.encode("utf-8")
                except UnicodeError:
                    raise ValueError("Text must be valid UTF-8") from None
            elif isinstance(item, dict):
                for key, data in item.items():
                    inspect(key, depth + 1)
                    inspect(data, depth + 1)
            elif isinstance(item, (list, tuple)):
                for data in item:
                    inspect(data, depth + 1)

        inspect(value)
        return value


class Evidence(Contract):
    source_id: str = Field(min_length=1)
    version: str = Field(min_length=1)
    section_id: str | None = None


class Safety(Contract):
    rule_ids: list[str]
    abstained: bool


class Provenance(Contract):
    mode: Literal["local", "server", "static"]
    model: str | None
    knowledge_version: str
    translator: str | None = None
    model_revision: str | None = None
    router: str = "rules"
    router_intent: str | None = None
    router_revision: str | None = None
    routing_disagreement: bool = False
    policy_version: str = "education-extractive-2"


class ArogyaResponse(Contract):
    schema_version: Literal["1.0"] = "1.0"
    request_id: str = Field(min_length=1)
    status: Literal[
        "answered", "needs_clarification", "needs_professional_review", "urgent", "unavailable"
    ]
    language: Language
    answer: str
    evidence: list[Evidence]
    safety: Safety
    provenance: Provenance

    @model_validator(mode="after")
    def require_grounding(self):
        if self.status == "answered" and (not self.evidence or self.safety.abstained):
            raise ValueError("An answered result requires evidence and must not abstain")
        return self


class Capability(Contract):
    id: Literal["browser_qwen", "server_qwen", "ocr", "laya", "tmt", "offline_library", "sync"]
    available: bool
    reason: str


class Capabilities(Contract):
    schema_version: Literal["1.0"] = "1.0"
    stage: Literal["starter", "backend"] = "backend"
    languages: list[Language]
    features: list[Capability]
