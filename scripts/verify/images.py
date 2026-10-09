"""Exercise the running Python image API with generated non-medical fixtures."""

import base64
import io
import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx
from PIL import Image, ImageDraw, ImageFont


def main():
    output = Path(".local/server-validation")
    output.mkdir(parents=True, exist_ok=True)
    try:
        latin = ImageFont.truetype(
            os.getenv(
                "AROGYA_TEST_LATIN_FONT", "/System/Library/Fonts/Supplemental/Arial.ttf"
            ),
            48,
        )
    except OSError:
        latin = ImageFont.truetype("DejaVuSans.ttf", 48)
    nepali = (
        Path(__file__).resolve().parents[2]
        / "services/api/tests/fixtures/ocr/nepali-printed.png"
    )
    samples = {
        "eng": "BLUE TRIANGLE 123",
        "nep": "नमूना पाठ\nनीलो त्रिकोण\nसंख्या २.५\nपरीक्षण मात्र",
        "eng+nep": "नमूना पाठ\nनीलो त्रिकोण\nसंख्या २.५\nपरीक्षण मात्र",
    }
    receipt = {"actual_checked_at": datetime.now(UTC).isoformat(), "results": []}
    with httpx.Client(
        base_url=os.getenv("AROGYA_TEST_URL", "http://127.0.0.1:8000"),
        timeout=60,
        trust_env=False,
    ) as client:
        assert client.get("/").status_code == 200
        runtime = client.get("/api/v1/runtime").json()
        engine = next(e for e in runtime["engines"] if e["id"] == "server_ocr")
        assert engine["state"] == "ready", engine
        client.headers["Authorization"] = (
            "Bearer " + client.post("/api/v1/session").json()["access_token"]
        )
        try:
            grant = client.post(
                "/api/v1/consents",
                json={
                    "purpose": "image_transcription",
                    "data_categories": ["image_bytes"],
                },
            )
            grant.raise_for_status()
            for language, text in samples.items():
                if language == "eng":
                    image = Image.new("RGB", (1000, 300), "white")
                    ImageDraw.Draw(image).text((50, 50), text, font=latin, fill="black")
                    encoded = io.BytesIO()
                    image.save(encoded, format="PNG")
                    data = encoded.getvalue()
                else:
                    # Browser-rendered fixture preserves Devanagari shaping on macOS Pillow.
                    data = nepali.read_bytes()
                (output / f"{language}.png").write_bytes(data)
                payload = {
                    "image_base64": base64.b64encode(data).decode(),
                    "language": language,
                    "consent_id": grant.json()["id"],
                }
                start = time.monotonic()
                result = client.post("/api/v1/images/read", json=payload)
                assert result.status_code == 200, result.text
                assert (
                    result.json()["text"].strip()
                    and result.json()["revision"] == engine["revision"]
                )
                receipt["results"].append(
                    {
                        "language": language,
                        "expected": text,
                        "observed": result.json()["text"],
                        "seconds": round(time.monotonic() - start, 3),
                    }
                )
            invalid = client.post(
                "/api/v1/images/read",
                json={
                    **payload,
                    "image_base64": base64.b64encode(b"not an image").decode(),
                },
            )
            assert invalid.status_code == 422
            assert (
                client.delete("/api/v1/consents/" + grant.json()["id"]).status_code
                == 204
            )
            assert client.post("/api/v1/images/read", json=payload).status_code == 403
        finally:
            assert client.delete("/api/v1/me/data").status_code == 204
    (output / "images.json").write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2) + "\n"
    )
    print(json.dumps(receipt, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
