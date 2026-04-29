from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import platform
import shlex
import stat
import subprocess
import sys
import tempfile
from typing import Callable, Optional
import zipfile

from packaging.version import InvalidVersion, Version
import requests

from .app.runtime_logging import (
    append_update_audit_event,
    update_installer_log_path,
)
from .runtime_paths import RuntimePaths

DEFAULT_RELEASE_REPOSITORY = os.environ.get(
    "DDALAB_UPDATE_REPOSITORY",
    "sdraeger/DDALAB",
)
_GITHUB_API_ROOT = "https://api.github.com"
_DOWNLOAD_CHUNK_SIZE = 1024 * 1024


@dataclass(frozen=True)
class ReleaseAsset:
    name: str
    download_url: str
    size_bytes: int


@dataclass(frozen=True)
class AvailableUpdate:
    current_version: str
    latest_version: str
    tag_name: str
    release_name: str
    release_url: str
    published_at_iso: Optional[str]
    asset: ReleaseAsset


@dataclass(frozen=True)
class UpdateDownloadProgress:
    downloaded_bytes: int
    total_bytes: int

    @property
    def percent(self) -> Optional[int]:
        if self.total_bytes <= 0:
            return None
        return max(0, min(100, int((self.downloaded_bytes * 100) / self.total_bytes)))


