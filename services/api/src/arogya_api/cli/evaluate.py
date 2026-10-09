"""Reproducible development evaluation, with no clinical approval or default catalog writes."""

import argparse
import asyncio
import hashlib
import json
import platform
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
from fastapi.testclient import TestClient

from arogya_api.core.paths import workspace_root
from arogya_api.core.safety import POLICY_VERSION, rule_intent
from arogya_api.core.settings import Settings
from arogya_api.inference.client import InferenceClient
from arogya_api.inference.models import GenerateRequest, GenerationResult, IntentResult
from arogya_api.knowledge.models import KnowledgeSource
from arogya_api.main import create_app


class DeterministicFixture:
    """Explicit provider double for checking gateway controls in CI, not model quality."""

    async def close(self):
        pass

    async def status(self):
        return {"qwen_ready": False, "laya_ready": False}

    async def classify(self, message, language):
        return IntentResult(intent=rule_intent(message), provider="rules", model_revision=None)

    async def generate(self, request):
        return GenerationResult(
            selection={"relevant": True, "sentence_ids": ["s1"]},
            model="deterministic-test-fixture",
            digest="a" * 64,
        )


def summary(rows):
    return {
        "passed": sum(r["passed"] for r in rows),
        "total": len(rows),
        "executed": bool(rows),
        "all_passed": all(r["passed"] for r in rows) if rows else None,
    }


def percentile(values, fraction):
    values = sorted(values)
    if not values:
        return None
    position = (len(values) - 1) * fraction
    lower = int(position)
    return round(
        values[lower]
        + (values[min(lower + 1, len(values) - 1)] - values[lower]) * (position - lower),
        2,
    )


def run_evaluation(corpus, settings, mode="live"):
    if settings.mode != "development":
        raise ValueError("Synthetic evaluation requires development mode")
    fixtures = {f["id"]: f for f in corpus["fixtures"]}
    rows = []
    with tempfile.TemporaryDirectory(prefix="arogya-eval-") as directory:
        isolated = settings.model_copy(
            update={
                "database_path": Path(directory) / "metadata.db",
                "allow_test_knowledge": True,
                "operator_registry_path": None,
                "bundle_signing_key_path": None,
            }
        )
        app = create_app(isolated, DeterministicFixture() if mode == "deterministic" else None)
        for fixture in fixtures.values():
            source = KnowledgeSource(
                source_id="eval-" + fixture["id"],
                title="Non-medical synthetic evaluation reference",
                version="fixture-1",
                language=fixture["language"],
                source_url="https://example.invalid/evaluation",
                license="test-only",
                review_status="test_fixture",
                valid_until=datetime.now(UTC) + timedelta(hours=1),
                sections=[
                    {
                        "id": "shape",
                        "questions": [fixture["question"]],
                        "sentences": [fixture["text"]],
                    },
                    {
                        "id": "counter",
                        "questions": [fixture["counter_question"]],
                        "sentences": [fixture["counter_text"]],
                    },
                ],
            )
            app.state.store.source_put(source)
        with TestClient(app) as client:
            headers = None
            for index, case in enumerate(corpus["gateway_cases"]):
                if index % 8 == 0:
                    token = client.post("/api/v1/session").json()["access_token"]
                    headers = {"Authorization": "Bearer " + token}
                fixture = fixtures[case["fixture"]]
                grant = client.post(
                    "/api/v1/consents",
                    headers=headers,
                    json={"purpose": "server_chat", "data_categories": ["message_text"]},
                ).json()
                message = case.get("message") or fixture[case["question_key"]]
                request = {
                    "request_id": case["id"],
                    "message": message,
                    "language": case.get("language", fixture["language"]),
                    "server_processing_consent_id": grant["id"],
                    "medicine_id": case.get("medicine_id"),
                    "preferred_mode": case.get("preferred_mode", "auto"),
                }
                if case.get("consent") == "missing":
                    request["server_processing_consent_id"] = None
                elif case.get("consent") == "revoked":
                    client.delete("/api/v1/consents/" + grant["id"], headers=headers)
                start = time.perf_counter()
                response = client.post("/api/v1/chat", headers=headers, json=request)
                elapsed = round((time.perf_counter() - start) * 1000, 2)
                data = response.json()
                passed = response.status_code == case.get("expected_http", 200)
                if "expected_status" in case:
                    passed &= data.get("status") == case["expected_status"]
                if case.get("expected_status") == "answered":
                    expected = (
                        fixture["counter_text"]
                        if case["question_key"] == "counter_question"
                        else fixture["text"]
                    )
                    passed &= data.get("answer") == expected and bool(data.get("evidence"))
                rows.append(
                    {
                        "id": case["id"],
                        "component": "gateway",
                        "language": fixture["id"],
                        "passed": bool(passed),
                        "http": response.status_code,
                        "status": data.get("status"),
                        "latency_ms": elapsed,
                        "routing_disagreement": data.get("provenance", {}).get(
                            "routing_disagreement", False
                        ),
                    }
                )
    if mode == "live":
        rows.extend(asyncio.run(model_diagnostics(corpus, settings)))
    groups = {
        name: summary([r for r in rows if r["component"] == name])
        for name in ("gateway", "selection", "intent")
    }
    latency = {
        name: {
            "p50_ms": percentile([r["latency_ms"] for r in rows if r["component"] == name], 0.5),
            "p95_ms": percentile([r["latency_ms"] for r in rows if r["component"] == name], 0.95),
        }
        for name in groups
    }
    return {
        "schema_version": "1.0",
        "checked_at": datetime.now(UTC).isoformat(),
        "mode": mode,
        "label_status": corpus["label_status"],
        "clinical_validation": False,
        "model_exercised": mode == "live",
        "policy_version": POLICY_VERSION,
        "model_pins": {
            "qwen_model": settings.qwen_model,
            "qwen_digest": settings.qwen_digest,
            "laya_revision": settings.laya_revision,
        },
        "host": {"system": platform.system(), "architecture": platform.machine()},
        "metrics": groups,
        "latency": latency,
        "cases": rows,
        "release": {
            "development_guardrails_passed": groups["gateway"]["all_passed"],
            "free_form_answering": "blocked",
            "clinical_release": "pending human review and real content",
        },
    }


