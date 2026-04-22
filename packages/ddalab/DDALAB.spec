from __future__ import annotations

import os
from pathlib import Path

from PyInstaller.compat import is_darwin
from PyInstaller.utils.hooks import collect_all
from PyInstaller.utils.hooks import collect_data_files
from PyInstaller.utils.hooks import copy_metadata
from ddalab_qt.runtime_binary_names import (
    PACKAGED_CLI_BINARY_STEM,
    platform_binary_name,
)
from ddalab_qt.version import get_app_version


PROJECT_ROOT = Path(globals().get("SPECPATH", Path.cwd())).resolve()
PACKAGE_ROOT = PROJECT_ROOT.resolve()
RUNTIME_BIN_DIR = PACKAGE_ROOT / "ddalab_qt" / "runtime" / "bin"
APP_VERSION = os.environ.get("DDALAB_VERSION", get_app_version())
DIST_MODE = os.environ.get("DDALAB_DIST_MODE", "dir").lower()

CLI_BINARY_NAME = platform_binary_name(PACKAGED_CLI_BINARY_STEM)

CLI_BINARY_PATH = RUNTIME_BIN_DIR / CLI_BINARY_NAME

missing = [path for path in (CLI_BINARY_PATH,) if not path.exists()]
if missing:
    raise SystemExit(
        "Missing staged native dependencies for Qt bundle build. Run scripts/prepare_runtime.py first: "
        + ", ".join(str(path) for path in missing)
    )

datas = collect_data_files("ddalab_qt", excludes=["runtime/bin/*"])
datas += copy_metadata("ddalab")

binaries = [
    (str(CLI_BINARY_PATH), "bin"),
]

hiddenimports = []

_EXCLUDED_DATA_PATTERNS = [
    "**/tests/**",
    "**/test/**",
    "**/testing/**",
    "**/examples/**",
    "**/__pycache__/**",
]


def _runtime_submodule_filter(name: str) -> bool:
    return not any(
        fragment in name
        for fragment in (".tests", ".test", ".testing", ".examples")
    )

# Collect the full optional reader/runtime stacks so the packaged app exposes
# the same file-format support as the installed Python environment.
for package_name in (
    "matplotlib",
    "mne",
    "defusedxml",
    "pymatreader",
    "mffpy",
    "nibabel",
    "pyxdf",
    "pynwb",
    "hdmf",
    "lazy_loader",
):
    package_datas, package_binaries, package_hiddenimports = collect_all(
        package_name,
        filter_submodules=_runtime_submodule_filter,
        exclude_datas=_EXCLUDED_DATA_PATTERNS,
    )
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

hiddenimports += [
    "defusedxml.ElementTree",
    "defusedxml.minidom",
    "matplotlib.backends.backend_agg",
    "scipy.signal",
    "scipy.stats",
    "sklearn",
    "sklearn.decomposition",
]

datas = list(dict.fromkeys(datas))
binaries = list(dict.fromkeys(binaries))
hiddenimports = sorted(dict.fromkeys(hiddenimports))

a = Analysis(
    ["run_ddalab_gui.py"],
    pathex=[str(PROJECT_ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

if DIST_MODE == "onefile":
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.zipfiles,
        a.datas,
        [],
        name="DDALAB",
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,
        console=False,
    )
else:
    exe = EXE(
        pyz,
        a.scripts,
        [],
        exclude_binaries=True,
        name="DDALAB",
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,
        console=False,
    )

    coll = COLLECT(
        exe,
        a.binaries,
        a.zipfiles,
        a.datas,
        strip=False,
        upx=False,
        name="DDALAB",
    )

    if is_darwin:
        app = BUNDLE(
            coll,
            name="DDALAB.app",
            bundle_identifier="io.ddalab.desktop",
            info_plist={
                "CFBundleDisplayName": "DDALAB",
                "CFBundleName": "DDALAB",
                "CFBundleShortVersionString": APP_VERSION,
                "CFBundleVersion": APP_VERSION,
            },
        )
