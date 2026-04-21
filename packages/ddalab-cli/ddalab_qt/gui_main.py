from __future__ import annotations

import argparse
import sys
from typing import Optional, Sequence

from PySide6.QtWidgets import QApplication

from .app.main_window import build_main_window
from .runtime_paths import RuntimePaths
from .ui.style import apply_theme


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="DDALAB")
    parser.add_argument(
        "--server",
        default=None,
        help="Optional remote DDALAB analysis server URL for institutional deployments. If omitted, the Qt app uses the local Python backend by default.",
    )
    parser.add_argument(
        "--smoke-test",
        action="store_true",
        help="Instantiate the app and exit immediately",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    runtime_paths = RuntimePaths.detect()
    app = QApplication(sys.argv)
    app.setApplicationName("DDALAB")
    apply_theme(app, runtime_paths)
    window = build_main_window(
        runtime_paths=runtime_paths,
        server_url=args.server,
        bootstrap_backend=not args.smoke_test,
    )

    if args.smoke_test:
        app.processEvents()
        return 0

    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
