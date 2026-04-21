from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


def _find_source_repo_root(start: Path) -> Optional[Path]:
    for candidate in (start, *start.parents):
        if (
            (candidate / "packages" / "ddalab-cli").exists()
            and (candidate / "packages" / "ddalab-gui").exists()
        ):
            return candidate
    return None


@dataclass(frozen=True)
class RuntimePaths:
    package_root: Path
    source_repo_root: Optional[Path]
    executable_dir: Path

    @classmethod
    def detect(cls) -> "RuntimePaths":
        package_root = Path(__file__).resolve().parent
        source_repo_root = _find_source_repo_root(package_root)
        return cls(
            package_root=package_root,
            source_repo_root=source_repo_root,
            executable_dir=Path(sys.executable).resolve().parent,
        )

    def package_asset(self, *parts: str) -> Path:
        return self.package_root.joinpath("assets", *parts)

    def is_source_checkout(self) -> bool:
        return self.source_repo_root is not None

    def package_runtime_bin_dir(self) -> Path:
        return self.package_root / "runtime" / "bin"

    def font_search_dirs(self) -> list[Path]:
        candidates: list[Path] = []
        packaged_fonts = self.package_asset("fonts")
        if packaged_fonts.exists():
            candidates.append(packaged_fonts)
        return candidates

    def browser_fallback_root(self) -> Path:
        return self.source_repo_root or Path.home()
