import concurrent.futures
import hashlib
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from arogya_api.core.settings import Settings
from arogya_api.history.models import HistoryConversation
from arogya_api.history.store import HistoryStore
from arogya_api.main import create_app

KEY = "history_" + "a" * 64
TIME = "2026-10-10T00:00:00Z"


def conversation(identifier=None, message_id=None, text="Synthetic blue triangle"):
    return {
        "id": identifier or uuid.uuid4().hex,
        "title": "Synthetic history fixture",
        "language": "en",
        "created_at": TIME,
        "updated_at": TIME,
        "messages": [
            {
                "id": message_id or uuid.uuid4().hex,
                "sender": "user",
                "text": text,
                "timestamp": TIME,
            }
        ],
    }


def test_history_requires_separate_explicit_permission_and_durable_key(tmp_path):
    settings = Settings(database_path=tmp_path / "metadata.db")
    app = create_app(settings)
    with TestClient(app) as client:
        session = client.post("/api/v1/session").json()["access_token"]
        auth = {"Authorization": "Bearer " + session}
        grant = {"allow_server_storage": True, "client_access_token": KEY}
        assert client.post("/api/v1/history/vault", json=grant).status_code == 401
        bad = client.post(
            "/api/v1/history/vault", headers=auth, json={**grant, "allow_server_storage": False}
        )
        assert bad.status_code == 422 and KEY not in bad.text
        response = client.post("/api/v1/history/vault", headers=auth, json=grant)
        assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
        expiry = response.json()["expires_at"]
        assert (
            client.post("/api/v1/history/vault", headers=auth, json=grant).json()["expires_at"]
            == expiry
        )
        assert client.get("/api/v1/history/conversations", headers=auth).status_code == 401
        history_auth = {"Authorization": "Bearer " + KEY}
        value = conversation()
        path = "/api/v1/history/conversations/" + value["id"]
        assert client.put(path, headers=history_auth, json=value).status_code == 200
        with app.state.store.connect() as db:
            assert "Synthetic blue triangle" not in "\n".join(db.iterdump())
        client.delete("/api/v1/session", headers=auth)
        assert (
            len(
                client.get("/api/v1/history/conversations", headers=history_auth).json()[
                    "conversations"
                ]
            )
            == 1
        )
    # A server restart/signing-key change must not invalidate separately granted history.
    with TestClient(create_app(Settings(database_path=settings.database_path))) as client:
        assert client.get("/api/v1/history/conversations", headers=history_auth).status_code == 200
        assert client.delete("/api/v1/history/vault", headers=history_auth).status_code == 204
        assert client.get("/api/v1/history/conversations", headers=history_auth).status_code == 401
    data = app.state.history.path.read_bytes()
    assert KEY.encode() not in data and b"Synthetic blue triangle" not in data


def test_history_owners_are_isolated_and_deletions_cannot_be_resurrected(tmp_path):
    store = HistoryStore(tmp_path / "chat.sqlite")
    store.enroll(KEY)
    other = "history_" + "b" * 64
    store.enroll(other)
    owner, foreign = store.owner(KEY), store.owner(other)
    value = HistoryConversation.model_validate(conversation())
    store.put(owner, value)
    assert store.index(foreign).conversations == []
    store.delete_conversation(foreign, value.id)
    assert len(store.index(owner).conversations) == 1
    store.delete_conversation(owner, value.id)
    store.delete_conversation(owner, value.id)
    with pytest.raises(HTTPException) as deleted:
        store.put(owner, value)
    assert deleted.value.status_code == 410
    assert store.index(owner).deleted_ids == [value.id]
    assert store.path.stat().st_mode & 0o777 == 0o600
    with store.connect() as db:
        dump = "\n".join(db.iterdump())
        assert KEY not in dump and "Synthetic blue triangle" not in dump
        db.execute("UPDATE history_vaults SET expires=0")
    with pytest.raises(HTTPException) as expired:
        store.owner(KEY)
    assert expired.value.status_code == 401
    with store.connect() as db:
        assert db.execute("SELECT count(*) FROM history_deleted").fetchone()[0] == 0


def test_parallel_message_deltas_merge_without_overwriting_and_ids_are_immutable(tmp_path):
    store = HistoryStore(tmp_path / "chat.sqlite")
    store.enroll(KEY)
    owner = store.owner(KEY)
    identifier = uuid.uuid4().hex
    values = [
        HistoryConversation.model_validate(conversation(identifier, text=f"Synthetic {i}"))
        for i in range(12)
    ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda item: store.put(owner, item), values))
    saved = store.index(owner).conversations[0]
    assert len(saved.messages) == 12
    assert {message.text for message in saved.messages} == {f"Synthetic {i}" for i in range(12)}
    changed = values[0].model_copy(deep=True)
    changed.messages[0].text = "changed"
    with pytest.raises(HTTPException) as conflict:
        store.put(owner, changed)
    assert conflict.value.status_code == 409
    assert store.index(owner).conversations[0] == saved
    assert hashlib.sha256(KEY.encode()).hexdigest() in store.path.read_bytes().decode(
        errors="ignore"
    )


def test_history_message_limits_and_http_body_do_not_echo_private_data(tmp_path):
    app = create_app(Settings(database_path=tmp_path / "metadata.db"))
    app.state.history.enroll(KEY)
    with TestClient(app) as client:
        auth = {"Authorization": "Bearer " + KEY}
        value = conversation(text="PRIVATE" * 400)
        path = "/api/v1/history/conversations/" + value["id"]
        result = client.put(path, headers=auth, json=value)
        assert result.status_code == 422 and "PRIVATE" not in result.text
        assert client.put(path, headers=auth, content=b"x" * 1000001).status_code == 413
        assert app.state.history.index(app.state.history.owner(KEY)).conversations == []
