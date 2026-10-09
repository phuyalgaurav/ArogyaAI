"""Real HTTP document/voice/history vertical slice using synthetic input only."""

import argparse
import base64
import json
import secrets
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument(
        "--image",
        type=Path,
        default=Path(".local/backend-directive-validation/recognition/printed-en.png"),
    )
    parser.add_argument(
        "--output", type=Path, default=Path(".local/conversation-validation")
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    record = {
        "checked_at": datetime.now(UTC).isoformat(),
        "turns": [],
        "timings": {},
        "limitations": [
            "Synthetic document; no handwriting acceptance",
            "Generated TTS clip, no physical microphone or native-speaker acceptance",
        ],
    }
    token = "history_" + secrets.token_hex(32)
    with httpx.Client(base_url=args.api, timeout=175, trust_env=False) as client:

        def session():
            client.headers["Authorization"] = (
                "Bearer " + client.post("/api/v1/session").json()["access_token"]
            )

        def grant(purpose, category):
            response = client.post(
                "/api/v1/consents",
                json={
                    "purpose": purpose,
                    "data_categories": [category],
                    "expires_in_seconds": 3600,
                },
            )
            response.raise_for_status()
            return response.json()["id"]

        def request(method, path, **kwargs):
            response = getattr(client, method)(path, **kwargs)
            response.raise_for_status()
            return response.json() if response.content else None

        def turn(conversation, rid, message, language="en"):
            start = time.monotonic()
            result = request(
                "post",
                f"/api/v1/conversations/{conversation['id']}/turns",
                json={
                    "request_id": rid,
                    "message": message,
                    "language": language,
                    "model_profile": "qwen",
                    "expected_context_revision": conversation["context_revision"],
                    "consent_id": document_grant,
                },
            )
            record["timings"][rid] = round(time.monotonic() - start, 3)
            record["turns"].append(result)
            print(
                json.dumps(
                    {
                        "turn": rid,
                        "status": result["status"],
                        "seconds": record["timings"][rid],
                        "references": result["references"],
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            return result

        session()
        request(
            "post",
            "/api/v1/history/vault",
            json={"allow_server_storage": True, "client_access_token": token},
        )
        client.headers["X-History-Token"] = token
        try:
            image_grant = grant("image_transcription", "image_bytes")
            document_grant = grant("document_explanation", "document_text")
            speech_grant = grant("speech_synthesis", "speech_text")
            transcript_grant = grant("speech_transcription", "audio_clip")
            c = request(
                "post",
                "/api/v1/conversations",
                json={
                    "mode": "document",
                    "storage": "server_history",
                    "allow_context_storage": True,
                },
            )
            path = f"/api/v1/conversations/{c['id']}"
            job = request(
                "post",
                path + "/recognitions",
                json={
                    "request_id": "synthetic-photo",
                    "expected_context_revision": 0,
                    "kind": "report",
                    "image": {
                        "image_base64": base64.b64encode(
                            args.image.read_bytes()
                        ).decode(),
                        "model_profile": "qwen",
                        "consent_id": image_grant,
                    },
                },
            )
            deadline = time.monotonic() + 170
            while job["status"] == "processing" and time.monotonic() < deadline:
                time.sleep(0.25)
                job = request("get", path + "/recognitions/" + job["id"])
            assert job["status"] == "completed", job
            c = request("get", path)
            a = c["attachments"][0]
            assert "2.5 mg" in a["original_text"] and "Friday" in a["original_text"], a
            c = request(
                "put",
                path + "/attachments/" + a["id"] + "/review",
                json={
                    "expected_context_revision": c["context_revision"],
                    "text": a["original_text"],
                    "text_checked": True,
                    "consent_id": document_grant,
                },
            )
            first = turn(c, "follow-up", "When is follow-up?")
            assert any("Friday" in r["quote"] for r in first["references"])
            second = turn(c, "pronoun", "Explain that line")
            assert any("Friday" in r["quote"] for r in second["references"])
            third = turn(c, "third", "Which line mentions follow-up?")
            assert third["references"]
            assert (
                request(
                    "post",
                    path + "/turns",
                    json={
                        "request_id": "third",
                        "message": "Which line mentions follow-up?",
                        "language": "en",
                        "model_profile": "qwen",
                        "expected_context_revision": c["context_revision"],
                        "consent_id": document_grant,
                    },
                )
                == third
            )
            c = request(
                "put",
                path + "/attachments/" + a["id"] + "/review",
                json={
                    "expected_context_revision": c["context_revision"],
                    "text": a["original_text"].replace("Friday", "Monday"),
                    "text_checked": True,
                    "consent_id": document_grant,
                },
            )
            fourth = turn(c, "corrected", "When is follow-up?", language="ne")
            assert any("Monday" in r["quote"] for r in fourth["references"])
            start = time.monotonic()
            speech = request(
                "post",
                path + "/speech/synthesize",
                json={
                    "turn_id": "corrected",
                    "expected_context_revision": c["context_revision"],
                    "chunk_index": 0,
                    "consent_id": speech_grant,
                },
            )
            record["timings"]["first_audio"] = round(time.monotonic() - start, 3)
            audio = base64.b64decode(speech["speech"]["audio_base64"])
            (args.output / "first-chunk.wav").write_bytes(audio)
            record["speech"] = {
                **speech,
                "speech": {
                    k: v for k, v in speech["speech"].items() if k != "audio_base64"
                },
            }
            # Normalize the actual TTS WAV to the STT endpoint's PCM16/16kHz input.
            import io
            import wave

            import numpy as np

            with wave.open(io.BytesIO(audio)) as wav:
                samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
                rate = wav.getframerate()
            count = int(len(samples) * 16000 / rate)
            resampled = np.interp(
                np.arange(count) * rate / 16000, np.arange(len(samples)), samples
            ).astype("<i2")
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(16000)
                wav.writeframes(resampled.tobytes())
            record["transcription"] = request(
                "post",
                path + "/speech/transcribe",
                json={
                    "request_id": "synthetic-voice",
                    "expected_context_revision": c["context_revision"],
                    "audio": {
                        "audio_base64": base64.b64encode(buffer.getvalue()).decode(),
                        "consent_id": transcript_grant,
                    },
                },
            )
            assert record["transcription"]["automatically_submitted"] is False
            request("delete", "/api/v1/me/data")
            session()
            document_grant = grant("document_explanation", "document_text")
            resumed = request("get", path)
            assert len(resumed["turns"]) == 4
            final = turn(resumed, "resumed", "Which line mentions follow-up?")
            assert any("Monday" in r["quote"] for r in final["references"])
            record["recognition"] = a["recognition"]
            record["history_resumed"] = True
            request("delete", path)
            assert client.get(path).status_code == 404
            record["deleted"] = True
            (args.output / "result.json").write_text(
                json.dumps(record, ensure_ascii=False, indent=2)
            )
            print(
                json.dumps(
                    {
                        "history_resumed": True,
                        "deleted": True,
                        "timings": record["timings"],
                        "transcription": record["transcription"]["transcription"][
                            "text"
                        ],
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
        finally:
            client.delete(
                "/api/v1/history/vault", headers={"Authorization": "Bearer " + token}
            )
            client.delete("/api/v1/me/data")


if __name__ == "__main__":
    main()
