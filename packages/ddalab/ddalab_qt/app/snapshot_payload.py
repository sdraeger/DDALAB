from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Optional


def relink_snapshot_payload(
    payload: dict,
    *,
    old_path: str,
    new_path: str,
) -> dict:
    rewritten = deepcopy(payload)
    rewritten["activeFilePath"] = _replace_exact_path(
        rewritten.get("activeFilePath"),
        old_path,
        new_path,
    )
    rewritten["openFiles"] = _replace_path_list(
        rewritten.get("openFiles"),
        old_path,
        new_path,
    )
    rewritten["pinnedFiles"] = _replace_path_list(
        rewritten.get("pinnedFiles"),
        old_path,
        new_path,
    )
    annotations = rewritten.get("annotationsByFile")
    if isinstance(annotations, dict):
        remapped: dict[str, object] = {}
        for key, value in annotations.items():
            remapped[new_path if key == old_path else str(key)] = value
        rewritten["annotationsByFile"] = remapped
    _rewrite_result_path(rewritten.get("ddaResult"), old_path, new_path)
    _rewrite_result_path(rewritten.get("icaResult"), old_path, new_path)
    return rewritten


def first_missing_snapshot_source(payload: dict) -> Optional[str]:
    active_file = payload.get("activeFilePath")
    return active_file if isinstance(active_file, str) and active_file else None


def missing_snapshot_source_name(payload: dict, missing_path: str) -> str:
    active_file = payload.get("activeFilePath")
    if isinstance(active_file, str) and active_file:
        return Path(active_file).name
    if missing_path:
        return Path(missing_path).name
    dda_result = payload.get("ddaResult")
    if isinstance(dda_result, dict):
        for key in ("fileName", "file_name"):
            value = dda_result.get(key)
            if isinstance(value, str) and value:
                return value
    return "snapshot dataset"


def _replace_exact_path(value: object, old_path: str, new_path: str) -> object:
    if isinstance(value, str) and value == old_path:
        return new_path
    return value


def _replace_path_list(value: object, old_path: str, new_path: str) -> list[str]:
    if not isinstance(value, list):
        return []
    rewritten: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item:
            continue
        rewritten.append(new_path if item == old_path else item)
    return rewritten


def _rewrite_result_path(payload: object, old_path: str, new_path: str) -> None:
    if not isinstance(payload, dict):
        return
    for key in ("filePath", "file_path"):
        value = payload.get(key)
        if isinstance(value, str) and value == old_path:
            payload[key] = new_path
