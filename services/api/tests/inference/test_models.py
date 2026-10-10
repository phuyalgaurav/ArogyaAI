import asyncio
import json

import pytest

from arogya_api.core.settings import Settings
from arogya_api.documents.models import DocumentLine, DocumentSelectionRequest
from arogya_api.inference.client import InferenceClient
from arogya_api.inference.errors import ProviderUnavailable


def request(profile="bonsai"):
    return DocumentSelectionRequest(
        kind="report",
        model_profile=profile,
        lines=[DocumentLine(id="L1", text="Synthetic quantity: 2.5 mg")],
    )


def test_explicit_bonsai_never_falls_back_to_qwen(tmp_path):
    client = InferenceClient(Settings())

    async def run():
        try:
            with pytest.raises(ProviderUnavailable):
                await client.select_document(request())
            assert client.profile("bonsai") == "bonsai"
            assert client.profile("qwen") == "qwen"
        finally:
            await client.close()

    asyncio.run(run())


@pytest.mark.parametrize("change", [None, "number", "reference", "json"])
def test_bonsai_document_references_and_quantities_are_validated(change):
    client = InferenceClient(Settings())

    async def fake(*args):
        value = {
            "highlights": [
                {
                    "line_id": "L9" if change == "reference" else "L1",
                    "kind": "medicine",
                    "meaning": "The document says 5 mg."
                    if change == "number"
                    else "The document records 2.5 mg.",
                }
            ],
            "answer_line_ids": [],
        }
        return ("bad JSON" if change == "json" else json.dumps(value)), "a" * 64

    client.bonsai_generate = fake

    async def run():
        try:
            if change:
                with pytest.raises(ProviderUnavailable):
                    await client.select_document(request())
            else:
                result = await client.select_document(request())
                assert result.selection.highlights[0].meaning == "The document records 2.5 mg."
                assert "Bonsai" in result.model
        finally:
            await client.close()

    asyncio.run(run())


def test_switch_to_qwen_cannot_kill_inflight_bonsai():
    client = InferenceClient(Settings())

    async def run():
        await client.model_gate.acquire()
        try:
            with pytest.raises(ProviderUnavailable):
                await client.select_document(request("qwen"))
        finally:
            client.model_gate.release()
            await client.close()

    asyncio.run(run())


def test_bonsai_cancellation_kills_only_owned_runtime_and_releases_slot(tmp_path):
    from arogya_api.inference.bonsai import BonsaiClient

    client = BonsaiClient(None)
    client.verify = lambda: {"python": __import__("sys").executable, "revision": "a" * 64}
    original = asyncio.create_subprocess_exec
    children = []

    async def fake(*args, **kwargs):
        child = await original(
            __import__("sys").executable, "-c", "import time;time.sleep(60)", **kwargs
        )
        children.append(child)
        return child

    from unittest.mock import patch

    async def run():
        with patch("arogya_api.inference.bonsai.asyncio.create_subprocess_exec", fake):
            task = asyncio.create_task(client.generate("fixture", "fixture", 10))
            for _ in range(100):
                if children:
                    break
                await asyncio.sleep(0.01)
            assert children and client.busy
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert children[0].returncode is not None and not client.busy and client.process is None

    asyncio.run(run())
