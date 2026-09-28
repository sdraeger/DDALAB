"""Model Context Protocol server that lets AI agents run and query DDALAB.

Speaks MCP over stdio (newline-delimited JSON-RPC 2.0). Dataset and DDA tools run the
DDALAB CLI in a subprocess, so nothing the backend prints can reach the protocol
stream. dda_history reads the desktop app's state database.

usage: ddalab mcp    (for example: claude mcp add ddalab -- ddalab mcp)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import uuid
from contextlib import closing
from dataclasses import asdict
from pathlib import Path
from typing import Any, Optional, Sequence

import numpy as np

from .persistence.state_db import StateDatabase
from .version import get_app_version

# ponytail: stdio transport only; add streamable HTTP if a remote client needs it
PROTOCOL_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
RESULTS_DIR = Path(tempfile.gettempdir()) / "ddalab-mcp"
MAX_ROWS = 64
INSTRUCTIONS = (
    "DDALAB runs delay differential analysis (DDA) on EEG, iEEG, and other time series. "
    "Call dataset_info first to get 0-based channel indices, run dda_run, then read "
    "values with dda_result. dda_history lists results saved by the DDALAB desktop app; "
    "their IDs work in dda_result."
)


def _cli(*args: str) -> Any:
    """Run the DDALAB CLI and return its JSON output."""
    # ponytail: needs a pip or source install; a PyInstaller build would need its own CLI path
    proc = subprocess.run(
        [sys.executable, "-m", "ddalab_app", *args],
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,  # the child must not read the protocol stream
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"ddalab exited with {proc.returncode}")
    return json.loads(proc.stdout) if proc.stdout.strip() else None


def _num(x: float) -> Optional[float]:
    return float(f"{x:.4g}") if np.isfinite(x) else None


def _load_result(result: str) -> dict:
    path = Path(result).expanduser()
    if path.is_file():
        return json.loads(path.read_text())
    with closing(StateDatabase()) as db:
        found = db.load_dda_result_by_id(result)
    if found is None:
        raise ValueError(f"No result file or DDALAB history entry named {result!r}.")
    return asdict(found.materialize())


def dda_info() -> Any:
    return _cli("dda", "info", "--json")


def dataset_info(file: str) -> Any:
    return _cli("dataset", "info", "--file", file)


def dda_run(
    file: str,
    variants: Optional[Sequence[str]] = None,
    channels: Optional[Sequence[int]] = None,
    start: Optional[float] = None,
    end: Optional[float] = None,
    full_duration: bool = False,
    wl: Optional[int] = None,
    ws: Optional[int] = None,
    delays: Optional[Sequence[int]] = None,
    model: Optional[Sequence[int]] = None,
    variant_pairs: Sequence[str] = (),
    device: Optional[str] = None,
    output: Optional[str] = None,
) -> dict:
    out = Path(output).expanduser() if output else RESULTS_DIR / f"{Path(file).stem}-{uuid.uuid4().hex[:8]}.json"
    args = ["dda", "run", "--file", file, "--output", str(out), "--compact"]
    args += ["--channels", *map(str, channels)] if channels else ["--all-channels"]
    for flag, value in (("--start", start), ("--end", end), ("--wl", wl), ("--ws", ws), ("--device", device)):
        if value is not None:
            args += [flag, str(value)]
    for flag, values in (("--variants", variants), ("--delays", delays), ("--model", model)):
        if values:
            args += [flag, *map(str, values)]
    for pair in variant_pairs:
        args += ["--variant-pairs", pair]
    if full_duration:
        args.append("--full-duration")
    _cli(*args)
    result = json.loads(out.read_text())
    centers = result["window_centers_seconds"]
    return {
        "result": str(out),
        "id": result["id"],
        "file": result["file_path"],
        "windows": len(centers),
        "window_centers_seconds": [centers[0], centers[-1]] if centers else [],
        "variants": [
            {"id": v["id"], "rows": len(v["row_labels"]), "row_labels": v["row_labels"][:MAX_ROWS]}
            for v in result["variants"]
        ],
        "diagnostics": result["diagnostics"],
        "reproduction": result.get("reproduction"),
    }


def dda_result(
    result: str,
    variant: Optional[str] = None,
    rows: Optional[Sequence[str]] = None,
    start: Optional[float] = None,
    end: Optional[float] = None,
    max_windows: int = 100,
) -> dict:
    data = _load_result(result)
    ids = [v["id"] for v in data["variants"]]
    v = data["variants"][ids.index(variant) if variant else 0]
    labels = v["row_labels"]
    keep = [labels.index(r) for r in rows] if rows else list(range(min(len(labels), MAX_ROWS)))
    t = np.asarray(data["window_centers_seconds"], float)
    lo = -np.inf if start is None else start
    hi = np.inf if end is None else end
    sel = np.flatnonzero((t >= lo) & (t <= hi))
    if not sel.size:
        raise ValueError("No windows fall in the requested time range.")
    m = np.asarray(v["matrix"], float)[keep][:, sel]
    bins = np.array_split(np.arange(sel.size), min(int(max_windows), sel.size))
    return {
        "variants": ids,
        "variant": v["id"],
        "rows": [labels[i] for i in keep],
        "rows_total": len(labels),
        "window_centers_seconds": [_num(t[sel][b].mean()) for b in bins],
        "windows_per_value": sel.size / len(bins),
        "values": [[_num(np.nanmean(row[b])) for b in bins] for row in m],
    }


def dda_history(file: Optional[str] = None, limit: int = 20) -> list:
    path = os.path.abspath(os.path.expanduser(file)) if file else None
    with closing(StateDatabase()) as db:
        return [asdict(s) for s in db.load_dda_history_summaries(path, int(limit))]


def _array(item_type: str, description: str) -> dict:
    return {"type": "array", "items": {"type": item_type}, "description": description}


def _schema(props: dict, *required: str) -> dict:
    return {"type": "object", "properties": props, "required": list(required)}


TOOLS = {
    "dda_info": (
        dda_info,
        "DDALAB version, whether the DDA engine is available, default parameters, and the supported DDA variants.",
        _schema({}),
    ),
    "dataset_info": (
        dataset_info,
        "Open a recording (EDF, BrainVision, BIDS, CSV, ASCII, and more) and return its channels, sampling rate, and duration.",
        _schema({"file": {"type": "string", "description": "Path to the recording"}}, "file"),
    ),
    "dda_run": (
        dda_run,
        "Run DDA on a recording and save the full result as JSON. Returns a summary with the result path "
        "for dda_result. Uses all channels unless channels is given, and the first 30 s unless start, end, "
        "or full_duration is given. Window length, step, and delays are in samples.",
        _schema(
            {
            "file": {"type": "string", "description": "Path to the recording"},
            "variants": _array("string", "ST, CT, CD, DE, or SY; default ST"),
            "channels": _array("integer", "0-based channel indices from dataset_info"),
            "start": {"type": "number", "description": "Start time in seconds"},
            "end": {"type": "number", "description": "End time in seconds"},
            "full_duration": {"type": "boolean"},
            "wl": {"type": "integer", "description": "Window length in samples"},
            "ws": {"type": "integer", "description": "Window step in samples"},
            "delays": _array("integer", "Delays in samples"),
            "model": _array("integer", "MODEL term indices, for example [1, 2, 10]"),
            "variant_pairs": _array("string", "Channel pairs for CT or CD, for example ['CT:0-1,0-2']"),
            "device": {"type": "string", "description": "cpu (default), cuda, or cuda:N"},
            "output": {"type": "string", "description": "Where to save the result JSON; default is a temporary file"},
            },
            "file",
        ),
    ),
    "dda_result": (
        dda_result,
        f"Read a saved DDA result by file path or desktop-history ID. Returns the variant IDs and, for one variant "
        f"(default: the first), the values of the chosen rows (default: the first {MAX_ROWS}) in a time range, "
        "averaged into at most max_windows time bins.",
        _schema(
            {
            "result": {"type": "string", "description": "Result JSON path from dda_run, or an ID from dda_history"},
            "variant": {"type": "string"},
            "rows": _array("string", "Row labels, such as channel names"),
            "start": {"type": "number"},
            "end": {"type": "number"},
            "max_windows": {"type": "integer", "description": "Default 100"},
            },
            "result",
        ),
    ),
    "dda_history": (
        dda_history,
        "List DDA results saved by the DDALAB desktop app, newest first.",
        _schema(
            {
                "file": {"type": "string", "description": "Only results for this recording"},
                "limit": {"type": "integer", "description": "Default 20"},
            }
        ),
    ),
}


def _error(id_: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}


def _call(params: dict) -> dict:
    try:
        value = TOOLS[params["name"]][0](**(params.get("arguments") or {}))
    except Exception as exc:
        return {"content": [{"type": "text", "text": str(exc)}], "isError": True}
    return {"content": [{"type": "text", "text": json.dumps(value, separators=(",", ":"))}]}


def handle(msg: Any) -> Optional[dict]:
    """The reply to one JSON-RPC message, or None for notifications."""
    if not isinstance(msg, dict):
        return _error(None, -32600, "Invalid request")
    method, id_, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
    if id_ is None:
        return None
    if method == "initialize":
        asked = params.get("protocolVersion")
        result = {
            "protocolVersion": asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0],
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "ddalab", "version": get_app_version()},
            "instructions": INSTRUCTIONS,
        }
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {
            "tools": [
                {"name": name, "description": description, "inputSchema": schema}
                for name, (_, description, schema) in TOOLS.items()
            ]
        }
    elif method == "tools/call":
        if params.get("name") not in TOOLS:
            return _error(id_, -32602, f"Unknown tool: {params.get('name')}")
        result = _call(params)
    else:
        return _error(id_, -32601, f"Method not found: {method}")
    return {"jsonrpc": "2.0", "id": id_, "result": result}


def serve(stdin=sys.stdin, stdout=sys.stdout) -> None:
    for line in stdin:
        if not line.strip():
            continue
        try:
            reply = handle(json.loads(line))
        except ValueError:
            reply = _error(None, -32700, "Parse error")
        if reply is not None:
            stdout.write(json.dumps(reply, separators=(",", ":")) + "\n")
            stdout.flush()
