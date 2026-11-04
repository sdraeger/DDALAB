//! `ddalab stream`: DDA on the newest samples of a Lab Streaming Layer stream, a result every `ws` samples from the
//! last window of `wl`, with the stream's channels re-referenced as a recording's are. Results go to stdout as JSON
//! lines, to LSL outlets, and to the web app over a WebSocket on 127.0.0.1 that only a client knowing the printed
//! token may open.

use super::reference_of;
use crate::classify::ClassifierModel;
use crate::cli::args::{parse_pairs, StreamArgs};
use crate::cli::exit_codes;
use crate::engine::run_request_on_matrix;
use crate::io::{open_matrix, with_reference, FileSet, Reference};
use crate::lsl::{Inlet, Outlet};
use crate::types::*;
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use tungstenite::{Message, WebSocket};

/// The rows of `terms` (by source index) the reference makes of each incoming row, and the derived labels.
type Montage = (Vec<String>, Vec<Vec<(usize, f64)>>);

/// The montage `reference` makes of channels `labels`: resolved once, on a one-row recording of them.
fn montage(labels: &[String], reference: Option<&Reference>) -> Result<Montage, String> {
    let Some(reference) = reference else {
        let identity = (0..labels.len()).map(|i| vec![(i, 1.0)]).collect();
        return Ok((labels.to_vec(), identity));
    };
    let probe =
        open_matrix(labels.to_vec(), 1.0, vec![0.0; labels.len()]).map_err(|e| e.to_string())?;
    let empty = FileSet {
        primary: "stream".into(),
        files: BTreeMap::new(),
    };
    let referenced = with_reference(probe, reference, &empty).map_err(|e| e.to_string())?;
    let resolved = referenced
        .info()
        .reference
        .clone()
        .expect("a referenced recording records its reference");
    let index = |label: &str| {
        labels
            .iter()
            .position(|l| l == label)
            .expect("the terms name the stream's channels")
    };
    Ok((
        resolved.channels.iter().map(|c| c.label.clone()).collect(),
        resolved
            .channels
            .iter()
            .map(|c| {
                c.terms
                    .iter()
                    .map(|t| (index(&t.source), t.weight))
                    .collect()
            })
            .collect(),
    ))
}

/// The request of `args` for one window over `rows` rows of `channels` channels.
fn request(args: &StreamArgs, channels: usize, rows: usize) -> Result<DDARequest, String> {
    let pairs = |p: &Option<Vec<String>>| p.as_deref().map(parse_pairs).transpose();
    Ok(DDARequest {
        file_path: String::new(),
        channels: Some((0..channels).collect()),
        time_range: TimeRange {
            start: 0.0,
            end: rows.saturating_sub(1) as f64,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: args.variants.clone(),
            select_mask: None,
        },
        window_parameters: WindowParameters {
            window_length: args.wl,
            window_step: args.wl,
            ct_window_length: None,
            ct_window_step: None,
        },
        delay_parameters: DelayParameters {
            delays: args.delays.clone(),
        },
        ct_channel_pairs: pairs(&args.ct_pairs)?,
        cd_channel_pairs: pairs(&args.cd_pairs)?,
        model_parameters: Some(ModelParameters {
            dm: DEFAULT_MODEL_DIMENSION,
            order: DEFAULT_POLYNOMIAL_ORDER,
            nr_tau: args.delays.len() as u32,
        }),
        model_terms: Some(args.model.clone()),
        variant_configs: None,
        sampling_rate: None,
    })
}

/// The fewest rows that hold one DDA window of `args`: the window plus what the delays and derivatives reach back.
fn rows_needed(args: &StreamArgs, channels: usize) -> Result<usize, String> {
    let reach = 2 * args.delays.iter().copied().max().unwrap_or(0).max(0) as usize + 16;
    for rows in args.wl as usize..=args.wl as usize + reach {
        let zeros = vec![vec![0.0; channels]; rows];
        if run_request_on_matrix(&request(args, channels, rows)?, &zeros, None)
            .is_ok_and(|r| !r.q_matrix.first().is_none_or(Vec::is_empty))
        {
            return Ok(rows);
        }
    }
    Err(format!(
        "no window of {} samples fits {} rows; check --wl and --delays",
        args.wl,
        args.wl as usize + reach
    ))
}

/// How long a connection has to complete its WebSocket handshake.
const HANDSHAKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
/// How long one message may wait on a client before the client is dropped (`Clients::send`).
const SEND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(1);

