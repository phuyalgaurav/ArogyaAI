"""Separate opt-in SQLite history, with hashed access keys and immutable message IDs."""

import hashlib
import sqlite3
import time
from contextlib import contextmanager
from datetime import UTC, datetime

from fastapi import HTTPException

from arogya_api.history.models import HistoryConversation, HistoryIndex, HistoryVault


class HistoryStore:
    def __init__(self, path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS history_vaults(
                    key_hash TEXT PRIMARY KEY, expires REAL NOT NULL,
                    consent_at REAL NOT NULL, consent_policy TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS history_conversations(
                    owner TEXT NOT NULL REFERENCES history_vaults(key_hash) ON DELETE CASCADE,
                    id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(owner,id));
                CREATE TABLE IF NOT EXISTS history_deleted(
                    owner TEXT NOT NULL REFERENCES history_vaults(key_hash) ON DELETE CASCADE,
                    id TEXT NOT NULL, PRIMARY KEY(owner,id));
            """)
        path.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA secure_delete=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def purge_expired(self):
        with self.connect() as db:
            db.execute("DELETE FROM history_vaults WHERE expires<=?", (time.time(),))

    def enroll(self, token):
        self.purge_expired()
        expires = time.time() + 30 * 86400
        key = hashlib.sha256(token.encode()).hexdigest()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT expires FROM history_vaults WHERE key_hash=?", (key,)
            ).fetchone()
            if existing:
                expires = existing["expires"]
            db.execute(
                "INSERT OR IGNORE INTO history_vaults VALUES(?,?,?,?)",
                (
                    key,
                    expires,
                    time.time(),
                    "chat-storage-1",
                ),
            )
        return HistoryVault(access_token=token, expires_at=datetime.fromtimestamp(expires, UTC))

    def owner(self, token):
        self.purge_expired()
        if not token or len(token) != 72 or not token.startswith("history_"):
            raise HTTPException(401, "history_key_invalid_or_expired")
        key = hashlib.sha256(token.encode()).hexdigest()
        with self.connect() as db:
            if not db.execute("SELECT 1 FROM history_vaults WHERE key_hash=?", (key,)).fetchone():
                raise HTTPException(401, "history_key_invalid_or_expired")
        return key

    def require_active(self, db, owner):
        row = db.execute("SELECT expires FROM history_vaults WHERE key_hash=?", (owner,)).fetchone()
        if not row or row["expires"] <= time.time():
            raise HTTPException(401, "history_key_invalid_or_expired")
        return row["expires"]

    def index(self, owner):
        with self.connect() as db:
            expires = self.require_active(db, owner)
            rows = db.execute("SELECT payload FROM history_conversations WHERE owner=?", (owner,))
            conversations = [
                HistoryConversation.model_validate_json(row["payload"]) for row in rows
            ]
            deleted = [
                row["id"]
                for row in db.execute("SELECT id FROM history_deleted WHERE owner=?", (owner,))
            ]
        return HistoryIndex(
            conversations=conversations,
            deleted_ids=deleted,
            expires_at=datetime.fromtimestamp(expires, UTC),
        )

    def put(self, owner, incoming):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.require_active(db, owner)
            if db.execute(
                "SELECT 1 FROM history_deleted WHERE owner=? AND id=?", (owner, incoming.id)
            ).fetchone():
                raise HTTPException(410, "conversation_was_deleted")
            row = db.execute(
                "SELECT payload FROM history_conversations WHERE owner=? AND id=?",
                (owner, incoming.id),
            ).fetchone()
            if row:
                old = HistoryConversation.model_validate_json(row["payload"])
                messages = {message.id: message for message in old.messages}
                for message in incoming.messages:
                    if message.id in messages and messages[message.id] != message:
                        raise HTTPException(409, "saved_message_changed")
                    messages[message.id] = message
                if len(messages) > 100:
                    raise HTTPException(409, "conversation_message_limit")
                incoming = HistoryConversation(
                    **{
                        **old.model_dump(),
                        "updated_at": max(old.updated_at, incoming.updated_at),
                        "messages": sorted(
                            messages.values(), key=lambda message: (message.timestamp, message.id)
                        ),
                    }
                )
            else:
                count = db.execute(
                    "SELECT count(*) FROM history_conversations WHERE owner=?", (owner,)
                ).fetchone()[0]
                if count >= 50:
                    raise HTTPException(409, "conversation_count_limit")
            payload = incoming.model_dump_json()
            total = db.execute(
                "SELECT COALESCE(sum(length(CAST(payload AS BLOB))),0) "
                "FROM history_conversations WHERE owner=? AND id!=?",
                (owner, incoming.id),
            ).fetchone()[0]
            if total + len(payload.encode()) > 16000000:
                raise HTTPException(409, "history_storage_limit")
            db.execute(
                "INSERT INTO history_conversations VALUES(?,?,?) "
                "ON CONFLICT(owner,id) DO UPDATE SET payload=excluded.payload",
                (owner, incoming.id, payload),
            )
        return incoming

    def delete_conversation(self, owner, conversation_id):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.require_active(db, owner)
            count = db.execute(
                "SELECT count(*) FROM history_deleted WHERE owner=?", (owner,)
            ).fetchone()[0]
            existing = db.execute(
                "SELECT 1 FROM history_deleted WHERE owner=? AND id=?", (owner, conversation_id)
            ).fetchone()
            if count >= 1000 and not existing:
                raise HTTPException(409, "history_deletion_limit")
            db.execute(
                "DELETE FROM history_conversations WHERE owner=? AND id=?", (owner, conversation_id)
            )
            db.execute(
                "INSERT OR IGNORE INTO history_deleted VALUES(?,?)", (owner, conversation_id)
            )

    def revoke(self, owner):
        with self.connect() as db:
            db.execute("DELETE FROM history_vaults WHERE key_hash=?", (owner,))
