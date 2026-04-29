from __future__ import annotations

import json
import os
import subprocess
import threading
from collections import deque
from time import perf_counter_ns
from typing import Any, Callable, Mapping, Optional, Sequence

from ..app.perf_logging import perf_logger


class DdaSidecarClient:
    def __init__(
        self,
        *,
        cli_command: Sequence[str],
        cwd: str,
        preview_columns: int = 2048,
    ) -> None:
        self._command = [*[str(part) for part in cli_command], "serve"]
        self._command.extend(
            [
                "--preview-columns",
                str(max(int(preview_columns), 16)),
            ]
        )
        self._cwd = str(cwd)
        self._lock = threading.RLock()
        self._process: Optional[subprocess.Popen[str]] = None
        self._stderr_lines: deque[str] = deque(maxlen=160)
        self._stderr_thread: Optional[threading.Thread] = None

    def run_group(
        self,
        params: Mapping[str, Any],
        *,
        on_progress: Optional[Callable[[dict[str, Any]], None]] = None,
    ) -> dict[str, Any]:
        payload = self.request("run_group", params, on_progress=on_progress)
        return payload if isinstance(payload, dict) else {}

    def run_group_matrix(
        self,
        params: Mapping[str, Any],
        *,
        on_progress: Optional[Callable[[dict[str, Any]], None]] = None,
    ) -> dict[str, Any]:
        payload = self.request("run_group_matrix", params, on_progress=on_progress)
        return payload if isinstance(payload, dict) else {}

    def run_group_matrix_file(
        self,
        params: Mapping[str, Any],
        *,
        on_progress: Optional[Callable[[dict[str, Any]], None]] = None,
    ) -> dict[str, Any]:
        payload = self.request(
            "run_group_matrix_file",
            params,
            on_progress=on_progress,
        )
        return payload if isinstance(payload, dict) else {}

    def request(
        self,
        method: str,
        params: Optional[Mapping[str, Any]] = None,
        *,
        on_progress: Optional[Callable[[dict[str, Any]], None]] = None,
    ) -> Any:
        with self._lock:
            self._ensure_process_locked()
            return self._request_locked(method, params or {}, on_progress=on_progress)

    def close(self) -> None:
        with self._lock:
            process = self._process
            if process is None:
                return
            try:
                if process.poll() is None:
                    try:
                        self._request_locked("shutdown", {})
                    except Exception:
                        pass
                    try:
                        process.terminate()
                        process.wait(timeout=2)
                    except Exception:
                        process.kill()
            finally:
                self._process = None

    def _ensure_process_locked(self) -> None:
        process = self._process
        if process is not None and process.poll() is None:
            return
        self._stderr_lines.clear()
        env = dict(os.environ)
        spawn_started_ns = perf_counter_ns()
        process = subprocess.Popen(
            self._command,
            cwd=self._cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
            env=env,
        )
        self._process = process
        stderr_pipe = process.stderr
        if stderr_pipe is not None:
            self._stderr_thread = threading.Thread(
                target=self._drain_stderr,
                args=(stderr_pipe,),
                daemon=True,
                name="ddalab-dda-sidecar-stderr",
            )
            self._stderr_thread.start()
        self._request_locked("ping", {})
        perf_logger().log_duration(
            "dda.sidecar.process.start",
            spawn_started_ns,
            command=" ".join(self._command),
        )

    def _request_locked(
        self,
        method: str,
        params: Mapping[str, Any],
        *,
        on_progress: Optional[Callable[[dict[str, Any]], None]] = None,
    ) -> Any:
        process = self._process
        if process is None or process.poll() is not None:
            raise RuntimeError(self._dead_process_message("DDA sidecar is not running."))
        stdin = process.stdin
        stdout = process.stdout
        if stdin is None or stdout is None:
            raise RuntimeError("DDA sidecar pipes were not initialized.")
        request_payload = {"method": method, "params": dict(params)}
        try:
            stdin.write(json.dumps(request_payload, separators=(",", ":")) + "\n")
            stdin.flush()
        except Exception as error:
            raise RuntimeError(
                self._dead_process_message(
                    f"Could not send a request to the DDA sidecar: {error}"
                )
            ) from error

        while True:
            response_line = stdout.readline()
            if not response_line:
                raise RuntimeError(
                    self._dead_process_message(
                        f"DDA sidecar closed while handling '{method}'."
                    )
                )
            try:
                response = json.loads(response_line)
            except json.JSONDecodeError as error:
                raise RuntimeError(
                    self._dead_process_message(
                        f"DDA sidecar returned malformed JSON for '{method}': {error}"
                    )
                ) from error
            if not isinstance(response, dict):
                raise RuntimeError(
                    self._dead_process_message(
                        f"DDA sidecar returned an unexpected response for '{method}'."
                    )
                )
            if response.get("event") == "progress":
                payload = response.get("payload")
                if on_progress is not None and isinstance(payload, dict):
                    try:
                        on_progress(payload)
                    except Exception:
                        pass
                continue
            if response.get("ok") is not True:
                message = str(response.get("error") or f"DDA sidecar '{method}' failed.")
                raise RuntimeError(self._dead_process_message(message))
            return response.get("result")

    def _dead_process_message(self, message: str) -> str:
        stderr_tail = self._stderr_tail()
        if stderr_tail:
            return (
                f"{message}\n\n"
                f"Sidecar command: {' '.join(self._command)}\n"
                f"Sidecar stderr:\n{stderr_tail}"
            )
        return f"{message}\n\nSidecar command: {' '.join(self._command)}"

    def _stderr_tail(self) -> str:
        return "\n".join(line for line in self._stderr_lines if line.strip())

    def _drain_stderr(self, stream) -> None:
        try:
            for line in stream:
                cleaned = line.rstrip()
                if cleaned:
                    self._stderr_lines.append(cleaned)
        finally:
            try:
                stream.close()
            except Exception:
                pass
