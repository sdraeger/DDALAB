// `ddalab mcp`: the stdio MCP server, driven as a client drives it. HIPAA mode (the default) keeps annotation text and
// samples from the model; `--no-hipaa` returns both.
use serde_json::{json, Value};
use std::path::Path;

const EDF: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/fixture.edf");

/// The replies of `ddalab mcp <flags>` to `messages`, one JSON-RPC message per line.
fn session(flags: &[&str], messages: &[Value]) -> Vec<Value> {
    let input: String = messages.iter().map(|m| format!("{m}\n")).collect();
    let output = assert_cmd::cargo::cargo_bin_cmd!("ddalab")
        .arg("mcp")
        .args(flags)
        .write_stdin(input)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn initialize() -> Value {
    json!({"jsonrpc": "2.0", "id": 0, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "0"}}})
}

fn call(id: u64, name: &str, arguments: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "method": "tools/call", "params": {"name": name, "arguments": arguments}})
}

/// The JSON a tool call returned, and whether it is an error.
fn content(reply: &Value) -> (Value, bool) {
    let result = &reply["result"];
    let text = result["content"][0]["text"].as_str().unwrap();
    let value = serde_json::from_str(text).unwrap_or(Value::String(text.into()));
    (value, result["isError"] == true)
}

fn tool_names(reply: &Value) -> Vec<String> {
    reply["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn hipaa_mode_withholds_annotation_text_and_samples() {
    let replies = session(
        &[],
        &[
            initialize(),
            json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
            call(2, "inspect_recording", json!({"file": EDF})),
            call(
                3,
                "read_samples",
                json!({"file": EDF, "channels": [0], "start_sample": 0, "count": 4}),
            ),
        ],
    );
    assert_eq!(replies.len(), 4, "a notification has no reply");
    let init = &replies[0]["result"];
    assert_eq!(init["protocolVersion"], "2025-06-18");
    assert_eq!(init["serverInfo"]["name"], "ddalab");
    assert!(init["instructions"]
        .as_str()
        .unwrap()
        .contains("HIPAA mode is on"));
    assert!(!tool_names(&replies[1]).contains(&"read_samples".to_string()));

    let (info, error) = content(&replies[2]);
    assert!(!error);
    assert_eq!(info["sample_rate_hz"], 256.0);
    let labels: Vec<&str> = info["channels"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["label"].as_str().unwrap())
        .collect();
    assert_eq!(labels, ["Fp1", "Fp2"]);
    assert_eq!(
        info["annotations"],
        json!([{"onset_s": 2.5, "duration_s": 1.0}, {"onset_s": 20.0, "duration_s": 0.0}])
    );
    assert_eq!(info["annotation_text_withheld"], true);
    assert!(!replies[2].to_string().contains("eyes closed"));

    assert_eq!(
        replies[3]["error"]["code"], -32602,
        "read_samples does not exist in HIPAA mode"
    );
}

#[test]
fn without_hipaa_mode_annotation_text_and_samples_are_returned() {
    let replies = session(
        &["--no-hipaa"],
        &[
            initialize(),
            json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
            call(2, "inspect_recording", json!({"file": EDF})),
            call(
                3,
                "read_samples",
                json!({"file": EDF, "channels": [0, 1], "start_sample": 10, "count": 4}),
            ),
            call(
                4,
                "read_samples",
                json!({"file": EDF, "channels": [0], "start_sample": 0, "count": 1_000_000}),
            ),
        ],
    );
    assert!(replies[0]["result"]["instructions"]
        .as_str()
        .unwrap()
        .contains("HIPAA mode is off"));
    assert!(tool_names(&replies[1]).contains(&"read_samples".to_string()));
    let (info, _) = content(&replies[2]);
    assert_eq!(info["annotations"][0]["label"], "eyes closed");
    assert_eq!(info["annotation_text_withheld"], false);

    let (samples, error) = content(&replies[3]);
    assert!(!error);
    assert_eq!(samples["channels"], json!(["Fp1", "Fp2"]));
    assert_eq!(samples["values"].as_array().unwrap().len(), 2);
    assert_eq!(samples["values"][0].as_array().unwrap().len(), 4);

    let (message, error) = content(&replies[4]);
    assert!(error, "too many samples is refused: {message}");
}

#[test]
fn a_run_saves_its_result_and_reads_back_in_bins() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("run.json");
    let out = out.to_str().unwrap();
    let replies = session(
        &[],
        &[
            initialize(),
            call(
                1,
                "run_dda",
                json!({"file": EDF, "channels": [0, 1], "variants": ["ST"], "wl": 256, "ws": 128, "output": out}),
            ),
            call(2, "read_result", json!({"result": out, "max_windows": 5})),
            call(
                3,
                "read_result",
                json!({"result": out, "rows": ["Fp2"], "start": 10, "end": 20}),
            ),
        ],
    );
    let (run, error) = content(&replies[1]);
    assert!(!error, "{run}");
    assert_eq!(run["result"], out);
    assert!(Path::new(out).is_file());
    assert_eq!(run["variants"][0]["row_labels"], json!(["Fp1", "Fp2"]));
    let windows = run["windows"].as_u64().unwrap();
    assert!(windows > 5);

    let (binned, error) = content(&replies[2]);
    assert!(!error, "{binned}");
    assert_eq!(binned["rows"], json!(["Fp1", "Fp2"]));
    assert_eq!(
        binned["window_centers_seconds"].as_array().unwrap().len(),
        5
    );
    assert_eq!(binned["values"][1].as_array().unwrap().len(), 5);

    let (part, error) = content(&replies[3]);
    assert!(!error, "{part}");
    assert_eq!(part["rows"], json!(["Fp2"]));
    let centers: Vec<f64> = part["window_centers_seconds"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t.as_f64().unwrap())
        .collect();
    assert!(
        centers.iter().all(|&t| (10.0..=20.0).contains(&t)),
        "{centers:?}"
    );
}

