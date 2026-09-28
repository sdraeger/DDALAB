import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from ddalab_app import mcp_server
from ddalab_app.domain.models import DdaResult
from ddalab_app.mcp_server import serve
from ddalab_app.persistence.state_db import StateDatabase


def _exchange(*messages):
    out = io.StringIO()
    serve(io.StringIO("".join(json.dumps(m) + "\n" for m in messages)), out)
    return {r["id"]: r for r in map(json.loads, out.getvalue().splitlines())}


def call(id_, **params):
    return {"jsonrpc": "2.0", "id": id_, "method": "tools/call", "params": params}


class McpServerTest(unittest.TestCase):
    def test_protocol_and_result_query(self) -> None:
        result = {
            "id": "r1",
            "file_path": "a.edf",
            "window_centers_seconds": [0.5, 1.5, 2.5, 3.5],
            "diagnostics": [],
            "variants": [
                {
                    "id": "ST",
                    "label": "Single timeseries",
                    "row_labels": ["C3", "C4"],
                    "matrix": [[1.0, 2.0, 3.0, 4.0], [5.0, None, 7.0, 8.0]],
                }
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "r.json")
            Path(path).write_text(json.dumps(result))
            db = StateDatabase(Path(tmp) / "state.sqlite3")
            db.save_dda_result(
                DdaResult.from_json(
                    {
                        **result,
                        "file_name": "a.edf",
                        "created_at_iso": "2026-09-27T00:00:00Z",
                        "engine_label": "DDA",
                    }
                )
            )
            db.close()
            with mock.patch.object(
                mcp_server,
                "StateDatabase",
                lambda: StateDatabase(Path(tmp) / "state.sqlite3"),
            ):
                replies = _exchange(
                    {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "initialize",
                        "params": {"protocolVersion": "2025-06-18"},
                    },
                    {"jsonrpc": "2.0", "method": "notifications/initialized"},
                    {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                    call(3, name="dda_result", arguments={"result": path}),
                    call(
                        4,
                        name="dda_result",
                        arguments={"result": path, "rows": ["C4"], "max_windows": 2},
                    ),
                    call(
                        5,
                        name="dda_result",
                        arguments={"result": path, "variant": "CT"},
                    ),
                    call(6, name="nope"),
                    {"jsonrpc": "2.0", "id": 7, "method": "resources/list"},
                    call(8, name="dda_history", arguments={}),
                    call(
                        9, name="dda_result", arguments={"result": "r1", "rows": ["C3"]}
                    ),
                )
        self.assertEqual(sorted(replies), [1, 2, 3, 4, 5, 6, 7, 8, 9])
        self.assertEqual(replies[1]["result"]["protocolVersion"], "2025-06-18")
        self.assertEqual(
            {t["name"] for t in replies[2]["result"]["tools"]},
            {"dda_info", "dataset_info", "dda_run", "dda_result", "dda_history"},
        )
        default = json.loads(replies[3]["result"]["content"][0]["text"])
        self.assertEqual(
            (default["variants"], default["rows"], default["windows_per_value"]),
            (["ST"], ["C3", "C4"], 1.0),
        )
        sliced = json.loads(replies[4]["result"]["content"][0]["text"])
        self.assertEqual(
            sliced["values"], [[5.0, 7.5]]
        )  # NaN skipped inside the first bin
        self.assertEqual(sliced["window_centers_seconds"], [1.0, 3.0])
        self.assertTrue(replies[5]["result"]["isError"])
        self.assertEqual(replies[6]["error"]["code"], -32602)
        self.assertEqual(replies[7]["error"]["code"], -32601)
        self.assertEqual(
            json.loads(replies[8]["result"]["content"][0]["text"])[0]["id"], "r1"
        )
        self.assertEqual(
            json.loads(replies[9]["result"]["content"][0]["text"])["values"],
            [[1.0, 2.0, 3.0, 4.0]],
        )


if __name__ == "__main__":
    unittest.main()
