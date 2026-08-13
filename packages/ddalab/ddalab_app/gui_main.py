from __future__ import annotations

import argparse
import sys
from typing import Optional, Sequence

from PySide6.QtGui import QGuiApplication, QIcon

from .app.runtime.runtime_logging import (
    configure_runtime_logging,
    install_exception_logging,
    logging_bootstrap_warning,
    runtime_logger,
)
from .app.workbench import build_workbench
from .runtime_paths import RuntimePaths
from .version import get_app_version


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="DDALAB")
    parser.add_argument(
        "--smoke-test",
        action="store_true",
        help="Instantiate the app and exit immediately",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    runtime_paths = RuntimePaths.detect()
    startup_logger = None
    log_path = None
    try:
        log_path = configure_runtime_logging()
        install_exception_logging()
        startup_logger = runtime_logger("startup")
    except Exception as exc:  # noqa: BLE001
        print(
            f"DDALAB logging bootstrap failed; continuing without file logging: {exc}",
            file=sys.stderr,
        )
    if startup_logger is not None:
        startup_logger.info(
            "Launching DDALAB version=%s frozen=%s executable=%s log=%s",
            get_app_version(),
            bool(getattr(sys, "frozen", False)),
            runtime_paths.executable_path,
            log_path,
        )
        bootstrap_warning = logging_bootstrap_warning()
        if bootstrap_warning:
            startup_logger.warning("Logging bootstrap degraded: %s", bootstrap_warning)
    app = QGuiApplication(sys.argv)
    app.setApplicationName("DDALAB")
    app.setApplicationVersion(get_app_version())
    app_icon: Optional[QIcon] = None
    app_icon_path = runtime_paths.package_asset("icons", "icon.png")
    if app_icon_path.exists():
        candidate_icon = QIcon(str(app_icon_path))
        if not candidate_icon.isNull():
            app_icon = candidate_icon
            app.setWindowIcon(app_icon)
    runtime = build_workbench(
        runtime_paths,
        bootstrap_backend=not args.smoke_test,
    )

    if args.smoke_test:
        app.processEvents()
        runtime.controller.close()
        return 0

    app.aboutToQuit.connect(runtime.controller.close)
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
