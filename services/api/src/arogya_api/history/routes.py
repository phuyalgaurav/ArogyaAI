from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from arogya_api.history.models import (
    HistoryConsent,
    HistoryConversation,
    HistoryIndex,
    HistoryVault,
)


def history_router(store, sessions, limits, conversations=None):
    router = APIRouter(prefix="/api/v1/history", tags=["Opt-in chat history"])
    bearer = HTTPBearer(auto_error=False)

    def owner(
        response: Response, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)
    ):
        response.headers["Cache-Control"] = "no-store"
        return store.owner(credentials.credentials if credentials else None)

    @router.post("/vault", response_model=HistoryVault)
    def enroll(
        payload: HistoryConsent,
        request: Request,
        response: Response,
        credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    ):
        session_id = sessions.verify(credentials.credentials if credentials else None)
        limits.check("history-enroll:" + session_id, 3)
        limits.check("history-ip:" + (request.client.host if request.client else "unknown"), 10)
        response.headers["Cache-Control"] = "no-store"
        return store.enroll(payload.client_access_token)

    @router.get("/conversations", response_model=HistoryIndex)
    def index(owner_id=Depends(owner)):
        limits.check("history-read:" + owner_id, 30)
        return store.index(owner_id)

    @router.put("/conversations/{conversation_id}", response_model=HistoryConversation)
    def put(conversation_id: str, payload: HistoryConversation, owner_id=Depends(owner)):
        if conversation_id != payload.id:
            raise HTTPException(422, "conversation_id_mismatch")
        limits.check("history-write:" + owner_id, 120)
        return store.put(owner_id, payload)

    @router.delete("/conversations/{conversation_id}", status_code=204)
    def delete(conversation_id: str, owner_id=Depends(owner)):
        if len(conversation_id) != 32 or any(
            char not in "abcdef0123456789" for char in conversation_id
        ):
            raise HTTPException(422, "invalid_conversation_id")
        limits.check("history-delete:" + owner_id, 60)
        store.delete_conversation(owner_id, conversation_id)

    @router.delete("/vault", status_code=204)
    async def revoke(owner_id=Depends(owner)):
        store.revoke(owner_id)
        if conversations:
            await conversations.purge()

    return router
