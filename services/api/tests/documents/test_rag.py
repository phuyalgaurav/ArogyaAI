"""Retrieval quality, provenance, prompt bounds and fail-closed generation checks."""

import asyncio

import pytest
from fastapi import HTTPException

from arogya_api.documents.models import (
    DocumentContextTurn,
    DocumentExplainRequest,
    DocumentSelectionResult,
)
from arogya_api.documents.rag import (
    MAX_CONTEXT_CHARS,
    MAX_CONTEXT_LINES,
    build_context,
    document_lines,
    retrieve,
    tokens,
)
from arogya_api.documents.service import explain


def long_document():
    lines = [f"Section {i}: " + "Background wording for this passage. " * 4 for i in range(1, 41)]
    lines[5] = "Glucose: 89.5 mg/dL"
    lines[35] = "Creatinine: 1.25 mg/dL"
    lines[38] = "Follow-up: Monday at the clinic"
    return "\n".join(lines)


class PassageProvider:
    def __init__(self):
        self.requests = []

    async def select_document(self, request):
        self.requests.append(request)
        matches = [line.id for line in request.lines if "Creatinine" in line.text]
        return DocumentSelectionResult(
            selection={"highlights": [], "answer_line_ids": matches[:3]},
            model="fixture",
            revision="a" * 64,
        )


def test_unicode_tokenization_keeps_nepali_words_and_normalizes_digits():
    assert "ग्लुकोज" in tokens("ग्लुकोज १२.५")
    assert tokens("१२.५") == tokens("12.5")
    assert set(tokens("Hb")) & set(tokens("हेमोग्लोबिन"))
    assert set(tokens("blood sugar")) & set(tokens("ग्लुकोज"))


@pytest.mark.parametrize("question", ["Explain creatinine", "क्रिएटिनिन के हो?"])
def test_retrieval_finds_late_passages_in_both_languages_and_preserves_line_ids(question):
    text = long_document()
    lines = document_lines(text)
    context = build_context(text, "report", 2)
    result = retrieve(context, lines, question)
    assert "L36" in {line.id for line in result}
    assert "L6" not in {line.id for line in result}
    assert len(result) <= MAX_CONTEXT_LINES
    assert sum(len(line.text) + 1 for line in result) <= MAX_CONTEXT_CHARS
    assert next(line.text for line in result if line.id == "L36") == "Creatinine: 1.25 mg/dL"


def test_no_retrieval_match_does_not_invoke_generator():
    text = long_document()
    provider = PassageProvider()
    result = asyncio.run(
        explain(
            DocumentExplainRequest(
                text=text,
                kind="report",
                question="Where are the zebras?",
                text_checked=True,
                consent_id="fixture",
            ),
            provider,
            build_context(text, "report"),
        )
    )
    assert result.status == "no_match" and not result.items
    assert result.retrieval.truncated and result.retrieval.line_ids == []
    assert provider.requests == []


def test_explicit_and_pronoun_references_survive_retrieval():
    text = long_document()
    lines = document_lines(text)
    context = build_context(text, "report")
    assert "L1" in {line.id for line in retrieve(context, lines, "Explain that line", (), ["L1"])}
    previous = [DocumentContextTurn(question="Explain creatinine", answer_line_ids=["L36"])]
    result = retrieve(context, lines, "What does it mean?", previous)
    assert "L36" in {line.id for line in result}
    assert retrieve(context, lines, "Where are the zebras?", previous) == []


def test_summary_is_extractive_and_chunks_cover_every_line_with_overlap():
    text = long_document()
    lines = document_lines(text)
    context = build_context(text, "report", 4)
    assert context.reviewed_revision == 4
    assert {i for chunk in context.chunks for i in chunk.line_ids} == {line.id for line in lines}
    assert all(
        set(left.line_ids) & set(right.line_ids)
        for left, right in zip(context.chunks, context.chunks[1:])
    )
    for line_id in context.summary_line_ids:
        assert f"{line_id}: {lines[int(line_id[1:]) - 1].text}" in context.summary
    assert "L39" in context.summary_line_ids
    overview = retrieve(context, lines, "Summarize this document")
    assert {line.id for line in overview} == set(context.summary_line_ids)


