import asyncio
import hmac
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from arogya_api.core.privacy import BoundedRequestBody
from arogya_api.core.settings import Settings
from arogya_api.runtime.models import WorkerRuntime
from arogya_api.speech.engine import LanguageEngine
from arogya_api.speech.models import (
    SpeechInput,
    SpeechResult,
    TranscriptionInput,
    TranscriptionResult,
    TranslationInput,
    TranslationResult,
)


def create_language_worker(settings=None, engine=None):
    settings = settings or Settings.from_environment()

    @asynccontextmanager
    async def lifespan(app):
        app.state.engine = engine or await asyncio.to_thread(
            LanguageEngine, settings.language_model_dir
        )
        app.state.running = None
        yield
        if app.state.running:
            await asyncio.shield(app.state.running)

    app = FastAPI(title="ArogyaAI private translation and voice worker", lifespan=lifespan)
    app.add_middleware(BoundedRequestBody, max_bytes=1000000)
    bearer = HTTPBearer(auto_error=False)

    def authenticate(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        if not settings.language_worker_token:
            raise HTTPException(503, "language_worker_not_configured")
        if not credentials or not hmac.compare_digest(
            credentials.credentials, settings.language_worker_token.get_secret_value()
        ):
            raise HTTPException(401, "invalid_service_token")

    @app.exception_handler(RequestValidationError)
    async def invalid(request, error):
        return JSONResponse({"detail": "invalid_request"}, 422)

    @app.get(
        "/internal/v1/language/runtime",
        response_model=WorkerRuntime,
        dependencies=[Depends(authenticate)],
    )
    def runtime():
        return app.state.engine.runtime(app.state.running is not None)

    async def execute(kind, payload):
        if app.state.running:
            raise HTTPException(503, "language_worker_busy", headers={"Retry-After": "3"})
        task = asyncio.create_task(asyncio.to_thread(app.state.engine.run, kind, payload))
        app.state.running = task

        def release(completed):
            if app.state.running is completed:
                app.state.running = None
            if not completed.cancelled():
                completed.exception()  # Consume failures even when the requester disconnects.

        task.add_done_callback(release)
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=75)
        except (ValueError, RuntimeError, OSError):
            raise HTTPException(503, "language_processing_failed") from None
        except TimeoutError:
            raise HTTPException(504, "language_processing_timeout") from None

    @app.post(
        "/internal/v1/language/translation",
        response_model=TranslationResult,
        dependencies=[Depends(authenticate)],
    )
    async def translate(payload: TranslationInput):
        return await execute("translation", payload)

    @app.post(
        "/internal/v1/language/stt",
        response_model=TranscriptionResult,
        dependencies=[Depends(authenticate)],
    )
    async def transcribe(payload: TranscriptionInput):
        return await execute("stt", payload)

    @app.post(
        "/internal/v1/language/tts",
        response_model=SpeechResult,
        dependencies=[Depends(authenticate)],
    )
    async def speak(payload: SpeechInput):
        return await execute("tts", payload)

    return app


app = create_language_worker()
