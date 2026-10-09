from typing import Literal

from pydantic import Field

from arogya_api.core.contracts import Contract


class ImageReadRequest(Contract):
    kind: Literal["prescription", "doctor_note", "report", "medicine"] = "prescription"
    model_profile: Literal["qwen", "bonsai"] | None = None
    image_base64: str = Field(min_length=16, max_length=11184812)
    language: Literal["eng", "nep", "eng+nep"] = "eng"
    rotation: Literal[0, 90, 180, 270] = 0
    consent_id: str = Field(min_length=1, max_length=100)


class ImageReadResult(Contract):
    text: str = Field(max_length=30000)
    language: Literal["eng", "nep", "eng+nep"]
    status: Literal["unverified"] = "unverified"
    engine: str = Field(max_length=120)
    revision: str = Field(pattern=r"^[a-f0-9]{64}$")
    method: Literal["vision", "printed_ocr"] | None = None
    warnings: list[str] = Field(default_factory=list, max_length=8)
