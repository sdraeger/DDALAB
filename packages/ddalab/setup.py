from __future__ import annotations

import os
import platform
import subprocess
import sys
from pathlib import Path

from setuptools import Distribution, setup
from setuptools.command.build_py import build_py as _build_py

try:
    from setuptools.command.bdist_wheel import bdist_wheel as _bdist_wheel
except ImportError:
    from wheel.bdist_wheel import bdist_wheel as _bdist_wheel


PROJECT_ROOT = Path(__file__).resolve().parent
PREPARE_RUNTIME_SCRIPT = PROJECT_ROOT / "scripts" / "prepare_runtime.py"


def _should_prepare_runtime() -> bool:
    return os.environ.get("DDALAB_SKIP_RUNTIME_PREP") != "1"


class build_py(_build_py):
    def run(self) -> None:
        if _should_prepare_runtime():
            subprocess.run(
                [sys.executable, str(PREPARE_RUNTIME_SCRIPT)],
                cwd=PROJECT_ROOT,
                check=True,
            )
        super().run()


class BinaryDistribution(Distribution):
    def has_ext_modules(self) -> bool:
        return True


class bdist_wheel(_bdist_wheel):
    def finalize_options(self) -> None:
        super().finalize_options()
        self.root_is_pure = False
        deployment_target = os.environ.get("MACOSX_DEPLOYMENT_TARGET")
        if sys.platform == "darwin" and deployment_target:
            target = deployment_target.replace(".", "_")
            self.plat_name = f"macosx_{target}_{platform.machine().lower()}"
            self.plat_name_supplied = True

    def get_tag(self) -> tuple[str, str, str]:
        _, _, plat = super().get_tag()
        return "py3", "none", plat


setup(
    distclass=BinaryDistribution,
    cmdclass={
        "build_py": build_py,
        "bdist_wheel": bdist_wheel,
    },
)
