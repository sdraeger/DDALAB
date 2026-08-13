from __future__ import annotations

from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path

from PySide6.QtCore import QObject, QUrl
from PySide6.QtQml import QQmlApplicationEngine

from ...runtime_paths import RuntimePaths
from ...ui.quick_plot_surface import register_quick_plot_types
from ...ui.quick_waveform_surface import register_quick_waveform_types
from .controller import WorkbenchController


@dataclass
class WorkbenchRuntime:
    engine: QQmlApplicationEngine
    controller: WorkbenchController
    window: QObject


def workbench_qml_path() -> Path:
    return Path(str(files("ddalab_app.ui.qml.workbench").joinpath("Main.qml")))


def build_workbench(
    runtime_paths: RuntimePaths,
    *,
    bootstrap_backend: bool = True,
) -> WorkbenchRuntime:
    register_quick_plot_types()
    register_quick_waveform_types()
    controller = WorkbenchController(
        runtime_paths,
        bootstrap_backend=bootstrap_backend,
    )
    engine = QQmlApplicationEngine()
    engine.rootContext().setContextProperty("workbench", controller)
    engine.load(QUrl.fromLocalFile(str(workbench_qml_path())))
    roots = engine.rootObjects()
    if not roots:
        controller.close()
        raise RuntimeError("The DDALAB QML workbench could not be loaded.")
    return WorkbenchRuntime(engine=engine, controller=controller, window=roots[0])
