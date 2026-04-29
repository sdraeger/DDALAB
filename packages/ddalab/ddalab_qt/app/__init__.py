from __future__ import annotations

from typing import Any


__all__ = ["MainWindow", "build_main_window"]


def __getattr__(name: str) -> Any:
    if name in __all__:
        from .main_window import MainWindow, build_main_window

        exports = {
            "MainWindow": MainWindow,
            "build_main_window": build_main_window,
        }
        return exports[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