/// The web app's connections, which every message goes to; a client that fails is dropped.
#[derive(Clone, Default)]
struct Clients(Arc<Mutex<Vec<WebSocket<TcpStream>>>>);

impl Clients {
    fn send(&self, message: Message) {
        self.0
            .lock()
            .unwrap()
            .retain_mut(|socket| socket.send(message.clone()).is_ok());
    }

    /// Accepts on 127.0.0.1:`port` the clients whose address carries `token`, each greeted with `header`.
    // The handshake callback's error type is tungstenite's HTTP response.
    #[allow(clippy::result_large_err)]
    fn serve(&self, port: u16, token: String, header: Value) -> Result<(), String> {
        let listener =
            TcpListener::bind(("127.0.0.1", port)).map_err(|e| format!("127.0.0.1:{port}: {e}"))?;
        let clients = self.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                // Each handshake on a thread of its own, with deadlines: a connection that never completes one, or a
                // client that stops reading, is dropped without stalling the others or the stream.
                let (clients, token, header) = (clients.clone(), token.clone(), header.clone());
                std::thread::spawn(move || {
                    let timeouts = stream
                        .set_read_timeout(Some(HANDSHAKE_TIMEOUT))
                        .and(stream.set_write_timeout(Some(SEND_TIMEOUT)));
                    if timeouts.is_err() {
                        return;
                    }
                    let expected = format!("token={token}");
                    let checked = |request: &tungstenite::handshake::server::Request, response| {
                        if request
                            .uri()
                            .query()
                            .is_some_and(|q| q.split('&').any(|p| p == expected))
                        {
                            Ok(response)
                        } else {
                            let mut refused = tungstenite::handshake::server::ErrorResponse::new(
                                Some("token required".into()),
                            );
                            *refused.status_mut() = tungstenite::http::StatusCode::FORBIDDEN;
                            Err(refused)
                        }
                    };
                    if let Ok(mut socket) = tungstenite::accept_hdr(stream, checked) {
                        if socket.send(Message::text(header.to_string())).is_ok() {
                            clients.0.lock().unwrap().push(socket);
                        }
                    }
                });
            }
        });
        Ok(())
    }
}

pub fn execute(args: StreamArgs) -> i32 {
    match stream(&args) {
        Ok(()) => exit_codes::SUCCESS,
        Err(error) => {
            eprintln!("Error: {error}");
            exit_codes::INPUT_ERROR
        }
    }
}

