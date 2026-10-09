"""Explicit pinned downloads; health requests never download model assets."""

import json
import os
import secrets
from pathlib import Path

from dotenv import dotenv_values

from arogya_api.core.assets import sha256_file
from arogya_api.core.paths import workspace_root


def main():
    from huggingface_hub import hf_hub_download

    pins = json.loads(
        (Path(__file__).resolve().parent.parent / "resources/language-models.json").read_text()
    )
    local = workspace_root() / ".local"
    local.mkdir(mode=0o700, exist_ok=True)
    models = local / "language-models"
    for kind, spec in pins.items():
        destination = models / kind
        destination.mkdir(mode=0o700, parents=True, exist_ok=True)
        print(f"Preparing {kind}: {spec['repository']}…", flush=True)
        for name, expected in spec["files"].items():
            path = destination / name
            if not path.exists() or sha256_file(path) != expected["sha256"]:
                path = Path(
                    hf_hub_download(
                        spec["repository"], name, revision=spec["revision"], local_dir=destination
                    )
                )
            if path.stat().st_size != expected["bytes"] or sha256_file(path) != expected["sha256"]:
                raise RuntimeError(f"Pinned artifact verification failed: {kind}/{name}")
            path.chmod(0o600)
    envfile = local / "backend.env"
    values = {k: v for k, v in dotenv_values(envfile).items() if v is not None}
    values.update(
        AROGYA_LANGUAGE_WORKER_URL="http://127.0.0.1:8002", AROGYA_LANGUAGE_MODEL_DIR=str(models)
    )
    values.setdefault("AROGYA_LANGUAGE_WORKER_TOKEN", secrets.token_hex(32))
    temporary = envfile.with_suffix(".tmp")
    temporary.write_text("".join(f"{key}={json.dumps(value)}\n" for key, value in values.items()))
    temporary.chmod(0o600)
    os.replace(temporary, envfile)
    print("Translation, Nepali STT and Kala TTS are pinned and configured.", flush=True)


if __name__ == "__main__":
    main()
