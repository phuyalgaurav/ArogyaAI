import asyncio
import hashlib
import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from arogya_api.core.safety import EMERGENCY, INJECTION, PERSONAL
from arogya_api.documents.glossary import MEANINGS, definitions
from arogya_api.documents.models import (
    DocumentExplainRequest,
    DocumentExplainResult,
    DocumentItem,
    DocumentRetrieval,
    DocumentSelectionRequest,
)
from arogya_api.documents.rag import (
    batches,
    build_context,
    context_matches,
    document_lines,
    retrieve,
)
from arogya_api.documents.rules import ADMIN, line_kind, literal_question_matches
from arogya_api.inference.errors import ProviderUnavailable

AMBIGUOUS = re.compile(r"\b(?:OD|QD|QOD|BD|BID|TID|QID|PRN|HS|IU|U)\b|\?", re.I)
DECISION = re.compile(
    r"\b(?:do i have|am i|is it safe|best medicine|recommend.*medicine)\b|"
    r"\b(?:is|are)\b.*\b(?:normal|dangerous|serious)\b|यो.*(?:ठीक|गम्भीर)|"
    r"के.*रोग|औषधि.*सिफारिस",
    re.I,
)


async def explain(payload, provider, context=None):
    revision = hashlib.sha256(payload.text.encode()).hexdigest()
    ne = payload.language == "ne"
    base = {
        "document_sha256": revision,
        "items": [],
        "answer_line_ids": [],
    }
    if EMERGENCY.search(payload.question):
        notice = (
            ("तुरुन्त स्वास्थ्यकर्मीको आपत्कालीन सहायता लिनुहोस्। यस सेवाले आपत्कालीन अवस्था जाँच्न सक्दैन।")
            if ne
            else (
                "Seek urgent professional care now. "
                "This reader cannot assess or rule out an emergency."
            )
        )
        return DocumentExplainResult(
            **base,
            status="urgent",
            notice=notice,
            speech_text_ne="तुरुन्त आपत्कालीन स्वास्थ्य सहायता लिनुहोस्।",
        )
    if (
        PERSONAL.search(payload.question)
        or INJECTION.search(payload.question)
        or DECISION.search(payload.question)
    ):
        notice = (
            (
                "यो निर्णय चिकित्सक वा फार्मासिस्टसँग गर्नुहोस्। यस सेवाले रोग "
                "निदान वा व्यक्तिगत औषधिको मात्रा छान्दैन।"
            )
            if ne
            else (
                "Ask your clinician or pharmacist about this decision. "
                "This reader does not diagnose or choose, change or confirm a personal dose."
            )
        )
        return DocumentExplainResult(
            **base,
            status="professional_review",
            notice=notice,
            speech_text_ne=(
                "यो निर्णय चिकित्सक वा फार्मासिस्टसँग गर्नुहोस्। व्यक्तिगत औषधिको मात्रा यस सेवाले छान्दैन।"
            ),
        )
    all_lines = document_lines(payload.text)
    known = {line.id: line.text for line in all_lines}
    if not set(payload.focus_line_ids) <= set(known):
        raise HTTPException(422, "unknown_document_line")
    literal = literal_question_matches(payload.question, all_lines)
    focus = payload.focus_line_ids
    if not focus and re.search(r"\b(?:that|this) line\b|त्यो हरफ|त्यो लाइन", payload.question, re.I):
        if payload.previous_turns and len(payload.previous_turns[-1].answer_line_ids) == 1:
            focus = payload.previous_turns[-1].answer_line_ids
            if not set(focus) <= set(known):
                raise HTTPException(422, "stale_document_references")
    reused = context_matches(
        context, payload.text, payload.kind, context.reviewed_revision if context else 0
    )
    if not reused:
        context = build_context(payload.text, payload.kind)
    lines = retrieve(
        context, all_lines, payload.question, payload.previous_turns, focus or literal or []
    )
    retrieval = DocumentRetrieval(
        method="bm25" if payload.question.strip() else "full_document",
        line_ids=[line.id for line in lines],
        total_lines=len(all_lines),
        context_reused=reused,
        truncated=len(lines) < len(all_lines),
    )
    if not lines:
        return DocumentExplainResult(
            **base,
            status="no_match",
            notice="मिल्दो अंश भेटिएन। हरफ छान्नुहोस् वा प्रश्न फेरि लेख्नुहोस्।"
            if ne
            else "No matching passage was retrieved. Select a line or rephrase the question.",
            speech_text_ne="मिल्दो अंश भेटिएन। हरफ छान्नुहोस् वा प्रश्न फेरि लेख्नुहोस्।",
            retrieval=retrieval,
        )
    meanings, highlighted, model_answers = {}, set(), []
    identity = None
    try:
        for batch in batches(lines):
            batch_ids = {line.id for line in batch}
            previous = [
                turn.model_copy(
                    update={
                        "answer_line_ids": [i for i in turn.answer_line_ids if i in batch_ids],
                        "answer_excerpt": turn.answer_excerpt[:300],
                        "answer_excerpt_truncated": turn.answer_excerpt_truncated
                        or len(turn.answer_excerpt) > 300,
                    }
                )
                for turn in payload.previous_turns[-3:]
                if batch_ids.intersection(turn.answer_line_ids)
            ]
            request = DocumentSelectionRequest(
                user_context=payload.user_context,
                kind=payload.kind,
                question=payload.question,
                lines=batch,
                language=payload.language,
                model_profile=payload.model_profile,
                previous_turns=previous,
                focus_line_ids=[i for i in focus if i in batch_ids],
            )
            result = await provider.select_document(request)
            result.selection.validate_ids(batch)
            if identity is not None and identity != (result.model, result.revision):
                raise ValueError("Document model changed between passages")
            identity = result.model, result.revision
            meanings.update(
                (item.line_id, item.meaning) for item in result.selection.highlights if item.meaning
            )
            highlighted.update(item.line_id for item in result.selection.highlights)
            model_answers.extend(result.selection.answer_line_ids)
    except (ProviderUnavailable, ValueError):
        raise HTTPException(503, "document_reader_unavailable_or_invalid") from None
    selected_ids = highlighted
    selected_ids.update(line.id for line in lines if not ADMIN.search(line.text))
    answer_ids = literal if literal is not None else list(dict.fromkeys(model_answers))[:3]
    if focus:
        answer_ids = focus
    if not payload.question.strip():
        answer_ids = []
    selected_ids.update(answer_ids)
    items = []
    for line in lines:
        if line.id not in selected_ids:
            continue
        kind = line_kind(line.text)
        spoken = MEANINGS[kind][1]
        for definition in definitions(line.text, "ne"):
            if len(spoken + " " + definition.meaning) <= 300:
                spoken += " " + definition.meaning
        items.append(
            DocumentItem(
                line_id=line.id,
                quote=known[line.id],
                kind=kind,
                meaning=meanings.get(line.id) or MEANINGS[kind][int(ne)],
                definitions=definitions(line.text, payload.language),
                check_with_professional=kind in {"medicine", "instruction", "finding"}
                or bool(AMBIGUOUS.search(line.text)),
                speech_text_ne=spoken,
            )
        )
    no_match = bool(payload.question.strip()) and not answer_ids
    notice = (
        (
            "कागजातमा यो प्रश्नको स्पष्ट उत्तर भेटिएन। चिकित्सकसँग सोध्नुहोस्।"
            if ne
            else (
                "No clear answer to this question was found in the supplied document. "
                "Ask its author."
            )
        )
        if no_match
        else (
            ("यो पढ्ने सहायक मस्यौदा हो। उद्धरण मूल पाठसँग जाँच्नुहोस्; नतिजा र मात्रा पुष्टि भएका छैनन्।")
            if ne
            else (
                "A reading guide, with exact document quotes. Check them against the original; "
                "results and doses are not clinically verified."
            )
        )
    )
    speech = "यो कागजात पढ्ने सहायक मस्यौदा हो। औषधिको मात्रा र नतिजा चिकित्सकसँग पुष्टि गर्नुहोस्।"
    return DocumentExplainResult(
        status="no_match" if no_match else "draft",
        notice=notice,
        items=items,
        answer_line_ids=answer_ids,
        document_sha256=revision,
        model=result.model,
        revision=result.revision,
        speech_text_ne=speech,
        retrieval=retrieval,
        question_method=("literal_document_match" if literal is not None else "model_selection")
        if payload.question.strip()
        else "none",
    )


def document_router(store, sessions, provider, limits):
    router = APIRouter(prefix="/api/v1/documents", tags=["Document reading"])
    bearer = HTTPBearer(auto_error=False)

    def owner(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        return sessions.verify(credentials.credentials if credentials else None)

    @router.post("/explain", response_model=DocumentExplainResult)
    async def read(
        payload: DocumentExplainRequest,
        request: Request,
        response: Response,
        owner_id=Depends(owner),
    ):
        purpose = "document_explanation"
        if not store.consent_valid(payload.consent_id, owner_id, purpose):
            raise HTTPException(403, "document_consent_required")
        limits.check(purpose + ":" + owner_id, 8)
        task = asyncio.create_task(explain(payload, provider))
        try:
            async with asyncio.timeout(160):
                while not task.done():
                    await asyncio.wait({task}, timeout=0.25)
                    if await request.is_disconnected():
                        raise HTTPException(499, "document_request_cancelled")
                result = await task
        except TimeoutError:
            raise HTTPException(504, "document_reader_timeout") from None
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if not store.consent_valid(payload.consent_id, owner_id, purpose):
            raise HTTPException(403, "document_consent_expired_or_revoked")
        response.headers["Cache-Control"] = "no-store"
        return result

    return router
