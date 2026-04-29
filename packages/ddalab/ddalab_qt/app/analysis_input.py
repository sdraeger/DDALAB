from __future__ import annotations

from typing import Optional


def parse_time_bounds(
    start_text: str,
    end_text: str,
    *,
    label: str,
    default_start: Optional[float] = 0.0,
) -> tuple[Optional[float], Optional[float]]:
    start = _parse_optional_seconds(
        start_text,
        field_name=f"{label} start",
        default=default_start,
    )
    end = _parse_optional_seconds(
        end_text,
        field_name=f"{label} end",
        default=None,
    )
    if start is not None and start < 0:
        raise ValueError(f"{label} start must be greater than or equal to 0.")
    if end is not None and end < 0:
        raise ValueError(f"{label} end must be greater than or equal to 0.")
    if start is not None and end is not None and end <= start:
        raise ValueError(f"{label} end must be greater than the start time.")
    return start, end


def _parse_optional_seconds(
    raw_text: str,
    *,
    field_name: str,
    default: Optional[float],
) -> Optional[float]:
    text = str(raw_text or "").strip()
    if not text:
        return default
    try:
        return float(text)
    except ValueError as exc:
        raise ValueError(
            f"{field_name} must be a valid number of seconds."
        ) from exc
