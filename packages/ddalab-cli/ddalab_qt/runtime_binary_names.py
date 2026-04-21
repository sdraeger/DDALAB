from __future__ import annotations

import os


DDA_BINARY_STEM = "run_DDA_AsciiEdf"
PACKAGED_CLI_BINARY_STEM = "ddalab-backend"
DEV_CLI_BINARY_STEM = "ddalab"


def platform_binary_name(stem: str) -> str:
    return f"{stem}.exe" if os.name == "nt" else stem
