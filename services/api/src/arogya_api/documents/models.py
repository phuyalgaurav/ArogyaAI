import re
import unicodedata
from typing import Literal

from pydantic import Field, model_validator

from arogya_api.core.contracts import Contract

DocumentKind = Literal["prescription", "doctor_note", "report"]
LineKind = Literal["medicine", "instruction", "finding", "follow_up", "other"]


class DocumentContextTurn(Contract):
    question: str = Field(max_length=400)
    answer_line_ids: list[str] = Field(max_length=3)
    answer_excerpt: str = Field(default="", max_length=1500)
    answer_excerpt_truncated: bool = False


class DocumentExplainRequest(Contract):
    user_context: str = Field(default="", max_length=4000)
    model_profile: Literal["qwen", "bonsai"] | None = None
    text: str = Field(min_length=1, max_length=8000)
    kind: DocumentKind
    language: Literal["en", "ne"] = "en"
    question: str = Field(default="", max_length=400)
    text_checked: Literal[True]
    consent_id: str = Field(min_length=1, max_length=100)
    previous_turns: list[DocumentContextTurn] = Field(default_factory=list, max_length=6)
    focus_line_ids: list[str] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def readable(self):
        lines = [line.strip() for line in self.text.splitlines() if line.strip()]
        if not lines or len(lines) > 40 or any(len(line) > 500 for line in lines):
            raise ValueError("Use up to 40 nonempty lines, each at most 500 characters")
        return self


class DocumentLine(Contract):
    id: str = Field(pattern=r"^L[1-9][0-9]?$", max_length=3)
    text: str = Field(min_length=1, max_length=500)


class DocumentChunk(Contract):
    id: str = Field(pattern=r"^C[1-9][0-9]?$")
    line_ids: list[str] = Field(min_length=1, max_length=3)
    terms: dict[str, int] = Field(max_length=1000)
    token_count: int = Field(ge=0, le=1000)


class DocumentContext(Contract):
    """Derived retrieval data, retained under the attachment's existing storage policy."""

    schema_version: Literal[1] = 1
    method: Literal["bm25"] = "bm25"
    document_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    reviewed_revision: int = Field(ge=0)
    kind: DocumentKind
    chunks: list[DocumentChunk] = Field(min_length=1, max_length=40)
    document_frequency: dict[str, int] = Field(max_length=8000)
    average_chunk_length: float = Field(ge=0)
    summary: str = Field(max_length=1800)
    summary_line_ids: list[str] = Field(max_length=6)


class DocumentRetrieval(Contract):
    method: Literal["bm25", "full_document"]
    line_ids: list[str] = Field(max_length=40)
    total_lines: int = Field(ge=1, le=40)
    context_reused: bool
    truncated: bool


class DocumentSelectionRequest(Contract):
    user_context: str = Field(default="", max_length=4000)
    model_profile: Literal["qwen", "bonsai"] | None = None
    language: Literal["en", "ne"] = "en"
    kind: DocumentKind
    question: str = Field(default="", max_length=400)
    lines: list[DocumentLine] = Field(min_length=1, max_length=40)
    previous_turns: list[DocumentContextTurn] = Field(default_factory=list, max_length=6)
    focus_line_ids: list[str] = Field(default_factory=list, max_length=3)


class DocumentHighlight(Contract):
    line_id: str = Field(pattern=r"^L[1-9][0-9]?$", max_length=3)
    kind: LineKind
    meaning: str | None = Field(default=None, max_length=500)


class DocumentSelection(Contract):
    highlights: list[DocumentHighlight] = Field(max_length=12)
    answer_line_ids: list[str] = Field(max_length=3)

    def validate_ids(self, lines):
        known = {line.id for line in lines}
        ids = [item.line_id for item in self.highlights]
        if (
            not set(ids + self.answer_line_ids) <= known
            or len(ids) != len(set(ids))
            or len(self.answer_line_ids) != len(set(self.answer_line_ids))
        ):
            raise ValueError("Unknown or duplicate document references")
        known = {line.id: line.text for line in lines}

        def numbers(text):
            normalized = "".join(str(unicodedata.decimal(c)) if c.isdecimal() else c for c in text)
            return set(re.findall(r"\d+(?:\.\d+)?", normalized))

        for item in self.highlights:
            if item.meaning and not numbers(item.meaning) <= numbers(known[item.line_id]):
                raise ValueError("Unsupported quantity in explanation")


class DocumentSelectionResult(Contract):
    selection: DocumentSelection
    model: str
    revision: str = Field(pattern=r"^[a-f0-9]{64}$")


class ReviewedQuestionCandidate(Contract):
    id: str = Field(pattern=r"^Q[1-9][0-9]?$")
    question: str = Field(min_length=1, max_length=2000)


class ReviewedQuestionSelectionRequest(Contract):
    user_context: str = Field(default="", max_length=4000)
    model_profile: Literal["qwen", "bonsai"] | None = None
    message: str = Field(min_length=1, max_length=2000)
    language: Literal["en", "ne"]
    previous_questions: list[str] = Field(default_factory=list, max_length=3)
    candidates: list[ReviewedQuestionCandidate] = Field(min_length=1, max_length=20)


class ReviewedQuestionSelection(Contract):
    question_id: str | None = Field(default=None, pattern=r"^Q[1-9][0-9]?$")


class ReviewedQuestionSelectionResult(Contract):
    selection: ReviewedQuestionSelection
    model: str
    revision: str = Field(pattern=r"^[a-f0-9]{64}$")


class DocumentDefinition(Contract):
    term: str
    meaning: str
    source_url: str


class DocumentItem(Contract):
    line_id: str
    quote: str
    kind: LineKind
    meaning: str
    definitions: list[DocumentDefinition]
    check_with_professional: bool
    speech_text_ne: str = Field(max_length=300)


class DocumentExplainResult(Contract):
    status: Literal["draft", "no_match", "professional_review", "urgent"]
    notice: str
    items: list[DocumentItem]
    answer_line_ids: list[str]
    document_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    model: str | None = None
    revision: str | None = None
    speech_text_ne: str = Field(max_length=300)
    question_method: Literal["none", "literal_document_match", "model_selection"] = "none"
    retrieval: DocumentRetrieval | None = None
