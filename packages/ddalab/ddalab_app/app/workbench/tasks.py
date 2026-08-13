from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from PySide6.QtCore import QObject, Signal

from ..runtime.runtime_logging import runtime_logger


class TaskSignals(QObject):
    success = Signal(object)
    error = Signal(str)
    progress = Signal(object)


class TaskRunner:
    def __init__(self, parent: QObject, *, workers: int = 4) -> None:
        self._parent = parent
        self._executor = ThreadPoolExecutor(
            max_workers=workers,
            thread_name_prefix="ddalab-workbench",
        )

    def submit(
        self,
        task: Callable[[Callable[[object], None]], object],
        on_success: Callable[[object], None],
        on_error: Callable[[str], None],
        on_progress: Callable[[object], None] | None = None,
    ) -> None:
        signals = TaskSignals(self._parent)
        signals.success.connect(on_success)
        signals.error.connect(on_error)
        if on_progress is not None:
            signals.progress.connect(on_progress)

        def run() -> None:
            try:
                result = task(signals.progress.emit)
            except Exception as exc:  # noqa: BLE001
                runtime_logger("workbench.worker").exception("Background task failed")
                signals.error.emit(str(exc))
                return
            signals.success.emit(result)

        self._executor.submit(run)

    def close(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)
