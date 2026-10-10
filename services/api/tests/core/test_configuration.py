import asyncio

import httpx
import pytest
from pydantic import ValidationError

from arogya_api.core.settings import Settings
from arogya_api.inference.client import InferenceClient
from arogya_api.inference.errors import ProviderUnavailable
from arogya_api.inference.models import GenerateRequest
from arogya_api.knowledge.store import Store


@pytest.mark.parametrize(
    "values",
    [
        {"mode": "production", "allow_test_knowledge": True},
        {"worker_url": "http://localhost:8001"},
        {"worker_token": "short"},
        {"qwen_digest": "latest"},
        {"laya_path": "/tmp/unpinned"},
        {"ollama_url": "http://user:password@localhost:11435"},
    ],
)
def test_invalid_configuration_fails_closed(values):
    with pytest.raises(ValidationError):
        Settings(**values)


def test_production_requires_explicit_key(monkeypatch):
    monkeypatch.setenv("AROGYA_MODE", "production")
    monkeypatch.delenv("AROGYA_SIGNING_KEY", raising=False)
    with pytest.raises(ValueError):
        Settings.from_environment()


def test_test_fixture_import_requires_explicit_development_opt_in(tmp_path, source):
    with pytest.raises(ValueError):
        Store(tmp_path / "metadata.db").source_put(source)


def test_dosing_sections_are_excluded_from_retrieval(backend, source):
    _, store, *_ = backend
    source.sections[0].kind = "dosing"
    source.version = "test-2"
    store.source_put(source)
    assert store.retrieve("What is the blue triangle?", "en") == []


def test_unapproved_source_cannot_back_a_medicine(tmp_path, source):
    from arogya_api.knowledge.models import MedicineRecord

    store = Store(tmp_path / "metadata.db", allow_test_knowledge=True)
    source.review_status = "pending"
    store.source_put(source)
    with pytest.raises(ValueError):
        store.medicine_put(
            MedicineRecord(
                id="synthetic",
                canonical_name="Synthetic",
                active_ingredients=["fictional"],
                aliases=[],
                jurisdiction="test-only",
                source_ids=[source.source_id],
            )
        )


def test_worker_failure_becomes_typed_unavailability_and_rule_fallback():
    async def check():
        def fail(request):
            raise httpx.ConnectError("offline")

        client = InferenceClient(
            Settings(worker_url="http://worker.invalid", worker_token="w" * 64),
            httpx.MockTransport(fail),
        )
        try:
            assert await client.status() == {"qwen_ready": False, "laya_ready": False}
            assert (await client.classify("medicine information", "en")).intent == "medicine_info"
            request = GenerateRequest(
                message="question",
                language="en",
                sentences=[
                    {
                        "id": "s1",
                        "source_id": "test",
                        "section_id": "shape",
                        "version": "test-1",
                        "text": "test",
                    }
                ],
            )
            with pytest.raises(ProviderUnavailable):
                await client.generate(request)
        finally:
            await client.close()

    asyncio.run(check())
