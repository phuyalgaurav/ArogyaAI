import base64
import hashlib
from datetime import UTC, datetime, timedelta

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from fastapi import HTTPException

from arogya_api.core.safety import POLICY_VERSION
from arogya_api.knowledge.bundle_models import BundleManifest, BundlePayload, BundleSourceRef
from arogya_api.knowledge.governance import canonical, source_hash
from arogya_api.knowledge.models import KnowledgeSource, ReviewedQuestion
from arogya_api.knowledge.operators import require_role
from arogya_api.knowledge.store import normalized_question


def signing_bytes(manifest):
    value = manifest.model_dump(mode="json", exclude={"signature"})
    return b"ArogyaAI knowledge manifest v1\n" + canonical(value)


def verify_bundle(manifest, payload, trusted_public_key, now=None):
    now = now or datetime.now(UTC)
    if (
        manifest.policy_version != POLICY_VERSION
        or manifest.valid_until <= now
        or manifest.created_at > now
        or manifest.valid_until > manifest.created_at + timedelta(hours=1)
        or manifest.valid_until <= manifest.created_at
        or hashlib.sha256(trusted_public_key).hexdigest() != manifest.key_id
        or hashlib.sha256(payload).hexdigest() != manifest.payload_sha256
        or len(payload) != manifest.payload_bytes
        or manifest.id != manifest.payload_sha256
    ):
        raise ValueError("Invalid or expired knowledge bundle")
    Ed25519PublicKey.from_public_bytes(trusted_public_key).verify(
        base64.b64decode(manifest.signature, validate=True), signing_bytes(manifest)
    )
    contents = BundlePayload.model_validate_json(payload)
    if contents.language != manifest.language or contents.policy_version != manifest.policy_version:
        raise ValueError("Bundle context mismatch")
    if any(
        s.review_status != "approved"
        or s.language != contents.language
        or s.valid_until < manifest.valid_until
        or any(section.kind == "dosing" for section in s.sections)
        for s in contents.sources
    ):
        raise ValueError("Bundle contains ineligible source content")
    refs = {(r.source_id, r.version) for r in manifest.sources}
    if refs != {(s.source_id, s.version) for s in contents.sources}:
        raise ValueError("Bundle provenance mismatch")
    source_ids = {s.source_id for s in contents.sources}
    if any(not set(m.source_ids) <= source_ids for m in contents.medicines):
        raise ValueError("Bundle medicine lacks sources")
    for question in contents.questions:
        if not any(
            s.source_id == question.source_id
            and s.version == question.version
            and question.language == s.language
            and any(
                section.id == question.section_id
                and question.question in section.questions
                and section.task == question.task
                for section in s.sections
            )
            for s in contents.sources
        ):
            raise ValueError("Bundle question lacks reviewed provenance")
    return contents


