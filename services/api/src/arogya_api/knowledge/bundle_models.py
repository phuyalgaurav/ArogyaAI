from typing import Literal

from pydantic import AwareDatetime, Field

from arogya_api.core.contracts import Contract, Language
from arogya_api.knowledge.models import KnowledgeSource, MedicineRecord, ReviewedQuestion


class BundlePublishRequest(Contract):
    language: Language
    expires_in_seconds: int = Field(default=3600, ge=60, le=3600)


class BundleSourceRef(Contract):
    source_id: str
    version: str
    content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class BundlePayload(Contract):
    schema_version: Literal["1.0"] = "1.0"
    language: Language
    policy_version: str
    sources: list[KnowledgeSource] = Field(min_length=1, max_length=50)
    medicines: list[MedicineRecord] = Field(max_length=1000)
    questions: list[ReviewedQuestion] = Field(max_length=500)


class BundleManifest(Contract):
    schema_version: Literal["1.0"] = "1.0"
    id: str = Field(pattern=r"^[a-f0-9]{64}$")
    language: Language
    policy_version: str
    created_at: AwareDatetime
    valid_until: AwareDatetime
    payload_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    payload_bytes: int = Field(ge=1, le=1048576)
    catalog_epoch: str = Field(pattern=r"^[a-f0-9]{64}$")
    sources: list[BundleSourceRef]
    algorithm: Literal["Ed25519"] = "Ed25519"
    key_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    signature: str = Field(min_length=88, max_length=88)
