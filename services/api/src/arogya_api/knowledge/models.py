from typing import Literal
from urllib.parse import urlparse

from pydantic import AwareDatetime, Field, HttpUrl, model_validator

from arogya_api.core.contracts import Contract, Language


class KnowledgeSection(Contract):
    id: str = Field(min_length=1, max_length=100)
    kind: Literal["education", "warning", "dosing"] = "education"
    task: Literal["education", "medicine_info"] = "education"
    questions: list[str] = Field(default_factory=list, max_length=20)
    sentences: list[str] = Field(min_length=1, max_length=20)


class KnowledgeSource(Contract):
    source_id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    version: str = Field(min_length=1, max_length=100)
    language: Language
    source_url: HttpUrl
    license: str = Field(min_length=1, max_length=500)
    review_status: Literal["pending", "approved", "withdrawn", "test_fixture", "public_reference"]
    reviewed_by: str | None = None
    reviewed_at: AwareDatetime | None = None
    valid_until: AwareDatetime
    sections: list[KnowledgeSection] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def require_review_metadata(self):
        url = urlparse(str(self.source_url))
        if url.username or url.password:
            raise ValueError("Public source URLs must not contain credentials")
        if self.review_status == "approved" and (not self.reviewed_by or not self.reviewed_at):
            raise ValueError("Approved knowledge requires named review and its timestamp")
        ids = [section.id for section in self.sections]
        if len(set(ids)) != len(ids):
            raise ValueError("Knowledge section IDs must be unique")
        for section in self.sections:
            if any(not text.strip() or len(text) > 1500 for text in section.sentences):
                raise ValueError("Knowledge sentences must contain 1–1500 characters")
            if any(not text.strip() or len(text) > 2000 for text in section.questions):
                raise ValueError("Reviewed questions must contain 1–2000 characters")
        if sum(len(text) for s in self.sections for text in [*s.sentences, *s.questions]) > 30000:
            raise ValueError("Knowledge source exceeds the import size limit")
        if self.reviewed_at and self.valid_until <= self.reviewed_at:
            raise ValueError("Knowledge expiry must follow review")
        return self


class MedicineRecord(Contract):
    id: str = Field(min_length=1, max_length=100)
    canonical_name: str = Field(min_length=1, max_length=200)
    active_ingredients: list[str] = Field(min_length=1, max_length=20)
    aliases: list[str] = Field(max_length=50)
    jurisdiction: str = Field(min_length=1, max_length=100)
    source_ids: list[str] = Field(min_length=1, max_length=10)


class MedicineResolveRequest(Contract):
    query: str = Field(min_length=1, max_length=200)


class MedicineResolution(Contract):
    status: Literal["candidate", "needs_clarification"]
    candidates: list[MedicineRecord]
    verified: Literal[False] = False


class EvidenceSentence(Contract):
    id: str
    source_id: str
    section_id: str
    version: str
    task: Literal["education", "medicine_info"] = "education"
    text: str = Field(min_length=1, max_length=1500)


class ReviewedQuestion(Contract):
    question: str
    language: Language
    source_id: str
    section_id: str
    version: str
    task: Literal["education", "medicine_info"] = "education"
