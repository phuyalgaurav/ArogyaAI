import sqlite3
import unicodedata
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from arogya_api.knowledge.models import (
    EvidenceSentence,
    KnowledgeSource,
    MedicineRecord,
    ReviewedQuestion,
)


def normalized_name(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).casefold().split())


def normalized_question(value: str) -> str:
    text = normalized_name(value)
    while text and (
        text[-1] in "?？!！।" or (text[-1] == "." and len(text) > 1 and not text[-2].isdigit())
    ):
        text = text[:-1].rstrip()
    return text


class Store:
    def __init__(self, path: Path, allow_test_knowledge=False):
        self.path = path
        self.allow_test_knowledge = allow_test_knowledge
        self.governance = None
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
                INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM schema_version);
                CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS consents(
                    id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    expires REAL NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS medicines(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS aliases(
                    alias TEXT NOT NULL, medicine_id TEXT NOT NULL REFERENCES medicines(id)
                    ON DELETE CASCADE, PRIMARY KEY(alias, medicine_id));
                CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
                    source_id UNINDEXED, section_id UNINDEXED, sentence_index UNINDEXED, text);
                CREATE TABLE IF NOT EXISTS reviewed_questions(
                    question TEXT NOT NULL, source_id TEXT NOT NULL, section_id TEXT NOT NULL,
                    PRIMARY KEY(question, source_id, section_id));
                CREATE TABLE IF NOT EXISTS source_revisions(
                    source_id TEXT, version TEXT, payload TEXT NOT NULL, content_hash TEXT NOT NULL,
                    state TEXT NOT NULL, submitted_by TEXT NOT NULL, submitted_at TEXT NOT NULL,
                    PRIMARY KEY(source_id, version));
                CREATE TABLE IF NOT EXISTS knowledge_audit(
                    sequence INTEGER PRIMARY KEY, payload TEXT NOT NULL, event_hash TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS question_resolutions(
                    question TEXT, language TEXT, snapshot_hash TEXT NOT NULL,
                    selected TEXT NOT NULL,
                    PRIMARY KEY(question, language));
                CREATE TABLE IF NOT EXISTS knowledge_bundles(
                    id TEXT PRIMARY KEY, language TEXT NOT NULL, manifest TEXT NOT NULL,
                    payload BLOB NOT NULL, epoch TEXT NOT NULL);
            """)
            version = connection.execute("SELECT version FROM schema_version").fetchone()[0]
            if version == 1:
                for row in connection.execute("SELECT payload FROM sources").fetchall():
                    source = KnowledgeSource.model_validate_json(row["payload"])
                    self.index_questions(connection, source)
                connection.execute("UPDATE schema_version SET version=2")
            elif version not in {2, 3, 4, 5}:
                raise RuntimeError("Unsupported database schema version")
            if version < 4:
                connection.execute("DELETE FROM reviewed_questions")
                connection.execute("DELETE FROM question_resolutions")
                for row in connection.execute("SELECT payload FROM sources").fetchall():
                    self.index_questions(
                        connection, KnowledgeSource.model_validate_json(row["payload"])
                    )
            if "purpose" not in {
                row["name"] for row in connection.execute("PRAGMA table_info(consents)")
            }:
                connection.execute(
                    "ALTER TABLE consents ADD COLUMN purpose TEXT NOT NULL DEFAULT 'server_chat'"
                )
            connection.execute("UPDATE schema_version SET version=5")
        path.chmod(0o600)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def session_create(self, session_id, expires):
        with self.connect() as db:
            db.execute("DELETE FROM sessions WHERE expires <= ?", (datetime.now(UTC).timestamp(),))
            db.execute("INSERT INTO sessions VALUES (?, ?)", (session_id, expires))

    def session_active(self, session_id):
        with self.connect() as db:
            row = db.execute("SELECT expires FROM sessions WHERE id=?", (session_id,)).fetchone()
        return row is not None and row["expires"] > datetime.now(UTC).timestamp()

    def session_delete(self, session_id):
        with self.connect() as db:
            db.execute("DELETE FROM sessions WHERE id=?", (session_id,))

    def consent_create(self, consent_id, owner, expires, purpose="server_chat"):
        with self.connect() as db:
            db.execute(
                "INSERT INTO consents(id,owner,expires,revoked,purpose) VALUES (?, ?, ?, 0, ?)",
                (consent_id, owner, expires, purpose),
            )

    def consent_get(self, consent_id, owner):
        with self.connect() as db:
            return db.execute(
                "SELECT id, expires, revoked, purpose FROM consents WHERE id=? AND owner=?",
                (consent_id, owner),
            ).fetchone()

    def consent_valid(self, consent_id, owner, purpose="server_chat"):
        row = self.consent_get(consent_id, owner)
        return bool(
            row
            and row["purpose"] == purpose
            and not row["revoked"]
            and row["expires"] > datetime.now(UTC).timestamp()
            and self.session_active(owner)
        )

    def consent_revoke(self, consent_id, owner):
        with self.connect() as db:
            return db.execute(
                "UPDATE consents SET revoked=1 WHERE id=? AND owner=?", (consent_id, owner)
            ).rowcount

    def source_put(self, source: KnowledgeSource):
        if source.review_status == "approved":
            raise ValueError("Approved sources require authenticated review and activation")
        if self.governance and self.governance.managed(source.source_id):
            raise ValueError("Managed sources require revision, review, and withdrawal workflows")
        if source.review_status == "test_fixture" and not self.allow_test_knowledge:
            raise ValueError("Test fixtures require explicit development configuration")
        if source.reviewed_at and source.reviewed_at > datetime.now(UTC):
            raise ValueError("Knowledge cannot be reviewed in the future")
        old = self.source_get(source.source_id)
        if old and old.version == source.version and old.sections != source.sections:
            raise ValueError("Source content changes require a new version")
        with self.connect() as db:
            self.write_source(db, source)

    @staticmethod
    def write_source(db, source):
        db.execute(
            "INSERT OR REPLACE INTO sources VALUES (?, ?)",
            (source.source_id, source.model_dump_json()),
        )
        db.execute("DELETE FROM knowledge_fts WHERE source_id=?", (source.source_id,))
        db.execute("DELETE FROM reviewed_questions WHERE source_id=?", (source.source_id,))
        Store.index_questions(db, source)
        for section in source.sections:
            if section.kind == "dosing":
                continue
            for index, text in enumerate(section.sentences):
                db.execute(
                    "INSERT INTO knowledge_fts VALUES (?, ?, ?, ?)",
                    (source.source_id, section.id, index, text),
                )

    @staticmethod
    def index_questions(db, source):
        db.executemany(
            "INSERT OR IGNORE INTO reviewed_questions VALUES (?, ?, ?)",
            [
                (normalized_question(q), source.source_id, section.id)
                for section in source.sections
                if section.kind != "dosing"
                for q in section.questions
            ],
        )

    def source_get(self, source_id):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM sources WHERE id=?", (source_id,)).fetchone()
        return KnowledgeSource.model_validate_json(row["payload"]) if row else None

    def source_eligible(self, source, language=None):
        return bool(
            source
            and (
                (
                    source.review_status == "approved"
                    and self.governance
                    and self.governance.approved(source)
                )
                or (source.review_status == "test_fixture" and self.allow_test_knowledge)
            )
            and source.valid_until > datetime.now(UTC)
            and (language is None or source.language == language)
        )

    def medicine_put(self, medicine: MedicineRecord):
        if not all(self.source_eligible(self.source_get(s)) for s in medicine.source_ids):
            raise ValueError("Medicine records require eligible reviewed sources")
        with self.connect() as db:
            self.write_medicine(db, medicine)

    @staticmethod
    def write_medicine(db, medicine):
        db.execute(
            "INSERT OR REPLACE INTO medicines VALUES (?, ?)",
            (medicine.id, medicine.model_dump_json()),
        )
        db.execute("DELETE FROM aliases WHERE medicine_id=?", (medicine.id,))
        names = {normalized_name(name) for name in [medicine.canonical_name, *medicine.aliases]}
        db.executemany("INSERT INTO aliases VALUES (?, ?)", [(n, medicine.id) for n in names])

    def medicine_get(self, medicine_id):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM medicines WHERE id=?", (medicine_id,)).fetchone()
        if not row:
            return None
        medicine = MedicineRecord.model_validate_json(row["payload"])
        sources = [self.source_get(s) for s in medicine.source_ids]
        fixture = self.allow_test_knowledge and all(
            s and s.review_status == "test_fixture" for s in sources
        )
        if not fixture and not (self.governance and self.governance.medicine_approved(medicine)):
            return None
        return medicine if all(self.source_eligible(s) for s in sources) else None

    def medicine_resolve(self, query):
        with self.connect() as db:
            rows = db.execute(
                "SELECT medicine_id FROM aliases WHERE alias=?", (normalized_name(query),)
            ).fetchall()
        result = []
        for row in rows:
            medicine = self.medicine_get(row["medicine_id"])
            if medicine and normalized_name(query) in {
                normalized_name(n) for n in [medicine.canonical_name, *medicine.aliases]
            }:
                result.append(medicine)
        return result

    def candidates(self, message, language, source_ids=None):
        with self.connect() as db:
            rows = db.execute(
                "SELECT source_id, section_id FROM reviewed_questions WHERE question=?",
                (normalized_question(message),),
            ).fetchall()
        eligible = []
        for row in rows:
            if source_ids is not None and row["source_id"] not in source_ids:
                continue
            source = self.source_get(row["source_id"])
            if not self.source_eligible(source, language):
                continue
            section = next(s for s in source.sections if s.id == row["section_id"])
            if section.kind == "dosing":
                continue
            eligible.append((source, section))
        return eligible

    def retrieve(self, message, language, source_ids=None):
        eligible = self.candidates(message, language, source_ids)
        if len(eligible) > 1 and self.governance:
            conflict = self.governance.conflict(message, language)
            if conflict.selected:
                eligible = [
                    (s, section)
                    for s, section in eligible
                    if s.source_id == conflict.selected.source_id
                    and s.version == conflict.selected.version
                    and section.id == conflict.selected.section_id
                ]
        if len(eligible) != 1:
            return []
        source, section = eligible[0]
        sentences, budget = [], 0
        for text in section.sentences:
            if budget + len(text) > 4000:
                continue
            budget += len(text)
            sentences.append(
                EvidenceSentence(
                    id=f"s{len(sentences) + 1}",
                    source_id=source.source_id,
                    section_id=section.id,
                    version=source.version,
                    task=section.task,
                    text=text,
                )
            )
            if len(sentences) == 8:
                break
        return sentences

    def manifest(self):
        with self.connect() as db:
            ids = [row["id"] for row in db.execute("SELECT id FROM sources ORDER BY id")]
        sources = [self.source_get(source_id) for source_id in ids]
        return {
            "schema_version": "1.0",
            "offline_bundle_available": False,
            "signed": False,
            "sources": [
                {
                    "source_id": s.source_id,
                    "version": s.version,
                    "language": s.language,
                    "valid_until": s.valid_until.isoformat(),
                    "review_status": s.review_status,
                }
                for s in sources
                if self.source_eligible(s)
            ],
        }

    def questions(self, language, limit):
        with self.connect() as db:
            rows = db.execute("SELECT payload FROM sources ORDER BY id").fetchall()
        result = []
        for row in rows:
            source = KnowledgeSource.model_validate_json(row["payload"])
            if not self.source_eligible(source, language):
                continue
            for section in source.sections:
                if section.kind == "dosing":
                    continue
                for question in section.questions:
                    result.append(
                        ReviewedQuestion(
                            question=question,
                            language=source.language,
                            source_id=source.source_id,
                            section_id=section.id,
                            version=source.version,
                            task=section.task,
                        )
                    )
                    if len(result) == limit:
                        return result
        return result

    def export_metadata(self, owner):
        with self.connect() as db:
            rows = db.execute(
                "SELECT id, expires, revoked, purpose FROM consents WHERE owner=?", (owner,)
            )
            return {
                "session_id": owner,
                "consents": [dict(row) for row in rows],
                "health_data_stored": False,
            }
