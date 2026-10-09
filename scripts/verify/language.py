"""Exercise real private language models through the public consent gateway.

Uses generated non-medical audio only. Writes private local receipts, never model
weights, service tokens or user microphone recordings into the repository.
"""

import base64
import io
import json
import time
import wave
from datetime import UTC, datetime
from pathlib import Path

import httpx
from arogya_api.speech.engine import PINS
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / ".local/language-validation"


def main():
    import numpy as np

    load_dotenv(ROOT / ".local/backend.env")
    DIRECTORY.mkdir(parents=True, exist_ok=True, mode=0o700)
    records = []
    with httpx.Client(
        base_url="http://127.0.0.1:8000", timeout=85, trust_env=False
    ) as client:
        runtime = client.get("/api/v1/runtime").json()
        engine_ids = [engine["id"] for engine in runtime["engines"]]
        assert len(engine_ids) == len(set(engine_ids)), "Duplicate runtime engines"
        for kind, engine_id in {
            "translation": "translation",
            "stt": "nepali_stt",
            "tts": "nepali_tts",
        }.items():
            engine = next(e for e in runtime["engines"] if e["id"] == engine_id)
            assert engine["state"] == "ready", engine
            assert engine["revision"] == PINS[kind]["revision"]
        token = client.post("/api/v1/session").json()["access_token"]
        headers = {"Authorization": "Bearer " + token}
        try:
            grants = {}
            categories = {
                "server_chat": "message_text",
                "translation": "translation_text",
                "speech_transcription": "audio_clip",
                "speech_synthesis": "speech_text",
            }
            for purpose, category in categories.items():
                response = client.post(
                    "/api/v1/consents",
                    headers=headers,
                    json={"purpose": purpose, "data_categories": [category]},
                )
                response.raise_for_status()
                grants[purpose] = response.json()["id"]

            def call(path, purpose, **payload):
                begun = time.monotonic()
                response = client.post(
                    "/api/v1/" + path,
                    headers=headers,
                    json={**payload, "consent_id": grants[purpose]},
                )
                response.raise_for_status()
                result = response.json()
                saved = {
                    key: value for key, value in result.items() if key != "audio_base64"
                }
                records.append(
                    {
                        "operation": path,
                        "elapsed_seconds": round(time.monotonic() - begun, 3),
                        "result": saved,
                    }
                )
                return result

            basic = {"text": "Hello", "source_language": "en", "target_language": "ne"}
            assert (
                client.post(
                    "/api/v1/translation",
                    json={**basic, "consent_id": grants["translation"]},
                ).status_code
                == 401
            )
            assert (
                client.post(
                    "/api/v1/translation",
                    headers=headers,
                    json={**basic, "consent_id": grants["server_chat"]},
                ).status_code
                == 403
            )
            speech = call(
                "speech/synthesize",
                "speech_synthesis",
                text="नमस्कार। आज मौसम राम्रो छ।",
                speaker="kala",
            )
            raw = base64.b64decode(speech["audio_base64"])
            (DIRECTORY / "nepali-preview.wav").write_bytes(raw)
            with wave.open(io.BytesIO(raw)) as audio:
                rate, frames = audio.getframerate(), audio.getnframes()
                samples = np.frombuffer(audio.readframes(frames), dtype="<i2")
            length = round(len(samples) * 16000 / rate)
            resampled = np.interp(
                np.arange(length) * rate / 16000, np.arange(len(samples)), samples
            ).astype("<i2")
            clip = io.BytesIO()
            with wave.open(clip, "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(16000)
                audio.writeframes(resampled.tobytes())
            (DIRECTORY / "transcription-input.wav").write_bytes(clip.getvalue())
            call(
                "speech/transcribe",
                "speech_transcription",
                audio_base64=base64.b64encode(clip.getvalue()).decode(),
            )
            call(
                "speech/synthesize",
                "speech_synthesis",
                text="नमस्कार। आज मौसम राम्रो छ।",
                speaker="barsha",
            )
            en = "I am going home."
            ne = "म घर जाँदैछु।"
            call(
                "translation",
                "translation",
                text=en,
                source_language="en",
                target_language="ne",
            )
            tam = call(
                "translation",
                "translation",
                text=en,
                source_language="en",
                target_language="tam",
            )["text"]
            for source, original, targets in [
                ("ne", ne, ["en", "tam"]),
                ("tam", tam, ["en", "ne"]),
            ]:
                for target in targets:
                    call(
                        "translation",
                        "translation",
                        text=original,
                        source_language=source,
                        target_language=target,
                    )
            guard = call(
                "translation",
                "translation",
                text="We have 12 cups named TEST.",
                source_language="en",
                target_language="ne",
                protected_terms=["TEST"],
            )
            if "TEST" not in guard["text"]:
                assert (
                    "protected_terms_changed" in guard["warnings"]
                    and guard["status"] == "needs_review"
                )
            client.delete(
                "/api/v1/consents/" + grants["translation"], headers=headers
            ).raise_for_status()
            assert (
                client.post(
                    "/api/v1/translation",
                    headers=headers,
                    json={**basic, "consent_id": grants["translation"]},
                ).status_code
                == 403
            )
            exported = client.get("/api/v1/me/data", headers=headers).json()
            assert "नमस्कार" not in json.dumps(exported, ensure_ascii=False)
        finally:
            client.delete("/api/v1/me/data", headers=headers).raise_for_status()
    report = {
        "checked_at": datetime.now(UTC).isoformat(),
        "kind": "real local gateway integration",
        "accuracy_boundary": "Generated-audio smoke and model-generated Tamang round trips; no native-speaker or clinical acceptance.",
        "records": records,
    }
    (DIRECTORY / "gateway-smoke.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2)
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
