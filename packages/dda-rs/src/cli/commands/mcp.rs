// `ddalab mcp`: DDALAB as a Model Context Protocol server, one JSON-RPC message per line on stdin and stdout.
// Everything a tool returns goes to the agent's model provider. No tool returns a recording's header identity fields
// (`RecordingInfo` holds none); HIPAA mode, the default, also keeps annotation text and samples from the model.
use super::run::{analyze, job_of, request_of};
use crate::cli::args::{Cli, Command, McpArgs, PredictArgs, ReferenceArgs};
use crate::cli::output;
use crate::cli::{dda_params, exit_codes};
use crate::io::{open_referenced, FileSet, Reader};
use crate::VariantMetadata;
use clap::Parser;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

const PROTOCOL_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
/// The rows `read_result` returns when none are named, and the row labels `run_dda` lists.
const MAX_ROWS: usize = 64;
/// The most values one `read_samples` call returns.
const MAX_SAMPLES: usize = 10_000;

/// Where `run_dda` saves a result that names no output, as `<id>.json`: the user's cache directory, since a
/// shared temporary directory would let other users of a node read the results or plant files `read_result` reads.
fn results_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("ddalab-mcp")
}

/// `results_dir`, created readable by its owner only.
fn private_results_dir() -> Result<PathBuf, String> {
    let dir = results_dir();
    let failed = |e: std::io::Error| format!("{}: {e}", dir.display());
    std::fs::create_dir_all(&dir).map_err(failed)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&dir)
            .map_err(failed)?
            .permissions()
            .mode();
        if mode & 0o077 != 0 {
            // Fails unless this user owns the directory, which is the refusal a planted one gets.
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
                .map_err(failed)?;
        }
    }
    Ok(dir)
}

/// Serves stdin until it closes. Tool calls run in order on a worker thread, so a call may use the result of the one
/// before it, while this loop keeps answering `ping` and reading `notifications/cancelled` (a call can take minutes).
/// A call cancelled before it starts is skipped, and the reply of one cancelled while it runs is dropped, as the
/// protocol asks. At the end of input the server finishes the calls it has, then exits.
pub fn execute(args: McpArgs) -> i32 {
    let out = Mutex::new(std::io::stdout());
    let failed = AtomicBool::new(false);
    let cancelled: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
    let write = |reply: Value| {
        let mut out = out.lock().unwrap();
        if writeln!(out, "{reply}").and_then(|_| out.flush()).is_err() {
            failed.store(true, Ordering::Relaxed);
        }
    };
    let hipaa = args.hipaa;
    std::thread::scope(|scope| {
        let (calls, queued) = std::sync::mpsc::channel::<Value>();
        let (write_call, cancelled_call) = (&write, &cancelled);
        scope.spawn(move || {
            for message in queued {
                let id = message["id"].to_string();
                if cancelled_call.lock().unwrap().remove(&id) {
                    continue;
                }
                let reply = handle(&message, hipaa);
                if !cancelled_call.lock().unwrap().remove(&id) {
                    reply.into_iter().for_each(write_call);
                }
            }
        });
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                write(error(Value::Null, -32700, "Parse error"));
                continue;
            };
            if message["method"] == "notifications/cancelled" {
                if let Some(id) = message["params"].get("requestId") {
                    cancelled.lock().unwrap().insert(id.to_string());
                }
            } else if message["method"] == "tools/call" && message.get("id").is_some() {
                // The worker outlives this loop within the scope; a send fails only if it panicked.
                if calls.send(message).is_err() {
                    break;
                }
            } else {
                handle(&message, hipaa).into_iter().for_each(&write);
            }
        }
        drop(calls);
    });
    if failed.load(Ordering::Relaxed) {
        exit_codes::EXECUTION_ERROR
    } else {
        exit_codes::SUCCESS
    }
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

