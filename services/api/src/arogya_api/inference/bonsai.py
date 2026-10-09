"""One owned, bounded Bonsai process with pinned files and cancellation teardown."""

import asyncio
import json
import os
import signal
from pathlib import Path

from arogya_api.inference.errors import ProviderUnavailable
from arogya_api.runtime.models import EngineRuntime

MODEL = "prism-ml/Ternary-Bonsai-2-27B-mlx-2bit"


class BonsaiClient:
    def __init__(self, profile_path):
        self.path = profile_path
        self.process = None
        self.busy = False
        self.profile = None
        self.observed = None

    def verify(self):
        if not self.path:
            raise ValueError("bonsai_unconfigured")
        profile = json.loads(self.path.read_text())
        if len(profile.get("files", {})) < 8:
            raise ValueError("incomplete_bonsai_pin")
        if profile["model"] != MODEL or len(profile["revision"]) != 64:
            raise ValueError("bonsai_identity")
        for file, expected in profile["files"].items():
            path = Path(profile["pack"]) / file
            if (
                path.stat().st_size != expected["size"]
                or path.stat().st_mtime_ns != expected["mtime_ns"]
            ):
                raise ValueError("bonsai_pack_changed; rerun setup verification")
        if not Path(profile["python"]).is_file():
            raise ValueError("bonsai_python_missing")
        return profile

    async def runtime(self):
        engine = EngineRuntime(
            id="bonsai",
            name=MODEL,
            task="document_vision",
            state="unconfigured",
            reason="Run pnpm setup:bonsai.",
        )
        try:
            profile = await asyncio.to_thread(self.verify)
            engine.state = "busy" if self.busy else "ready"
            engine.revision = profile["revision"]
            engine.loaded = bool(self.process and self.process.returncode is None)
            engine.memory_bytes = (
                (self.observed or {}).get("active_memory_bytes") if engine.loaded else None
            )
            engine.reason = "Server document/vision model; one request at a time, 14 GB MLX cap."
        except (OSError, ValueError, KeyError, TypeError):
            if self.path:
                engine.state = "unavailable"
                engine.reason = "Bonsai pack or isolated runtime failed verification. Rerun setup."
        return engine

    async def close(self):
        process, self.process = self.process, None
        if process and process.returncode is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await process.wait()

    async def generate(self, system, content, max_tokens=1200, image=None):
        if self.busy:
            raise ProviderUnavailable("bonsai_busy")
        self.busy = True
        try:
            profile = await asyncio.to_thread(self.verify)
            async with asyncio.timeout(150):
                if not self.process or self.process.returncode is not None:
                    self.process = await asyncio.create_subprocess_exec(
                        profile["python"],
                        str(Path(__file__).with_name("bonsai_process.py")),
                        str(self.path),
                        stdin=asyncio.subprocess.PIPE,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.DEVNULL,
                        start_new_session=True,
                        limit=65536,
                    )
                    ready = json.loads(await self.process.stdout.readline())
                    if ready != {"ready": True, "revision": profile["revision"]}:
                        raise ValueError("runtime_identity")
                payload = {
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": content},
                    ],
                    "max_tokens": max_tokens,
                    "image": image,
                }
                self.process.stdin.write((json.dumps(payload) + "\n").encode())
                await self.process.stdin.drain()
                result = json.loads(await self.process.stdout.readline())
                if result.get("revision") != profile["revision"] or "error" in result:
                    raise ValueError("invalid_bonsai_result")
                self.verify()
                self.profile, self.observed = profile, result
                return result["text"], profile["revision"]
        except BaseException as error:
            await self.close()
            if isinstance(error, asyncio.CancelledError):
                raise
            if not isinstance(error, Exception):
                raise
            raise ProviderUnavailable("bonsai_unavailable_or_invalid") from None
        finally:
            self.busy = False
