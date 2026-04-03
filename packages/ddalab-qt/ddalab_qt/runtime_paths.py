from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional


def _is_relative_to(path: Path, other: Path) -> bool:
    try:
        path.resolve().relative_to(other.resolve())
        return True
    except ValueError:
        return False


def _find_source_repo_root(start: Path) -> Optional[Path]:
    for candidate in (start, *start.parents):
        if (
            (candidate / "packages" / "ddalab-qt").exists()
            and (candidate / "packages" / "ddalab-kmp").exists()
        ):
            return candidate
    return None


@dataclass(frozen=True)
class RuntimePaths:
    package_root: Path
    source_repo_root: Optional[Path]
    source_kmp_root: Optional[Path]
    executable_dir: Path

    @classmethod
    def detect(cls) -> "RuntimePaths":
        package_root = Path(__file__).resolve().parent
        source_repo_root = _find_source_repo_root(package_root)
        source_kmp_root = (
            source_repo_root / "packages" / "ddalab-kmp"
            if source_repo_root is not None
            else None
        )
        if source_kmp_root is not None and not source_kmp_root.exists():
            source_kmp_root = None
        return cls(
            package_root=package_root,
            source_repo_root=source_repo_root,
            source_kmp_root=source_kmp_root,
            executable_dir=Path(sys.executable).resolve().parent,
        )

    def package_asset(self, *parts: str) -> Path:
        return self.package_root.joinpath("assets", *parts)

    def font_search_dirs(self) -> list[Path]:
        candidates: list[Path] = []
        packaged_fonts = self.package_asset("fonts")
        if packaged_fonts.exists():
            candidates.append(packaged_fonts)
        if self.source_kmp_root is not None:
            source_fonts = (
                self.source_kmp_root
                / "composeApp"
                / "src"
                / "commonMain"
                / "composeResources"
                / "font"
            )
            if source_fonts.exists():
                candidates.append(source_fonts)
        return candidates

    def browser_fallback_root(self) -> Path:
        return self.source_repo_root or Path.home()

    def local_bridge_script_candidates(self) -> Iterable[Path]:
        script_name = (
            "ddalab-kmp-local-bridge.bat"
            if os.name == "nt"
            else "ddalab-kmp-local-bridge"
        )
        env_script = os.environ.get("DDALAB_QT_LOCAL_BRIDGE")
        if env_script:
            env_path = Path(env_script).expanduser()
            if env_path.is_dir():
                yield env_path / "bin" / script_name
            else:
                yield env_path

        env_runtime_root = os.environ.get("DDALAB_QT_RUNTIME_ROOT")
        candidate_roots = [
            Path(env_runtime_root).expanduser() if env_runtime_root else None,
            self.package_root,
            self.package_root.parent,
            self.executable_dir,
            self.executable_dir.parent,
            self.executable_dir.parent / "Resources",
        ]

        seen: set[Path] = set()
        for root in candidate_roots:
            if root is None:
                continue
            resolved_root = root.resolve()
            if resolved_root in seen:
                continue
            seen.add(resolved_root)
            yield resolved_root / "ddalab-kmp-local-bridge" / "bin" / script_name
            yield (
                resolved_root / "runtime" / "ddalab-kmp-local-bridge" / "bin" / script_name
            )

        if self.source_kmp_root is not None:
            yield (
                self.source_kmp_root
                / "serverApp"
                / "build"
                / "install"
                / "ddalab-kmp-local-bridge"
                / "bin"
                / script_name
            )

    def find_local_bridge_script(self) -> Optional[Path]:
        for candidate in self.local_bridge_script_candidates():
            if candidate.exists():
                return candidate
        return None

    def local_bridge_build_root(self) -> Optional[Path]:
        return self.source_kmp_root

    def local_bridge_workdir(self, script_path: Path) -> Path:
        if self.source_kmp_root is not None and _is_relative_to(script_path, self.source_kmp_root):
            return self.source_kmp_root
        return script_path.parent

    def helper_watch_paths(self) -> list[Path]:
        if self.source_kmp_root is None:
            return []
        return [
            self.source_kmp_root / "serverApp" / "build.gradle.kts",
            self.source_kmp_root / "serverApp" / "src" / "main",
            self.source_kmp_root / "composeApp" / "src" / "desktopMain",
            self.source_kmp_root / "composeApp" / "src" / "commonMain",
            self.source_kmp_root / "backendApi" / "src" / "commonMain",
        ]
