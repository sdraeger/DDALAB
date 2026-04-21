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


def _detect_macos_app_bundle(executable_path: Path) -> Optional[Path]:
    if sys.platform != "darwin":
        return None
    if executable_path.parent.name != "MacOS":
        return None
    contents_dir = executable_path.parent.parent
    if contents_dir.name != "Contents":
        return None
    app_bundle = contents_dir.parent
    if app_bundle.suffix != ".app":
        return None
    return app_bundle


def _detect_appimage_path() -> Optional[Path]:
    raw_path = os.environ.get("APPIMAGE")
    if not raw_path:
        return None
    try:
        return Path(raw_path).resolve()
    except OSError:
        return Path(raw_path)


@dataclass(frozen=True)
class RuntimePaths:
    package_root: Path
    source_repo_root: Optional[Path]
    executable_dir: Path
    executable_path: Path
    is_frozen: bool
    app_bundle_path: Optional[Path]
    appimage_path: Optional[Path]

    @classmethod
    def detect(cls) -> "RuntimePaths":
        package_root = Path(__file__).resolve().parent
        source_repo_root = _find_source_repo_root(package_root)
        executable_path = Path(sys.executable).resolve()
        return cls(
            package_root=package_root,
            source_repo_root=source_repo_root,
            executable_dir=executable_path.parent,
            executable_path=executable_path,
            is_frozen=bool(getattr(sys, "frozen", False)),
            app_bundle_path=_detect_macos_app_bundle(executable_path),
            appimage_path=_detect_appimage_path(),
        )

    def package_asset(self, *parts: str) -> Path:
        return self.package_root.joinpath("assets", *parts)

    def is_source_checkout(self) -> bool:
        return self.source_repo_root is not None

    def is_packaged_build(self) -> bool:
        return self.is_frozen and not self.is_source_checkout()

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

    def packaged_update_target(self) -> Optional[Path]:
        if not self.is_packaged_build():
            return None
        if self.app_bundle_path is not None:
            return self.app_bundle_path
        return self.appimage_path or self.executable_path
