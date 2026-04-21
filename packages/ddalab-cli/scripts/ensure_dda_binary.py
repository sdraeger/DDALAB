from __future__ import annotations

import argparse
import json
import os
import stat
import sys
import urllib.request
from pathlib import Path


LATEST_JSON_URL = "https://snl.salk.edu/~sfdraeger/dda/latest.json"
FALLBACK_VERSION = "v1.1"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Ensure run_DDA_AsciiEdf exists in the repo bin/ directory."
    )
    parser.add_argument(
        "--print-path",
        action="store_true",
        help="Print the resolved binary path after ensuring it exists.",
    )
    args = parser.parse_args()

    binary_path = ensure_dda_binary()
    if args.print_path:
        print(binary_path)
    return 0


def ensure_dda_binary() -> Path:
    repo_root = Path(__file__).resolve().parents[3]
    bin_dir = repo_root / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)

    binary_name = "run_DDA_AsciiEdf.exe" if os.name == "nt" else "run_DDA_AsciiEdf"
    binary_path = bin_dir / binary_name
    if binary_path.exists():
        _ensure_executable(binary_path)
        return binary_path

    version = _fetch_latest_version()
    download_url = f"https://snl.salk.edu/~sfdraeger/dda/{version}/run_DDA_AsciiEdf"
    print(f"Downloading {binary_name} from {download_url}", file=sys.stderr)
    with urllib.request.urlopen(download_url) as response:
        payload = response.read()
    binary_path.write_bytes(payload)
    _ensure_executable(binary_path)
    return binary_path


def _fetch_latest_version() -> str:
    try:
        with urllib.request.urlopen(LATEST_JSON_URL) as response:
            payload = json.load(response)
    except Exception:
        return FALLBACK_VERSION
    version = payload.get("version") if isinstance(payload, dict) else None
    return version if isinstance(version, str) and version.strip() else FALLBACK_VERSION


def _ensure_executable(path: Path) -> None:
    if os.name == "nt":
        return
    current_mode = path.stat().st_mode
    path.chmod(current_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


if __name__ == "__main__":
    raise SystemExit(main())
