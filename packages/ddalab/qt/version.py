from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version as package_version
from pathlib import Path
import tomllib

_FALLBACK_VERSION = "0.0.0.dev0"


def _source_checkout_version() -> str | None:
    module_path = Path(__file__).resolve()
    for candidate in module_path.parents:
        pyproject = candidate / "pyproject.toml"
        if not pyproject.exists():
            continue
        payload = tomllib.loads(pyproject.read_text(encoding="utf-8"))
        project = payload.get("project")
        if not isinstance(project, dict):
            continue
        if project.get("name") != "ddalab":
            continue
        version = project.get("version")
        if isinstance(version, str) and version.strip():
            return version.strip()
    return None


def get_app_version() -> str:
    source_version = _source_checkout_version()
    if source_version is not None:
        return source_version
    try:
        return package_version("ddalab")
    except PackageNotFoundError:
        pass
    return _FALLBACK_VERSION
