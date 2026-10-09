"""Bounded session memory and explicit opt-in history with optimistic revisions."""

import threading
from datetime import UTC, datetime

from fastapi import HTTPException

from arogya_api.conversations.models import (
    Conversation,
    ConversationIndex,
    ConversationSummary,
)


def fail(code, status=409, retryable=False):
    messages = {
        "processing_permission_required": "Allow the required processing permission, then retry.",
        "conversation_not_found": "This conversation is unavailable or has been deleted.",
        "stale_context": "The reviewed context changed. Refresh before continuing.",
        "stale_conversation": "The conversation changed during processing. Refresh and retry.",
        "conversation_busy": "Another operation is running in this conversation. Stop it or wait.",
        "transcription_review_required": "Compare and review the transcription before asking.",
        "medicine_identity_review_required": "Review and select the medicine identity first.",
        "medicine_not_supported_by_label": "The medicine does not match the reviewed label.",
        "unreadable_image": "No readable wording was found. Retake the photo or enter text.",
        "request_id_conflict": "This request identifier was already used for different input.",
        "document_text_limit_or_empty": "Use 1–40 nonempty lines, up to 500 characters per line.",
        "document_limit_exceeded": "The page exceeds the reader's limits. Submit smaller passages.",
        "speech_chunk_language_unsupported": "This passage cannot be spoken by the Nepali voice.",
        "stale_turn": "The context changed after this answer. Ask again before requesting speech.",
    }
    raise HTTPException(
        status,
        {
            "code": code,
            "retryable": retryable,
            "message": messages.get(code, code.replace("_", " ").capitalize() + "."),
        },
    )


class ConversationStore:
    def __init__(self, history, metadata):
        self.history = history
        self.metadata = metadata
        self.memory = {}
        self.lock = threading.RLock()
        with history.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS context_conversations(
                    owner TEXT NOT NULL REFERENCES history_vaults(key_hash) ON DELETE CASCADE,
                    id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL,
                    PRIMARY KEY(owner,id));
                CREATE TABLE IF NOT EXISTS context_deleted(
                    owner TEXT NOT NULL REFERENCES history_vaults(key_hash) ON DELETE CASCADE,
                    id TEXT NOT NULL, PRIMARY KEY(owner,id));
            """)

    def purge(self):
        with self.lock:
            now = datetime.now(UTC)
            self.memory = {
                key: value
                for key, value in self.memory.items()
                if value.expires_at > now and self.metadata.session_active(key[0][2:])
            }

    def load(self, owner, conversation_id):
        if owner.startswith("s:"):
            self.purge()
            with self.lock:
                value = self.memory.get((owner, conversation_id))
                if not value:
                    fail("conversation_not_found", 404)
                return value.model_copy(deep=True)
        with self.history.connect() as db:
            self.history.require_active(db, owner[2:])
            row = db.execute(
                "SELECT payload FROM context_conversations WHERE owner=? AND id=?",
                (owner[2:], conversation_id),
            ).fetchone()
            if not row:
                fail("conversation_not_found", 404)
            return Conversation.model_validate_json(row["payload"])

    def save(self, owner, value, *, create=False):
        expected = value.version
        value = value.model_copy(deep=True)
        value.updated_at = datetime.now(UTC)
        value.version += 1
        payload = value.model_dump_json()
        if len(payload.encode()) > 800000:
            fail("conversation_storage_limit", 413)
        if owner.startswith("s:"):
            self.purge()
            with self.lock:
                key = (owner, value.id)
                old = self.memory.get(key)
                if create:
                    if old:
                        fail("conversation_exists")
                    if len(self.memory) >= 1000:
                        fail("conversation_capacity", 503, True)
                    if sum(key[0] == owner for key in self.memory) >= 50:
                        fail("conversation_count_limit")
                elif not old or old.version != expected:
                    fail("stale_conversation")
                if not self.metadata.session_active(owner[2:]):
                    fail("session_expired", 401)
                other_bytes = sum(
                    len(v.model_dump_json().encode()) for k, v in self.memory.items() if k != key
                )
                if other_bytes + len(payload.encode()) > 64000000:
                    fail("conversation_capacity", 503, True)
                self.memory[key] = value
            return value.model_copy(deep=True)
        with self.history.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.history.require_active(db, owner[2:])
            if db.execute(
                "SELECT 1 FROM context_deleted WHERE owner=? AND id=?", (owner[2:], value.id)
            ).fetchone():
                fail("conversation_was_deleted", 410)
            total, count = db.execute(
                "SELECT COALESCE(sum(length(CAST(payload AS BLOB))),0),count(*) "
                "FROM context_conversations WHERE owner=? AND id!=?",
                (owner[2:], value.id),
            ).fetchone()
            if total + len(payload.encode()) > 16000000 or (create and count >= 50):
                fail("history_storage_limit", 413)
            if create:
                db.execute(
                    "INSERT INTO context_conversations VALUES(?,?,?,?)",
                    (owner[2:], value.id, value.version, payload),
                )
            elif (
                db.execute(
                    "UPDATE context_conversations SET version=?,payload=? "
                    "WHERE owner=? AND id=? AND version=?",
                    (value.version, payload, owner[2:], value.id, expected),
                ).rowcount
                != 1
            ):
                fail("stale_conversation")
        return value

    def index(self, owner, query, mode, offset, limit):
        if owner.startswith("s:"):
            self.purge()
            with self.lock:
                values = [
                    v.model_copy(deep=True) for (key, _), v in self.memory.items() if key == owner
                ]
        else:
            with self.history.connect() as db:
                self.history.require_active(db, owner[2:])
                values = [
                    Conversation.model_validate_json(row[0])
                    for row in db.execute(
                        "SELECT payload FROM context_conversations WHERE owner=?", (owner[2:],)
                    )
                ]
        values = [
            v
            for v in values
            if (not mode or v.mode == mode)
            and (
                not query
                or query.casefold()
                in (
                    v.title + " " + " ".join(t.message + " " + t.answer for t in v.turns)
                ).casefold()
            )
        ]
        values.sort(key=lambda v: (v.updated_at, v.id), reverse=True)
        return ConversationIndex(
            total=len(values),
            offset=offset,
            limit=limit,
            conversations=[
                ConversationSummary(
                    id=v.id,
                    mode=v.mode,
                    title=v.title,
                    updated_at=v.updated_at,
                    storage=v.storage,
                    turn_count=len(v.turns),
                    preview=v.turns[-1].message[:160] if v.turns else "",
                )
                for v in values[offset : offset + limit]
            ],
        )

    def delete(self, owner, conversation_id):
        self.load(owner, conversation_id)
        if owner.startswith("s:"):
            with self.lock:
                self.memory.pop((owner, conversation_id), None)
            return
        with self.history.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.history.require_active(db, owner[2:])
            if (
                db.execute(
                    "SELECT count(*) FROM context_deleted WHERE owner=?", (owner[2:],)
                ).fetchone()[0]
                >= 1000
            ):
                fail("history_deletion_limit")
            db.execute(
                "DELETE FROM context_conversations WHERE owner=? AND id=?",
                (owner[2:], conversation_id),
            )
            db.execute(
                "INSERT OR IGNORE INTO context_deleted VALUES(?,?)", (owner[2:], conversation_id)
            )

    def clear_session(self, session_id):
        with self.lock:
            self.memory = {
                key: value for key, value in self.memory.items() if key[0] != "s:" + session_id
            }
