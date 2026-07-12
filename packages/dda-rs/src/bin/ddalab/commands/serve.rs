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
struct RunAnalysisParams {
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
    sr: Option<f64>,
    #[serde(default)]
    variant_configs: Option<HashMap<String, VariantChannelConfig>>,
}

#[derive(Debug, Deserialize)]
struct RunGroupParams {
    #[serde(flatten)]
    analysis: RunAnalysisParams,
    #[serde(default)]
    start_sample: Option<u64>,
    #[serde(default)]
    end_sample: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct RunGroupMatrixParams {
    #[serde(flatten)]
    analysis: RunAnalysisParams,
    channel_labels: Vec<String>,
    samples: Vec<Vec<f64>>,
}

#[derive(Debug, Deserialize)]
struct RunGroupMatrixFileParams {
    #[serde(flatten)]
    analysis: RunAnalysisParams,
    matrix_path: String,
    rows: usize,
    cols: usize,
    channel_labels: Vec<String>,
}

#[derive(Debug, Serialize)]
struct PingResponse {
    status: &'static str,
    preview_columns: usize,
}

#[derive(Debug, Serialize)]
struct RunGroupResponse {
    id: String,
    backend: &'static str,
    result: DDAResult,
}

impl RunGroupResponse {
    fn new(result: DDAResult) -> Self {
        Self {
            id: result.id.clone(),
            backend: "pure-rust",
            result,
        }
    }
}

struct ProgressThrottle {
    last_emit: Instant,
}

impl ProgressThrottle {
    fn new() -> Self {
        Self {
            last_emit: Instant::now() - Duration::from_secs(1),
        }
    }

    fn should_emit(&self, progress: &PureRustProgress) -> bool {
        progress.step_index <= 1
            || progress.step_index >= progress.total_steps
            || self.last_emit.elapsed() >= Duration::from_millis(60)
    }

