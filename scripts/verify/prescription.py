"""Verify the real Python/Qwen photo path using a synthetic printed prescription."""

import base64
import io
import json
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx
from PIL import Image, ImageDraw, ImageFont


def main():
    output = Path(__file__).resolve().parents[2] / ".local/prescription-validation"
    output.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (1100, 620), "white")
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("Arial.ttf", 42)
    except OSError:
        font = ImageFont.load_default(size=42)
    lines = [
        "SYNTHETIC TEST - NOT TREATMENT",
        "Example medicine: 2.5 mg",
        "Follow-up: Friday",
    ]
    for number, line in enumerate(lines):
        draw.text((45, 70 + number * 150), line, fill="black", font=font)
    image.save(output / "synthetic-prescription.png")
    raw = io.BytesIO()
    image.save(raw, "PNG")
    with httpx.Client(
        base_url="http://127.0.0.1:8000", timeout=75, trust_env=False
    ) as client:
        token = client.post("/api/v1/session").json()["access_token"]
        client.headers["Authorization"] = "Bearer " + token
        try:
            payload = {
                "image_base64": base64.b64encode(raw.getvalue()).decode(),
                "consent_id": "not-granted",
            }
            assert (
                client.post("/api/v1/images/prescription", json=payload).status_code
                == 403
            )
            grant = client.post(
                "/api/v1/consents",
                json={
                    "purpose": "image_transcription",
                    "data_categories": ["image_bytes"],
                },
            ).json()["id"]
            start = time.monotonic()
            response = client.post(
                "/api/v1/images/prescription", json={**payload, "consent_id": grant}
            )
            response.raise_for_status()
            result = response.json()
            assert (
                result["status"] == "unverified" and "vision draft" in result["engine"]
            )
            assert "2.5 mg" in result["text"] and "Friday" in result["text"], result
            record = {
                "actual_checked_at": datetime.now(UTC).isoformat(),
                "seconds": round(time.monotonic() - start, 3),
                "fixture": "synthetic printed photo; not a handwriting accuracy evaluation",
                "expected_lines": lines,
                "result": result,
            }
            (output / "result.json").write_text(json.dumps(record, indent=2) + "\n")
            print(json.dumps(record, indent=2))
        finally:
            client.delete("/api/v1/me/data").raise_for_status()


if __name__ == "__main__":
    main()
