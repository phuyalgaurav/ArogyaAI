from fastapi import APIRouter, Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from arogya_api.knowledge.bundle_models import BundleManifest, BundlePublishRequest
from arogya_api.knowledge.models import MedicineRecord
from arogya_api.knowledge.review_models import (
    AuditEvent,
    ConflictLookup,
    MedicineImport,
    OperatorIdentity,
    QuestionConflict,
    ResolveQuestionRequest,
    ReviewRequest,
    SourceDraft,
    SourceRevision,
    VersionAction,
)


def operator_router(store, governance, registry, limits, bundles):
    router = APIRouter(prefix="/api/v1/operator", tags=["Source review"])
    bearer = HTTPBearer(auto_error=False)

    def actor(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        limits.check("operator_ip:" + (request.client.host if request.client else "unknown"), 120)
        operator = registry.authenticate(credentials.credentials if credentials else None)
        limits.check("operator:" + operator.id, 120)
        return operator

    @router.get("/me", response_model=OperatorIdentity)
    def identity(operator=Depends(actor)):
        return {"id": operator.id, "roles": operator.roles, "expires_at": operator.expires_at}

    @router.post("/sources", response_model=SourceRevision, status_code=201)
    def submit(source: SourceDraft, operator=Depends(actor)):
        return governance.submit(source, operator)

    @router.get("/sources", response_model=list[SourceRevision])
    def revisions(limit: int = Query(default=50, ge=1, le=100), operator=Depends(actor)):
        with store.connect() as db:
            rows = db.execute(
                "SELECT source_id, version FROM source_revisions "
                "ORDER BY submitted_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [governance.revision(row["source_id"], row["version"]) for row in rows]

    @router.get("/sources/{source_id}/{version}", response_model=SourceRevision)
    def revision(source_id: str, version: str, operator=Depends(actor)):
        return governance.revision(source_id, version)

    @router.post("/sources/{source_id}/{version}/reviews", response_model=SourceRevision)
    def review(source_id: str, version: str, payload: ReviewRequest, operator=Depends(actor)):
        return governance.review(source_id, version, payload, operator)

    @router.post("/sources/{source_id}/{version}/activate", response_model=SourceRevision)
    def activate(source_id: str, version: str, payload: VersionAction, operator=Depends(actor)):
        return governance.activate(source_id, version, payload, operator)

    @router.post("/sources/{source_id}/{version}/withdraw", response_model=SourceRevision)
    def withdraw(source_id: str, version: str, payload: VersionAction, operator=Depends(actor)):
        return governance.withdraw(source_id, version, payload, operator)

    @router.post("/questions/conflict", response_model=QuestionConflict)
    def conflict(payload: ConflictLookup, operator=Depends(actor)):
        return governance.conflict(payload.question, payload.language)

    @router.post("/questions/resolve", response_model=QuestionConflict)
    def resolve(payload: ResolveQuestionRequest, operator=Depends(actor)):
        return governance.resolve(payload, operator)

    @router.get("/audit", response_model=list[AuditEvent])
    def audit(
        after: int = Query(default=0, ge=0),
        limit: int = Query(default=100, ge=1, le=200),
        operator=Depends(actor),
    ):
        return [event for event in governance.events() if event.sequence > after][:limit]

    @router.post("/medicines", response_model=MedicineRecord, status_code=201)
    def medicine(payload: MedicineImport, operator=Depends(actor)):
        return governance.import_medicine(payload, operator)

    @router.post("/bundles", response_model=BundleManifest, status_code=201)
    def publish_bundle(payload: BundlePublishRequest, operator=Depends(actor)):
        return bundles.publish(payload, operator)

    return router
