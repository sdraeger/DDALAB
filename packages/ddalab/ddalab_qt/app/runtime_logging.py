from __future__ import annotations

import logging
import sys
import threading
from logging.handlers import RotatingFileHandler
from pathlib import Path
from time import gmtime
from typing import Optional


_LOG_ROOT = Path.home() / ".ddalab-qt" / "logs"
_LOG_FILE = _LOG_ROOT / "ddalab.log"
_LOGGER_NAME = "ddalab"
_CONFIG_LOCK = threading.Lock()
_CONFIGURED = False
_PREVIOUS_EXCEPTHOOK = sys.excepthook
_PREVIOUS_THREAD_EXCEPTHOOK = getattr(threading, "excepthook", None)


def log_file_path() -> Path:
    return _LOG_FILE


def configure_runtime_logging() -> Path:
    global _CONFIGURED
    with _CONFIG_LOCK:
        if _CONFIGURED:
            return _LOG_FILE

        _LOG_ROOT.mkdir(parents=True, exist_ok=True)

        handler = RotatingFileHandler(
            _LOG_FILE,
            maxBytes=2_000_000,
            backupCount=5,
            encoding="utf-8",
        )
        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
        )
        formatter.converter = gmtime
        handler.setFormatter(formatter)

        logger = logging.getLogger(_LOGGER_NAME)
        logger.handlers.clear()
        logger.setLevel(logging.INFO)
        logger.propagate = False
        logger.addHandler(handler)

        _CONFIGURED = True
        logger.info("Runtime logging initialized at %s", _LOG_FILE)
        return _LOG_FILE


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
