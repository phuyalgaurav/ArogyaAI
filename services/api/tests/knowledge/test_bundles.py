import json
from datetime import UTC, datetime, timedelta

import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from arogya_api.knowledge.bundle_models import BundleManifest
from arogya_api.knowledge.bundles import verify_bundle


@pytest.fixture
def bundle_backend(governed, tmp_path):
    key = Ed25519PrivateKey.generate()
    path = tmp_path / "signing.key"
    path.write_bytes(key.private_bytes_raw())
    governed[1].state.bundles.key_path = path
    return governed, key


def publish(bundle_backend):
    governed, key = bundle_backend
    client, app, source, call, activate, *_ = governed
    activate()
    result = call("/bundles", {"language": "en"}, "admin")
    assert result.status_code == 201, result.text
    manifest = BundleManifest.model_validate(result.json())
    payload = client.get(f"/api/v1/knowledge/bundles/{manifest.id}")
    assert payload.status_code == 200, payload.text
    return manifest, payload.content


def test_signed_bundle_can_be_verified_with_pinned_key(bundle_backend):
    manifest, payload = publish(bundle_backend)
    governed, key = bundle_backend
    contents = verify_bundle(manifest, payload, key.public_key().public_bytes_raw())
    assert contents.sources[0].sections[0].sentences == [
        "The blue triangle is a fictional test symbol."
    ]
    assert contents.questions[0].source_id == "synthetic-symbol"
    index = governed[0].get("/api/v1/knowledge/manifest").json()
    assert index["offline_bundle_available"] is True
    assert index["signed"] is False  # The discovery index is not the signed manifest.
    assert index["bundles"][0]["id"] == manifest.id
    assert (
        governed[0].get(f"/api/v1/knowledge/bundles/{manifest.id}/manifest").json()["signature"]
        == manifest.signature
    )


@pytest.mark.parametrize("change", ["payload", "signature", "wrong_key", "manifest", "expiry"])
def test_bundle_verification_rejects_tampering_and_expiry(bundle_backend, change):
    manifest, payload = publish(bundle_backend)
    _, key = bundle_backend
    public = key.public_key().public_bytes_raw()
    now = datetime.now(UTC)
    if change == "payload":
        payload += b" "
    elif change == "signature":
        manifest.signature = "a" * 88
    elif change == "wrong_key":
        public = Ed25519PrivateKey.generate().public_key().public_bytes_raw()
    elif change == "manifest":
        manifest.policy_version = "invented-policy"
    else:
        now += timedelta(hours=2)
    with pytest.raises((ValueError, InvalidSignature)):
        verify_bundle(manifest, payload, public, now)


def test_withdrawal_removes_online_bundle_and_bounds_offline_staleness(bundle_backend):
    manifest, payload = publish(bundle_backend)
    governed, key = bundle_backend
    client, app, source, call, *_ = governed
    revision = call("/sources/synthetic-symbol/test-1", method="get").json()
    assert (
        call(
            "/sources/synthetic-symbol/test-1/withdraw",
            {
                "expected_hash": revision["content_hash"],
                "reason": "Withdraw this non-medical test source.",
            },
            "clinical",
        ).status_code
        == 200
    )
    assert client.get(f"/api/v1/knowledge/bundles/{manifest.id}").status_code == 404
    assert client.get("/api/v1/knowledge/manifest").json()["bundles"] == []
    # An offline client cannot learn a new withdrawal without reconnecting.
    verify_bundle(manifest, payload, key.public_key().public_bytes_raw())
    with pytest.raises(ValueError):
        verify_bundle(manifest, payload, key.public_key().public_bytes_raw(), manifest.valid_until)


def test_publishing_requires_redistribution_rights(bundle_backend):
    governed, _ = bundle_backend
    client, app, source, call, activate, *_ = governed
    activate(redistribute=False)
    assert call("/bundles", {"language": "en"}, "admin").status_code == 409


def test_publishing_requires_admin_and_approved_content(bundle_backend):
    governed, _ = bundle_backend
    call = governed[3]
    assert call("/bundles", {"language": "en"}, "editor").status_code == 403
    assert call("/bundles", {"language": "en"}, "admin").status_code == 409


