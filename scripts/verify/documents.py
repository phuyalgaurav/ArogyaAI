"""Run synthetic document, Nepali dictation and read-aloud through the local API."""

import base64
import io
import json
import time
import wave
from datetime import UTC, datetime
from pathlib import Path

import httpx


def main():
    import numpy as np

    output = Path(__file__).resolve().parents[2] / ".local/document-validation"
    output.mkdir(parents=True, exist_ok=True)
    records = []
    with httpx.Client(
        base_url="http://127.0.0.1:8000", timeout=85, trust_env=False
    ) as client:
        token = client.post("/api/v1/session").json()["access_token"]
        client.headers["Authorization"] = "Bearer " + token
        try:
            grants = {}
            for purpose, category in {
                "document_explanation": "document_text",
                "speech_synthesis": "speech_text",
                "speech_transcription": "audio_clip",
            }.items():
                response = client.post(
                    "/api/v1/consents",
                    json={
                        "purpose": purpose,
                        "data_categories": [category],
                    },
                )
                response.raise_for_status()
                grants[purpose] = response.json()["id"]

            def call(path, purpose, **payload):
                start = time.monotonic()
                response = client.post(
                    "/api/v1/" + path,
                    json={
                        **payload,
                        "consent_id": grants[purpose],
                    },
                )
                response.raise_for_status()
                result = response.json()
                records.append(
                    {
                        "operation": path,
                        "seconds": round(time.monotonic() - start, 3),
                        "result": {
                            key: value
                            for key, value in result.items()
                            if key != "audio_base64"
                        },
                    }
                )
                print(path, result.get("status", "audio"), flush=True)
                return result

            examples = {
                "report": "Synthetic test report\nHb: 12.5 g/dL\nReference range: see laboratory report\nFollow-up: next Friday",
                "prescription": "Synthetic test prescription\nExample medicine: 2.5 mg OD?\nFollow-up: Friday",
                "doctor_note": "परीक्षणका लागि काल्पनिक नोट\nहेमोग्लोबिन परीक्षण\nफेरि भेट: शुक्रबार",
            }
            for kind, text in examples.items():
                result = call(
                    "documents/explain",
                    "document_explanation",
                    text=text,
                    kind=kind,
                    language="ne" if kind == "doctor_note" else "en",
                    question="",
                    text_checked=True,
                )
                assert result["status"] == "draft" and result["items"]
                lines = [line.strip() for line in text.splitlines() if line.strip()]
                assert all(
                    item["quote"] == lines[int(item["line_id"][1:]) - 1]
                    for item in result["items"]
                )
            result = call(
                "documents/explain",
                "document_explanation",
                text=examples["report"],
                kind="report",
                language="en",
                question="Which line mentions follow-up?",
                text_checked=True,
            )
            assert result["answer_line_ids"] == ["L4"], result
            passage = next(
                item["speech_text_ne"]
                for item in result["items"]
                if item["line_id"] == "L4"
            )
            audio = call(
                "speech/synthesize", "speech_synthesis", text=passage, speaker="kala"
            )
            raw = base64.b64decode(audio["audio_base64"])
            (output / "document-explanation.wav").write_bytes(raw)
            with wave.open(io.BytesIO(raw)) as wav:
                rate = wav.getframerate()
                samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
            length = round(len(samples) * 16000 / rate)
            samples = np.interp(
                np.arange(length) * rate / 16000, np.arange(len(samples)), samples
            ).astype("<i2")
            assert length <= 20 * 16000, "Use a shorter passage for STT roundtrip"
            clip = io.BytesIO()
            with wave.open(clip, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(16000)
                wav.writeframes(samples.tobytes())
            (output / "document-dictation.wav").write_bytes(clip.getvalue())
            call(
                "speech/transcribe",
                "speech_transcription",
                audio_base64=base64.b64encode(clip.getvalue()).decode(),
            )
            for question, status in (
                ("Should I change my dose?", "professional_review"),
                ("I cannot breathe", "urgent"),
            ):
                result = call(
                    "documents/explain",
                    "document_explanation",
                    text=examples["report"],
                    kind="report",
                    question=question,
                    text_checked=True,
                )
                assert result["status"] == status and result["model"] is None
            client.delete(
                "/api/v1/consents/" + grants["document_explanation"]
            ).raise_for_status()
            assert (
                client.post(
                    "/api/v1/documents/explain",
                    json={
                        "text": examples["report"],
                        "kind": "report",
                        "text_checked": True,
                        "consent_id": grants["document_explanation"],
                    },
                ).status_code
                == 403
            )
        finally:
            client.delete("/api/v1/me/data").raise_for_status()
    (output / "live.json").write_text(
        json.dumps(
            {
                "actual_checked_at": datetime.now(UTC).isoformat(),
                "records": records,
                "synthetic_fixtures_only": True,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
