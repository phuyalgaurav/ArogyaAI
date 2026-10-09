import os
import secrets
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, SecretStr, model_validator


class Settings(BaseModel):
    mode: str = "development"
    database_path: Path = Path(".local/arogya.sqlite3")
    signing_key: SecretStr = Field(default_factory=lambda: SecretStr(secrets.token_hex(32)))
    worker_url: str | None = None
    worker_token: SecretStr | None = None
    ollama_url: str = "http://127.0.0.1:11435"
    qwen_model: str = "qwen3.5:0.8b"
    qwen_digest: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    laya_path: Path | None = None
    laya_revision: str | None = Field(default=None, pattern=r"^[a-f0-9]{40}$")
    laya_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    allow_test_knowledge: bool = False
    request_timeout: float = Field(default=45, ge=1, le=120)
    session_seconds: int = Field(default=3600, ge=60, le=86400)
    operator_registry_path: Path | None = None
    bundle_signing_key_path: Path | None = None
    knowledge_audit_key: SecretStr | None = None
    language_worker_url: str | None = None
    language_worker_token: SecretStr | None = None
    language_model_dir: Path | None = None
    ocr_dir: Path | None = None
    web_dir: Path | None = None
    history_database_path: Path | None = None
    bonsai_profile_path: Path | None = None
    default_model_profile: Literal["qwen", "bonsai"] = "qwen"

    @model_validator(mode="after")
    def validate_configuration(self):
        if self.mode not in {"development", "production"}:
            raise ValueError("AROGYA_MODE must be development or production")
        if len(self.signing_key.get_secret_value()) < 32:
            raise ValueError("Signing key must contain at least 32 characters")
        if self.knowledge_audit_key and len(self.knowledge_audit_key.get_secret_value()) < 32:
            raise ValueError("Knowledge audit key must contain at least 32 characters")
        if (
            self.mode == "production"
            and self.operator_registry_path
            and not self.knowledge_audit_key
        ):
            raise ValueError("Production source governance requires a separate audit key")
        if self.mode == "production" and self.allow_test_knowledge:
            raise ValueError("Test knowledge cannot be enabled in production")
        if self.worker_url and not self.worker_token:
            raise ValueError("Worker URL requires a service token")
        if self.worker_token and len(self.worker_token.get_secret_value()) < 32:
            raise ValueError("Worker token must contain at least 32 characters")
        if self.language_worker_url and not self.language_worker_token:
            raise ValueError("Language worker URL requires a service token")
        if self.language_worker_token and len(self.language_worker_token.get_secret_value()) < 32:
            raise ValueError("Language worker token must contain at least 32 characters")
        if self.laya_path and not (self.laya_revision and self.laya_sha256):
            raise ValueError("A local Laya checkpoint requires a revision and weight checksum")
        for value in (self.worker_url, self.ollama_url, self.language_worker_url):
            if value:
                parsed = urlparse(value)
                if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                    raise ValueError("Provider endpoints must use HTTP or HTTPS")
                if parsed.username or parsed.password or parsed.query or parsed.fragment:
                    raise ValueError("Provider URLs must not contain credentials or query strings")
        return self

    @classmethod
    def from_environment(cls):
        mode = os.getenv("AROGYA_MODE", "development")
        key = os.getenv("AROGYA_SIGNING_KEY")
        if mode == "production" and not key:
            raise ValueError("Production requires AROGYA_SIGNING_KEY")
        values = {"mode": mode}
        for field in cls.model_fields:
            value = os.getenv("AROGYA_" + field.upper())
            if value is not None and value != "":
                values[field] = value
        return cls(**values)
