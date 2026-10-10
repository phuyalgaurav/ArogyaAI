import json
from datetime import UTC, datetime, timedelta

import pytest
from conftest import FakeInference
from fastapi.testclient import TestClient
from pydantic import ValidationError

from arogya_api.cli.setup_operator import prepare
from arogya_api.core.settings import Settings
from arogya_api.knowledge.models import KnowledgeSource
from arogya_api.main import create_app


def test_independent_reviews_required_before_public_activation(governed):
    client, app, source, call, activate, *_ = governed
    result = call("/sources", source)
    digest = result.json()["content_hash"]
    path = "/sources/synthetic-symbol/test-1"
    assert (
        call(
            path + "/activate",
            {"expected_hash": digest, "reason": "Must not skip either review."},
            "admin",
        ).status_code
        == 409
    )
    assert client.get("/api/v1/knowledge/questions").json() == []
    activate()
    assert len(client.get("/api/v1/knowledge/questions").json()) == 1
    events = call("/audit", who="admin", method="get").json()
    assert [e["event"] for e in events] == ["submitted", "reviewed", "reviewed", "activated"]
    assert len({e["event_hash"] for e in events}) == 4


@pytest.mark.parametrize("who", ["editor", "admin", "license"])
def test_wrong_role_cannot_approve_clinical_content(governed, who):
    _, _, source, call, *_ = governed
    digest = call("/sources", source).json()["content_hash"]
    result = call(
        "/sources/synthetic-symbol/test-1/reviews",
        {
            "kind": "clinical",
            "decision": "approve",
            "expected_hash": digest,
            "reason": "Attempt wrong role for synthetic content.",
        },
        who,
    )
    assert result.status_code == 403


def test_author_cannot_approve_own_revision(governed):
    _, _, source, call, *_ = governed
    digest = call("/sources", source, "self-reviewer").json()["content_hash"]
    result = call(
        "/sources/synthetic-symbol/test-1/reviews",
        {
            "kind": "clinical",
            "decision": "approve",
            "expected_hash": digest,
            "reason": "Self review must be refused by the workflow.",
        },
        "self-reviewer",
    )
    assert result.status_code == 403


def test_revision_is_immutable_and_repeated_submit_is_idempotent(governed):
    _, _, source, call, *_ = governed
    first = call("/sources", source).json()
    assert call("/sources", source).json()["content_hash"] == first["content_hash"]
    source["title"] = "A changed title also requires a new version"
    assert call("/sources", source).status_code == 409
    assert len(call("/audit", who="admin", method="get").json()) == 1


def test_spoofed_approval_metadata_and_stale_hashes_are_rejected(governed):
    _, _, source, call, *_ = governed
    assert call("/sources", {**source, "reviewed_by": "ForgedReviewer"}).status_code == 422
    call("/sources", source)
    assert (
        call(
            "/sources/synthetic-symbol/test-1/reviews",
            {
                "kind": "clinical",
                "decision": "approve",
                "expected_hash": "f" * 64,
                "reason": "Cannot review an unexpected content hash.",
            },
            "clinical",
        ).status_code
        == 409
    )


def test_license_review_requires_rights_evidence(governed):
    _, _, source, call, *_ = governed
    digest = call("/sources", source).json()["content_hash"]
    assert (
        call(
            "/sources/synthetic-symbol/test-1/reviews",
            {
                "kind": "license",
                "decision": "approve",
                "expected_hash": digest,
                "reason": "Approval without a license evidence link.",
            },
            "license",
        ).status_code
        == 422
    )


def test_withdrawal_removes_public_sources(governed):
    client, app, source, call, activate, *_ = governed
    revision = activate()
    path = "/sources/synthetic-symbol/test-1/withdraw"
    assert (
        call(
            path,
            {
                "expected_hash": revision["content_hash"],
                "reason": "Withdraw the synthetic test reference.",
            },
            "license",
        ).status_code
        == 200
    )
    assert client.get("/api/v1/knowledge/questions").json() == []
    assert client.get("/api/v1/knowledge/sources/synthetic-symbol").status_code == 404
    with pytest.raises(ValueError):
        app.state.store.source_put(KnowledgeSource.model_validate(source))


def test_conflict_resolution_is_bound_to_current_candidate_versions(governed):
    client, app, source, call, activate, *_ = governed
    activate()
    activate("second-symbol")
    question = "What is the blue triangle?"
    assert app.state.store.retrieve(question, "en") == []
    lookup = {"question": question, "language": "en"}
    conflict = call("/questions/conflict", lookup).json()
    result = call(
        "/questions/resolve",
        {
            **lookup,
            "expected_snapshot": conflict["snapshot_hash"],
            "selected": conflict["candidates"][0],
            "reason": "Select the reviewed test authority.",
        },
        "clinical",
    )
    assert result.status_code == 200, result.text
    assert len(app.state.store.retrieve(question, "en")) == 1
    activate("third-symbol")
    assert app.state.store.retrieve(question, "en") == []


