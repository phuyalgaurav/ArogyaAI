"""Provision local administration only; human review roles require explicit assignment."""

import hashlib
import json
import os
import secrets
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from dotenv import dotenv_values

from arogya_api.core.paths import workspace_root


def private_write(path, data):
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=".arogya-")
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
        os.replace(temporary, path)
        path.chmod(0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def prepare(root):
    local = root / ".local"
    local.mkdir(mode=0o700, exist_ok=True)
    local.chmod(0o700)
    environment = local / "backend.env"
    values = {k: v for k, v in dotenv_values(environment).items() if v is not None}
    if values.get("AROGYA_MODE", "development") != "development":
        raise ValueError("Automatic operator setup is limited to local development")
    registry = Path(values.get("AROGYA_OPERATOR_REGISTRY_PATH") or local / "operators.json")
    token_file = local / "operator-token"
    if not registry.exists():
        token = secrets.token_urlsafe(48)
        identity = [
            {
                "id": "local-maintainer",
                "roles": ["administrator", "content_editor"],
                "token_sha256": hashlib.sha256(token.encode()).hexdigest(),
                "enabled": True,
                "expires_at": (datetime.now(UTC) + timedelta(days=30)).isoformat(),
            }
        ]
        private_write(token_file, (token + "\n").encode())
        private_write(registry, (json.dumps(identity, indent=2) + "\n").encode())
    key_path = Path(values.get("AROGYA_BUNDLE_SIGNING_KEY_PATH") or local / "knowledge-signing.key")
    if not key_path.exists():
        private_write(key_path, Ed25519PrivateKey.generate().private_bytes_raw())
    key = Ed25519PrivateKey.from_private_bytes(key_path.read_bytes())
    public = key.public_key().public_bytes_raw()
    trust = {
        "algorithm": "Ed25519",
        "key_id": hashlib.sha256(public).hexdigest(),
        "public_key_hex": public.hex(),
        "environment": "development",
    }
    private_write(local / "knowledge-trust.json", (json.dumps(trust, indent=2) + "\n").encode())
    values.update(
        {
            "AROGYA_OPERATOR_REGISTRY_PATH": str(registry),
            "AROGYA_KNOWLEDGE_AUDIT_KEY": values.get("AROGYA_KNOWLEDGE_AUDIT_KEY")
            or secrets.token_hex(32),
            "AROGYA_BUNDLE_SIGNING_KEY_PATH": str(key_path),
            "AROGYA_SIGNING_KEY": values.get("AROGYA_SIGNING_KEY") or secrets.token_hex(32),
            "AROGYA_DATABASE_PATH": values.get("AROGYA_DATABASE_PATH")
            or str(local / "arogya.sqlite3"),
        }
    )
    private_write(
        environment, "".join(f"{k}={json.dumps(v)}\n" for k, v in values.items()).encode()
    )
    return registry, token_file


def main():
    registry, token_file = prepare(workspace_root())
    print("Local administration configured. Registry:", registry)
    print("Bearer token stays in a private file:", token_file)
    print("No clinical/license reviewer was created. Restart the local backend to load settings.")


if __name__ == "__main__":
    main()
