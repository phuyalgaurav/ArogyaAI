import asyncio
import base64
import hashlib
import importlib.util
import json
import os
import signal
import sys
from contextlib import suppress
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from arogya_api.images.models import ImageReadRequest, ImageReadResult
from arogya_api.inference.errors import ProviderUnavailable
from arogya_api.runtime.models import EngineRuntime

OCR_TIMEOUT_SECONDS = 50


class ImageReader:
    def __init__(self, directory):
        self.directory = directory
        self.busy = False

    def verify(self):
        if not self.directory or not importlib.util.find_spec("PIL"):
            raise ValueError("ocr_unconfigured")
        raw = (self.directory / "manifest.json").read_bytes()
        manifest = json.loads(raw)
        if not manifest["version"].startswith("tesseract 5."):
            raise ValueError("ocr_version")
        files = [(Path(manifest["binary"]), manifest["binary_sha256"])]
        files += [
            (self.directory / f"{code}.traineddata", manifest["languages"][code])
            for code in ("eng", "nep")
        ]
        if any(hashlib.sha256(path.read_bytes()).hexdigest() != digest for path, digest in files):
            raise ValueError("ocr_assets_changed")
        return manifest, hashlib.sha256(raw).hexdigest()

    async def runtime(self):
        engine = EngineRuntime(
            id="server_ocr",
            name="Tesseract on Python server",
            task="printed_text_recognition",
            state="unconfigured" if not self.directory else "unavailable",
            reason="Run pnpm setup:server-ocr and restart the server.",
        )
        try:
            manifest, revision = await asyncio.to_thread(self.verify)
            engine.name = manifest["version"]
            engine.revision = revision
            engine.state = "busy" if self.busy else "ready"
            engine.loaded = self.busy
            engine.reason = (
                "Printed English/Nepali text drafts; compare every result with the image."
            )
        except (OSError, ValueError, KeyError, TypeError):
            pass
        return engine

    async def read(self, payload):
        if self.busy:
            raise HTTPException(503, "image_reader_busy", headers={"Retry-After": "3"})
        self.busy = True
        process = None
        try:
            try:
                data = base64.b64decode(payload.image_base64, validate=True)
                if not data or len(data) > 8 * 1024 * 1024:
                    raise ValueError
            except ValueError:
                raise HTTPException(422, "invalid_image") from None
            manifest, revision = await asyncio.to_thread(self.verify)
            process = await asyncio.create_subprocess_exec(
                sys.executable,
                "-m",
                "arogya_api.images.ocr_process",
                manifest["binary"],
                str(self.directory),
                payload.language,
                str(payload.rotation),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                start_new_session=True,
            )
            stdout, _ = await asyncio.wait_for(
                process.communicate(data), timeout=OCR_TIMEOUT_SECONDS
            )
            if process.returncode:
                raise HTTPException(422, "image_could_not_be_read")
            _, after = await asyncio.to_thread(self.verify)
            if revision != after or len(stdout) > 200000:
                raise ValueError("ocr_assets_changed")
            return ImageReadResult(
                text=json.loads(stdout)["text"],
                language=payload.language,
                engine=manifest["version"],
                revision=revision,
            )
        except TimeoutError:
            raise HTTPException(504, "image_reader_timeout") from None
        except (OSError, ValueError, KeyError, TypeError):
            raise HTTPException(503, "image_reader_unavailable") from None
        finally:
            if process:
                # Also terminate native children if the decoder timed out or was cancelled.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                await process.wait()
            self.busy = False


def image_router(store, sessions, reader, limits, vision=None):
    router = APIRouter(tags=["Printed image text"])
    bearer = HTTPBearer(auto_error=False)

    def owner(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        return sessions.verify(credentials.credentials if credentials else None)

    @router.post("/api/v1/images/prescription", response_model=ImageReadResult)
    @router.post("/api/v1/images/read", response_model=ImageReadResult)
    async def read(
        payload: ImageReadRequest, request: Request, response: Response, owner_id=Depends(owner)
    ):
        if not store.consent_valid(payload.consent_id, owner_id, "image_transcription"):
            raise HTTPException(403, "processing_consent_required")
        limits.check("image:" + owner_id, 8)
        visual = request.url.path.endswith("/prescription")
        if visual and not vision:
            raise HTTPException(503, "prescription_vision_unavailable")
        operation = asyncio.create_task(
            vision.read_prescription(payload) if visual else reader.read(payload)
        )
        try:
            while not operation.done():
                await asyncio.wait({operation}, timeout=0.25)
                if not operation.done() and await request.is_disconnected():
                    raise HTTPException(499, "image_reading_cancelled")
            result = await operation
        except ProviderUnavailable:
            raise HTTPException(503, "prescription_vision_unavailable") from None
        finally:
            if not operation.done():
                operation.cancel()
                with suppress(asyncio.CancelledError):
                    await operation
        if not store.consent_valid(payload.consent_id, owner_id, "image_transcription"):
            raise HTTPException(403, "processing_consent_expired_or_revoked")
        result.method = "vision" if visual else "printed_ocr"
        result.warnings = ["unverified_transcription"]
        if not visual:
            result.warnings.append("printed_ocr_not_handwriting_verified")
        if "[illegible]" in result.text:
            result.warnings.append("illegible_regions")
        if "[page exceeds transcription limit]" in result.text:
            raise HTTPException(413, "document_limit_exceeded")
        response.headers["Cache-Control"] = "no-store"
        return result

    return router
