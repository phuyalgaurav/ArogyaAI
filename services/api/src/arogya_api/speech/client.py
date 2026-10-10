import base64
import io
import wave

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from arogya_api.runtime.models import EngineRuntime, WorkerRuntime
from arogya_api.speech.engine import ENGINE_IDS, PINS, decode_clip, translation_warnings
from arogya_api.speech.models import (
    SpeechRequest,
    SpeechResult,
    TranscriptionRequest,
    TranscriptionResult,
    TranslationRequest,
    TranslationResult,
)


class LanguageClient:
    def __init__(self, settings, transport=None):
        self.settings = settings
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(80, connect=2),
            transport=transport,
            trust_env=False,
            follow_redirects=False,
            headers={
                "Authorization": "Bearer "
                + (
                    settings.language_worker_token.get_secret_value()
                    if settings.language_worker_token
                    else ""
                )
            },
        )

    async def close(self):
        await self.client.aclose()

    async def runtime(self):
        if self.settings.language_worker_url:
            try:
                response = await self.client.get(
                    self.settings.language_worker_url + "/internal/v1/language/runtime", timeout=8
                )
                response.raise_for_status()
                observed = WorkerRuntime.model_validate(response.json())
                engines = {engine.id: engine for engine in observed.engines}
                if len(observed.engines) != 3 or set(engines) != set(ENGINE_IDS.values()):
                    raise ValueError
                for kind, engine_id in ENGINE_IDS.items():
                    if (
                        engines[engine_id].revision != PINS[kind]["revision"]
                        or engines[engine_id].name != PINS[kind]["repository"]
                        or engines[engine_id].task
                        != {
                            "translation": "translation",
                            "stt": "transcription",
                            "tts": "speech_synthesis",
                        }[kind]
                    ):
                        raise ValueError
                return observed.engines
            except (httpx.HTTPError, ValueError):
                pass
        tasks = {"translation": "translation", "stt": "transcription", "tts": "speech_synthesis"}
        return [
            EngineRuntime(
                id=ENGINE_IDS[kind],
                name=PINS[kind]["repository"],
                task=tasks[kind],
                state="unavailable" if self.settings.language_worker_url else "unconfigured",
                revision=PINS[kind]["revision"],
                loaded=None,
                reason="Private language worker unavailable; run pnpm setup:language and restart.",
            )
            for kind in ENGINE_IDS
        ]

    async def run(self, kind, payload, result_type):
        if not self.settings.language_worker_url:
            raise HTTPException(503, "language_worker_unavailable")
        try:
            response = await self.client.post(
                self.settings.language_worker_url + "/internal/v1/language/" + kind,
                json=payload.model_dump(exclude={"consent_id"}),
            )
            if (
                response.status_code == 503
                and response.json().get("detail") == "language_worker_busy"
            ):
                raise HTTPException(503, "language_worker_busy", headers={"Retry-After": "3"})
            response.raise_for_status()
            if len(response.content) > 2800000:
                raise ValueError
            result = result_type.model_validate(response.json())
            pin = PINS[kind]
            if (result.model, result.revision) != (pin["repository"], pin["revision"]):
                raise ValueError
            if kind == "translation" and (
                result.original_text,
                result.source_language,
                result.target_language,
            ) != (payload.text, payload.source_language, payload.target_language):
                raise ValueError
            if kind == "tts" and (result.text, result.speaker) != (payload.text, payload.speaker):
                raise ValueError
            if kind == "tts":
                with wave.open(
                    io.BytesIO(base64.b64decode(result.audio_base64, validate=True))
                ) as audio:
                    if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (
                        1,
                        2,
                        22050,
                    ):
                        raise ValueError
                    frames = audio.getnframes()
                    if (
                        abs(frames / 22050 - result.duration_seconds) > 1 / 22050
                        or len(audio.readframes(frames)) != frames * 2
                    ):
                        raise ValueError
            if kind == "stt" and (result.processor_model, result.processor_revision) != (
                PINS["stt_processor"]["repository"],
                PINS["stt_processor"]["revision"],
            ):
                raise ValueError
            if (
                kind == "stt"
                and abs(decode_clip(payload.audio_base64)[1] - result.duration_seconds) > 1 / 16000
            ):
                raise ValueError
            if kind == "translation":
                warnings = translation_warnings(payload.text, result.text, payload.protected_terms)
                result.warnings = list(dict.fromkeys(result.warnings + warnings))
                if result.warnings:
                    result.status = "needs_review"
            return result
        except (httpx.HTTPError, ValueError, wave.Error, EOFError):
            raise HTTPException(503, "language_processing_unavailable") from None


def language_router(store, sessions, client, limits):
    router = APIRouter(prefix="/api/v1", tags=["Translation and speech"])
    bearer = HTTPBearer(auto_error=False)

    def owner(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        return sessions.verify(credentials.credentials if credentials else None)

    async def execute(kind, purpose, payload, result_type, owner_id, response):
        if not store.consent_valid(payload.consent_id, owner_id, purpose):
            raise HTTPException(403, "processing_consent_required")
        limits.check(purpose + ":" + owner_id, 8)
        if kind == "stt":
            try:
                decode_clip(payload.audio_base64)
            except ValueError:
                raise HTTPException(422, "invalid_audio_clip") from None
        result = await client.run(kind, payload, result_type)
        if not store.consent_valid(payload.consent_id, owner_id, purpose):
            raise HTTPException(403, "processing_consent_expired_or_revoked")
        response.headers["Cache-Control"] = "no-store"
        return result

    @router.post("/translation", response_model=TranslationResult)
    async def translation(payload: TranslationRequest, response: Response, owner_id=Depends(owner)):
        return await execute(
            "translation", "translation", payload, TranslationResult, owner_id, response
        )

    @router.post("/speech/transcribe", response_model=TranscriptionResult)
    async def transcribe(
        payload: TranscriptionRequest, response: Response, owner_id=Depends(owner)
    ):
        return await execute(
            "stt", "speech_transcription", payload, TranscriptionResult, owner_id, response
        )

    @router.post("/speech/synthesize", response_model=SpeechResult)
    async def speak(payload: SpeechRequest, response: Response, owner_id=Depends(owner)):
        return await execute("tts", "speech_synthesis", payload, SpeechResult, owner_id, response)

    return router