class Bundles:
    def __init__(self, store, governance, key_path):
        self.store, self.governance, self.key_path = store, governance, key_path

    def key(self):
        if not self.key_path:
            raise HTTPException(503, "knowledge_signing_not_configured")
        try:
            if self.key_path.stat().st_size != 32:
                raise ValueError
            return Ed25519PrivateKey.from_private_bytes(self.key_path.read_bytes())
        except (OSError, ValueError):
            raise HTTPException(503, "knowledge_signing_key_invalid") from None

    def trust_descriptor(self):
        public = self.key().public_key().public_bytes_raw()
        return {
            "algorithm": "Ed25519",
            "key_id": hashlib.sha256(public).hexdigest(),
            "public_key_hex": public.hex(),
            "trust": "pin out of band; discovery is not trust",
        }

    def state(self, language):
        with self.store.connect() as db:
            rows = db.execute("SELECT payload FROM sources ORDER BY id").fetchall()
            medicines = [row["id"] for row in db.execute("SELECT id FROM medicines ORDER BY id")]
        sources, eligible_refs = [], []
        for row in rows:
            source = KnowledgeSource.model_validate_json(row["payload"])
            if (
                not self.store.source_eligible(source, language)
                or source.review_status != "approved"
            ):
                continue
            revision = self.governance.revision(source.source_id, source.version)
            eligible_refs.append(
                BundleSourceRef(
                    source_id=source.source_id,
                    version=source.version,
                    content_hash=source_hash(source),
                ).model_dump()
            )
            license_review = next(r for r in revision.reviews if r.kind == "license")
            if license_review.redistribution_allowed and any(
                s.kind != "dosing" for s in source.sections
            ):
                sources.append(source)
        selected_medicines = []
        source_ids = {s.source_id for s in sources}
        for medicine_id in medicines:
            medicine = self.store.medicine_get(medicine_id)
            if medicine and set(medicine.source_ids) <= source_ids:
                selected_medicines.append(medicine)
        resolutions = [
            e.model_dump(mode="json")
            for e in self.governance.events()
            if e.event == "question_resolved" and e.data["language"] == language
        ]
        refs = [
            BundleSourceRef(source_id=s.source_id, version=s.version, content_hash=source_hash(s))
            for s in sources
        ]
        epoch = hashlib.sha256(
            canonical(
                {
                    "sources": eligible_refs,
                    "medicines": [m.model_dump(mode="json") for m in selected_medicines],
                    "resolutions": resolutions,
                    "policy_version": POLICY_VERSION,
                }
            )
        ).hexdigest()
        return sources, selected_medicines, refs, epoch

    def publish(self, request, actor):
        require_role(actor, "administrator")
        key = self.key()
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            sources, medicines, refs, epoch = self.state(request.language)
            if not sources:
                raise HTTPException(409, "redistribution_approved_sources_required")
            if len(sources) > 50 or len(medicines) > 1000:
                raise HTTPException(413, "bundle_item_limit")
            source_ids = {s.source_id for s in sources}
            questions = []
            seen = set()
            raw_questions = [
                ReviewedQuestion(
                    question=q,
                    language=source.language,
                    source_id=source.source_id,
                    version=source.version,
                    section_id=section.id,
                    task=section.task,
                )
                for source in sources
                for section in source.sections
                if section.kind != "dosing"
                for q in section.questions
            ]
            if len(raw_questions) > 500:
                raise HTTPException(413, "bundle_question_limit")
            for question in raw_questions:
                normalized = normalized_question(question.question)
                if normalized in seen:
                    continue
                seen.add(normalized)
                chosen = self.store.retrieve(question.question, request.language)
                if not chosen or chosen[0].source_id not in source_ids:
                    continue
                selected = chosen[0]
                questions.append(
                    question.model_copy(
                        update={
                            "source_id": selected.source_id,
                            "version": selected.version,
                            "section_id": selected.section_id,
                            "task": selected.task,
                        }
                    )
                )
            if len(questions) > 500:
                raise HTTPException(413, "bundle_question_limit")
            filtered = []
            for source in sources:
                sections = []
                for section in source.sections:
                    if section.kind == "dosing":
                        continue
                    keep = [
                        q.question
                        for q in questions
                        if q.source_id == source.source_id
                        and q.version == source.version
                        and q.section_id == section.id
                    ]
                    sections.append(section.model_copy(update={"questions": keep}))
                filtered.append(source.model_copy(update={"sections": sections}))
            contents = BundlePayload(
                language=request.language,
                policy_version=POLICY_VERSION,
                sources=filtered,
                medicines=medicines,
                questions=questions,
            )
            payload = canonical(contents.model_dump(mode="json"))
            if len(payload) > 1048576:
                raise HTTPException(413, "bundle_byte_limit")
            digest = hashlib.sha256(payload).hexdigest()
            now = datetime.now(UTC)
            valid_until = min(
                now + timedelta(seconds=request.expires_in_seconds),
                *(s.valid_until for s in sources),
            )
            manifest = BundleManifest(
                id=digest,
                language=request.language,
                policy_version=POLICY_VERSION,
                created_at=now,
                valid_until=valid_until,
                payload_sha256=digest,
                payload_bytes=len(payload),
                catalog_epoch=epoch,
                sources=refs,
                key_id=hashlib.sha256(key.public_key().public_bytes_raw()).hexdigest(),
                signature="0" * 88,
            )
            manifest.signature = base64.b64encode(key.sign(signing_bytes(manifest))).decode()
            verify_bundle(manifest, payload, key.public_key().public_bytes_raw(), now)
            db.execute(
                "INSERT OR REPLACE INTO knowledge_bundles VALUES (?, ?, ?, ?, ?)",
                (digest, request.language, manifest.model_dump_json(), payload, epoch),
            )
            self.governance.append(
                db,
                actor,
                "bundle_published",
                "bundle:" + digest,
                digest,
                {"payload_sha256": digest, "key_id": manifest.key_id},
            )
            return manifest

    def get(self, bundle_id):
        with self.store.connect() as db:
            row = db.execute("SELECT * FROM knowledge_bundles WHERE id=?", (bundle_id,)).fetchone()
        if not row:
            raise HTTPException(404, "knowledge_bundle_unavailable")
        try:
            manifest = BundleManifest.model_validate_json(row["manifest"])
            if (
                manifest.policy_version != POLICY_VERSION
                or self.state(manifest.language)[3] != row["epoch"]
                or row["epoch"] != manifest.catalog_epoch
            ):
                raise ValueError
            verify_bundle(manifest, row["payload"], self.key().public_key().public_bytes_raw())
            return manifest, row["payload"]
        except (ValueError, TypeError, InvalidSignature, HTTPException):
            raise HTTPException(404, "knowledge_bundle_unavailable") from None

    def available(self):
        with self.store.connect() as db:
            ids = [
                r["id"]
                for r in db.execute(
                    "SELECT id FROM knowledge_bundles ORDER BY rowid DESC LIMIT 100"
                )
            ]
        manifests = []
        for bundle_id in ids:
            try:
                manifests.append(self.get(bundle_id)[0])
            except HTTPException:
                continue
        return manifests
