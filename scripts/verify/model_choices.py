"""Exercise both actual document/vision profiles through the consented gateway."""

import json
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx


def main():
    output = Path(".local/model-choice-validation")
    output.mkdir(parents=True, exist_ok=True)
    records = []
    text = "Synthetic test note\nRest and drink fluids\nFollow-up: Friday"
    with httpx.Client(
        base_url="http://127.0.0.1:8000", timeout=170, trust_env=False
    ) as client:
        token = client.post("/api/v1/session").json()["access_token"]
        client.headers["Authorization"] = "Bearer " + token
        try:
            grants = {}
            for purpose, category in [
                ("document_explanation", "document_text"),
                ("image_transcription", "image_bytes"),
            ]:
                grants[purpose] = client.post(
                    "/api/v1/consents",
                    json={"purpose": purpose, "data_categories": [category]},
                ).json()["id"]
            for profile in ("bonsai", "qwen"):
                started = time.monotonic()
                response = client.post(
                    "/api/v1/documents/explain",
                    json={
                        "text": text,
                        "kind": "doctor_note",
                        "language": "en",
                        "text_checked": True,
                        "model_profile": profile,
                        "consent_id": grants["document_explanation"],
                    },
                )
                response.raise_for_status()
                result = response.json()
                assert result["status"] == "draft" and result["items"]
                assert ("Bonsai" in result["model"]) == (profile == "bonsai")
                assert all(
                    item["quote"] in text.splitlines() for item in result["items"]
                )
                records.append(
                    {
                        "profile": profile,
                        "task": "document",
                        "seconds": round(time.monotonic() - started, 3),
                        "result": result,
                    }
                )
                print(profile, "document passed", flush=True)
            (output / "result.json").write_text(
                json.dumps(
                    {
                        "actual_checked_at": datetime.now(UTC).isoformat(),
                        "records": records,
                    },
                    indent=2,
                )
                + "\n"
            )
        finally:
            client.delete("/api/v1/me/data").raise_for_status()


if __name__ == "__main__":
    main()
