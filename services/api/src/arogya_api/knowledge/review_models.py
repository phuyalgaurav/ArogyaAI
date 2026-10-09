from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import AwareDatetime, Field, HttpUrl, StringConstraints, model_validator

from arogya_api.core.contracts import Contract, Language
from arogya_api.knowledge.models import KnowledgeSource, MedicineRecord

Role = Literal["administrator", "content_editor", "clinical_reviewer", "license_reviewer"]
Digest = str
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=1000)]


class Operator(Contract):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    roles: list[Role] = Field(min_length=1, max_length=4)
    token_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    enabled: bool = True
    expires_at: AwareDatetime


class OperatorIdentity(Contract):
    id: str
    roles: list[Role]
    expires_at: AwareDatetime


class ConflictLookup(Contract):
    question: str = Field(min_length=1, max_length=2000)
    language: Language


class SourceDraft(KnowledgeSource):
    source_id: str = Field(pattern=r"^[A-Za-z0-9_.-]{1,100}$")
    version: str = Field(pattern=r"^[A-Za-z0-9_.-]{1,100}$")
    review_status: Literal["pending"] = "pending"
    reviewed_by: None = None
    reviewed_at: None = None


class ReviewRequest(Contract):
    kind: Literal["clinical", "license"]
    decision: Literal["approve", "reject"]
    expected_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    reason: Reason
    license_evidence_url: HttpUrl | None = None
    redistribution_allowed: bool = False
    translation_allowed: bool = False

    @model_validator(mode="after")
    def license_proof(self):
        if self.license_evidence_url:
            url = urlparse(str(self.license_evidence_url))
            if url.username or url.password:
                raise ValueError("License evidence URLs must not contain credentials")
        if self.kind == "license" and self.decision == "approve" and not self.license_evidence_url:
            raise ValueError("License approval requires an evidence URL")
        if self.kind == "clinical" and (
            self.license_evidence_url or self.redistribution_allowed or self.translation_allowed
        ):
            raise ValueError("License rights require a separate license review")
        return self


class VersionAction(Contract):
    expected_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    reason: Reason


class MedicineImport(Contract):
    medicine: MedicineRecord
    reason: Reason


class SourceReview(Contract):
    kind: Literal["clinical", "license"]
    decision: Literal["approve", "reject"]
    actor_id: str
    recorded_at: AwareDatetime
    content_hash: str
    reason: str
    license_evidence_url: HttpUrl | None = None
    redistribution_allowed: bool = False
    translation_allowed: bool = False


class SourceRevision(Contract):
    source: KnowledgeSource
    content_hash: str
    state: Literal["pending", "active", "retired", "withdrawn"]
    submitted_by: str
    submitted_at: AwareDatetime
    reviews: list[SourceReview]


class QuestionCandidate(Contract):
    source_id: str
    version: str
    section_id: str
    content_hash: str


class QuestionConflict(Contract):
    question: str
    language: Language
    snapshot_hash: str
    candidates: list[QuestionCandidate]
    selected: QuestionCandidate | None


class ResolveQuestionRequest(Contract):
    question: str = Field(min_length=1, max_length=2000)
    language: Language
    expected_snapshot: str = Field(pattern=r"^[a-f0-9]{64}$")
    selected: QuestionCandidate
    reason: Reason


class AuditEvent(Contract):
    sequence: int
    actor_id: str
    event: str
    source_id: str
    version: str
    recorded_at: AwareDatetime
    data: dict
    previous_hash: str
    event_hash: str
