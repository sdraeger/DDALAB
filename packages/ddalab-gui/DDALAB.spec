from __future__ import annotations

import os
from pathlib import Path

from PyInstaller.compat import is_darwin
from PyInstaller.utils.hooks import collect_data_files
from PyInstaller.utils.hooks import copy_metadata
from ddalab_qt.runtime_binary_names import (
    DDA_BINARY_STEM,
    PACKAGED_CLI_BINARY_STEM,
    platform_binary_name,
)
from ddalab_qt.version import get_app_version


PROJECT_ROOT = Path.cwd()
CLI_PROJECT_ROOT = (PROJECT_ROOT.parent / "ddalab-cli").resolve()
RUNTIME_BIN_DIR = CLI_PROJECT_ROOT / "ddalab_qt" / "runtime" / "bin"
APP_VERSION = os.environ.get("DDALAB_VERSION", get_app_version())
DIST_MODE = os.environ.get("DDALAB_DIST_MODE", "dir").lower()

DDA_BINARY_NAME = platform_binary_name(DDA_BINARY_STEM)
CLI_BINARY_NAME = platform_binary_name(PACKAGED_CLI_BINARY_STEM)

DDA_BINARY_PATH = RUNTIME_BIN_DIR / DDA_BINARY_NAME
CLI_BINARY_PATH = RUNTIME_BIN_DIR / CLI_BINARY_NAME

missing = [path for path in (DDA_BINARY_PATH, CLI_BINARY_PATH) if not path.exists()]
if missing:
    raise SystemExit(
        "Missing staged native dependencies for Qt bundle build. Run scripts/prepare_runtime.py first: "
        + ", ".join(str(path) for path in missing)
    )

datas = collect_data_files("ddalab_qt", excludes=["runtime/bin/*"])
datas += collect_data_files("matplotlib")
datas += copy_metadata("ddalab")
datas += copy_metadata("ddalab-gui")
hiddenimports = [
    "matplotlib",
    "matplotlib.font_manager",
    "matplotlib.mathtext",
    "matplotlib.backends.backend_agg",
    "mne",
    "nibabel",
    "pyxdf",
    "pynwb",
    "sklearn",
    "sklearn.decomposition",
    "scipy.signal",
    "scipy.stats",
]

a = Analysis(
    ["run_ddalab_gui.py"],
    pathex=[str(PROJECT_ROOT), str(CLI_PROJECT_ROOT)],
    binaries=[
        (str(DDA_BINARY_PATH), "bin"),
        (str(CLI_BINARY_PATH), "bin"),
    ],
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