async def model_diagnostics(corpus, settings):
    provider = InferenceClient(settings)
    fixtures = {f["id"]: f for f in corpus["fixtures"]}
    rows = []
    try:
        status = await provider.status()
        if not status["qwen_ready"] or not status["laya_ready"]:
            raise RuntimeError("Live evaluation requires both pinned Qwen and Laya workers")
        for case in corpus["selection_cases"]:
            fixture = fixtures[case["fixture"]]
            request = GenerateRequest(
                message=case.get("message") or fixture[case["question_key"]],
                language=fixture["language"],
                sentences=[
                    {
                        "id": "s1",
                        "source_id": "eval-" + fixture["id"],
                        "section_id": "test",
                        "version": "fixture-1",
                        "text": fixture[case.get("evidence_key", "text")],
                    }
                ],
            )
            start = time.perf_counter()
            try:
                result = await provider.generate(request)
                actual = result.selection.relevant and bool(result.selection.sentence_ids)
                passed = actual == case["expected_relevant"]
                observed = result.selection.model_dump()
            except Exception as error:
                passed, observed = False, {"error_type": type(error).__name__}
            rows.append(
                {
                    "id": case["id"],
                    "component": "selection",
                    "language": fixture["id"],
                    "passed": passed,
                    "observed": observed,
                    "latency_ms": round((time.perf_counter() - start) * 1000, 2),
                }
            )
        for case in corpus["intent_cases"]:
            start = time.perf_counter()
            result = await provider.classify(case["message"], case["language"])
            rows.append(
                {
                    "id": case["id"],
                    "component": "intent",
                    "language": case["id"].split("_")[0],
                    "passed": result.provider == "laya"
                    and result.intent == case["expected_intent"],
                    "observed": result.model_dump(),
                    "latency_ms": round((time.perf_counter() - start) * 1000, 2),
                }
            )
        return rows
    finally:
        await provider.close()


def main():
    root = workspace_root()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["live", "deterministic"], default="live")
    parser.add_argument("--output", type=Path, default=root / ".local/ai-evaluation.json")
    args = parser.parse_args()
    load_dotenv(root / ".local/backend.env", override=True)
    corpus_bytes = (root / "services/api/tests/fixtures/backend_cases.json").read_bytes()
    corpus = json.loads(corpus_bytes)
    report = run_evaluation(corpus, Settings.from_environment(), args.mode)
    report["corpus_sha256"] = hashlib.sha256(corpus_bytes).hexdigest()
    code = hashlib.sha256()
    for path in sorted((root / "services/api/src/arogya_api").rglob("*.py")):
        code.update(
            str(path.relative_to(root / "services/api/src/arogya_api")).encode()
            + b"\0"
            + path.read_bytes()
        )
    report["backend_code_sha256"] = code.hexdigest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(
        json.dumps(
            {
                "mode": report["mode"],
                "metrics": report["metrics"],
                "release": report["release"],
                "report": str(args.output),
            },
            indent=2,
        )
    )
    if not report["release"]["development_guardrails_passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
