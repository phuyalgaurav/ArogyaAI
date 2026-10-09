"""Explicit local setup. Model downloads never happen in the gateway request path."""

import hashlib
import json
import os
import secrets
import signal
import subprocess
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values
from huggingface_hub import snapshot_download

from arogya_api.core.paths import workspace_root


def main():
    root = workspace_root()
    pins = json.loads(
        (Path(__file__).resolve().parent.parent / "resources/server-models.json").read_text()
    )
    local = root / ".local"
    local.mkdir(mode=0o700, exist_ok=True)
    local.chmod(0o700)
    destination = local / "backend.env"
    existing = dotenv_values(destination) if destination.exists() else {}
    endpoint = existing.get("AROGYA_OLLAMA_URL") or "http://127.0.0.1:11435"
    owned = None
    with httpx.Client(base_url=endpoint, timeout=120, trust_env=False) as client:
        try:
            try:
                client.get("/api/tags", timeout=2).raise_for_status()
            except httpx.HTTPError:
                owned = subprocess.Popen(
                    ["ollama", "serve"],
                    env={
                        **os.environ,
                        "OLLAMA_HOST": endpoint.removeprefix("http://"),
                        "OLLAMA_NO_CLOUD": "1",
                        "OLLAMA_NUM_PARALLEL": "1",
                        "OLLAMA_MAX_LOADED_MODELS": "1",
                        "OLLAMA_MAX_QUEUE": "8",
                    },
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                )
                deadline = time.monotonic() + 10
                while True:
                    try:
                        client.get("/api/tags", timeout=1).raise_for_status()
                        break
                    except httpx.HTTPError:
                        if time.monotonic() >= deadline:
                            raise RuntimeError("Local Ollama failed to start") from None
                        time.sleep(0.2)
            qwen = pins["qwen"]
            tags = client.get("/api/tags").json()["models"]
            if not any(m["name"] == qwen["model"] and m["digest"] == qwen["digest"] for m in tags):
                print("Downloading pinned Qwen model through local Ollama…", flush=True)
                with client.stream("POST", "/api/pull", json={"model": qwen["model"]}) as response:
                    response.raise_for_status()
                    for line in response.iter_lines():
                        result = json.loads(line)
                        if "error" in result:
                            raise RuntimeError("Ollama model download failed")
                tags = client.get("/api/tags").json()["models"]
            if not any(m["name"] == qwen["model"] and m["digest"] == qwen["digest"] for m in tags):
                raise RuntimeError("Qwen tag differs from the reviewed pin; setup stopped")
        finally:
            if owned:
                os.killpg(owned.pid, signal.SIGTERM)
                owned.wait(timeout=10)
    laya = pins["laya"]
    print("Preparing pinned multilingual Laya checkpoint…", flush=True)
    checkpoint = Path(
        snapshot_download(
            laya["repository"],
            revision=laya["revision"],
            allow_patterns=["*.json", "*.safetensors"],
        )
    )
    with (checkpoint / "model.safetensors").open("rb") as weight_file:
        if hashlib.file_digest(weight_file, "sha256").hexdigest() != laya["sha256"]:
            raise RuntimeError("Laya checkpoint checksum mismatch")
    values = {
        **{k: v for k, v in existing.items() if v is not None},
        "AROGYA_MODE": "development",
        "AROGYA_DATABASE_PATH": str(local / "arogya.sqlite3"),
        "AROGYA_SIGNING_KEY": existing.get("AROGYA_SIGNING_KEY") or secrets.token_hex(32),
        "AROGYA_WORKER_TOKEN": existing.get("AROGYA_WORKER_TOKEN") or secrets.token_hex(32),
        "AROGYA_WORKER_URL": "http://127.0.0.1:8001",
        "AROGYA_OLLAMA_URL": endpoint,
        "AROGYA_QWEN_MODEL": qwen["model"],
        "AROGYA_QWEN_DIGEST": qwen["digest"],
        "AROGYA_LAYA_PATH": str(checkpoint),
        "AROGYA_LAYA_REVISION": laya["revision"],
        "AROGYA_LAYA_SHA256": laya["sha256"],
        "AROGYA_ALLOW_TEST_KNOWLEDGE": "false",
        "AROGYA_REQUEST_TIMEOUT": "90",
    }
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write("".join(f"{name}={json.dumps(value)}\n" for name, value in values.items()))
    destination.chmod(0o600)
    print("Backend configured in ignored .local/backend.env. Run pnpm dev:backend.")


if __name__ == "__main__":
    main()
