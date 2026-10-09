import asyncio
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from arogya_api.core.host_specs import host_specs
from arogya_api.inference.errors import ProviderUnavailable
from arogya_api.knowledge.operators import require_role
from arogya_api.runtime.models import (
    EngineRuntime,
    ModelAction,
    RuntimeStatus,
    WorkerRuntime,
)


def unavailable_runtime(settings, reason="Worker could not be reached."):
    return WorkerRuntime(
        checked_at=datetime.now(UTC),
        engines=[
            EngineRuntime(
                id="qwen_selector",
                name=settings.qwen_model,
                task="evidence_selection",
                state="unavailable" if settings.qwen_digest else "unconfigured",
                revision=settings.qwen_digest,
                reason=reason,
            ),
            EngineRuntime(
                id="laya_router",
                name="Laya multilingual",
                task="intent_routing",
                state="unavailable" if settings.laya_revision else "unconfigured",
                revision=settings.laya_revision,
                reason=reason,
            ),
        ],
    )


async def observe_worker(client, settings, classifier_loaded, busy):
    runtime = unavailable_runtime(settings, "Configured model is not currently available.")
    qwen, laya = runtime.engines
    laya.loaded = classifier_loaded
    if classifier_loaded and settings.laya_revision:
        laya.state = "busy" if busy else "ready"
        laya.reason = "Routing is advisory; reviewed task metadata remains authoritative."
    if not settings.qwen_digest:
        return runtime
    responses = await asyncio.gather(
        client.get("/api/tags", timeout=3),
        client.get("/api/ps", timeout=3),
        return_exceptions=True,
    )
    try:
        tags = responses[0]
        if isinstance(tags, Exception):
            raise ValueError
        tags.raise_for_status()
        if not any(
            m.get("name") == settings.qwen_model and m.get("digest") == settings.qwen_digest
            for m in tags.json()["models"]
        ):
            return runtime
        qwen.state = "busy" if busy else "ready"
        qwen.reason = "Pinned model is installed; answers still need reviewed sources."
        running = responses[1]
        if isinstance(running, Exception):
            return runtime
        running.raise_for_status()
        models = running.json()["models"]
        if not isinstance(models, list):
            raise ValueError
        qwen.loaded = False
        for model in models:
            if (
                model.get("name") == settings.qwen_model
                and model.get("digest") != settings.qwen_digest
            ):
                qwen.state = "unavailable"
                qwen.loaded = None
                qwen.reason = "Running model revision does not match the configured pin."
                return runtime
            if (
                model.get("name") == settings.qwen_model
                and model.get("digest") == settings.qwen_digest
            ):
                qwen.loaded = True
                # Ollama-reported allocation, not total process/system memory.
                qwen.memory_bytes = model.get("size_vram")
                qwen.context_tokens = model.get("context_length")
                break
        return WorkerRuntime.model_validate(runtime.model_dump())
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        return runtime.model_copy(
            update={
                "engines": [
                    qwen.model_copy(
                        update={
                            "loaded": None,
                            "memory_bytes": None,
                            "context_tokens": None,
                        }
                    ),
                    laya,
                ]
            }
        )


def runtime_router(store, provider, registry, limits, language=None, image_reader=None):
    router = APIRouter(tags=["Model runtime"])
    bearer = HTTPBearer(auto_error=False)

    @router.get("/api/v1/runtime", response_model=RuntimeStatus)
    async def status(request: Request, response: Response):
        limits.check("runtime:" + (request.client.host if request.client else "unknown"), 30)
        response.headers["Cache-Control"] = "no-store"
        observed = await provider.runtime()
        engines = observed.engines + (await language.runtime() if language else [])
        if hasattr(provider, "bonsai_runtime"):
            engines.append(await provider.bonsai_runtime())
        if image_reader:
            engines.append(await image_reader.runtime())
        return RuntimeStatus(
            host=host_specs(),
            checked_at=observed.checked_at,
            engines=engines,
            reviewed_sources=len(store.manifest()["sources"]),
            reviewed_questions=len(store.questions("en", 100)) + len(store.questions("ne", 100)),
        )

    @router.post("/api/v1/operator/models/qwen", response_model=WorkerRuntime)
    async def manage(
        payload: ModelAction,
        request: Request,
        credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    ):
        limits.check("model_admin:" + (request.client.host if request.client else "unknown"), 10)
        actor = registry.authenticate(credentials.credentials if credentials else None)
        require_role(actor, "administrator")
        if payload.expected_revision != provider.settings.qwen_digest:
            raise HTTPException(409, "model_revision_changed")
        try:
            return await provider.manage_model(payload)
        except ProviderUnavailable:
            raise HTTPException(503, "model_runtime_unavailable") from None

    return router