    fn mark_emitted(&mut self) {
        self.last_emit = Instant::now();
    }
}

impl RunAnalysisParams {
    fn build_request(
        &self,
        channels: &[usize],
        variants: &[String],
        start: Option<f64>,
        end: Option<f64>,
    ) -> Result<dda_rs::DDARequest, String> {
        dda_params::validate_common_params(
            channels,
            variants,
            &self.delays,
            self.wl,
            self.ws,
            &self.ct_pairs,
            &self.cd_pairs,
        )?;

        dda_params::build_dda_request(dda_params::RequestConfig {
            file_path: &self.file,
            channels,
            variants,
            window_length: self.wl,
            window_step: self.ws,
            delays: if self.delays.is_empty() {
                &DEFAULT_DELAYS
            } else {
                &self.delays
            },
            model_terms: self.model_terms.clone(),
            dm: self.dm.unwrap_or(DEFAULT_MODEL_DIMENSION),
            order: self.order.unwrap_or(DEFAULT_POLYNOMIAL_ORDER),
            nr_tau: self.nr_tau.unwrap_or(DEFAULT_NUM_TAU),
            ct_window_length: self.ct_wl,
            ct_window_step: self.ct_ws,
            ct_channel_pairs: self.ct_pairs.clone(),
            cd_channel_pairs: self.cd_pairs.clone(),
            sampling_rate: self.sr,
            start,
            end,
            highpass: None,
            lowpass: None,
            variant_configs: self.variant_configs.clone(),
        })
    }
}

fn validate_matrix_selection(
    params: &RunAnalysisParams,
    column_count: usize,
) -> Result<Vec<usize>, String> {
    let channels = if params.channels.is_empty() {
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
    for (kind, pairs) in [("CT", &params.ct_pairs), ("CD", &params.cd_pairs)] {
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
    Ok(channels)
}

fn resolve_channel_labels(labels: &[String], column_count: usize) -> Vec<String> {
    if labels.len() == column_count {
        labels.to_vec()
    } else {
        (0..column_count)
            .map(|index| format!("Ch {}", index))
            .collect()
    }
}

async fn run_group<F>(params: RunGroupParams, on_progress: F) -> Result<RunGroupResponse, String>
where
    F: FnMut(&PureRustProgress),
{
    let variants = dda_params::normalize_variants(&params.analysis.variants)?;
    dda_params::validate_file(&params.analysis.file)?;
    let request =
        params
            .analysis
            .build_request(&params.analysis.channels, &variants, None, None)?;

    let (start_bound, end_bound) = dda_params::compute_bounds(
        None,
        None,
        params.start_sample,
        params.end_sample,
        params.analysis.sr,
    );
    let result =
        dda_params::execute_request_with_progress(&request, start_bound, end_bound, on_progress)
            .await
            .map_err(|error| format!("DDA execution failed: {}", error))?;
    Ok(RunGroupResponse::new(result))
}

async fn run_group_matrix<F>(
    params: RunGroupMatrixParams,
    on_progress: F,
) -> Result<RunGroupResponse, String>
where
    F: FnMut(&PureRustProgress),
{
    let variants = dda_params::normalize_variants(&params.analysis.variants)?;
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

    let channels = validate_matrix_selection(&params.analysis, column_count)?;

    let end_sample = params.samples.len().saturating_sub(1) as f64;
    let request =
        params
            .analysis
            .build_request(&channels, &variants, Some(0.0), Some(end_sample))?;
    let labels = resolve_channel_labels(&params.channel_labels, column_count);

    let result = dda_params::execute_request_on_matrix_with_progress(
        &request,
        &params.samples,
        Some(labels.as_slice()),
        on_progress,
    )
    .await
    .map_err(|error| format!("DDA execution failed: {}", error))?;
    Ok(RunGroupResponse::new(result))
}

async fn run_group_matrix_file<F>(
    params: RunGroupMatrixFileParams,
    on_progress: F,
) -> Result<RunGroupResponse, String>
where
    F: FnMut(&PureRustProgress),
{
    let variants = dda_params::normalize_variants(&params.analysis.variants)?;
    if params.rows == 0 || params.cols == 0 {
        return Err("Matrix-backed DDA input contains no samples.".to_string());
    }

    let channels = validate_matrix_selection(&params.analysis, params.cols)?;

    let end_sample = params.rows.saturating_sub(1) as f64;
    let request =
        params
            .analysis
            .build_request(&channels, &variants, Some(0.0), Some(end_sample))?;
    let labels = resolve_channel_labels(&params.channel_labels, params.cols);

    let result = dda_params::execute_request_on_matrix_file_with_progress(
        &request,
        &params.matrix_path,
        params.rows,
        params.cols,
        Some(labels.as_slice()),
        on_progress,
    )
    .await
    .map_err(|error| format!("DDA execution failed: {}", error))?;
    Ok(RunGroupResponse::new(result))
}

pub async fn execute(args: ServeArgs) -> i32 {
    let _ = args.binary;
    let _ = args.disable_native_fallback;

    let preview_columns = args.preview_columns.max(16);
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
                    preview_columns,
                },
            ),
            "run_group" => match serde_json::from_value::<RunGroupParams>(request.params) {
                Ok(params) => {
                    let mut throttle = ProgressThrottle::new();
                    match run_group(params, |progress| {
                        if throttle.should_emit(progress) {
                            let _ = write_progress(&mut writer, progress);
                            throttle.mark_emitted();
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
                        let mut throttle = ProgressThrottle::new();
                        match run_group_matrix(params, |progress| {
                            if throttle.should_emit(progress) {
                                let _ = write_progress(&mut writer, progress);
                                throttle.mark_emitted();
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
                        let mut throttle = ProgressThrottle::new();
                        match run_group_matrix_file(params, |progress| {
                            if throttle.should_emit(progress) {
                                let _ = write_progress(&mut writer, progress);
                                throttle.mark_emitted();
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
    write_json_line(
        writer,
        &serde_json::json!({
            "ok": true,
            "result": result,
        }),
    )
}

fn write_progress(writer: &mut impl Write, progress: &PureRustProgress) -> io::Result<()> {
    write_json_line(
        writer,
        &serde_json::json!({
            "event": "progress",
            "payload": progress,
        }),
    )
}

fn write_error(writer: &mut impl Write, error: &str) -> io::Result<()> {
    write_json_line(
        writer,
        &serde_json::json!({
            "ok": false,
            "error": error,
        }),
    )
}

fn write_json_line<T: Serialize>(writer: &mut impl Write, value: &T) -> io::Result<()> {
    serde_json::to_writer(&mut *writer, value).map_err(io::Error::other)?;
    writer.write_all(b"\n")?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_group_parameters_keep_the_flat_protocol_shape() {
        let params: RunGroupParams = serde_json::from_value(serde_json::json!({
            "file": "/tmp/input.csv",
            "channels": [0, 2],
            "variants": ["ST"],
            "wl": 64,
            "ws": 32,
            "delays": [1, 2],
            "start_sample": 10,
            "end_sample": 200,
            "sr": 256.0
        }))
        .expect("flat run_group parameters");

        assert_eq!(params.analysis.file, "/tmp/input.csv");
        assert_eq!(params.analysis.channels, vec![0, 2]);
        assert_eq!(params.analysis.variants, vec!["ST"]);
        assert_eq!(params.start_sample, Some(10));
        assert_eq!(params.end_sample, Some(200));
        assert_eq!(params.analysis.sr, Some(256.0));
    }
}