fn stream(args: &StreamArgs) -> Result<(), String> {
    let reference = reference_of(&args.reference)?;
    let model = args
        .classify
        .as_deref()
        .map(|path| -> Result<ClassifierModel, String> {
            let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
            let value: Value = serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
            serde_json::from_value(value.get("model").cloned().unwrap_or(value))
                .map_err(|e| format!("{path}: {e}"))
        })
        .transpose()?;
    let mut inlet =
        Inlet::resolve(&args.by, &args.stream, args.timeout).map_err(|e| e.to_string())?;
    let info = inlet.info.clone();
    let rate = info.sample_rate_hz;
    if rate <= 0.0 {
        return Err(format!(
            "{} has an irregular rate: DDA needs a fixed one",
            info.name
        ));
    }
    let (labels, terms) = montage(&info.channels, reference.as_ref())?;
    let need = rows_needed(args, labels.len())?;
    // The classifier reads its own channels, by label, from the derived ones.
    let classify = model
        .map(|m| -> Result<(ClassifierModel, Vec<usize>), String> {
            let columns = m
                .channels
                .iter()
                .map(|c| {
                    labels
                        .iter()
                        .position(|l| l == c)
                        .ok_or_else(|| format!("the stream has no channel {c} the model reads"))
                })
                .collect::<Result<_, _>>()?;
            Ok((m, columns))
        })
        .transpose()?;
    let segment_rows = (args.segment * rate).round() as usize;
    let keep = need.max(if classify.is_some() { segment_rows } else { 0 });
    eprintln!(
        "Streaming {} ({} channels at {rate} Hz): a result every {} samples",
        info.name,
        labels.len(),
        args.ws
    );

    let first = run_request_on_matrix(
        &request(args, labels.len(), need)?,
        &vec![vec![0.0; labels.len()]; need],
        Some(&labels),
    )
    .map_err(|e| e.to_string())?;
    let rows_of: BTreeMap<String, Vec<String>> = first
        .variant_results
        .iter()
        .flatten()
        .map(|v| {
            (
                v.variant_id.clone(),
                v.channel_labels.clone().unwrap_or_default(),
            )
        })
        .collect();
    let outlets: BTreeMap<String, Outlet> = if args.outlet {
        rows_of
            .iter()
            .map(|(id, rows)| {
                Ok((
                    id.clone(),
                    Outlet::new(
                        &format!("{}-{id}", info.name),
                        "DDA",
                        rows,
                        rate / args.ws as f64,
                    )?,
                ))
            })
            .collect::<crate::error::Result<_>>()
            .map_err(|e| e.to_string())?
    } else {
        BTreeMap::new()
    };
    let class_outlet = match (&classify, args.outlet) {
        (Some(_), true) => Some(
            Outlet::new(&format!("{}-class", info.name), "Markers", &[], 0.0)
                .map_err(|e| e.to_string())?,
        ),
        _ => None,
    };
    let clients = Clients::default();
    if let Some(port) = args.serve {
        let token = uuid::Uuid::new_v4().simple().to_string();
        let header = json!({
            "type": "header",
            "name": info.name,
            "kind": info.kind,
            "channels": labels,
            "sample_rate_hz": rate,
            "variants": rows_of,
            "classes": classify.as_ref().map(|(m, _)| m.lda.classes.clone()),
        });
        clients.serve(port, token.clone(), header)?;
        eprintln!("Serving the web app at ws://127.0.0.1:{port}/?token={token}");
    }

    let width = info.channels.len().max(1);
    let mut chunk = vec![0.0; width * 1024];
    let mut buffer: VecDeque<Vec<f64>> = VecDeque::with_capacity(keep + 1024);
    let (mut seen, mut since_dda, mut since_class) = (0usize, 0usize, 0usize);
    let every_rows = ((args.every * rate).round() as usize).max(1);
    loop {
        let rows = inlet.pull(&mut chunk, 1.0).map_err(|e| e.to_string())?;
        let mut fresh = Vec::with_capacity(rows * labels.len());
        for row in chunk[..rows * width].chunks(width) {
            let derived: Vec<f64> = terms
                .iter()
                .map(|t| t.iter().map(|&(i, w)| w * row[i]).sum())
                .collect();
            fresh.extend(derived.iter().map(|&v| v as f32));
            buffer.push_back(derived);
            if buffer.len() > keep {
                buffer.pop_front();
            }
            seen += 1;
            since_dda += 1;
            since_class += 1;
            let t = seen as f64 / rate;
            if since_dda >= args.ws as usize && buffer.len() >= need {
                since_dda = 0;
                let window: Vec<Vec<f64>> =
                    buffer.iter().skip(buffer.len() - need).cloned().collect();
                let result = run_request_on_matrix(
                    &request(args, labels.len(), need)?,
                    &window,
                    Some(&labels),
                )
                .map_err(|e| e.to_string())?;
                let mut variants = BTreeMap::new();
                for v in result.variant_results.iter().flatten() {
                    let values: Vec<f64> = v
                        .q_matrix
                        .iter()
                        .map(|r| r.last().copied().unwrap_or(f64::NAN))
                        .collect();
                    if let Some(outlet) = outlets.get(&v.variant_id) {
                        outlet.push(&values).map_err(|e| e.to_string())?;
                    }
                    variants.insert(v.variant_id.clone(), values);
                }
                let message = json!({ "type": "dda", "t": t, "variants": variants });
                if !args.quiet {
                    println!("{message}");
                }
                clients.send(Message::text(message.to_string()));
            }
            if let Some((model, columns)) = &classify {
                if since_class >= every_rows && buffer.len() >= segment_rows {
                    since_class = 0;
                    let segment: Vec<Vec<f64>> = buffer
                        .iter()
                        .skip(buffer.len() - segment_rows)
                        .map(|r| columns.iter().map(|&c| r[c]).collect())
                        .collect();
                    let (class, scores) = model.classify(&segment).map_err(|e| e.to_string())?;
                    if let Some(outlet) = &class_outlet {
                        outlet.push_text(&class).map_err(|e| e.to_string())?;
                    }
                    let message =
                        json!({ "type": "class", "t": t, "class": class, "scores": scores });
                    if !args.quiet {
                        println!("{message}");
                    }
                    clients.send(Message::text(message.to_string()));
                }
            }
        }
        // The samples as the viewer draws them: f32, row-major over the derived channels.
        if !fresh.is_empty() {
            clients.send(Message::binary(
                fresh
                    .iter()
                    .flat_map(|v| v.to_le_bytes())
                    .collect::<Vec<u8>>(),
            ));
        }
        if args.duration.is_some_and(|d| seen as f64 / rate >= d) {
            return Ok(());
        }
    }
}
