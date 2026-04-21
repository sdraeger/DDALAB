from __future__ import annotations

import argparse
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from ddalab_qt.runtime_binary_names import (  # noqa: E402
    DDA_BINARY_STEM,
    DEV_CLI_BINARY_STEM,
    PACKAGED_CLI_BINARY_STEM,
    platform_binary_name,
)
from ensure_dda_binary import ensure_dda_binary  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Stage native DDALAB backend binaries into ddalab_qt/runtime/bin."
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Delete any previously staged runtime binaries before copying.",
    )
    parser.add_argument(
        "--print-dir",
        action="store_true",
        help="Print the runtime bin directory after staging.",
    )
    parser.add_argument(
        "--no-build-cli",
        action="store_true",
        help="Fail instead of invoking cargo when the Rust backend binary is missing.",
    )
    args = parser.parse_args()

    runtime_bin_dir = stage_runtime_binaries(
        clean=args.clean,
        build_cli=not args.no_build_cli,
    )
    if args.print_dir:
        print(runtime_bin_dir)
    return 0


def stage_runtime_binaries(*, clean: bool = False, build_cli: bool = True) -> Path:
    repo_root = PROJECT_ROOT.parent.parent
    package_root = PROJECT_ROOT / "ddalab_qt"
    runtime_bin_dir = package_root / "runtime" / "bin"

    if clean and runtime_bin_dir.exists():
        shutil.rmtree(runtime_bin_dir)
    runtime_bin_dir.mkdir(parents=True, exist_ok=True)

    dda_source = ensure_dda_binary()
    cli_source = _ensure_cli_binary(repo_root, build_cli=build_cli)

    dda_target = runtime_bin_dir / platform_binary_name(DDA_BINARY_STEM)
    cli_target = runtime_bin_dir / platform_binary_name(PACKAGED_CLI_BINARY_STEM)

    _copy_executable(dda_source, dda_target)
    _copy_executable(cli_source, cli_target)
    return runtime_bin_dir


def _ensure_cli_binary(repo_root: Path, *, build_cli: bool) -> Path:
    cli_root = repo_root / "packages" / "dda-cli"
    manifest_path = cli_root / "Cargo.toml"
    binary_name = platform_binary_name(DEV_CLI_BINARY_STEM)
    candidates = [
        cli_root / "target" / "release" / binary_name,
        cli_root / "target" / "debug" / binary_name,
    ]

    for candidate in candidates:
        if candidate.exists():
            return candidate

    if not build_cli:
        raise FileNotFoundError(
            f"Rust backend binary was not found in {cli_root / 'target'}."
        )

    cargo = shutil.which("cargo")
    if cargo is None:
        raise RuntimeError(
            "cargo is required to build the bundled Rust backend for DDALAB."
        )

    subprocess.run(
        [
            cargo,
            "build",
            "--manifest-path",
            str(manifest_path),
            "--bin",
            DEV_CLI_BINARY_STEM,
            "--release",
        ],
        cwd=repo_root,
        check=True,
    )

    release_binary = cli_root / "target" / "release" / binary_name
    if not release_binary.exists():
        raise FileNotFoundError(
            f"Rust backend build completed without producing {release_binary}."
        )
    return release_binary


def _copy_executable(source: Path, target: Path) -> None:
    shutil.copy2(source, target)
    _ensure_executable(target)


def _ensure_executable(path: Path) -> None:
    if os.name == "nt":
        return
    current_mode = path.stat().st_mode
    path.chmod(current_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


if __name__ == "__main__":
    raise SystemExit(main())
