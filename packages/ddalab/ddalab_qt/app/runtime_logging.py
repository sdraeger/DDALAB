from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
import os
import sys
import tempfile
import threading
from logging.handlers import RotatingFileHandler
from pathlib import Path
from time import gmtime
from typing import Optional


_DEFAULT_LOG_ROOT = Path.home() / ".ddalab-qt" / "logs"
_FALLBACK_LOG_ROOT = Path(tempfile.gettempdir()) / "ddalab-qt" / "logs"
_LOG_FILE_NAME = "ddalab.log"
_UPDATE_AUDIT_FILE_NAME = "update-audit.jsonl"
_UPDATE_INSTALLER_LOG_FILE_NAME = "update-installer.log"
_LOGGER_NAME = "ddalab"
_CONFIG_LOCK = threading.Lock()
_CONFIGURED = False
_ACTIVE_LOG_ROOT = _DEFAULT_LOG_ROOT
_ACTIVE_LOG_FILE = _DEFAULT_LOG_ROOT / _LOG_FILE_NAME
_BOOTSTRAP_WARNING: Optional[str] = None
_PREVIOUS_EXCEPTHOOK = sys.excepthook
_PREVIOUS_THREAD_EXCEPTHOOK = getattr(threading, "excepthook", None)


def log_file_path() -> Path:
    return _ACTIVE_LOG_FILE


def update_audit_log_path() -> Path:
    return _resolve_writable_log_root() / _UPDATE_AUDIT_FILE_NAME


def update_installer_log_path() -> Path:
    return _resolve_writable_log_root() / _UPDATE_INSTALLER_LOG_FILE_NAME


def log_root_path() -> Path:
    return _resolve_writable_log_root()


def logging_bootstrap_warning() -> Optional[str]:
    return _BOOTSTRAP_WARNING


def append_update_audit_event(event: str, **fields: object) -> None:
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    payload = {"timestamp": timestamp, "event": event}
    payload.update(
        {
            key: _normalize_audit_value(value)
            for key, value in fields.items()
            if value is not None
        }
    )
    try:
        audit_path = update_audit_log_path()
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        with audit_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, sort_keys=True) + "\n")
    except Exception as exc:  # noqa: BLE001
        _safe_stderr_write(
            f"DDALAB update audit logging failed for event={event}: {exc}\n"
        )


def configure_runtime_logging() -> Path:
    global _ACTIVE_LOG_FILE
    global _ACTIVE_LOG_ROOT
    global _BOOTSTRAP_WARNING
    global _CONFIGURED
    with _CONFIG_LOCK:
        if _CONFIGURED:
            return _ACTIVE_LOG_FILE

        logger = logging.getLogger(_LOGGER_NAME)
        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
        )
        formatter.converter = gmtime

        handler: logging.Handler
        selected_log_file: Optional[Path] = None
        bootstrap_errors: list[str] = []
        for candidate_root in _candidate_log_roots():
            try:
                candidate_root.mkdir(parents=True, exist_ok=True)
                candidate_log_file = candidate_root / _LOG_FILE_NAME
                with candidate_log_file.open("a", encoding="utf-8"):
                    pass
                handler = RotatingFileHandler(
                    candidate_log_file,
                    maxBytes=2_000_000,
                    backupCount=5,
                    encoding="utf-8",
                )
                selected_log_file = candidate_log_file
                _ACTIVE_LOG_ROOT = candidate_root
                _ACTIVE_LOG_FILE = candidate_log_file
                break
            except Exception as exc:  # noqa: BLE001
                bootstrap_errors.append(f"{candidate_root}: {exc}")
        else:
            handler = logging.StreamHandler(sys.stderr)
            _ACTIVE_LOG_ROOT = _FALLBACK_LOG_ROOT
            _ACTIVE_LOG_FILE = _FALLBACK_LOG_ROOT / _LOG_FILE_NAME

        handler.setFormatter(formatter)
        logger.handlers.clear()
        logger.setLevel(logging.INFO)
        logger.propagate = False
        logger.addHandler(handler)

        if bootstrap_errors:
            if selected_log_file is not None:
                _BOOTSTRAP_WARNING = (
                    "Primary log path was unavailable; using fallback log file "
                    f"{selected_log_file}. Errors: {' | '.join(bootstrap_errors)}"
                )
            else:
                _BOOTSTRAP_WARNING = (
                    "DDALAB could not open any file-backed log destination; using "
                    f"stderr only. Errors: {' | '.join(bootstrap_errors)}"
                )
        else:
            _BOOTSTRAP_WARNING = None

        _CONFIGURED = True
        logger.info("Runtime logging initialized at %s", _ACTIVE_LOG_FILE)
        if _BOOTSTRAP_WARNING is not None:
            logger.warning(_BOOTSTRAP_WARNING)
        return _ACTIVE_LOG_FILE


def runtime_logger(name: Optional[str] = None) -> logging.Logger:
    configure_runtime_logging()
    logger = logging.getLogger(_LOGGER_NAME)
    return logger if not name else logger.getChild(name)


def install_exception_logging() -> None:
    configure_runtime_logging()

    def handle_uncaught_exception(exc_type, exc_value, exc_traceback) -> None:
        runtime_logger("crash").critical(
            "Unhandled exception",
            exc_info=(exc_type, exc_value, exc_traceback),
        )
        if _PREVIOUS_EXCEPTHOOK is not None:
            _PREVIOUS_EXCEPTHOOK(exc_type, exc_value, exc_traceback)

    sys.excepthook = handle_uncaught_exception

    previous_thread_hook = _PREVIOUS_THREAD_EXCEPTHOOK
    if previous_thread_hook is None:
        return

    def handle_thread_exception(args) -> None:
        runtime_logger("thread").critical(
            "Unhandled thread exception",
            exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
        )
        previous_thread_hook(args)

    threading.excepthook = handle_thread_exception


def add_log_file_hint(message: str) -> str:
    text = str(message).strip() or "Unknown error."
    hint = f"Log file: {log_file_path()}"
    if hint in text:
        return text
    return f"{text}\n\n{hint}"


def _candidate_log_roots() -> list[Path]:
    candidates: list[Path] = []
    env_root = os.environ.get("DDALAB_LOG_DIR")
    if env_root:
        candidates.append(Path(env_root).expanduser())
    candidates.append(_DEFAULT_LOG_ROOT)
    candidates.append(_FALLBACK_LOG_ROOT)
    unique_candidates: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        unique_candidates.append(candidate)
    return unique_candidates


def _resolve_writable_log_root() -> Path:
    if _CONFIGURED:
        return _ACTIVE_LOG_ROOT
    for candidate in _candidate_log_roots():
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            test_path = candidate / ".write-test"
            with test_path.open("a", encoding="utf-8"):
                pass
            test_path.unlink(missing_ok=True)
            return candidate
        except Exception:  # noqa: BLE001
            continue
    return _FALLBACK_LOG_ROOT


def _normalize_audit_value(value: object) -> object:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_normalize_audit_value(item) for item in value]
    if isinstance(value, dict):
        return {
            str(key): _normalize_audit_value(item) for key, item in value.items()
        }
    return str(value)


def _safe_stderr_write(message: str) -> None:
    try:
        sys.stderr.write(message)
    except Exception:  # noqa: BLE001
        pass
