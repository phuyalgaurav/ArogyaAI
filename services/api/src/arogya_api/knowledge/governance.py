import hashlib
import hmac
import json
import sqlite3
from datetime import UTC, datetime

from fastapi import HTTPException

from arogya_api.knowledge.models import KnowledgeSource
from arogya_api.knowledge.operators import require_role
from arogya_api.knowledge.review_models import (
    AuditEvent,
    QuestionCandidate,
    QuestionConflict,
    SourceReview,
    SourceRevision,
)
from arogya_api.knowledge.store import normalized_question


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()


def source_hash(source):
    value = source.model_dump(mode="json", exclude={"review_status", "reviewed_by", "reviewed_at"})
    return hashlib.sha256(canonical(value)).hexdigest()


class Governance:
    def __init__(self, store, signing_key):
        self.store = store
        self.key = hmac.digest(signing_key.encode(), b"arogya-public-source-audit-v1", "sha256")
        store.governance = self

    def events(self, db=None):
        if db is None:
            with self.store.connect() as connection:
                return self.events(connection)
        try:
            return self._events(db)
        except (ValueError, TypeError, KeyError):
            raise HTTPException(503, "knowledge_audit_invalid") from None

    def _events(self, db):
        previous, result = "0" * 64, []
        for index, row in enumerate(
            db.execute("SELECT * FROM knowledge_audit ORDER BY sequence"), 1
        ):
            data = json.loads(row["payload"])
            expected = hmac.new(self.key, canonical(data), "sha256").hexdigest()
            if (
                row["sequence"] != index
                or data["sequence"] != index
                or data["previous_hash"] != previous
                or not hmac.compare_digest(expected, row["event_hash"])
            ):
                raise HTTPException(503, "knowledge_audit_invalid")
            event = AuditEvent(**data, event_hash=expected)
            result.append(event)
            previous = expected
        return result

    def append(self, db, actor, event, source_id, version, data):
        events = self.events(db)
        payload = {
            "sequence": len(events) + 1,
            "actor_id": actor.id,
            "event": event,
            "source_id": source_id,
            "version": version,
            "recorded_at": datetime.now(UTC).isoformat(),
            "data": data,
            "previous_hash": events[-1].event_hash if events else "0" * 64,
        }
        digest = hmac.new(self.key, canonical(payload), "sha256").hexdigest()
        db.execute(
            "INSERT INTO knowledge_audit VALUES (?, ?, ?)",
            (payload["sequence"], canonical(payload).decode(), digest),
        )
        return AuditEvent(**payload, event_hash=digest)

    def managed(self, source_id):
        with self.store.connect() as db:
            return bool(
                db.execute(
                    "SELECT 1 FROM source_revisions WHERE source_id=?", (source_id,)
                ).fetchone()
            )

    def revision(self, source_id, version, db=None):
        if db is None:
            with self.store.connect() as connection:
                return self.revision(source_id, version, connection)
        row = db.execute(
            "SELECT * FROM source_revisions WHERE source_id=? AND version=?", (source_id, version)
        ).fetchone()
        if not row:
            raise HTTPException(404, "source_revision_not_found")
        source = KnowledgeSource.model_validate_json(row["payload"])
        if source_hash(source) != row["content_hash"]:
            raise HTTPException(503, "source_revision_invalid")
        events = [e for e in self.events(db) if e.source_id == source_id and e.version == version]
        submission = next((e for e in events if e.event == "submitted"), None)
        if not submission or submission.data["content_hash"] != row["content_hash"]:
            raise HTTPException(503, "source_revision_unaudited")
        if (
            submission.actor_id != row["submitted_by"]
            or submission.recorded_at.isoformat() != row["submitted_at"]
        ):
            raise HTTPException(503, "source_revision_invalid")
        reviews = {}
        for event in events:
            if event.event == "reviewed":
                review = SourceReview(
                    **event.data, actor_id=event.actor_id, recorded_at=event.recorded_at
                )
                if review.content_hash != row["content_hash"]:
                    raise HTTPException(503, "source_review_invalid")
                reviews[review.kind] = review
        return SourceRevision(
            source=source,
            content_hash=row["content_hash"],
            state=row["state"],
            submitted_by=row["submitted_by"],
            submitted_at=row["submitted_at"],
            reviews=list(reviews.values()),
        )

    def submit(self, source, actor):
        require_role(actor, "content_editor")
        if source.valid_until <= datetime.now(UTC):
            raise HTTPException(422, "source_already_expired")
        digest = source_hash(source)
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                db.execute(
                    "INSERT INTO source_revisions VALUES (?, ?, ?, ?, 'pending', ?, ?)",
                    (
                        source.source_id,
                        source.version,
                        source.model_dump_json(),
                        digest,
                        actor.id,
                        datetime.now(UTC).isoformat(),
                    ),
                )
            except sqlite3.IntegrityError:
                old = self.revision(source.source_id, source.version, db)
                if old.content_hash != digest:
                    raise HTTPException(409, "source_version_is_immutable") from None
                return old
            event = self.append(
                db, actor, "submitted", source.source_id, source.version, {"content_hash": digest}
            )
            db.execute(
                "UPDATE source_revisions SET submitted_at=? WHERE source_id=? AND version=?",
                (event.recorded_at.isoformat(), source.source_id, source.version),
            )
            return self.revision(source.source_id, source.version, db)

    def review(self, source_id, version, request, actor):
        require_role(actor, request.kind + "_reviewer")
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            revision = self.revision(source_id, version, db)
            if revision.content_hash != request.expected_hash:
                raise HTTPException(409, "source_hash_changed")
            if revision.state != "pending":
                raise HTTPException(409, "review_requires_pending_revision")
            if actor.id == revision.submitted_by:
                raise HTTPException(403, "independent_review_required")
            if revision.source.valid_until <= datetime.now(UTC):
                raise HTTPException(422, "source_already_expired")
            value = request.model_dump(mode="json", exclude={"expected_hash"})
            value["content_hash"] = revision.content_hash
            self.append(db, actor, "reviewed", source_id, version, value)
            return self.revision(source_id, version, db)

    def activate(self, source_id, version, request, actor):
        require_role(actor, "administrator")
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            revision = self.revision(source_id, version, db)
            if revision.content_hash != request.expected_hash or revision.state != "pending":
                raise HTTPException(409, "pending_source_hash_required")
            reviews = {r.kind: r for r in revision.reviews}
            if set(reviews) != {"clinical", "license"} or any(
                r.decision != "approve" for r in reviews.values()
            ):
                raise HTTPException(409, "clinical_and_license_approval_required")
            if revision.source.valid_until <= datetime.now(UTC):
                raise HTTPException(422, "source_already_expired")
            active = revision.source.model_copy(
                update={
                    "review_status": "approved",
                    "reviewed_by": reviews["clinical"].actor_id,
                    "reviewed_at": reviews["clinical"].recorded_at,
                }
            )
            active = KnowledgeSource.model_validate(active.model_dump())
            db.execute(
                "UPDATE source_revisions SET state='retired' WHERE source_id=? AND state='active'",
                (source_id,),
            )
            db.execute(
                "UPDATE source_revisions SET state='active' WHERE source_id=? AND version=?",
                (source_id, version),
            )
            self.store.write_source(db, active)
            self.append(
                db,
                actor,
                "activated",
                source_id,
                version,
                {"content_hash": revision.content_hash, "reason": request.reason},
            )
            return self.revision(source_id, version, db)

    def withdraw(self, source_id, version, request, actor):
        require_role(actor, "administrator", "clinical_reviewer", "license_reviewer")
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            revision = self.revision(source_id, version, db)
            if request.expected_hash != revision.content_hash:
                raise HTTPException(409, "source_hash_changed")
            db.execute(
                "UPDATE source_revisions SET state='withdrawn' WHERE source_id=? AND version=?",
                (source_id, version),
            )
            current = db.execute("SELECT payload FROM sources WHERE id=?", (source_id,)).fetchone()
            if current:
                active = KnowledgeSource.model_validate_json(current["payload"])
                if active.version == version:
                    self.store.write_source(
                        db, active.model_copy(update={"review_status": "withdrawn"})
                    )
            self.append(
                db,
                actor,
                "withdrawn",
                source_id,
                version,
                {"content_hash": revision.content_hash, "reason": request.reason},
            )
            return self.revision(source_id, version, db)

    def approved(self, source):
        try:
            revision = self.revision(source.source_id, source.version)
            reviews = {r.kind: r for r in revision.reviews}
            events = [e for e in self.events() if e.source_id == source.source_id]
            last_state = next(
                (
                    e.event
                    for e in reversed(events)
                    if e.event == "activated"
                    or (e.event == "withdrawn" and e.version == source.version)
                ),
                None,
            )
            last_activation = next((e for e in reversed(events) if e.event == "activated"), None)
            return bool(
                revision.state == "active"
                and last_state == "activated"
                and last_activation
                and last_activation.version == source.version
                and revision.content_hash == source_hash(source)
                and set(reviews) == {"clinical", "license"}
                and all(r.decision == "approve" for r in reviews.values())
                and source.reviewed_by == reviews["clinical"].actor_id
                and source.reviewed_at == reviews["clinical"].recorded_at
            )
        except (HTTPException, ValueError, TypeError, KeyError):
            return False

    def conflict(self, question, language, db=None):
        candidates = self.store.candidates(question, language)
        values = [
            QuestionCandidate(
                source_id=s.source_id,
                version=s.version,
                section_id=section.id,
                content_hash=source_hash(s),
            )
            for s, section in candidates
        ]
        values.sort(key=lambda v: (v.source_id, v.version, v.section_id))
        snapshot = hashlib.sha256(canonical([v.model_dump() for v in values])).hexdigest()
        selected = None
        if db is None:
            with self.store.connect() as connection:
                return self.conflict(question, language, connection)
        row = db.execute(
            "SELECT * FROM question_resolutions WHERE question=? AND language=?",
            (normalized_question(question), language),
        ).fetchone()
        if row and row["snapshot_hash"] == snapshot:
            candidate = QuestionCandidate.model_validate_json(row["selected"])
            events = [
                e
                for e in self.events(db)
                if e.event == "question_resolved"
                and e.data["question"] == normalized_question(question)
                and e.data["language"] == language
            ]
            if (
                events
                and events[-1].data["snapshot_hash"] == snapshot
                and events[-1].data["selected"] == candidate.model_dump()
            ):
                if candidate in values:
                    selected = candidate
        return QuestionConflict(
            question=question,
            language=language,
            snapshot_hash=snapshot,
            candidates=values,
            selected=selected,
        )

    def resolve(self, request, actor):
        require_role(actor, "clinical_reviewer")
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            conflict = self.conflict(request.question, request.language, db)
            if request.expected_snapshot != conflict.snapshot_hash:
                raise HTTPException(409, "question_candidates_changed")
            if request.selected not in conflict.candidates or len(conflict.candidates) < 2:
                raise HTTPException(422, "conflicting_candidate_required")
            db.execute(
                "INSERT OR REPLACE INTO question_resolutions VALUES (?, ?, ?, ?)",
                (
                    normalized_question(request.question),
                    request.language,
                    conflict.snapshot_hash,
                    request.selected.model_dump_json(),
                ),
            )
            self.append(
                db,
                actor,
                "question_resolved",
                request.selected.source_id,
                request.selected.version,
                {
                    "question": normalized_question(request.question),
                    "language": request.language,
                    "snapshot_hash": conflict.snapshot_hash,
                    "selected": request.selected.model_dump(),
                    "reason": request.reason,
                },
            )
            return self.conflict(request.question, request.language, db)

    def import_medicine(self, request, actor):
        require_role(actor, "clinical_reviewer")
        medicine = request.medicine
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if not all(
                self.store.source_eligible(self.store.source_get(s)) for s in medicine.source_ids
            ):
                raise HTTPException(409, "eligible_medicine_sources_required")
            if any(
                self.store.source_get(s).review_status != "approved" for s in medicine.source_ids
            ):
                raise HTTPException(409, "clinical_sources_required")
            self.store.write_medicine(db, medicine)
            self.append(
                db,
                actor,
                "medicine_imported",
                "medicine:" + medicine.id,
                "catalog-1",
                {
                    "content_hash": hashlib.sha256(
                        canonical(medicine.model_dump(mode="json"))
                    ).hexdigest(),
                    "source_ids": medicine.source_ids,
                    "source_refs": [
                        {
                            "source_id": s.source_id,
                            "version": s.version,
                            "content_hash": source_hash(s),
                        }
                        for s in [self.store.source_get(i) for i in medicine.source_ids]
                    ],
                    "reason": request.reason,
                },
            )
        return medicine

    def medicine_approved(self, medicine):
        try:
            events = [
                e
                for e in self.events()
                if e.source_id == "medicine:" + medicine.id and e.event == "medicine_imported"
            ]
            digest = hashlib.sha256(canonical(medicine.model_dump(mode="json"))).hexdigest()
            sources = [self.store.source_get(i) for i in medicine.source_ids]
            if any(s is None for s in sources):
                return False
            refs = [
                {"source_id": s.source_id, "version": s.version, "content_hash": source_hash(s)}
                for s in sources
            ]
            return bool(
                events
                and events[-1].data["content_hash"] == digest
                and events[-1].data.get("source_refs") == refs
            )
        except (HTTPException, ValueError, TypeError, KeyError):
            return False