/// The reply to one message: none to a notification or to a response.
fn handle(message: &Value, hipaa: bool) -> Option<Value> {
    if !message.is_object() {
        return Some(error(Value::Null, -32600, "Invalid request"));
    }
    let id = message.get("id")?.clone();
    let method = message.get("method")?.as_str()?;
    let params = message.get("params").cloned().unwrap_or(json!({}));
    let result = match method {
        "initialize" => {
            let asked = params["protocolVersion"].as_str();
            json!({
                "protocolVersion": asked.filter(|v| PROTOCOL_VERSIONS.contains(v)).unwrap_or(PROTOCOL_VERSIONS[0]),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "ddalab", "title": "DDALAB", "version": env!("CARGO_PKG_VERSION")},
                "instructions": instructions(hipaa),
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({"tools": tools(hipaa)}),
        "tools/call" => {
            let name = params["name"].as_str().unwrap_or_default();
            if !tools(hipaa).iter().any(|tool| tool["name"] == name) {
                return Some(error(id, -32602, &format!("Unknown tool: {name}")));
            }
            let arguments = match params.get("arguments") {
                Some(Value::Null) | None => json!({}),
                Some(arguments) => arguments.clone(),
            };
            match call_caught(name, arguments, hipaa) {
                Ok(value) => json!({"content": [{"type": "text", "text": value.to_string()}]}),
                Err(message) => {
                    json!({"content": [{"type": "text", "text": message}], "isError": true})
                }
            }
        }
        _ => return Some(error(id, -32601, &format!("Method not found: {method}"))),
    };
    Some(json!({"jsonrpc": "2.0", "id": id, "result": result}))
}

fn instructions(hipaa: bool) -> String {
    let mode = if hipaa {
        "HIPAA mode is on: the tools return no annotation text and no samples, only a recording's channel layout and \
         timing and DDA results, and classify takes no annotation classes. The arguments and results of every call still reach the model provider, file paths \
         included."
    } else {
        "HIPAA mode is off: inspect_recording returns annotation text and read_samples returns samples. The user chose \
         this for recordings without patient data."
    };
    format!(
        "DDALAB runs delay differential analysis (DDA) on EEG, iEEG and other recordings on this computer. Call \
         inspect_recording for a recording's 0-based channel indices, run_dda to analyze it, then read_result for the \
         values. {mode}"
    )
}

fn tools(hipaa: bool) -> Vec<Value> {
    let read_only = json!({"readOnlyHint": true, "openWorldHint": false});
    let file = json!({"type": "string", "description": "Path to the recording (EDF, BDF, BrainVision .vhdr, EEGLAB .set, BIDS, ASCII or CSV)"});
    let sr = json!({"type": "number", "description": "Sampling rate in Hz, for text files only"});
    let indices = |what: &str| json!({"type": "array", "items": {"type": "integer", "minimum": 0}, "description": what});
    let pairs = |what: &str| json!({"type": "array", "items": {"type": "array", "items": {"type": "integer", "minimum": 0}, "minItems": 2, "maxItems": 2}, "description": what});
    let reference = json!({"type": "string", "description": "Re-reference the analysis channels: average, bipolar, \
        laplacian, or the path of a montage TSV (columns channel, source, weight). The derived channels replace the \
        analysis channels, so channel indices count them"});
    let electrodes = json!({"type": "string", "description": "For reference laplacian: the path of an electrodes TSV \
        (name, x, y, z); default the subject's *_electrodes.tsv beside the recording"});
    let mut tools = vec![
        json!({
            "name": "ddalab_info",
            "title": "DDALAB version and variants",
            "description": "DDALAB's version, the DDA variants it runs and the default DDA parameters.",
            "inputSchema": {"type": "object", "properties": {}},
            "annotations": read_only,
        }),
        json!({
            "name": "inspect_recording",
            "title": "Inspect a recording",
            "description": "A recording's format, sampling rate, duration, analysis channels (with the 0-based indices \
                run_dda takes), other channels, annotations and warnings.",
            "inputSchema": {"type": "object", "properties": {"file": file, "sr": sr, "reference": reference, "electrodes": electrodes}, "required": ["file"]},
            "annotations": read_only,
        }),
        json!({
            "name": "run_dda",
            "title": "Run DDA",
            "description": "Runs DDA on a recording and saves the whole result as JSON. Returns a summary with the \
                result's path and id for read_result. Defaults: the ST variant, every analysis channel BIDS does not mark \
                bad, the whole recording and the parameters ddalab_info lists. Window length, step and delays are in samples.",
            "inputSchema": {"type": "object", "properties": {
                "file": file,
                "variants": {"type": "array", "items": {"type": "string"}, "description": "ST, CT, CD, DE or SY (ddalab_info lists them)"},
                "channels": indices("0-based analysis channel indices from inspect_recording"),
                "start": {"type": "number", "description": "Start time in seconds"},
                "end": {"type": "number", "description": "End time in seconds"},
                "wl": {"type": "integer", "minimum": 1, "description": "Window length in samples"},
                "ws": {"type": "integer", "minimum": 1, "description": "Window step in samples"},
                "delays": {"type": "array", "items": {"type": "integer", "minimum": 1}, "description": "Delays (tau) in samples"},
                "model": {"type": "array", "items": {"type": "integer"}, "description": "Model term indices, such as [1, 2, 10]"},
                "ct_pairs": pairs("Channel pairs for CT, as analysis channel indices"),
                "cd_pairs": pairs("Directed channel pairs for CD, as analysis channel indices"),
                "sr": sr,
                "reference": reference,
                "electrodes": electrodes,
                "output": {"type": "string", "description": "Where to save the result JSON; default: a file in the system's temporary folder"},
            }, "required": ["file"]},
            "annotations": {"readOnlyHint": false, "destructiveHint": true, "idempotentHint": false, "openWorldHint": false},
        }),
        json!({
            "name": "read_result",
            "title": "Read a DDA result",
            "description": format!("A saved result's variant ids and, for one variant (default: the first), the values \
                of the named rows (default: the first {MAX_ROWS}) in a time range, averaged into at most max_windows bins \
                of consecutive windows."),
            "inputSchema": {"type": "object", "properties": {
                "result": {"type": "string", "description": "The result's path or id from run_dda"},
                "variant": {"type": "string", "description": "A variant id from run_dda, such as ST"},
                "rows": {"type": "array", "items": {"type": "string"}, "description": "Row labels, such as channel names"},
                "start": {"type": "number", "description": "Earliest window center in seconds"},
                "end": {"type": "number", "description": "Latest window center in seconds"},
                "max_windows": {"type": "integer", "minimum": 1, "description": "Default 100"},
            }, "required": ["result"]},
            "annotations": read_only,
        }),
        json!({
            "name": "classify",
            "title": "Find the DDA model that classifies segments",
            "description": "Cuts labeled recordings into segments, searches ST DDA structures (model terms, then delay \
                pairs) for the one whose features separate the classes best under grouped cross-validation with \
                shrinkage LDA, and trains its classifier. Labels come from a samples TSV (file, label, optional start, \
                end, group), from annotations of files matched by classes (plus rest for unannotated stretches), or \
                from a column of a BIDS participants.tsv. Reports the ranking, the search and nested balanced \
                accuracies (the nested one is unbiased), the confusion matrix and the saved report, which predict takes. \
                A search can take minutes.",
            "inputSchema": {"type": "object", "properties": {
                "samples": {"type": "string", "description": "Path of a samples TSV"},
                "files": {"type": "array", "items": {"type": "string"}, "description": "Recording paths for classes or participants"},
                "classes": {"type": "array", "items": {"type": "string"}, "description": "Annotation classes: NAME, or NAME=TEXT matching annotations containing TEXT"},
                "rest": {"type": "string", "description": "A class for stretches no annotation covers"},
                "participants": {"type": "string", "description": "Path of a BIDS participants.tsv"},
                "column": {"type": "string", "description": "Its column holding the class"},
                "segment": {"type": "number", "exclusiveMinimum": 0, "description": "Seconds per segment, default 10"},
                "channels": {"type": "array", "items": {"type": "string"}, "description": "Channel labels; default every analysis channel"},
                "reference": reference,
                "electrodes": electrodes,
                "wl": {"type": "integer", "minimum": 1},
                "ws": {"type": "integer", "minimum": 1},
                "terms": {"type": "integer", "minimum": 1, "description": "Model terms per structure, default 3"},
                "delay_range": {"type": "array", "items": {"type": "integer", "minimum": 1}, "minItems": 2, "maxItems": 2, "description": "Smallest and largest delay searched, default [1, 20]"},
                "folds": {"type": "integer", "minimum": 2},
                "sr": sr,
                "output": {"type": "string", "description": "Report path; default a file in the user's cache directory"},
            }},
            "annotations": {"readOnlyHint": false, "destructiveHint": true, "idempotentHint": true, "openWorldHint": false},
        }),
        json!({
            "name": "predict",
            "title": "Classify recordings",
            "description": "Classifies recordings segment by segment with the model of a classify report: each file's class by majority, its votes and every segment's class.",
            "inputSchema": {"type": "object", "properties": {
                "model": {"type": "string", "description": "Path of a classify report"},
                "files": {"type": "array", "items": {"type": "string"}},
                "segment": {"type": "number", "exclusiveMinimum": 0, "description": "Seconds per segment, default 10"},
                "sr": sr,
            }, "required": ["model", "files"]},
            "annotations": read_only,
        }),
    ];
    if !hipaa {
        tools.push(json!({
            "name": "read_samples",
            "title": "Read samples",
            "description": format!("Physical samples (SI units) of analysis channels, at most {MAX_SAMPLES} values per call."),
            "inputSchema": {"type": "object", "properties": {
                "file": file,
                "channels": indices("0-based analysis channel indices from inspect_recording"),
                "start_sample": {"type": "integer", "minimum": 0},
                "count": {"type": "integer", "minimum": 1, "description": "Samples per channel"},
                "sr": sr,
                "reference": reference,
                "electrodes": electrodes,
            }, "required": ["file", "channels", "start_sample", "count"]},
            "annotations": read_only,
        }));
    }
    tools
}

/// `call` on a thread of its own: a panic in the engine fails the call and leaves the server running.
fn call_caught(name: &str, arguments: Value, hipaa: bool) -> Result<Value, String> {
    std::thread::scope(|scope| scope.spawn(|| call(name, arguments, hipaa)).join()).unwrap_or_else(
        |_| Err("DDALAB failed with an internal error (details on the server's stderr)".into()),
    )
}

fn call(name: &str, arguments: Value, hipaa: bool) -> Result<Value, String> {
    match name {
        "ddalab_info" => Ok(info()),
        "inspect_recording" => inspect(parse(arguments)?, hipaa),
        "run_dda" => run(parse(arguments)?),
        "read_result" => read_result(parse(arguments)?),
        "read_samples" => samples(parse(arguments)?),
        "classify" => classify(parse(arguments)?, hipaa),
        "predict" => predict(parse(arguments)?),
        _ => Err(format!("Unknown tool: {name}")),
    }
}

fn parse<T: DeserializeOwned>(arguments: Value) -> Result<T, String> {
    serde_json::from_value(arguments).map_err(|e| format!("Invalid arguments: {e}"))
}

fn open(
    file: &str,
    sr: Option<f64>,
    reference: Option<String>,
    electrodes: Option<String>,
) -> Result<Box<dyn Reader>, String> {
    let reference = super::reference_of(&ReferenceArgs {
        reference,
        electrodes,
    })?;
    FileSet::from_path(Path::new(file))
        .and_then(|files| open_referenced(&files, sr, reference.as_ref()))
        .map_err(|e| format!("{file}: {e}"))
}

/// `x` to `digits` significant digits; null when not finite.
fn round(x: f64, digits: i32) -> Value {
    if !x.is_finite() {
        return Value::Null;
    }
    if x == 0.0 {
        return json!(0.0);
    }
    let scale = 10f64.powi(digits - 1 - x.abs().log10().floor() as i32);
    json!((x * scale).round() / scale)
}

fn info() -> Value {
    let variants: Vec<Value> = VariantMetadata::active_variants()
        .map(|v| json!({"id": v.abbreviation, "name": v.name, "channels": format!("{:?}", v.channel_format), "documentation": v.documentation}))
        .collect();
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "variants": variants,
        "defaults": {
            "variants": ["ST"],
            "wl": crate::DEFAULT_WINDOW_LENGTH,
            "ws": crate::DEFAULT_WINDOW_STEP,
            "delays": crate::DEFAULT_DELAYS,
            "model": crate::DEFAULT_MODEL_TERMS,
            "model_dimension": crate::DEFAULT_MODEL_DIMENSION,
            "polynomial_order": crate::DEFAULT_POLYNOMIAL_ORDER,
        },
        "accepted_variant_ids": dda_params::app_variant_ids().collect::<Vec<_>>(),
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InspectTool {
    file: String,
    sr: Option<f64>,
    reference: Option<String>,
    electrodes: Option<String>,
}

fn inspect(args: InspectTool, hipaa: bool) -> Result<Value, String> {
    let reader = open(&args.file, args.sr, args.reference, args.electrodes)?;
    let (annotations, scan_warnings) = reader
        .scan_annotations()
        .map_err(|e| format!("{}: {e}", args.file))?;
    let info = reader.info();
    let analysis = info.analysis_channels();
    let channels: Vec<Value> = analysis
        .iter()
        .enumerate()
        .map(|(index, &c)| {
            let channel = &info.channels[c];
            json!({"index": index, "label": channel.label, "unit": channel.unit, "bids_status": channel.bids_status})
        })
        .collect();
    let other: Vec<Value> = (0..info.channels.len())
        .filter(|c| !analysis.contains(c))
        .map(|c| {
            let channel = &info.channels[c];
            json!({"label": channel.label, "kind": channel.kind, "sample_rate_hz": channel.sample_rate_hz})
        })
        .collect();
    let annotations: Vec<Value> = annotations
        .iter()
        .map(|a| match hipaa {
            true => json!({"onset_s": a.onset_s, "duration_s": a.duration_s}),
            false => json!({"onset_s": a.onset_s, "duration_s": a.duration_s, "label": a.label}),
        })
        .collect();
    let warnings: Vec<&String> = info.warnings.iter().chain(&scan_warnings).collect();
    Ok(json!({
        "format": info.format,
        "sample_rate_hz": info.sample_rate_hz,
        "sample_count": info.sample_count,
        "duration_s": info.duration_s,
        "channels": channels,
        "other_channels": other,
        "annotations": annotations,
        "annotation_text_withheld": hipaa,
        "warnings": warnings,
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RunTool {
    file: String,
    variants: Option<Vec<String>>,
    channels: Option<Vec<usize>>,
    start: Option<f64>,
    end: Option<f64>,
    wl: Option<u32>,
    ws: Option<u32>,
    delays: Option<Vec<i32>>,
    model: Option<Vec<i32>>,
    ct_pairs: Option<Vec<[usize; 2]>>,
    cd_pairs: Option<Vec<[usize; 2]>>,
    sr: Option<f64>,
    reference: Option<String>,
    electrodes: Option<String>,
    output: Option<String>,
}

/// Runs the request `ddalab run` makes of the same flags, so the defaults and checks are the command line's.
fn run(args: RunTool) -> Result<Value, String> {
    // The command line's own message names its flags (--ct-pairs), which this tool does not have.
    let variants = dda_params::normalize_variants(args.variants.as_deref().unwrap_or_default())?;
    for (variant, argument, pairs, example) in [
        ("CT", "ct_pairs", &args.ct_pairs, "[[0, 1], [0, 2]]"),
        ("CD", "cd_pairs", &args.cd_pairs, "[[0, 1], [1, 0]]"),
    ] {
        if variants.iter().any(|v| v == variant) && pairs.as_ref().is_none_or(Vec::is_empty) {
            return Err(format!(
                "{variant} needs {argument}: pairs of analysis channel indices, such as {example}"
            ));
        }
    }
    let mut argv = vec![
        "ddalab".to_string(),
        "run".into(),
        "--quiet".into(),
        format!("--file={}", args.file),
    ];
    // Each value attached to its flag: a value that starts with "--" stays a value instead of becoming a flag.
    let mut flag = |name: &str, values: Vec<String>| {
        argv.extend(values.iter().map(|value| format!("--{name}={value}")));
    };
    let text = |values: Option<Vec<String>>| values.unwrap_or_default();
    let all =
        |values: Option<Vec<i64>>| text(values.map(|v| v.iter().map(i64::to_string).collect()));
    let pairs = |pairs: Option<Vec<[usize; 2]>>| {
        text(pairs.map(|p| p.iter().map(|[i, j]| format!("{i},{j}")).collect()))
    };
    flag("variants", text(args.variants));
    flag(
        "channels",
        all(args
            .channels
            .map(|c| c.into_iter().map(|c| c as i64).collect())),
    );
    flag(
        "delays",
        all(args.delays.map(|d| d.into_iter().map(i64::from).collect())),
    );
    flag(
        "model",
        all(args.model.map(|m| m.into_iter().map(i64::from).collect())),
    );
    flag("ct-pairs", pairs(args.ct_pairs));
    flag("cd-pairs", pairs(args.cd_pairs));
    flag("reference", text(args.reference.map(|r| vec![r])));
    flag("electrodes", text(args.electrodes.map(|e| vec![e])));
    flag("wl", all(args.wl.map(|v| vec![i64::from(v)])));
    flag("ws", all(args.ws.map(|v| vec![i64::from(v)])));
    for (name, value) in [("start", args.start), ("end", args.end), ("sr", args.sr)] {
        flag(name, text(value.map(|v| vec![v.to_string()])));
    }
    let run_args = match Cli::try_parse_from(&argv)
        .map_err(|e| e.render().to_string())?
        .command
    {
        Command::Run(run_args) => run_args,
        _ => unreachable!("argv names the run command"),
    };
    let (request, _) = request_of(&run_args)?;
    let document = analyze(job_of(&run_args, request))
        .map_err(|(_, message)| message)?
        .document;

    let path = match args.output {
        Some(output) => PathBuf::from(output),
        None => {
            let dir = private_results_dir()?;
            dir.join(format!("{}.json", document.id))
        }
    };
    let json = serde_json::to_vec(&document).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("{}: {e}", path.display()))?;

    let centers = &document.window_centers_seconds;
    let r = &document.reproduction;
    let variants: Vec<Value> = document
        .variants
        .iter()
        .map(|v| {
            json!({
                "id": v.id,
                "label": v.label,
                "rows": v.row_labels.len(),
                "row_labels": &v.row_labels[..v.row_labels.len().min(MAX_ROWS)],
                "min_value": v.min_value,
                "max_value": v.max_value,
            })
        })
        .collect();
    Ok(json!({
        "result": path,
        "id": document.id,
        "windows": centers.len(),
        "first_window_center_s": centers.first(),
        "last_window_center_s": centers.last(),
        "variants": variants,
        "parameters": {
            "start_time_seconds": r.start_time_seconds,
            "end_time_seconds": r.end_time_seconds,
            "wl": r.window_length_samples,
            "ws": r.window_step_samples,
            "delays": r.delays,
            "model": r.model_terms,
        },
        "diagnostics": document.diagnostics,
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResultTool {
    result: String,
    variant: Option<String>,
    rows: Option<Vec<String>>,
    start: Option<f64>,
    end: Option<f64>,
    max_windows: Option<usize>,
}

fn read_result(args: ResultTool) -> Result<Value, String> {
    let path = match Path::new(&args.result).is_file() {
        true => PathBuf::from(&args.result),
        false => results_dir().join(format!("{}.json", args.result)),
    };
    let text = std::fs::read_to_string(&path)
        .map_err(|_| format!("No result file or run_dda id {:?}", args.result))?;
    let document: Value =
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    let variants = document["variants"]
        .as_array()
        .ok_or("Not a DDALAB result document")?;
    let ids: Vec<&str> = variants.iter().filter_map(|v| v["id"].as_str()).collect();
    let variant = match &args.variant {
        Some(id) => variants
            .iter()
            .find(|v| v["id"].as_str().is_some_and(|v| v.eq_ignore_ascii_case(id)))
            .ok_or(format!("No variant {id:?}; this result has {ids:?}"))?,
        None => variants.first().ok_or("The result has no variant")?,
    };
    let labels: Vec<&str> = variant["row_labels"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let keep: Vec<usize> = match &args.rows {
        Some(rows) => rows
            .iter()
            .map(|row| {
                labels
                    .iter()
                    .position(|l| l == row)
                    .ok_or(format!("No row {row:?}; rows are {labels:?}"))
            })
            .collect::<Result<_, _>>()?,
        None => (0..labels.len().min(MAX_ROWS)).collect(),
    };
    let t: Vec<f64> = document["window_centers_seconds"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_f64)
        .collect();
    let (lo, hi) = (
        args.start.unwrap_or(f64::NEG_INFINITY),
        args.end.unwrap_or(f64::INFINITY),
    );
    let selected: Vec<usize> = (0..t.len()).filter(|&w| t[w] >= lo && t[w] <= hi).collect();
    if selected.is_empty() {
        return Err("No window falls in the requested time range".into());
    }
    // Consecutive selected windows split into k bins as evenly as numpy's array_split splits them.
    let n = selected.len();
    let k = args.max_windows.unwrap_or(100).clamp(1, n);
    let bins: Vec<&[usize]> = (0..k)
        .map(|b| &selected[b * n / k..(b + 1) * n / k])
        .collect();
    let mean = |values: &mut dyn Iterator<Item = f64>| {
        let (sum, count) = values
            .filter(|x| x.is_finite())
            .fold((0.0, 0), |(s, c), x| (s + x, c + 1));
        if count == 0 {
            f64::NAN
        } else {
            sum / count as f64
        }
    };
    let matrix = &variant["matrix"];
    let values: Vec<Vec<Value>> = keep
        .iter()
        .map(|&row| {
            let value = |w: usize| matrix[row][w].as_f64().unwrap_or(f64::NAN);
            bins.iter()
                .map(|bin| round(mean(&mut bin.iter().map(|&w| value(w))), 4))
                .collect()
        })
        .collect();
    Ok(json!({
        "variants": ids,
        "variant": variant["id"],
        "rows": keep.iter().map(|&i| labels[i]).collect::<Vec<_>>(),
        "rows_total": labels.len(),
        "window_centers_seconds": bins.iter().map(|bin| round(mean(&mut bin.iter().map(|&w| t[w])), 6)).collect::<Vec<_>>(),
        "windows_per_value": n as f64 / k as f64,
        "values": values,
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SamplesTool {
    file: String,
    channels: Vec<usize>,
    start_sample: u64,
    count: usize,
    sr: Option<f64>,
    reference: Option<String>,
    electrodes: Option<String>,
}

fn samples(args: SamplesTool) -> Result<Value, String> {
    if args.channels.is_empty() || args.count == 0 {
        return Err("Ask for at least one channel and one sample".into());
    }
    if args.count.saturating_mul(args.channels.len()) > MAX_SAMPLES {
        return Err(format!(
            "At most {MAX_SAMPLES} values per call: ask for fewer samples or channels"
        ));
    }
    let reader = open(&args.file, args.sr, args.reference, args.electrodes)?;
    let info = reader.info();
    let analysis = info.analysis_channels();
    let channels: Vec<usize> = args
        .channels
        .iter()
        .map(|&i| {
            analysis.get(i).copied().ok_or(format!(
                "Channel {i} is out of range: {} analysis channels",
                analysis.len()
            ))
        })
        .collect::<Result<_, _>>()?;
    let end = args.start_sample.checked_add(args.count as u64);
    if !end.is_some_and(|end| end <= info.sample_count) {
        return Err(format!(
            "The recording has {} samples per channel",
            info.sample_count
        ));
    }
    let rows = reader
        .read_rows(&channels, args.start_sample, args.count)
        .map_err(|e| e.to_string())?;
    let values: Vec<Vec<Value>> = (0..channels.len())
        .map(|k| rows.iter().map(|row| round(row[k], 6)).collect())
        .collect();
    Ok(json!({
        "channels": channels.iter().map(|&c| &info.channels[c].label).collect::<Vec<_>>(),
        "units": channels.iter().map(|&c| &info.channels[c].unit).collect::<Vec<_>>(),
        "sample_rate_hz": info.sample_rate_hz,
        "start_sample": args.start_sample,
        "values": values,
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClassifyTool {
    samples: Option<String>,
    files: Option<Vec<String>>,
    classes: Option<Vec<String>>,
    rest: Option<String>,
    participants: Option<String>,
    column: Option<String>,
    segment: Option<f64>,
    channels: Option<Vec<String>>,
    reference: Option<String>,
    electrodes: Option<String>,
    wl: Option<u32>,
    ws: Option<u32>,
    terms: Option<u32>,
    delay_range: Option<[u32; 2]>,
    folds: Option<u32>,
    sr: Option<f64>,
    output: Option<String>,
}

/// `ddalab classify` with the flags of `args`: the summary of its report, which it saves. In HIPAA mode `classes` is
/// refused: classes are matched against annotation text, and which ones matched would tell the model that text.
fn classify(args: ClassifyTool, hipaa: bool) -> Result<Value, String> {
    if hipaa && args.classes.is_some() {
        return Err("HIPAA mode: classes are matched against annotation text, so classify takes them only without \
                    HIPAA mode; label segments with samples or participants instead"
            .into());
    }
    let path = match args.output {
        Some(output) => PathBuf::from(output),
        None => {
            let dir = private_results_dir()?;
            dir.join(format!("classify-{}.json", uuid::Uuid::new_v4()))
        }
    };
    let mut argv = vec![
        "ddalab".to_string(),
        "classify".into(),
        "--quiet".into(),
        format!("--output={}", path.display()),
    ];
    // Each value attached to its flag: a value that starts with "--" stays a value instead of becoming a flag.
    let mut flag = |name: &str, values: Vec<String>| {
        argv.extend(values.iter().map(|value| format!("--{name}={value}")));
    };
    let one = |v: Option<String>| v.into_iter().collect::<Vec<_>>();
    let number = |v: Option<f64>| v.map(|v| v.to_string()).into_iter().collect::<Vec<_>>();
    let int = |v: Option<u32>| v.map(|v| v.to_string()).into_iter().collect::<Vec<_>>();
    flag("samples", one(args.samples));
    flag("files", args.files.unwrap_or_default());
    flag("classes", args.classes.unwrap_or_default());
    flag("rest", one(args.rest));
    flag("participants", one(args.participants));
    flag("column", one(args.column));
    flag("segment", number(args.segment));
    flag("channels", args.channels.unwrap_or_default());
    flag("reference", one(args.reference));
    flag("electrodes", one(args.electrodes));
    flag("wl", int(args.wl));
    flag("ws", int(args.ws));
    flag("terms", int(args.terms));
    flag("folds", int(args.folds));
    flag("sr", number(args.sr));
    // Two numbers to one flag, which `--name=value` cannot carry; numbers cannot pose as flags.
    if let Some([low, high]) = args.delay_range {
        argv.extend(["--delay-range".into(), low.to_string(), high.to_string()]);
    }
    let Command::Classify(classify_args) = Cli::try_parse_from(&argv)
        .map_err(|e| e.render().to_string())?
        .command
    else {
        unreachable!("argv names the classify command");
    };
    let report = super::classify::train(&classify_args)?;
    output::write_json(&report, false, Some(&path.display().to_string()))?;
    Ok(json!({
        "report": path,
        "classes": report.classes,
        "segments_per_class": report.segments_per_class,
        "groups": report.groups,
        "folds": report.folds,
        "best": report.best,
        "search_balanced_accuracy": report.search_score,
        "nested_balanced_accuracy": report.nested_score,
        "confusion_true_by_predicted": report.confusion,
        "ranking": report.ranking.iter().take(5).collect::<Vec<_>>(),
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PredictTool {
    model: String,
    files: Vec<String>,
    segment: Option<f64>,
    sr: Option<f64>,
}

fn predict(args: PredictTool) -> Result<Value, String> {
    if args
        .segment
        .is_some_and(|seconds| !(seconds.is_finite() && seconds > 0.0))
    {
        return Err("segment must be a positive number of seconds".into());
    }
    super::classify::predictions(&PredictArgs {
        model: args.model,
        files: args.files,
        segment: args.segment.unwrap_or(10.0),
        sr: args.sr,
        output: None,
    })
}
