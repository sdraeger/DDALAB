from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from time import monotonic, perf_counter_ns
from typing import Dict


class PerfLogger:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._last_slow_event_at_ms: Dict[str, float] = {}

    def log(self, event: str, **fields: object) -> None:
        timestamp = datetime.now(timezone.utc).isoformat()
        parts = [f"{timestamp} [PERF] event={event}"]
        for key, value in fields.items():
            parts.append(f"{key}={self._normalize(value)}")
        line = " | ".join(parts) + "\n"
        with self._lock:
            try:
                with self.path.open("a", encoding="utf-8") as handle:
                    handle.write(line)
            except OSError:
                return

    def log_duration(self, event: str, start_ns: int, **fields: object) -> float:
        duration_ms = max(0.0, (perf_counter_ns() - start_ns) / 1_000_000.0)
        self.log(event, durationMs=f"{duration_ms:.2f}", **fields)
        return duration_ms

    def log_slow(
        self,
        key: str,
        event: str,
        duration_ms: float,
        *,
        threshold_ms: float,
        cooldown_ms: float = 1000.0,
        **fields: object,
    ) -> None:
        if duration_ms < threshold_ms:
            return
        now_ms = monotonic() * 1000.0
        previous = self._last_slow_event_at_ms.get(key)
        if previous is not None and (now_ms - previous) < cooldown_ms:
            return
        self._last_slow_event_at_ms[key] = now_ms
        self.log(event, durationMs=f"{duration_ms:.2f}", **fields)

    @staticmethod
    def _normalize(value: object) -> str:
        if value is None:
            return "none"
        if isinstance(value, float):
            return f"{value:.3f}"
        text = str(value).replace("\n", "\\n")
        return text if text else '""'


_PERF_LOGGER = PerfLogger(Path.home() / ".ddalab-qt" / "ddalab-qt-debug.log")


def perf_logger() -> PerfLogger:
    return _PERF_LOGGER
