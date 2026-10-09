"""Compare installed readers against synthetic references, or an explicit local manifest.

Results are engineering measurements, not handwriting or clinical acceptance.
Manifest entries: {id, image, reference, language, kind, critical_terms, category}.
"""

import argparse
import base64
import json
import time
import unicodedata
from datetime import UTC, datetime
from pathlib import Path

import httpx


def distance(a, b):
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, 1):
        current = [i]
        for j, right in enumerate(b, 1):
            current.append(
                min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (left != right))
            )
        previous = current
    return previous[-1]


def metrics(reference, observed, critical_terms):
    reference = unicodedata.normalize("NFC", reference)
    observed = unicodedata.normalize("NFC", observed)
    return {
        "character_error_rate": distance(reference, observed) / max(1, len(reference)),
        "word_error_rate": distance(reference.split(), observed.split())
        / max(1, len(reference.split())),
        "critical_exact": {term: term in observed for term in critical_terms},
        "missing_reference_lines": [
            line for line in reference.splitlines() if line not in observed
        ],
    }


def synthetic(output):
    from PIL import Image, ImageDraw, ImageFont

    samples = [
        (
            "printed-en",
            "Synthetic test only\nExamplemed 2.5 mg\nFollow-up: Friday",
            "eng",
            ["Examplemed", "2.5 mg", "Friday"],
        ),
        (
            "printed-ne",
            "परीक्षणका लागि मात्र\nहेमोग्लोबिन: १२.५ g/dL\nपुनः भेट: शुक्रबार",
            "nep",
            ["१२.५ g/dL", "शुक्रबार"],
        ),
        (
            "mixed-label",
            "Synthetic label only\nExamplemed 500 mg\nऔषधिको नाम जाँच्नुहोस्",
            "eng+nep",
            ["Examplemed", "500 mg"],
        ),
    ]
    font_path = Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf")
    if not font_path.is_file():
        raise SystemExit(
            "Supply --manifest with reference images, or install a Unicode font for synthetic fixtures."
        )
    rows = []
    for key, text, language, critical in samples:
        image = Image.new("RGB", (1300, 620), "white")
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype(str(font_path), 48)
        for i, line in enumerate(text.splitlines()):
            draw.text((45, 80 + 150 * i), line, font=font, fill="black")
        path = output / (key + ".png")
        image.save(path)
        rows.append(
            {
                "id": key,
                "image": str(path),
                "reference": text,
                "language": language,
                "kind": "medicine" if key == "mixed-label" else "report",
                "critical_terms": critical,
                "category": "synthetic_printed",
            }
        )
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--manifest", type=Path)
    parser.add_argument(
        "--engines",
        nargs="+",
        choices=["tesseract", "qwen", "bonsai"],
        default=["tesseract", "qwen", "bonsai"],
    )
    parser.add_argument(
        "--output", type=Path, default=Path(".local/recognition-evaluation")
    )
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    rows = json.loads(args.manifest.read_text()) if args.manifest else synthetic(output)
    records = []
    with httpx.Client(base_url=args.api, timeout=170, trust_env=False) as client:
        token = client.post("/api/v1/session").json()["access_token"]
        client.headers["Authorization"] = "Bearer " + token
        grant = client.post(
            "/api/v1/consents",
            json={
                "purpose": "image_transcription",
                "data_categories": ["image_bytes"],
                "expires_in_seconds": 3600,
            },
        ).json()["id"]
        try:
            for sample in rows:
                path = Path(sample["image"])
                if not path.is_absolute() and args.manifest:
                    path = args.manifest.parent / path
                image = base64.b64encode(path.read_bytes()).decode()
                for engine in args.engines:
                    start = time.monotonic()
                    response = client.post(
                        "/api/v1/images/"
                        + ("read" if engine == "tesseract" else "prescription"),
                        json={
                            "image_base64": image,
                            "language": sample["language"],
                            "kind": sample.get("kind", "report"),
                            "consent_id": grant,
                            "model_profile": "qwen"
                            if engine == "tesseract"
                            else engine,
                        },
                    )
                    result = response.json()
                    row = {
                        "sample": sample["id"],
                        "category": sample["category"],
                        "requested_engine": engine,
                        "seconds": round(time.monotonic() - start, 3),
                        "http_status": response.status_code,
                        "result": result,
                    }
                    if response.is_success:
                        row["metrics"] = metrics(
                            sample["reference"],
                            result["text"],
                            sample["critical_terms"],
                        )
                    records.append(row)
                    (output / "results.json").write_text(
                        json.dumps(
                            {
                                "checked_at": datetime.now(UTC).isoformat(),
                                "samples": rows,
                                "results": records,
                                "limitations": [
                                    "No clinical or native-speaker review",
                                    "Synthetic printed fixtures do not establish handwriting quality",
                                ],
                            },
                            ensure_ascii=False,
                            indent=2,
                        )
                    )
                    print(
                        json.dumps(
                            {k: v for k, v in row.items() if k != "result"},
                            ensure_ascii=False,
                        ),
                        flush=True,
                    )
        finally:
            client.delete("/api/v1/me/data")


if __name__ == "__main__":
    main()