#[test]
fn a_run_without_output_is_found_by_its_id() {
    let replies = session(
        &[],
        &[
            initialize(),
            call(
                1,
                "run_dda",
                json!({"file": EDF, "channels": [0], "wl": 256, "ws": 256}),
            ),
        ],
    );
    let (run, error) = content(&replies[1]);
    assert!(!error, "{run}");
    let id = run["id"].as_str().unwrap();
    let replies = session(
        &[],
        &[initialize(), call(1, "read_result", json!({"result": id}))],
    );
    let (read, error) = content(&replies[1]);
    assert!(!error, "{read}");
    assert_eq!(read["rows"], json!(["Fp1"]));
    std::fs::remove_file(run["result"].as_str().unwrap()).unwrap();
}

#[test]
fn bad_requests_get_errors_and_the_server_keeps_going() {
    let replies = session(
        &[],
        &[
            initialize(),
            json!({"jsonrpc": "2.0", "id": 1, "method": "nope"}),
            call(2, "no_such_tool", json!({})),
            call(3, "inspect_recording", json!({"file": "/no/such/file.edf"})),
            call(4, "inspect_recording", json!({"fiel": EDF})),
            call(5, "run_dda", json!({"file": EDF, "channels": [9]})),
            json!({"jsonrpc": "2.0", "id": 6, "method": "ping"}),
        ],
    );
    assert_eq!(replies[1]["error"]["code"], -32601);
    assert_eq!(replies[2]["error"]["code"], -32602);
    for reply in &replies[3..6] {
        assert!(content(reply).1, "{reply}");
    }
    assert_eq!(replies[6]["result"], json!({}));
}

#[test]
fn a_malformed_line_gets_a_parse_error() {
    let output = assert_cmd::cargo::cargo_bin_cmd!("ddalab")
        .arg("mcp")
        .write_stdin("{not json\n")
        .output()
        .unwrap();
    let reply: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(reply["error"]["code"], -32700);
}
