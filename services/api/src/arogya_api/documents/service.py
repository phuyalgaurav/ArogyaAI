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
    DocumentLine,
    DocumentSelectionRequest,
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


async def explain(payload, provider):
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
    lines = [
        DocumentLine(id=f"L{i + 1}", text=line)
        for i, line in enumerate(line.strip() for line in payload.text.splitlines() if line.strip())
    ]
    if not set(payload.focus_line_ids) <= {line.id for line in lines}:
        raise HTTPException(422, "unknown_document_line")
    request = DocumentSelectionRequest(
        kind=payload.kind,
        question=payload.question,
        lines=lines,
        language=payload.language,
        model_profile=payload.model_profile,
        previous_turns=payload.previous_turns,
        focus_line_ids=payload.focus_line_ids,
    )
    try:
        result = await provider.select_document(request)
        result.selection.validate_ids(lines)
    except (ProviderUnavailable, ValueError):
        raise HTTPException(503, "document_reader_unavailable_or_invalid") from None
    known = {line.id: line.text for line in lines}
    meanings = {item.line_id: item.meaning for item in result.selection.highlights if item.meaning}
    selected_ids = {item.line_id for item in result.selection.highlights}
    selected_ids.update(line.id for line in lines if not ADMIN.search(line.text))
    literal = literal_question_matches(payload.question, lines)
    answer_ids = literal if literal is not None else result.selection.answer_line_ids
    if payload.focus_line_ids:
        answer_ids = payload.focus_line_ids
    elif re.search(r"\b(?:that|this) line\b|त्यो हरफ|त्यो लाइन", payload.question, re.I):
        if payload.previous_turns and len(payload.previous_turns[-1].answer_line_ids) == 1:
            answer_ids = payload.previous_turns[-1].answer_line_ids
            if not set(answer_ids) <= set(known):
                raise HTTPException(422, "stale_document_references")
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
