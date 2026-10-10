import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles

from arogya_api.conversations.routes import conversation_router
from arogya_api.conversations.service import Conversations
from arogya_api.conversations.store import ConversationStore
from arogya_api.core.auth import RateLimiter, Sessions
from arogya_api.core.contracts import ArogyaResponse, Capabilities, Capability, Language
from arogya_api.core.models import ConsentGrant, ConsentRequest, SessionResponse
from arogya_api.core.privacy import BoundedRequestBody
from arogya_api.core.settings import Settings
from arogya_api.documents.service import document_router
from arogya_api.health import references as health_references
from arogya_api.health.models import ChatRequest
from arogya_api.health.service import answer
from arogya_api.history.routes import history_router
from arogya_api.history.store import HistoryStore
from arogya_api.images.reader import ImageReader, image_router
from arogya_api.inference.client import InferenceClient
from arogya_api.knowledge.bundle_models import BundleManifest
from arogya_api.knowledge.bundles import Bundles
from arogya_api.knowledge.governance import Governance
from arogya_api.knowledge.medicine_references import medicine_reference_router
from arogya_api.knowledge.models import (
    MedicineRecord,
    MedicineResolution,
    MedicineResolveRequest,
    ReviewedQuestion,
)
from arogya_api.knowledge.operators import OperatorRegistry
from arogya_api.knowledge.routes import operator_router
from arogya_api.knowledge.store import Store
from arogya_api.runtime.routes import runtime_router
from arogya_api.speech.client import LanguageClient, language_router
from arogya_api.speech.models import CONSENT_CATEGORIES


