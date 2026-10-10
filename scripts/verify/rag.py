"""Exercise current gateway source against the configured real Qwen worker.

Uses a synthetic document and temporary databases; leaves existing services and
user conversations intact. Fails if real inference or required references fail.
"""

import json
import tempfile
import time
from pathlib import Path

from arogya_api.core.settings import Settings
from arogya_api.main import create_app
from dotenv import load_dotenv
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]


def main():
    load_dotenv(ROOT / ".local/backend.env", override=False)
    rows = [
        f"Section {i}: " + "Background wording for this synthetic passage. " * 3
        for i in range(1, 41)
    ]
    rows[5] = "Glucose: 89.5 mg/dL"
    rows[35] = "Creatinine: 1.25 mg/dL"
    rows[38] = "Follow-up: Monday at the clinic"
    text = "\n".join(rows)
    receipts = []
    with tempfile.TemporaryDirectory(prefix="arogya-rag-") as directory:
        settings = Settings.from_environment().model_copy(
            update={
                "database_path": Path(directory) / "metadata.sqlite3",
                "history_database_path": Path(directory) / "history.sqlite3",
                "web_dir": None,
            }
        )
        with TestClient(create_app(settings)) as client:
            token = client.post("/api/v1/session").json()["access_token"]
            headers = {"Authorization": "Bearer " + token}

            def call(method, endpoint, data=None):
                response = getattr(client, method)(
                    endpoint, headers=headers, **({"json": data} if data else {})
                )
                if not response.is_success:
                    raise RuntimeError(
                        f"{endpoint}: {response.status_code} {response.text}"
                    )
                return response.json() if response.content else None

            grant = call(
                "post",
                "/api/v1/consents",
                {
                    "purpose": "document_explanation",
                    "data_categories": ["document_text"],
                },
            )["id"]
            conversation = call("post", "/api/v1/conversations", {"mode": "document"})
            base = "/api/v1/conversations/" + conversation["id"]
            try:
                conversation = call(
                    "post",
                    base + "/attachments/text",
                    {
                        "request_id": "source",
                        "expected_context_revision": 0,
                        "kind": "report",
                        "text": text,
                        "consent_id": grant,
                    },
                )
                attachment = conversation["active_attachment_id"]

                def review(wording):
                    return call(
                        "put",
                        base + "/attachments/" + attachment + "/review",
                        {
                            "expected_context_revision": conversation[
                                "context_revision"
                            ],
                            "text": wording,
                            "text_checked": True,
                            "consent_id": grant,
                        },
                    )

                conversation = review(text)

                def ask(
                    rid, question, language="en", expected="Creatinine: 1.25 mg/dL"
                ):
                    started = time.perf_counter()
                    turn = call(
                        "post",
                        base + "/turns",
                        {
                            "request_id": rid,
                            "expected_context_revision": conversation[
                                "context_revision"
                            ],
                            "message": question,
                            "language": language,
                            "model_profile": "qwen",
                            "consent_id": grant,
                        },
                    )
                    if turn["status"] != "draft" or not any(
                        ref["quote"] == expected for ref in turn["references"]
                    ):
                        raise RuntimeError(
                            "Real inference did not return the required source quote"
                        )
                    document = turn["document"]
                    retrieval = document["retrieval"]
                    if not retrieval["context_reused"] or not retrieval["truncated"]:
                        raise RuntimeError(
                            "Real inference did not reuse bounded retrieved context"
                        )
                    receipt = {
                        "question": question,
                        "status": turn["status"],
                        "language": language,
                        "source_characters": len(text),
                        "retrieved_characters": sum(
                            len(item["quote"]) for item in document["items"]
                        ),
                        "retrieval": retrieval,
                        "model": document["model"],
                        "revision": document["revision"],
                        "seconds": round(time.perf_counter() - started, 3),
                    }
                    receipts.append(receipt)
                    print(json.dumps(receipt, ensure_ascii=False), flush=True)

                ask("creatinine", "Which line mentions creatinine?")
                ask("followup", "Explain that line")
                ask("nepali", "क्रिएटिनिन कुन हरफमा छ?", "ne")
                conversation = review(text.replace("1.25", "1.75"))
                ask(
                    "corrected",
                    "Which line mentions creatinine?",
                    expected="Creatinine: 1.75 mg/dL",
                )
            finally:
                call("delete", base)
                call("delete", "/api/v1/me/data")
    output = ROOT / ".local/document-rag-validation"
    output.mkdir(parents=True, exist_ok=True)
    (output / "live.json").write_text(
        json.dumps(
            {
                "validation": "Current gateway source, real pinned Qwen worker, synthetic document",
                "turns": receipts,
                "test_context_deleted": True,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    print("Live RAG inference passed; temporary test context deleted.")


if __name__ == "__main__":
    main()
