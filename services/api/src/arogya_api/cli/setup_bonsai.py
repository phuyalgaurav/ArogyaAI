"""Verify an official Bonsai pack and register its isolated Python runtime."""

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

from arogya_api.inference.bonsai import MODEL


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", required=True, type=Path)
    parser.add_argument("--python", required=True, type=Path)
    args = parser.parse_args()
    pack = args.pack.resolve()
    manifest = json.loads((pack / "files.json").read_text())
    config = json.loads((pack / "config.json").read_text())
    if config.get("model_type") != "prism_hadamard_qwen35" or not config.get("components", {}).get(
        "vision"
    ):
        raise ValueError("Expected the official Hadamard Bonsai 2 vision pack")
    files = {}
    names = [
        "model.safetensors",
        "hadamard.json",
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "chat_template.jinja",
        "generation_config.json",
        "preprocessor_config.json",
    ] + sorted(str(p.relative_to(pack)) for p in (pack / "runtime").glob("*.py"))
    for name in names:
        path = pack / name
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                digest.update(chunk)
        expected = manifest[name]
        if digest.hexdigest() != expected["sha256"] or path.stat().st_size != expected["size"]:
            raise ValueError("Official pack checksum mismatch: " + name)
        files[name] = {
            "sha256": digest.hexdigest(),
            "size": path.stat().st_size,
            "mtime_ns": path.stat().st_mtime_ns,
        }
    subprocess.run(
        [str(args.python.absolute()), "-c", "import mlx.core,mlx_vlm,transformers,PIL"],
        check=True,
        timeout=30,
    )
    revision = hashlib.sha256(
        json.dumps(
            {name: value["sha256"] for name, value in files.items()}, sort_keys=True
        ).encode()
    ).hexdigest()
    output = Path(".local/bonsai-profile.json")
    output.parent.mkdir(exist_ok=True)
    output.write_text(
        json.dumps(
            {
                "model": MODEL,
                "revision": revision,
                "pack": str(pack),
                "python": str(args.python.absolute()),
                "files": files,
            },
            indent=2,
        )
        + "\n"
    )
    env = Path(".local/backend.env")
    lines = env.read_text().splitlines() if env.exists() else []
    keys = {
        "AROGYA_BONSAI_PROFILE_PATH": str(output.resolve()),
        "AROGYA_DEFAULT_MODEL_PROFILE": "bonsai",
    }
    lines = [line for line in lines if line.split("=", 1)[0] not in keys]
    env.write_text("\n".join(lines + [key + "=" + value for key, value in keys.items()]) + "\n")
    env.chmod(0o600)
    print("Verified Bonsai 2 pack and isolated runtime; selected it as the server default.")


if __name__ == "__main__":
    main()
