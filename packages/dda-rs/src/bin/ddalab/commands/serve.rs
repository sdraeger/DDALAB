use crate::cli::ServeArgs;
use crate::dda_params;
use crate::exit_codes;
use dda_rs::{
    DDAResult, PureRustProgress, VariantChannelConfig, DEFAULT_DELAYS, DEFAULT_MODEL_DIMENSION,
    DEFAULT_NUM_TAU, DEFAULT_POLYNOMIAL_ORDER,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::time::{Duration, Instant};

#[derive(Debug, Deserialize)]
struct ServeRequest {
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct RunGroupParams {
    file: String,
    #[serde(default)]
    channels: Vec<usize>,
    #[serde(default)]
    variants: Vec<String>,
    wl: u32,
    ws: u32,
    #[serde(default)]
    delays: Vec<i32>,
    #[serde(default)]
    model_terms: Option<Vec<i32>>,
    #[serde(default)]
    dm: Option<u32>,
    #[serde(default)]
    order: Option<u32>,
    #[serde(default)]
    nr_tau: Option<u32>,
    #[serde(default)]
    ct_wl: Option<u32>,
    #[serde(default)]
    ct_ws: Option<u32>,
    #[serde(default)]
    ct_pairs: Option<Vec<[usize; 2]>>,
    #[serde(default)]
    cd_pairs: Option<Vec<[usize; 2]>>,
    #[serde(default)]
    start_sample: Option<u64>,
    #[serde(default)]
    end_sample: Option<u64>,
    #[serde(default)]
    sr: Option<f64>,
    #[serde(default)]
    variant_configs: Option<HashMap<String, VariantChannelConfig>>,
}

#[derive(Debug, Deserialize)]
struct RunGroupMatrixParams {
    file: String,
    channel_labels: Vec<String>,
    samples: Vec<Vec<f64>>,
    #[serde(default)]
    channels: Vec<usize>,
    #[serde(default)]
    variants: Vec<String>,
    wl: u32,
    ws: u32,
    #[serde(default)]
    delays: Vec<i32>,
    #[serde(default)]
    model_terms: Option<Vec<i32>>,
    #[serde(default)]
    dm: Option<u32>,
    #[serde(default)]
    order: Option<u32>,
    #[serde(default)]
    nr_tau: Option<u32>,
    #[serde(default)]
    ct_wl: Option<u32>,
    #[serde(default)]
    ct_ws: Option<u32>,
    #[serde(default)]
    ct_pairs: Option<Vec<[usize; 2]>>,
    #[serde(default)]
    cd_pairs: Option<Vec<[usize; 2]>>,
    #[serde(default)]
    sr: Option<f64>,
    #[serde(default)]
    variant_configs: Option<HashMap<String, VariantChannelConfig>>,
}

#[derive(Debug, Deserialize)]
struct RunGroupMatrixFileParams {
    file: String,
    matrix_path: String,
    rows: usize,
    cols: usize,
    channel_labels: Vec<String>,
    #[serde(default)]
    channels: Vec<usize>,
    #[serde(default)]
    variants: Vec<String>,
    wl: u32,
    ws: u32,
    #[serde(default)]
    delays: Vec<i32>,
    #[serde(default)]
    model_terms: Option<Vec<i32>>,
    #[serde(default)]
    dm: Option<u32>,
    #[serde(default)]
    order: Option<u32>,
    #[serde(default)]
    nr_tau: Option<u32>,
    #[serde(default)]
    ct_wl: Option<u32>,
    #[serde(default)]
    ct_ws: Option<u32>,
    #[serde(default)]
    ct_pairs: Option<Vec<[usize; 2]>>,
    #[serde(default)]
    cd_pairs: Option<Vec<[usize; 2]>>,
    #[serde(default)]
    sr: Option<f64>,
    #[serde(default)]
    variant_configs: Option<HashMap<String, VariantChannelConfig>>,
}

#[derive(Debug, Serialize)]
struct PingResponse {
    status: &'static str,
    preview_columns: usize,
}

#[derive(Debug, Serialize)]
struct RunGroupResponse {
    id: String,
    backend: String,
    result: DDAResult,
}

struct SidecarState {
    preview_columns: usize,
}

impl SidecarState {
    fn new(preview_columns: usize) -> Self {
        Self {
            preview_columns: preview_columns.max(16),
        }
    }

    async fn run_group<F>(
        &mut self,
        params: RunGroupParams,
        mut on_progress: F,
    ) -> Result<RunGroupResponse, String>
    where
        F: FnMut(&PureRustProgress),
    {
        let normalized_variants = dda_params::normalize_variants(&params.variants)?;
        dda_params::validate_file(&params.file)?;
        dda_params::validate_common_params(
            &params.channels,
            &normalized_variants,
            &params.delays,
            params.wl,
            params.ws,
            &params.ct_pairs,
            &params.cd_pairs,
        )?;

        let request = dda_params::build_dda_request_with_options(
            &params.file,
            &params.channels,
            &normalized_variants,
            params.wl,
            params.ws,
            if params.delays.is_empty() {
                &DEFAULT_DELAYS
            } else {
                &params.delays
            },
            params.model_terms.clone(),
            params.dm.unwrap_or(DEFAULT_MODEL_DIMENSION),
            params.order.unwrap_or(DEFAULT_POLYNOMIAL_ORDER),
            params.nr_tau.unwrap_or(DEFAULT_NUM_TAU),
            params.ct_wl,
            params.ct_ws,
            params.ct_pairs.clone(),
            params.cd_pairs.clone(),
            params.sr,
            None,
            None,
            None,
            None,
            params.variant_configs.clone(),
        )?;

        let (start_bound, end_bound) = dda_params::compute_bounds(
            None,
            None,
            params.start_sample,
            params.end_sample,
            params.sr,
        );
        let result = dda_params::execute_request_with_progress(
            &request,
            start_bound,
            end_bound,
            |progress| on_progress(progress),
        )
        .await
        .map_err(|error| format!("DDA execution failed: {}", error))?;
        let full_result = result.result;
        let analysis_id = full_result.id.clone();
        let backend = match result.backend {
            dda_params::ExecutionBackend::PureRust => "pure-rust",
        }
        .to_string();
        Ok(RunGroupResponse {
            id: analysis_id,
            backend,
            result: full_result,
        })
    }

    async fn run_group_matrix<F>(
        &mut self,
        params: RunGroupMatrixParams,
        mut on_progress: F,
    ) -> Result<RunGroupResponse, String>
    where
        F: FnMut(&PureRustProgress),
    {
        let normalized_variants = dda_params::normalize_variants(&params.variants)?;
        if params.samples.is_empty() {
            return Err("Matrix-backed DDA input contains no samples.".to_string());
        }
        let column_count = params.samples.first().map(|row| row.len()).unwrap_or(0);
        if column_count == 0 {
            return Err("Matrix-backed DDA input contains no channels.".to_string());
        }
        for (row_index, row) in params.samples.iter().enumerate() {
            if row.len() != column_count {
                return Err(format!(
                    "Matrix-backed DDA row {} has {} columns, expected {}.",
                    row_index + 1,
                    row.len(),
                    column_count
                ));
            }
        }

        let channels: Vec<usize> = if params.channels.is_empty() {
            (0..column_count).collect()
        } else {
            params.channels.clone()
        };
        if let Some(index) = channels
            .iter()
            .copied()
            .find(|index| *index >= column_count)
        {
            return Err(format!(
                "Matrix-backed DDA channel index {} is out of range for {} channels.",
                index, column_count
            ));
        }
        for (kind, pairs) in [(&"CT", &params.ct_pairs), (&"CD", &params.cd_pairs)] {
            if let Some(pairs) = pairs {
                for [left, right] in pairs {
                    if *left >= column_count || *right >= column_count {
                        return Err(format!(
                            "Matrix-backed DDA {} pair ({}, {}) is out of range for {} channels.",
                            kind, left, right, column_count
                        ));
                    }
                }
            }
        }

        dda_params::validate_common_params(
            &channels,
            &normalized_variants,
            &params.delays,
            params.wl,
            params.ws,
            &params.ct_pairs,
            &params.cd_pairs,
        )?;

        let end_sample = params.samples.len().saturating_sub(1) as f64;
        let request = dda_params::build_dda_request_with_options(
            &params.file,
            &channels,
            &normalized_variants,
            params.wl,
            params.ws,
            if params.delays.is_empty() {
                &DEFAULT_DELAYS
            } else {
                &params.delays
            },
            params.model_terms.clone(),
            params.dm.unwrap_or(DEFAULT_MODEL_DIMENSION),
            params.order.unwrap_or(DEFAULT_POLYNOMIAL_ORDER),
            params.nr_tau.unwrap_or(DEFAULT_NUM_TAU),
            params.ct_wl,
            params.ct_ws,
            params.ct_pairs.clone(),
            params.cd_pairs.clone(),
            params.sr,
            Some(0.0),
            Some(end_sample),
            None,
            None,
            params.variant_configs.clone(),
        )?;

        let labels = if params.channel_labels.len() == column_count {
            params.channel_labels.clone()
        } else {
            (0..column_count)
                .map(|index| format!("Ch {}", index))
                .collect::<Vec<_>>()
        };

        let result = dda_params::execute_request_on_matrix_with_progress(
            &request,
            &params.samples,
            Some(labels.as_slice()),
            |progress| on_progress(progress),
        )
        .await
        .map_err(|error| format!("DDA execution failed: {}", error))?;
        let full_result = result.result;
        let analysis_id = full_result.id.clone();
        let backend = match result.backend {
            dda_params::ExecutionBackend::PureRust => "pure-rust",
        }
        .to_string();
        Ok(RunGroupResponse {
            id: analysis_id,
            backend,
            result: full_result,
        })
    }

    async fn run_group_matrix_file<F>(
        &mut self,
        params: RunGroupMatrixFileParams,
        mut on_progress: F,
    ) -> Result<RunGroupResponse, String>
    where
        F: FnMut(&PureRustProgress),
    {
        let normalized_variants = dda_params::normalize_variants(&params.variants)?;
        if params.rows == 0 || params.cols == 0 {
            return Err("Matrix-backed DDA input contains no samples.".to_string());
        }

        let channels: Vec<usize> = if params.channels.is_empty() {
            (0..params.cols).collect()
        } else {
            params.channels.clone()
        };
        if let Some(index) = channels.iter().copied().find(|index| *index >= params.cols) {
            return Err(format!(
                "Matrix-backed DDA channel index {} is out of range for {} channels.",
                index, params.cols
            ));
        }
        for (kind, pairs) in [(&"CT", &params.ct_pairs), (&"CD", &params.cd_pairs)] {
            if let Some(pairs) = pairs {
                for [left, right] in pairs {
                    if *left >= params.cols || *right >= params.cols {
                        return Err(format!(
                            "Matrix-backed DDA {} pair ({}, {}) is out of range for {} channels.",
                            kind, left, right, params.cols
                        ));
                    }
                }
            }
        }

        dda_params::validate_common_params(
            &channels,
            &normalized_variants,
            &params.delays,
            params.wl,
            params.ws,
            &params.ct_pairs,
            &params.cd_pairs,
        )?;

        let end_sample = params.rows.saturating_sub(1) as f64;
        let request = dda_params::build_dda_request_with_options(
            &params.file,
            &channels,
            &normalized_variants,
            params.wl,
            params.ws,
            if params.delays.is_empty() {
                &DEFAULT_DELAYS
            } else {
                &params.delays
            },
            params.model_terms.clone(),
            params.dm.unwrap_or(DEFAULT_MODEL_DIMENSION),
            params.order.unwrap_or(DEFAULT_POLYNOMIAL_ORDER),
            params.nr_tau.unwrap_or(DEFAULT_NUM_TAU),
            params.ct_wl,
            params.ct_ws,
            params.ct_pairs.clone(),
            params.cd_pairs.clone(),
            params.sr,
            Some(0.0),
            Some(end_sample),
            None,
            None,
            params.variant_configs.clone(),
        )?;

        let labels = if params.channel_labels.len() == params.cols {
            params.channel_labels.clone()
        } else {
            (0..params.cols)
                .map(|index| format!("Ch {}", index))
                .collect::<Vec<_>>()
        };

        let result = dda_params::execute_request_on_matrix_file_with_progress(
            &request,
            &params.matrix_path,
            params.rows,
            params.cols,
            Some(labels.as_slice()),
            |progress| on_progress(progress),
        )
        .await
        .map_err(|error| format!("DDA execution failed: {}", error))?;
        let full_result = result.result;
        let analysis_id = full_result.id.clone();
        let backend = match result.backend {
            dda_params::ExecutionBackend::PureRust => "pure-rust",
        }
        .to_string();
        Ok(RunGroupResponse {
            id: analysis_id,
            backend,
            result: full_result,
        })
    }
}

pub async fn execute(args: ServeArgs) -> i32 {
    let _ = args.binary;
    let _ = args.disable_native_fallback;

    let mut state = SidecarState::new(args.preview_columns);
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = io::BufReader::new(stdin.lock());
    let mut writer = io::BufWriter::new(stdout.lock());
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {}
            Err(error) => {
                let _ = write_error(&mut writer, &format!("Failed to read request: {}", error));
                return exit_codes::EXECUTION_ERROR;
            }
        }

        let request_line = line.trim_end_matches(&['\r', '\n'][..]).trim();
        if request_line.is_empty() {
            continue;
        }

        let request: ServeRequest = match serde_json::from_str(request_line) {
            Ok(request) => request,
            Err(error) => {
                if write_error(
                    &mut writer,
                    &format!("Invalid sidecar request JSON: {}", error),
                )
                .is_err()
                {
                    return exit_codes::EXECUTION_ERROR;
                }
                continue;
            }
        };

        let response_result = match request.method.as_str() {
            "ping" => write_success(
                &mut writer,
                &PingResponse {
                    status: "ok",
                    preview_columns: state.preview_columns,
                },
            ),
            "run_group" => match serde_json::from_value::<RunGroupParams>(request.params) {
                Ok(params) => {
                    let mut last_progress_at = Instant::now() - Duration::from_secs(1);
                    match state
                        .run_group(params, |progress| {
                            let should_emit = progress.step_index <= 1
                                || progress.step_index >= progress.total_steps
                                || last_progress_at.elapsed() >= Duration::from_millis(60);
                            if should_emit {
                                let _ = write_progress(&mut writer, progress);
                                last_progress_at = Instant::now();
                            }
                        })
                        .await
                    {
                        Ok(result) => write_success(&mut writer, &result),
                        Err(message) => write_error(&mut writer, &message),
                    }
                }
                Err(error) => write_error(
                    &mut writer,
                    &format!("Invalid run_group parameters: {}", error),
                ),
            },
            "run_group_matrix" => {
                match serde_json::from_value::<RunGroupMatrixParams>(request.params) {
                    Ok(params) => {
                        let mut last_progress_at = Instant::now() - Duration::from_secs(1);
                        match state
                            .run_group_matrix(params, |progress| {
                                let should_emit = progress.step_index <= 1
                                    || progress.step_index >= progress.total_steps
                                    || last_progress_at.elapsed() >= Duration::from_millis(60);
                                if should_emit {
                                    let _ = write_progress(&mut writer, progress);
                                    last_progress_at = Instant::now();
                                }
                            })
                            .await
                        {
                            Ok(result) => write_success(&mut writer, &result),
                            Err(message) => write_error(&mut writer, &message),
                        }
                    }
                    Err(error) => write_error(
                        &mut writer,
                        &format!("Invalid run_group_matrix parameters: {}", error),
                    ),
                }
            }
            "run_group_matrix_file" => {
                match serde_json::from_value::<RunGroupMatrixFileParams>(request.params) {
                    Ok(params) => {
                        let mut last_progress_at = Instant::now() - Duration::from_secs(1);
                        match state
                            .run_group_matrix_file(params, |progress| {
                                let should_emit = progress.step_index <= 1
                                    || progress.step_index >= progress.total_steps
                                    || last_progress_at.elapsed() >= Duration::from_millis(60);
                                if should_emit {
                                    let _ = write_progress(&mut writer, progress);
                                    last_progress_at = Instant::now();
                                }
                            })
                            .await
                        {
                            Ok(result) => write_success(&mut writer, &result),
                            Err(message) => write_error(&mut writer, &message),
                        }
                    }
                    Err(error) => write_error(
                        &mut writer,
                        &format!("Invalid run_group_matrix_file parameters: {}", error),
                    ),
                }
            }
            "shutdown" => {
                let response = write_success(
                    &mut writer,
                    &serde_json::json!({
                        "status": "bye",
                    }),
                );
                if response.is_err() {
                    return exit_codes::EXECUTION_ERROR;
                }
                break;
            }
            other => write_error(
                &mut writer,
                &format!("Unsupported sidecar method '{}'.", other),
            ),
        };

        if response_result.is_err() {
            return exit_codes::EXECUTION_ERROR;
        }
    }

    exit_codes::SUCCESS
}

fn write_success<T: Serialize>(writer: &mut impl Write, result: &T) -> io::Result<()> {
    serde_json::to_writer(
        &mut *writer,
        &serde_json::json!({
            "ok": true,
            "result": result,
        }),
    )
    .map_err(io::Error::other)?;
    writer.write_all(b"\n")?;
    writer.flush()
}

fn write_progress(writer: &mut impl Write, progress: &PureRustProgress) -> io::Result<()> {
    serde_json::to_writer(
        &mut *writer,
        &serde_json::json!({
            "event": "progress",
            "payload": progress,
        }),
    )
    .map_err(io::Error::other)?;
    writer.write_all(b"\n")?;
    writer.flush()
}

fn write_error(writer: &mut impl Write, error: &str) -> io::Result<()> {
    serde_json::to_writer(
        &mut *writer,
        &serde_json::json!({
            "ok": false,
            "error": error,
        }),
    )
    .map_err(io::Error::other)?;
    writer.write_all(b"\n")?;
    writer.flush()
}