def test_full_explanation_batches_cover_all_lines_with_bounded_inputs():
    provider = PassageProvider()
    text = long_document()
    result = asyncio.run(
        explain(
            DocumentExplainRequest(
                text=text, kind="report", text_checked=True, consent_id="fixture"
            ),
            provider,
            build_context(text, "report"),
        )
    )
    assert len(provider.requests) > 1
    assert {item.line_id for item in result.items} == {f"L{i}" for i in range(1, 41)}
    assert all(
        sum(len(line.text) + 1 for line in request.lines) <= MAX_CONTEXT_CHARS
        and len(request.lines) <= MAX_CONTEXT_LINES
        for request in provider.requests
    )
    assert result.retrieval.method == "full_document" and not result.retrieval.truncated


def test_full_explanation_rejects_model_revision_changes_between_batches():
    calls = 0
    provider = PassageProvider()

    async def changed(request):
        nonlocal calls
        calls += 1
        return DocumentSelectionResult(
            selection={"highlights": [], "answer_line_ids": []},
            model="fixture",
            revision=("a" if calls == 1 else "b") * 64,
        )

    provider.select_document = changed
    with pytest.raises(HTTPException) as error:
        asyncio.run(
            explain(
                DocumentExplainRequest(
                    text=long_document(), kind="report", text_checked=True, consent_id="fixture"
                ),
                provider,
            )
        )
    assert error.value.status_code == 503 and calls == 2


def test_generation_cannot_cite_an_unretrieved_line():
    provider = PassageProvider()

    async def invalid(request):
        assert "L1" not in {line.id for line in request.lines}
        return DocumentSelectionResult(
            selection={"highlights": [], "answer_line_ids": ["L1"]},
            model="fixture",
            revision="a" * 64,
        )

    provider.select_document = invalid
    with pytest.raises(HTTPException) as error:
        asyncio.run(
            explain(
                DocumentExplainRequest(
                    text=long_document(),
                    kind="report",
                    question="Explain creatinine",
                    text_checked=True,
                    consent_id="fixture",
                ),
                provider,
            )
        )
    assert error.value.status_code == 503


def test_previous_turns_are_bounded_and_filtered_to_retrieved_evidence():
    text = long_document()
    provider = PassageProvider()
    previous = [
        DocumentContextTurn(
            question="Explain creatinine",
            answer_line_ids=["L36"],
            answer_excerpt="Historical answer. " * 70,
        )
        for _ in range(5)
    ] + [DocumentContextTurn(question="Glucose", answer_line_ids=["L6"])]
    result = asyncio.run(
        explain(
            DocumentExplainRequest(
                text=text,
                kind="report",
                question="Explain creatinine",
                previous_turns=previous,
                text_checked=True,
                consent_id="fixture",
            ),
            provider,
        )
    )
    assert result.answer_line_ids == ["L36"]
    supplied = provider.requests[-1].previous_turns
    assert len(supplied) == 2
    assert all(
        len(turn.answer_excerpt) <= 300 and turn.answer_excerpt_truncated for turn in supplied
    )
    assert all(turn.answer_line_ids == ["L36"] for turn in supplied)


@pytest.mark.parametrize("question", ["Which line mentions creatinine?", "क्रिएटिनिन कुन हरफमा छ?"])
def test_named_glossary_navigation_keeps_exact_reference_when_model_omits_selection(question):
    provider = PassageProvider()

    async def empty(request):
        provider.requests.append(request)
        return DocumentSelectionResult(
            selection={"highlights": [], "answer_line_ids": []},
            model="fixture",
            revision="a" * 64,
        )

    provider.select_document = empty
    result = asyncio.run(
        explain(
            DocumentExplainRequest(
                text=long_document(),
                kind="report",
                question=question,
                text_checked=True,
                consent_id="fixture",
            ),
            provider,
        )
    )
    assert result.status == "draft" and result.answer_line_ids == ["L36"]
    assert result.question_method == "literal_document_match"
