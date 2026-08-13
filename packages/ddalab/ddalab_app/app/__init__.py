from __future__ import annotations

__all__ = ["WorkbenchController", "build_workbench"]


def __getattr__(name: str):
    if name in __all__:
        from .workbench import WorkbenchController, build_workbench

        return {
            "WorkbenchController": WorkbenchController,
            "build_workbench": build_workbench,
        }[name]
    raise AttributeError(name)
