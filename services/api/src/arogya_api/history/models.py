import json
from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from arogya_api.core.contracts import ArogyaResponse, Contract, Language


class HistoryMessage(Contract):
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    sender: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=6000)
    timestamp: AwareDatetime
    response: ArogyaResponse | None = None
    error: str | None = Field(default=None, max_length=6000)

    @model_validator(mode="after")
    def consistent(self):
        if self.sender == "user" and (self.response or self.error or len(self.text) > 2000):
            raise ValueError("User messages contain only a bounded question")
        if self.response and (self.sender != "assistant" or self.response.answer != self.text):
            raise ValueError("Saved response must match its displayed text")
        return self


class HistoryConversation(Contract):
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    title: str = Field(min_length=1, max_length=80)
    language: Language
    created_at: AwareDatetime
    updated_at: AwareDatetime
    messages: list[HistoryMessage] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def bounded(self):
        if len({message.id for message in self.messages}) != len(self.messages):
            raise ValueError("Message IDs must be unique")
        if self.updated_at < self.created_at:
            raise ValueError("Conversation times are reversed")
        if len(json.dumps(self.model_dump(mode="json")).encode()) > 800000:
            raise ValueError("Conversation is too large")
        return self


class HistoryConsent(Contract):
    allow_server_storage: Literal[True]
    client_access_token: str = Field(pattern=r"^history_[a-f0-9]{64}$")
    retention_days: Literal[30] = 30


class HistoryVault(Contract):
    access_token: str
    expires_at: AwareDatetime
    retention_days: Literal[30] = 30


class HistoryIndex(Contract):
    conversations: list[HistoryConversation]
    deleted_ids: list[str]
    expires_at: AwareDatetime
