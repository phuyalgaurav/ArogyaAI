import pytest

from arogya_api.health import references


@pytest.mark.parametrize("language", ["en", "ne"])
def test_public_education_works_with_empty_reviewed_catalog(backend, language):
    client, store, inference, headers, _, payload = backend
    with store.connect() as db:
        db.execute("DELETE FROM sources")
    question = references.questions(language)[0]
    payload.update(message=question.question, language=language)
    result = client.post("/api/v1/chat", headers=headers, json=payload)
    assert result.status_code == 200, result.text
    value = result.json()
    assert value["status"] == "answered"
    assert value["language"] == language
    assert value["safety"]["rule_ids"] == ["public_source_education"]
    assert value["evidence"][0]["source_id"] == question.source_id
    source = client.get("/api/v1/knowledge/sources/" + question.source_id).json()
    assert source["review_status"] == "public_reference"
    assert source["reviewed_by"] is None and source["reviewed_at"] is None
    assert "nhs.uk" in source["source_url"]
    assert value["answer"] in [
        text for section in source["sections"] for text in section["sentences"]
    ]
    assert store.manifest()["sources"] == []
    assert inference.calls == ["classify", "generate"]


def test_suggestions_include_public_topics_without_claiming_review(backend):
    client, store, *_ = backend
    questions = client.get(
        "/api/v1/knowledge/questions?language=en&limit=100&include_public=true"
    ).json()
    assert any(q["source_id"] == "public-fever-en" for q in questions)
    assert any(q["source_id"] == "synthetic-symbol" for q in questions)
    assert client.get("/api/v1/knowledge/questions?language=tam").json() == []
    source = references.source_get("public-fever-en")
    assert not store.source_eligible(source)
    assert client.get("/api/v1/knowledge/manifest").json()["public_education_sources"]
    assert len({q.source_id for q in references.questions("en")[:5]}) == 5


def test_public_topics_do_not_enable_personal_doses_or_unknown_medicine(backend):
    client, _, inference, headers, _, payload = backend
    payload["message"] = "Should I take antibiotics for my fever?"
    result = client.post("/api/v1/chat", headers=headers, json=payload).json()
    assert result["status"] == "needs_professional_review" and inference.calls == []
    payload.update(message="What are antibiotics?", medicine_id="unknown")
    result = client.post("/api/v1/chat", headers=headers, json=payload).json()
    assert result["safety"]["rule_ids"] == ["unknown_medicine"]


def test_invalid_public_evidence_selection_is_rejected(backend):
    client, _, inference, headers, _, payload = backend
    payload["message"] = "What is a fever?"
    inference.ids = ["invented"]
    assert (
        client.post("/api/v1/chat", headers=headers, json=payload).json()["status"]
        == "needs_professional_review"
    )


def test_saved_context_requires_permission_for_direct_chat(backend):
    client, _, _, headers, _, payload = backend
    payload.update(message="What is a fever?", user_context="User says they prefer Nepali.")
    assert client.post("/api/v1/chat", headers=headers, json=payload).status_code == 422
    payload["include_user_context"] = True
    assert client.post("/api/v1/chat", headers=headers, json=payload).json()["status"] == "answered"