class UpdateManager:
    def __init__(
        self,
        runtime_paths: RuntimePaths,
        current_version: str,
        *,
        repository: str = DEFAULT_RELEASE_REPOSITORY,
    ) -> None:
        self.runtime_paths = runtime_paths
        self.current_version = current_version
        self.repository = repository

    def supports_updates(self) -> bool:
        return (
            self.runtime_paths.is_packaged_build()
            and self.platform_name in {"windows", "macos", "linux"}
            and self.architecture in {"x64", "arm64"}
            and self._supported_asset_suffix() is not None
        )

    @property
    def platform_name(self) -> str:
        if sys.platform == "darwin":
            return "macos"
        if sys.platform.startswith("win"):
            return "windows"
        if sys.platform.startswith("linux"):
            return "linux"
        return sys.platform

    @property
    def architecture(self) -> str:
        machine = platform.machine().lower()
        if not machine:
            machine = os.environ.get("PROCESSOR_ARCHITECTURE", "").lower()
        if machine in {"x86_64", "amd64"}:
            return "x64"
        if machine in {"arm64", "aarch64"}:
            return "arm64"
        return machine or "unknown"

    def check_for_updates(self) -> Optional[AvailableUpdate]:
        if not self.supports_updates():
            raise RuntimeError(
                "Automatic updates are available only in packaged desktop builds."
            )

        append_update_audit_event(
            "check-start",
            repository=self.repository,
            platform=self.platform_name,
            architecture=self.architecture,
            current_version=self.current_version,
        )
        release = self._fetch_latest_release()
        tag_name = str(release.get("tag_name") or "").strip()
        release_version = self._normalized_release_version(tag_name)
        current_version = self._normalized_release_version(self.current_version)
        if Version(release_version) <= Version(current_version):
            append_update_audit_event(
                "check-no-update",
                repository=self.repository,
                latest_version=release_version,
                current_version=current_version,
            )
            return None

        asset = self._select_release_asset(release)
        update = AvailableUpdate(
            current_version=current_version,
            latest_version=release_version,
            tag_name=tag_name or f"v{release_version}",
            release_name=str(release.get("name") or f"DDALAB {release_version}"),
            release_url=str(release.get("html_url") or ""),
            published_at_iso=(
                str(release.get("published_at")).strip()
                if release.get("published_at")
                else None
            ),
            asset=asset,
        )
        append_update_audit_event(
            "check-update-available",
            repository=self.repository,
            latest_version=update.latest_version,
            tag_name=update.tag_name,
            asset_name=update.asset.name,
        )
        return update

    def download_update(
        self,
        update: AvailableUpdate,
        progress_callback: Optional[Callable[[UpdateDownloadProgress], None]] = None,
    ) -> Path:
        download_dir = Path(tempfile.mkdtemp(prefix="ddalab-update-"))
        target_path = download_dir / update.asset.name
        append_update_audit_event(
            "download-start",
            tag_name=update.tag_name,
            asset_name=update.asset.name,
            target_path=target_path,
            size_bytes=update.asset.size_bytes,
        )
        headers = {
            "Accept": "application/octet-stream",
            "User-Agent": "DDALAB-Updater",
        }
        with requests.get(
            update.asset.download_url,
            headers=headers,
            stream=True,
            timeout=(10, 120),
        ) as response:
            response.raise_for_status()
            total_bytes = int(
                response.headers.get("Content-Length") or update.asset.size_bytes or 0
            )
            downloaded_bytes = 0
            with target_path.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=_DOWNLOAD_CHUNK_SIZE):
                    if not chunk:
                        continue
                    handle.write(chunk)
                    downloaded_bytes += len(chunk)
                    if progress_callback is not None:
                        progress_callback(
                            UpdateDownloadProgress(
                                downloaded_bytes=downloaded_bytes,
                                total_bytes=total_bytes,
                            )
                        )
        append_update_audit_event(
            "download-complete",
            tag_name=update.tag_name,
            asset_name=update.asset.name,
            target_path=target_path,
            downloaded_bytes=downloaded_bytes,
        )
        return target_path

    def start_install(self, asset_path: Path, *, current_pid: int) -> str:
        append_update_audit_event(
            "install-start",
            asset_path=asset_path,
            current_pid=current_pid,
            platform=self.platform_name,
            architecture=self.architecture,
        )
        if self.platform_name == "windows":
            return self._start_windows_install(asset_path)
        if self.platform_name == "macos":
            return self._start_macos_install(asset_path, current_pid=current_pid)
        if self.platform_name == "linux":
            return self._start_linux_install(asset_path, current_pid=current_pid)
        raise RuntimeError(f"Unsupported update platform: {self.platform_name}")

    def _fetch_latest_release(self) -> dict:
        url = f"{_GITHUB_API_ROOT}/repos/{self.repository}/releases/latest"
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "DDALAB-Updater",
        }
        response = requests.get(url, headers=headers, timeout=(10, 30))
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError("GitHub release lookup returned an unexpected payload.")
        return payload

    def _normalized_release_version(self, raw_version: str) -> str:
        candidate = raw_version.strip().removeprefix("v")
        try:
            return str(Version(candidate))
        except InvalidVersion as exc:
            raise RuntimeError(f"Unsupported DDALAB version string: {raw_version}") from exc

    def _select_release_asset(self, release: dict) -> ReleaseAsset:
        suffix = self._supported_asset_suffix()
        if suffix is None:
            raise RuntimeError(
                f"No updater asset mapping is configured for {self.platform_name} {self.architecture}."
            )
        assets = release.get("assets")
        if not isinstance(assets, list):
            raise RuntimeError("GitHub release is missing its asset list.")
        for asset in assets:
            if not isinstance(asset, dict):
                continue
            name = str(asset.get("name") or "").strip()
            if name.endswith(suffix):
                return ReleaseAsset(
                    name=name,
                    download_url=str(asset.get("browser_download_url") or ""),
                    size_bytes=int(asset.get("size") or 0),
                )
        raise RuntimeError(
            f"The latest release does not contain a compatible {self.platform_name} {self.architecture} installer."
        )

    def _supported_asset_suffix(self) -> Optional[str]:
        if self.platform_name == "windows" and self.architecture == "x64":
            return "-windows-x64-installer.exe"
        if self.platform_name == "macos" and self.architecture in {"x64", "arm64"}:
            return f"-macos-{self.architecture}-app.zip"
        if self.platform_name == "linux" and self.architecture == "x64":
            return "-linux-x64.AppImage"
        return None

    def _start_windows_install(self, asset_path: Path) -> str:
        creationflags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(
            subprocess,
            "CREATE_NEW_PROCESS_GROUP",
            0,
        )
        subprocess.Popen(
            [
                str(asset_path),
                "/VERYSILENT",
                "/SUPPRESSMSGBOXES",
                "/NORESTART",
            ],
            close_fds=True,
            creationflags=creationflags,
        )
        return (
            "DDALAB will close and the Windows installer will finish the update in "
            "the background."
        )

    def _start_macos_install(self, asset_path: Path, *, current_pid: int) -> str:
        target_app = self.runtime_paths.app_bundle_path
        if target_app is None:
            raise RuntimeError("Could not determine the installed macOS app bundle.")
        if not os.access(target_app.parent, os.W_OK):
            raise RuntimeError(
                f"The install location is not writable: {target_app.parent}"
            )

        work_dir = Path(tempfile.mkdtemp(prefix="ddalab-macos-update-"))
        extract_dir = work_dir / "extracted"
        extract_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(asset_path) as archive:
            archive.extractall(extract_dir)

        extracted_app = next(
            (path for path in extract_dir.rglob("*.app") if path.name == "DDALAB.app"),
            None,
        )
        if extracted_app is None:
            raise RuntimeError("The downloaded update did not contain DDALAB.app.")

        script_path = work_dir / "install_update.sh"
        script_path.write_text(
            _build_macos_installer_script(
                current_pid=current_pid,
                target_app=target_app,
                extracted_app=extracted_app,
                installer_log_path=update_installer_log_path(),
            ),
            encoding="utf-8",
        )
        script_path.chmod(script_path.stat().st_mode | stat.S_IEXEC)
        subprocess.Popen(
            ["/bin/bash", str(script_path)],
            start_new_session=True,
        )
        return (
            "DDALAB will close, replace the installed macOS app bundle, and relaunch "
            "the new version."
        )

    def _start_linux_install(self, asset_path: Path, *, current_pid: int) -> str:
        target_binary = self.runtime_paths.packaged_update_target()
        if target_binary is None:
            raise RuntimeError("Could not determine the installed Linux executable.")
        if not os.access(target_binary.parent, os.W_OK):
            raise RuntimeError(
                f"The install location is not writable: {target_binary.parent}"
            )

        work_dir = Path(tempfile.mkdtemp(prefix="ddalab-linux-update-"))
        script_path = work_dir / "install_update.sh"
        script_path.write_text(
            _build_linux_installer_script(
                current_pid=current_pid,
                target_binary=target_binary,
                downloaded_binary=asset_path,
                installer_log_path=update_installer_log_path(),
            ),
            encoding="utf-8",
        )
        script_path.chmod(script_path.stat().st_mode | stat.S_IEXEC)
        subprocess.Popen(
            ["/bin/bash", str(script_path)],
            start_new_session=True,
        )
        return (
            "DDALAB will close, replace the installed Linux binary, and relaunch the "
            "new version."
        )


