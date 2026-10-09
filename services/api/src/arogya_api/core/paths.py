"""Locate the checkout for development/setup commands without depending on package depth."""

from pathlib import Path


def workspace_root() -> Path:
    for start in (Path.cwd().resolve(), Path(__file__).resolve().parent):
        for directory in (start, *start.parents):
            if (directory / "pnpm-workspace.yaml").is_file():
                return directory
    raise RuntimeError("Run this command from the ArogyaAI workspace.")