@pytest.mark.parametrize("target", ["audit", "source", "revision"])
def test_tampering_disables_approved_content(governed, target):
    client, app, source, call, activate, *_ = governed
    activate()
    with app.state.store.connect() as db:
        if target == "audit":
            db.execute("UPDATE knowledge_audit SET payload='{}' WHERE sequence=1")
        else:
            table, key = (
                ("sources", "id") if target == "source" else ("source_revisions", "source_id")
            )
            row = db.execute(
                f"SELECT payload FROM {table} WHERE {key}=?", (source["source_id"],)
            ).fetchone()
            payload = json.loads(row["payload"])
            payload["title"] = "Tampered synthetic title"
            db.execute(
                f"UPDATE {table} SET payload=? WHERE {key}=?",
                (json.dumps(payload), source["source_id"]),
            )
    assert client.get("/api/v1/knowledge/questions").json() == []
    if target == "audit":
        assert call("/audit", who="admin", method="get").status_code == 503


def test_operator_credentials_can_be_disabled_or_expired(governed):
    client, app, source, call, activate, settings, registry = governed
    assert client.get("/api/v1/operator/me").status_code == 401
    assert "token_sha256" not in call("/me", method="get").text
    data = json.loads(registry.read_text())
    data[0]["enabled"] = False
    registry.write_text(json.dumps(data))
    assert call("/me", method="get").status_code == 401
    data[0]["enabled"] = True
    data[0]["expires_at"] = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
    registry.write_text(json.dumps(data))
    assert call("/me", method="get").status_code == 401


def test_session_key_rotation_does_not_break_separate_source_audit_key(governed):
    _, _, source, call, activate, settings, _ = governed
    activate()
    changed = settings.model_copy(update={"signing_key": Settings().signing_key})
    with TestClient(create_app(changed, FakeInference())) as client:
        assert len(client.get("/api/v1/knowledge/questions").json()) == 1


def test_local_setup_does_not_create_fake_reviewers_and_preserves_keys(tmp_path):
    registry, token = prepare(tmp_path)
    identities = json.loads(registry.read_text())
    assert identities[0]["roles"] == ["administrator", "content_editor"]
    before = token.read_bytes()
    key = (tmp_path / ".local/knowledge-signing.key").read_bytes()
    prepare(tmp_path)
    assert token.read_bytes() == before
    assert (tmp_path / ".local/knowledge-signing.key").read_bytes() == key
    import os

    if os.name != "nt":
        assert token.stat().st_mode & 0o777 == 0o600


def test_production_operator_configuration_requires_a_separate_audit_key(tmp_path):
    with pytest.raises(ValidationError):
        Settings(mode="production", operator_registry_path=tmp_path / "operators.json")


def test_unaudited_legacy_approval_is_preserved_but_not_eligible(governed):
    client, app, source, *_ = governed
    legacy = KnowledgeSource.model_validate(
        {
            **source,
            "review_status": "approved",
            "reviewed_by": "legacy-test-assertion",
            "reviewed_at": datetime.now(UTC),
        }
    )
    with app.state.store.connect() as db:
        app.state.store.write_source(db, legacy)
        db.execute("UPDATE schema_version SET version=2")
    from arogya_api.knowledge.governance import Governance
    from arogya_api.knowledge.store import Store

    store = Store(app.state.store.path)
    Governance(store, "a" * 64)
    assert store.source_get(legacy.source_id) is not None
    assert not store.source_eligible(store.source_get(legacy.source_id))
    with store.connect() as db:
        assert db.execute("SELECT version FROM schema_version").fetchone()[0] == 5


def test_review_reason_cannot_be_empty_whitespace(governed):
    _, _, source, call, *_ = governed
    digest = call("/sources", source).json()["content_hash"]
    assert (
        call(
            "/sources/synthetic-symbol/test-1/reviews",
            {
                "kind": "clinical",
                "decision": "approve",
                "expected_hash": digest,
                "reason": " " * 40,
            },
            "clinical",
        ).status_code
        == 422
    )


def test_public_source_urls_cannot_embed_credentials(governed):
    _, _, source, call, *_ = governed
    source["source_url"] = "https://user:secret@example.invalid/source"
    assert call("/sources", source).status_code == 422
