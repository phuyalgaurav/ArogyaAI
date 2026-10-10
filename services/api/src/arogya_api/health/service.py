import hashlib
import json

from fastapi import HTTPException

from arogya_api.core.contracts import ArogyaResponse, Evidence, Provenance, Safety
from arogya_api.core.safety import POLICY_VERSION, precheck, rule_intent
from arogya_api.health import references
from arogya_api.inference.errors import ProviderUnavailable
from arogya_api.inference.models import GenerateRequest
from arogya_api.knowledge.store import normalized_question


def response(
    request,
    status,
    answer,
    rule,
    *,
    evidence=None,
    model=None,
    digest=None,
    router="rules",
    router_intent=None,
    router_revision=None,
    routing_disagreement=False,
    knowledge_version="none",
):
    return ArogyaResponse(
        request_id=request.request_id,
        language=request.language if status == "answered" else "en",
        status=status,
        answer=answer,
        evidence=evidence or [],
        safety=Safety(rule_ids=[rule], abstained=status != "answered"),
        provenance=Provenance(
            mode="server" if model else "static",
            model=model,
            model_revision=digest,
            router=router,
            router_intent=router_intent,
            router_revision=router_revision,
            routing_disagreement=routing_disagreement,
            policy_version=POLICY_VERSION,
            knowledge_version=knowledge_version,
        ),
    )


async def answer(request, owner, store, inference):
    blocked = precheck(request.message)
    if blocked:
        status, rule, text = blocked
        return response(request, status, text, rule)
    if request.preferred_mode == "local":
        return response(
            request,
            "unavailable",
            "This endpoint handles server processing. Local mode belongs to the browser.",
            "local_only_requested",
        )
    if not store.consent_valid(request.server_processing_consent_id, owner):
        raise HTTPException(403, "server_processing_consent_required")
    if request.language == "tam":
        return response(
            request,
            "unavailable",
            "Reviewed Tamang translation is not available yet. No translation or "
            "inference provider was called.",
            "translation_unavailable",
        )
    intent_rule = rule_intent(request.message)
    source_ids = None
    if request.medicine_id:
        medicine = store.medicine_get(request.medicine_id)
        if not medicine:
            return response(
                request,
                "needs_clarification",
                "This medicine has no current reviewed catalog entry. Ask a "
                "pharmacist to verify its identity.",
                "unknown_medicine",
            )
        source_ids = medicine.source_ids
    sentences = store.retrieve(request.message, request.language, source_ids)
    public_reference = False
    if not sentences and not request.medicine_id:
        sentences = references.retrieve(request.message, request.language)
        public_reference = bool(sentences)
    if not sentences:
        if intent_rule == "document_scan":
            return response(
                request, "unavailable", "Prescription processing is not enabled.", "ocr_unavailable"
            )
        if not store.questions(request.language, 1):
            text = (
                "यो प्रश्नको उत्तर दिने स्रोत अहिले उपलब्ध छैन। "
                "ज्वरो, निर्जलीकरण, स्वस्थ आहार, व्यायाम वा एन्टिबायोटिकबारे सामान्य प्रश्न सोध्नुहोस्।"
                if request.language == "ne"
                else "I don't have a source-backed answer to this question yet. "
                "Try a general question about fever, dehydration, healthy eating, physical "
                "activity or antibiotics, or ask a health professional for individual advice."
            )
            result = response(request, "unavailable", text, "no_matching_health_reference")
            result.language = request.language
            return result
        if intent_rule == "medicine_info" and not request.medicine_id:
            return response(
                request,
                "needs_clarification",
                "Choose an exact-match catalog candidate and ask a professional "
                "to verify its identity.",
                "medicine_identity_required",
            )
        return response(
            request,
            "needs_clarification",
            "I couldn't select a single reviewed reference for this question. "
            "Browse the reviewed questions and sources in the Library.",
            "no_approved_evidence",
        )
    task = sentences[0].task
    if task == "medicine_info" and not request.medicine_id:
        return response(
            request,
            "needs_clarification",
            "Choose a medicine from the exact-match catalog before requesting "
            "medicine-specific information.",
            "medicine_identity_required",
        )
    intent = await inference.classify(request.message, request.language)
    routing = {
        "router": intent.provider,
        "router_intent": intent.intent,
        "router_revision": intent.model_revision,
        "routing_disagreement": intent.intent != task,
    }
    if not store.consent_valid(request.server_processing_consent_id, owner):
        raise HTTPException(403, "consent_expired_or_revoked")
    try:
        result = await inference.generate(
            GenerateRequest(
                message=request.message,
                language=request.language,
                sentences=sentences,
                user_context=request.user_context,
                model_profile=request.model_profile,
            )
        )
    except ProviderUnavailable:
        return response(
            request,
            "unavailable",
            "The inference provider is unavailable. Your question was not saved.",
            "provider_unavailable",
            **routing,
        )
    if not store.consent_valid(request.server_processing_consent_id, owner):
        raise HTTPException(403, "consent_expired_or_revoked")
    selection = result.selection
    known = {sentence.id: sentence for sentence in sentences}
    if not selection.relevant or not selection.sentence_ids:
        return response(
            request,
            "needs_clarification",
            "The available evidence does not directly answer the question. Please clarify it.",
            "evidence_not_relevant",
            **routing,
        )
    if len(set(selection.sentence_ids)) != len(selection.sentence_ids) or not set(
        selection.sentence_ids
    ) <= set(known):
        return response(
            request,
            "needs_professional_review",
            "The model result could not be verified against the supplied evidence.",
            "unsupported_model_selection",
            **routing,
        )
    chosen = [known[sentence_id] for sentence_id in selection.sentence_ids]
    current = store.retrieve(request.message, request.language, source_ids)
    if public_reference:
        current = references.retrieve(request.message, request.language)
    eligible_now = {(s.source_id, s.version, s.section_id, s.text) for s in current}
    if any((s.source_id, s.version, s.section_id, s.text) not in eligible_now for s in chosen):
        return response(
            request,
            "unavailable",
            "The evidence scope changed during processing.",
            "source_no_longer_valid",
            **routing,
        )
    for sentence in chosen:
        source = (
            references.source_get(sentence.source_id)
            if public_reference
            else store.source_get(sentence.source_id)
        )
        if (
            not (source if public_reference else store.source_eligible(source, request.language))
            or source.version != sentence.version
        ):
            return response(
                request,
                "unavailable",
                "A source changed or expired during processing. Please retry after source review.",
                "source_no_longer_valid",
            )
        if not any(
            s.id == sentence.section_id
            and s.kind != "dosing"
            and sentence.text in s.sentences
            and any(
                normalized_question(request.message) == normalized_question(q) for q in s.questions
            )
            for s in source.sections
        ):
            return response(
                request,
                "unavailable",
                "The source sentence is no longer eligible for an answer.",
                "source_content_changed",
            )
    evidence = list(
        {
            (s.source_id, s.section_id, s.version): Evidence(
                source_id=s.source_id, section_id=s.section_id, version=s.version
            )
            for s in chosen
        }.values()
    )
    version = hashlib.sha256(
        json.dumps([e.model_dump() for e in evidence], sort_keys=True).encode()
    ).hexdigest()[:16]
    return response(
        request,
        "answered",
        "\n\n".join(sentence.text for sentence in chosen),
        "public_source_education" if public_reference else "extractive_evidence_validated",
        evidence=evidence,
        model=result.model,
        digest=result.digest,
        **routing,
        knowledge_version=version,
    )
