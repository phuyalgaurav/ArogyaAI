from typing import Literal

from pydantic import AwareDatetime, Field

from arogya_api.core.contracts import Contract


class EngineRuntime(Contract):
    id: Literal[
        "qwen_selector",
        "laya_router",
        "translation",
        "nepali_stt",
        "nepali_tts",
        "server_ocr",
        "bonsai",
    ]
    name: str = Field(max_length=120)
    task: Literal[
        "evidence_selection",
        "intent_routing",
        "translation",
        "transcription",
        "speech_synthesis",
        "printed_text_recognition",
        "document_vision",
    ]
    state: Literal["unconfigured", "unavailable", "ready", "busy"]
    revision: str | None = Field(default=None, max_length=74)
    loaded: bool | None = None
    memory_bytes: int | None = Field(default=None, ge=0)
    context_tokens: int | None = Field(default=None, ge=0)
    reason: str = Field(max_length=200)


class WorkerRuntime(Contract):
    checked_at: AwareDatetime
    engines: list[EngineRuntime] = Field(min_length=2, max_length=7)


class HostSpecs(Contract):
    system: str = Field(max_length=40)
    architecture: str = Field(max_length=40)
    cpu_threads: int | None = Field(default=None, ge=1)
    memory_bytes: int | None = Field(default=None, gt=0)


class RuntimeStatus(WorkerRuntime):
    host: HostSpecs | None = None
    reviewed_sources: int = Field(ge=0)
    reviewed_questions: int = Field(ge=0)
    free_form_answers: Literal[False] = False


class ModelAction(Contract):
    action: Literal["warm", "unload"]
    expected_revision: str = Field(pattern=r"^[a-f0-9]{64}$")