def _build_macos_installer_script(
    *,
    current_pid: int,
    target_app: Path,
    extracted_app: Path,
    installer_log_path: Path,
) -> str:
    return "\n".join(
        [
            "#!/bin/bash",
            "set -euo pipefail",
            f"PID={current_pid}",
            f"TARGET={shlex.quote(str(target_app))}",
            f"SOURCE={shlex.quote(str(extracted_app))}",
            f"LOG_FILE={shlex.quote(str(installer_log_path))}",
            'BACKUP="${TARGET}.previous"',
            'mkdir -p "$(dirname "$LOG_FILE")"',
            'exec >>"$LOG_FILE" 2>&1',
            'echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting macOS update install"',
            'restore_backup() {',
            '  if [ -d "$BACKUP" ]; then',
            '    rm -rf "$TARGET"',
            '    mv "$BACKUP" "$TARGET"',
            "  fi",
            "}",
            'trap \'echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] macOS update failed"; restore_backup\' ERR',
            'while kill -0 "$PID" 2>/dev/null; do sleep 1; done',
            'rm -rf "$BACKUP"',
            'if [ -d "$TARGET" ]; then mv "$TARGET" "$BACKUP"; fi',
            'ditto "$SOURCE" "$TARGET"',
            'open "$TARGET"',
            'echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] macOS update install finished"',
            "",
        ]
    )


def _build_linux_installer_script(
    *,
    current_pid: int,
    target_binary: Path,
    downloaded_binary: Path,
    installer_log_path: Path,
) -> str:
    return "\n".join(
        [
            "#!/bin/bash",
            "set -euo pipefail",
            f"PID={current_pid}",
            f"TARGET={shlex.quote(str(target_binary))}",
            f"SOURCE={shlex.quote(str(downloaded_binary))}",
            f"LOG_FILE={shlex.quote(str(installer_log_path))}",
            'STAGED="${TARGET}.new"',
            'BACKUP="${TARGET}.previous"',
            'mkdir -p "$(dirname "$LOG_FILE")"',
            'exec >>"$LOG_FILE" 2>&1',
            'echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting Linux update install"',
            'restore_backup() {',
            '  if [ -f "$BACKUP" ]; then',
            '    mv "$BACKUP" "$TARGET"',
            "  fi",
            "}",
            'trap \'echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Linux update failed"; rm -f "$STAGED"; restore_backup\' ERR',
            'while kill -0 "$PID" 2>/dev/null; do sleep 1; done',
            'cp "$SOURCE" "$STAGED"',
            'chmod +x "$STAGED"',
            'if [ -f "$TARGET" ]; then cp "$TARGET" "$BACKUP"; fi',
            'mv "$STAGED" "$TARGET"',
            '"$TARGET" &',
            'echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Linux update install finished"',
            "",
        ]
    )
