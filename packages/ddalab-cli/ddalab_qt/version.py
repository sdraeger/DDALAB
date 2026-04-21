from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version as package_version
import json
from pathlib import Path

_FALLBACK_VERSION = "0.0.0.dev0"


def _source_checkout_version() -> str | None:
    module_path = Path(__file__).resolve()
    for candidate in module_path.parents:
        package_json = candidate / "package.json"
        if not package_json.exists():
            continue
        if not (candidate / "packages" / "ddalab-cli").exists():
            continue
        if not (candidate / "packages" / "ddalab-gui").exists():
            continue
        payload = json.loads(package_json.read_text())
        version = payload.get("version")
        if isinstance(version, str) and version.strip():
            return version.strip()
    return None


def get_app_version() -> str:
    source_version = _source_checkout_version()
    if source_version is not None:
        return source_version
    for package_name in ("ddalab-gui", "ddalab"):
        try:
            return package_version(package_name)
        except PackageNotFoundError:
            continue
    return _FALLBACK_VERSION
