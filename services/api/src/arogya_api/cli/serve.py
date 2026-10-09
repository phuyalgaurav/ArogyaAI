"""Serve the built UI and public API together, with private inference on loopback."""

import argparse
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv

from arogya_api.core.paths import workspace_root


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lan", action="store_true", help="Allow phones on your local network")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--certfile", type=Path)
    parser.add_argument("--keyfile", type=Path)
    args = parser.parse_args()
    if bool(args.certfile) != bool(args.keyfile):
        parser.error("Provide both --certfile and --keyfile for HTTPS.")
    if not 1 <= args.port <= 65535:
        parser.error("Port must be between 1 and 65535.")
    root = workspace_root()
    os.chdir(root)
    load_dotenv(root / ".local/backend.env", override=False)
    web = root / "apps/web/out"
    if not (web / "index.html").is_file():
        parser.error("Run pnpm build:local first.")
    os.environ["AROGYA_WEB_DIR"] = str(web)
    commands = []
    ports = [args.port]
    for variable, module in (
        ("AROGYA_WORKER_URL", "inference.worker"),
        ("AROGYA_LANGUAGE_WORKER_URL", "speech.worker"),
    ):
        if not os.getenv(variable):
            continue
        url = urlparse(os.environ[variable])
        if url.hostname not in {"localhost", "127.0.0.1"} or url.scheme != "http":
            parser.error(f"{variable} must point to a local HTTP worker.")
        port = url.port or 80
        ports.append(port)
        commands.append(
            [
                sys.executable,
                "-m",
                "uvicorn",
                f"arogya_api.{module}:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "--no-access-log",
            ]
        )
    if len(ports) != len(set(ports)):
        parser.error("Gateway and worker ports must be distinct.")
    for port in ports:
        with socket.socket() as check:
            check.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                check.bind(("0.0.0.0" if args.lan else "127.0.0.1", port))
            except OSError:
                parser.error(f"Port {port} is in use; stop the previous ArogyaAI server first.")
    if os.getenv("AROGYA_WORKER_URL"):
        ollama = os.getenv("AROGYA_OLLAMA_URL", "http://127.0.0.1:11435")
        parsed = urlparse(ollama)
        if parsed.hostname not in {"localhost", "127.0.0.1"} or parsed.scheme != "http":
            parser.error("AROGYA_OLLAMA_URL must use local HTTP.")
        try:
            with httpx.Client(trust_env=False, timeout=2) as client:
                client.get(ollama + "/api/tags").raise_for_status()
        except httpx.HTTPError:
            os.environ.update(
                OLLAMA_HOST=parsed.netloc,
                OLLAMA_NO_CLOUD="1",
                OLLAMA_NUM_PARALLEL="1",
                OLLAMA_MAX_LOADED_MODELS="1",
                OLLAMA_MAX_QUEUE="8",
            )
            commands.insert(0, ["ollama", "serve"])
    public = [
        sys.executable,
        "-m",
        "uvicorn",
        "arogya_api.main:app",
        "--host",
        "0.0.0.0" if args.lan else "127.0.0.1",
        "--port",
        str(args.port),
        "--no-access-log",
    ]
    if args.certfile:
        public += [
            "--ssl-certfile",
            str(args.certfile.resolve()),
            "--ssl-keyfile",
            str(args.keyfile.resolve()),
        ]
    commands.append(public)
    children = []
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        for command in commands:
            children.append(subprocess.Popen(command, start_new_session=True))
        scheme = "https" if args.certfile else "http"
        print(f"ArogyaAI: {scheme}://127.0.0.1:{args.port}", flush=True)
        if args.lan:
            print(
                f"Phone: open {scheme}://<this computer's LAN IP>:{args.port} on the same Wi-Fi.",
                flush=True,
            )
        while not stopping and all(child.poll() is None for child in children):
            time.sleep(0.25)
        failed = any(child.poll() not in (None, 0) for child in children)
    finally:
        for child in children:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
