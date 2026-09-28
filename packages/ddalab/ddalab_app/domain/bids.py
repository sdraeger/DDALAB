"""BIDS sidecar files beside a recording: events, channels, and the modality JSON."""

from __future__ import annotations

import csv
import hashlib
import json
import re
from pathlib import Path

from .models import WaveformAnnotation

# Neural channel types, matched by prefix so MEGMAG and MEGGRADAXIAL count as MEG
_NEURAL_TYPES = ("EEG", "ECOG", "SEEG", "DBS", "MEG")


def sidecar(recording: str, suffix: str) -> Path | None:
    """sub-01_task-x_ieeg.vhdr -> sub-01_task-x_<suffix>, or None when it is missing."""
    path = Path(recording)
    stem, sep, _ = path.name.rpartition("_")
    found = path.with_name(f"{stem}_{suffix}")
    return found if sep and found.is_file() else None


def recording_json(recording: str) -> dict:
    """The modality sidecar (sub-..._ieeg.json for sub-..._ieeg.vhdr), or {}."""
    modality = Path(recording).name.rpartition("_")[2].split(".")[0]
    path = sidecar(recording, f"{modality}.json")
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path else {}
    except (OSError, ValueError):
        return {}


def _rows(path: Path | None) -> list[dict[str, str]]:
    if path is None:
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def event_annotations(recording: str) -> list[WaveformAnnotation]:
    """Events of events.tsv as annotations; clock stamps such as "+60.000000" are skipped."""
    # annotation ids are global, so they carry the recording
    prefix = hashlib.sha1(str(Path(recording).resolve()).encode()).hexdigest()[:10]
    annotations = []
    for index, row in enumerate(_rows(sidecar(recording, "events.tsv"))):
        label = (row.get("trial_type") or "").strip()
        try:
            onset = float(row["onset"])
            duration = float(row.get("duration") or 0.0)
        except (KeyError, TypeError, ValueError):
            continue
        if not label or re.fullmatch(r"\+\d+\.\d+", label):
            continue
        annotations.append(
            WaveformAnnotation(
                id=f"bids-{prefix}-{index}",
                label=label,
                notes="BIDS events.tsv",
                channel_name=None,
                start_seconds=onset,
                end_seconds=onset + duration if duration > 0 else None,
            )
        )
    return annotations


def event_onset(recording: str, pattern: str) -> float | None:
    """Onset of the earliest event whose trial_type matches pattern (case-insensitive)."""
    matcher = re.compile(pattern, re.IGNORECASE)
    onsets = [
        event.start_seconds
        for event in event_annotations(recording)
        if matcher.search(event.label)
    ]
    return min(onsets, default=None)


def good_channels(recording: str) -> list[str] | None:
    """Neural channels marked good in channels.tsv, or None without a channels file."""
    path = sidecar(recording, "channels.tsv")
    if path is None:
        return None
    return [
        row["name"]
        for row in _rows(path)
        if (row.get("status") or "good").strip().lower() == "good"
        and (row.get("type") or "").strip().upper().startswith(_NEURAL_TYPES)
    ]
