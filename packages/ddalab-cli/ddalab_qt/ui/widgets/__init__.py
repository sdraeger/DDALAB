from __future__ import annotations

from importlib import import_module
from typing import Any

__all__ = [
    "BusyIndicatorBar",
    "ClickableLabel",
    "DdaLinePlotWidget",
    "FileBrowserWidget",
    "HeatmapWidget",
    "MathLabel",
    "OverviewWidget",
    "TextExportDialog",
    "WaveformWidget",
]

_MODULE_BY_NAME = {
    "BusyIndicatorBar": ".busy_indicator",
    "ClickableLabel": ".clickable_label",
    "DdaLinePlotWidget": ".plots",
    "FileBrowserWidget": ".file_browser",
    "HeatmapWidget": ".plots",
    "MathLabel": ".math_label",
    "OverviewWidget": ".plots",
    "TextExportDialog": ".text_export_dialog",
    "WaveformWidget": ".plots",
}


def __getattr__(name: str) -> Any:
    module_name = _MODULE_BY_NAME.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = import_module(module_name, __name__)
    return getattr(module, name)