def create_app(settings=None, inference=None, language=None, images=None):
    settings = settings or Settings.from_environment()
    store = Store(settings.database_path, settings.allow_test_knowledge)
    audit_key = settings.knowledge_audit_key or settings.signing_key
    governance = Governance(store, audit_key.get_secret_value())
    bundles = Bundles(store, governance, settings.bundle_signing_key_path)
    sessions = Sessions(settings, store)
    limits = RateLimiter()
    provider = inference or InferenceClient(settings)
    language_client = language or LanguageClient(settings)
    image_reader = images or ImageReader(settings.ocr_dir)
    history = HistoryStore(
        settings.history_database_path or settings.database_path.with_name("chat-history.sqlite3")
    )
    contexts = ConversationStore(history, store)
    conversations = Conversations(contexts, store, provider, image_reader)

    @asynccontextmanager
    async def lifespan(app):
        async def cleanup():
            while True:
                await asyncio.to_thread(history.purge_expired)
                await asyncio.to_thread(contexts.purge)
                await conversations.purge()
                await asyncio.sleep(60)

        sweep = asyncio.create_task(cleanup())
        try:
            yield
        finally:
            sweep.cancel()
            await asyncio.gather(sweep, return_exceptions=True)
            await conversations.close()
            await provider.close()
            await language_client.close()

    app = FastAPI(title="ArogyaAI API", version="0.3.0", lifespan=lifespan)
    app.state.store = store
    app.state.settings = settings
    app.state.governance = governance
    app.state.bundles = bundles
    app.state.history = history
    app.state.contexts = contexts
    app.state.conversations = conversations
    app.include_router(
        conversation_router(
            contexts, conversations, store, sessions, history, limits, language_client
        )
    )
    app.include_router(history_router(history, sessions, limits, conversations))
    app.include_router(
        operator_router(
            store, governance, OperatorRegistry(settings.operator_registry_path), limits, bundles
        )
    )
    app.include_router(
        runtime_router(
            store,
            provider,
            OperatorRegistry(settings.operator_registry_path),
            limits,
            language_client,
            image_reader,
        )
    )
    app.include_router(image_router(store, sessions, image_reader, limits, provider))
    app.include_router(language_router(store, sessions, language_client, limits))
    app.include_router(document_router(store, sessions, provider, limits))
    app.include_router(medicine_reference_router())
    app.add_middleware(
        BoundedRequestBody,
        path_limits={
            "/api/v1/operator/": 131072,
            "/api/v1/speech/transcribe": 1000000,
            "/api/v1/images/": 11200000,
            "/api/v1/history/": 1000000,
            "/api/v1/conversations/": 11200000,
        },
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-History-Token"],
        allow_credentials=False,
    )
    bearer = HTTPBearer(auto_error=False)

    def owner(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        return sessions.verify(credentials.credentials if credentials else None)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, error):
        return JSONResponse(
            {
                "detail": "invalid_request",
                "errors": [{"type": e["type"]} for e in error.errors()],
            },
            422,
        )

    @app.get("/healthz")
    def health():
        return {
            "status": "ok",
            "service": "arogya-api",
            "stage": "backend",
            "version": app.version,
            "build": os.environ.get("AROGYA_BUILD_ID", "development"),
            "conversation_schema": 1,
        }

    @app.get("/api/v1/capabilities", response_model=Capabilities)
    async def capabilities():
        state = await provider.status()
        language_engines = await language_client.runtime()
        translation_ready = any(
            e.id == "translation" and e.state == "ready" for e in language_engines
        )
        reasons = {
            "browser_qwen": (False, "Browser worker is not implemented."),
            "server_qwen": (
                state["qwen_ready"],
                "Pinned inference readiness; answers also require eligible "
                "reviewed evidence and consent.",
            ),
            "laya": (
                state["laya_ready"],
                "Intent routing only; deterministic safety rules remain authoritative.",
            ),
            "ocr": (
                False,
                "Server prescription OCR and verification are unavailable. "
                "Printed-text image readers are separate from clinical verification.",
            ),
            "tmt": (
                translation_ready,
                "Standalone English, Nepali and Tamang translation drafts. "
                "Clinical translation validation and Tamang medical answers are pending.",
            ),
            "offline_library": (
                bool(bundles.available()),
                "Available only for a current signed redistribution-approved bundle.",
            ),
            "sync": (False, "Encrypted account synchronization is not implemented."),
        }
        return Capabilities(
            languages=["en", "ne", "tam"],
            features=[
                Capability(id=key, available=ready, reason=reason)
                for key, (ready, reason) in reasons.items()
            ],
        )

    @app.post("/api/v1/session", response_model=SessionResponse)
    def session(request: Request):
        limits.check("session:" + (request.client.host if request.client else "unknown"), 30)
        token, expires = sessions.issue()
        return SessionResponse(access_token=token, expires_at=datetime.fromtimestamp(expires, UTC))

    @app.post("/api/v1/consents", response_model=ConsentGrant)
    def grant(payload: ConsentRequest, session_id=Depends(owner)):
        limits.check("consent:" + session_id, 30)
        consent_id = str(uuid.uuid4())
        expires = datetime.now(UTC).timestamp() + payload.expires_in_seconds
        store.consent_create(consent_id, session_id, expires, payload.purpose)
        return ConsentGrant(
            id=consent_id,
            purpose=payload.purpose,
            data_categories=payload.data_categories,
            expires_at=datetime.fromtimestamp(expires, UTC),
            revoked=False,
        )

    @app.get("/api/v1/consents/{consent_id}", response_model=ConsentGrant)
    def consent(consent_id: str, session_id=Depends(owner)):
        row = store.consent_get(consent_id, session_id)
        if not row:
            raise HTTPException(404, "consent_not_found")
        return ConsentGrant(
            id=row["id"],
            purpose=row["purpose"],
            data_categories=[CONSENT_CATEGORIES[row["purpose"]]],
            expires_at=datetime.fromtimestamp(row["expires"], UTC),
            revoked=bool(row["revoked"]),
        )

    @app.delete("/api/v1/consents/{consent_id}", status_code=204)
    def revoke(consent_id: str, session_id=Depends(owner)):
        if not store.consent_revoke(consent_id, session_id):
            raise HTTPException(404, "consent_not_found")
        return Response(status_code=204)

    @app.post("/api/v1/chat", response_model=ArogyaResponse)
    async def chat(payload: ChatRequest, session_id=Depends(owner)):
        limits.check("chat:" + session_id, 10)
        return await answer(payload, session_id, store, provider)

    @app.post("/api/v1/medicines/resolve", response_model=MedicineResolution)
    def resolve(payload: MedicineResolveRequest):
        candidates = store.medicine_resolve(payload.query)
        return MedicineResolution(
            status="candidate" if candidates else "needs_clarification", candidates=candidates
        )

    @app.get("/api/v1/medicines/{medicine_id}", response_model=MedicineRecord)
    def medicine(medicine_id: str):
        result = store.medicine_get(medicine_id)
        if not result:
            raise HTTPException(404, "reviewed_medicine_not_found")
        return result

    @app.get("/api/v1/knowledge/manifest")
    def manifest():
        manifests = bundles.available()
        return {
            **store.manifest(),
            "public_education_sources": [
                {
                    "source_id": s.source_id,
                    "title": s.title,
                    "language": s.language,
                    "version": s.version,
                    "review_status": s.review_status,
                }
                for s in health_references.sources()
            ],
            "offline_bundle_available": bool(manifests),
            "bundles": manifests,
        }

    @app.get("/api/v1/knowledge/signing-key")
    def signing_key():
        return bundles.trust_descriptor()

    @app.get("/api/v1/knowledge/bundles/{bundle_id}/manifest", response_model=BundleManifest)
    def bundle_manifest(bundle_id: str):
        return bundles.get(bundle_id)[0]

    @app.get("/api/v1/knowledge/bundles/{bundle_id}")
    def bundle_payload(bundle_id: str):
        manifest, payload = bundles.get(bundle_id)
        return Response(
            payload,
            media_type="application/json",
            headers={"ETag": '"' + manifest.payload_sha256 + '"', "Cache-Control": "no-store"},
        )

    @app.get("/api/v1/knowledge/questions", response_model=list[ReviewedQuestion])
    def questions(
        language: Language = "en",
        limit: int = Query(default=50, ge=1, le=100),
        include_public: bool = False,
    ):
        return (
            health_references.available_questions(store, language, limit)
            if include_public
            else store.questions(language, limit)
        )

    @app.get("/api/v1/knowledge/sources/{source_id}")
    def source(source_id: str):
        public = health_references.source_get(source_id)
        if public:
            return public
        result = store.source_get(source_id)
        if not store.source_eligible(result):
            raise HTTPException(404, "reviewed_source_not_found")
        return result

    @app.get("/api/v1/me/data")
    def export(session_id=Depends(owner)):
        return store.export_metadata(session_id)

    @app.delete("/api/v1/me/data", status_code=204)
    async def delete(session_id=Depends(owner)):
        store.session_delete(session_id)
        contexts.clear_session(session_id)
        await conversations.purge()
        return Response(status_code=204)

    if settings.web_dir:
        if not (settings.web_dir / "index.html").is_file():
            raise ValueError("Build the local website with pnpm build:local first.")
        app.mount("/", StaticFiles(directory=settings.web_dir, html=True), name="website")
    return app


app = create_app()