def test_new_conflicting_nonredistributable_source_invalidates_bundle(bundle_backend):
    manifest, _ = publish(bundle_backend)
    governed, _ = bundle_backend
    client, app, source, call, activate, *_ = governed
    activate("another-symbol", redistribute=False)
    assert client.get(f"/api/v1/knowledge/bundles/{manifest.id}").status_code == 404
    newer = call("/bundles", {"language": "en"}, "admin").json()
    payload = client.get(f"/api/v1/knowledge/bundles/{newer['id']}").json()
    assert payload["questions"] == []


def test_dosing_sections_never_enter_bundle(bundle_backend):
    governed, _ = bundle_backend
    governed[2]["sections"].append(
        {
            "id": "dosing",
            "kind": "dosing",
            "sentences": ["Synthetic dosage sentinel, not a real instruction."],
        }
    )
    manifest, payload = publish(bundle_backend)
    assert b"dosage sentinel" not in payload


def test_current_bundle_is_invalidated_by_new_source_revision(bundle_backend):
    manifest, _ = publish(bundle_backend)
    governed, _ = bundle_backend
    governed[4](version="test-2")
    assert governed[0].get(f"/api/v1/knowledge/bundles/{manifest.id}").status_code == 404


def test_corrupt_stored_bundle_is_not_served(bundle_backend):
    manifest, _ = publish(bundle_backend)
    governed, _ = bundle_backend
    with governed[1].state.store.connect() as db:
        db.execute("UPDATE knowledge_bundles SET payload=? WHERE id=?", (b"corrupted", manifest.id))
    assert governed[0].get(f"/api/v1/knowledge/bundles/{manifest.id}").status_code == 404


def test_editor_cannot_import_medicine_and_tampered_catalog_is_unavailable(bundle_backend):
    governed, _ = bundle_backend
    client, app, source, call, activate, *_ = governed
    activate()
    medicine = {
        "id": "synthetic-medicine",
        "canonical_name": "Fictional Test Medicine",
        "active_ingredients": ["non-medical-test-only"],
        "aliases": ["Test Symbol"],
        "jurisdiction": "synthetic",
        "source_ids": ["synthetic-symbol"],
    }
    data = {"medicine": medicine, "reason": "Review a non-medical synthetic catalog fixture."}
    assert call("/medicines", data, "editor").status_code == 403
    assert call("/medicines", data, "clinical").status_code == 201
    assert client.get("/api/v1/medicines/synthetic-medicine").status_code == 200
    with app.state.store.connect() as db:
        medicine["canonical_name"] = "Tampered"
        db.execute(
            "UPDATE medicines SET payload=? WHERE id=?", (json.dumps(medicine), medicine["id"])
        )
    assert client.get("/api/v1/medicines/synthetic-medicine").status_code == 404


def test_catalog_review_is_bound_to_source_revision_and_aliases(bundle_backend):
    governed, _ = bundle_backend
    client, app, source, call, activate, *_ = governed
    activate()
    medicine = {
        "id": "synthetic-medicine",
        "canonical_name": "Fictional Test Medicine",
        "active_ingredients": ["non-medical-test-only"],
        "aliases": ["Test Alias"],
        "jurisdiction": "synthetic",
        "source_ids": ["synthetic-symbol"],
    }
    data = {"medicine": medicine, "reason": "Review the non-medical synthetic catalog fixture."}
    assert call("/medicines", data, "clinical").status_code == 201
    with app.state.store.connect() as db:
        db.execute("INSERT INTO aliases VALUES (?, ?)", ("forged alias", medicine["id"]))
    assert (
        client.post("/api/v1/medicines/resolve", json={"query": "forged alias"}).json()[
            "candidates"
        ]
        == []
    )
    activate(version="test-2")
    assert client.get("/api/v1/medicines/synthetic-medicine").status_code == 404
    assert call("/medicines", data, "clinical").status_code == 201
    assert client.get("/api/v1/medicines/synthetic-medicine").status_code == 200
