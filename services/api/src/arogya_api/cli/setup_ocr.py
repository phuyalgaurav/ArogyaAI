"""Pin an installed native Tesseract and the bundled English/Nepali data."""

import gzip
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

from dotenv import set_key

from arogya_api.core.paths import workspace_root

PINS = {
    "eng": "45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91",
    "nep": "cda17f5f7c18a81167be44ce4f545d0b244f8b00912d55f6568ac08d0e0f3b0e",
}


def main():
    root = workspace_root()
    binary = shutil.which("tesseract")
    if not binary:
        raise SystemExit("Install Tesseract 5 (macOS: brew install tesseract), then retry.")
    binary = Path(binary).resolve()
    version = (
        subprocess.check_output([str(binary), "--version"], timeout=5).decode().splitlines()[0]
    )
    if not version.startswith("tesseract 5."):
        raise SystemExit("Tesseract 5 is required.")
    target = root / ".local/server-ocr"
    target.mkdir(parents=True, exist_ok=True)
    assets = {}
    for language, digest in PINS.items():
        source = root / f"apps/web/public/ocr/languages/{language}.traineddata.gz"
        data = source.read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            raise SystemExit("OCR asset mismatch. Run pnpm setup:ocr and retry.")
        unpacked = gzip.decompress(data)
        (target / f"{language}.traineddata").write_bytes(unpacked)
        assets[language] = hashlib.sha256(unpacked).hexdigest()
    manifest = {
        "binary": str(binary),
        "version": version,
        "binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
        "languages": assets,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    env = root / ".local/backend.env"
    env.touch(mode=0o600, exist_ok=True)
    env.chmod(0o600)
    set_key(env, "AROGYA_OCR_DIR", str(target))
    print(f"Pinned {version} with English and Nepali assets. Restart the Python server.")


if __name__ == "__main__":
    main()
