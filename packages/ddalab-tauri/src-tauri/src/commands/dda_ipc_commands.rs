//! DDA Analysis Tauri IPC Commands
//!
//! Provides pure Tauri IPC commands for DDA analysis operations, replacing HTTP
//! endpoints to avoid enterprise security tools (Proofpoint URLdefense) intercepting
//! localhost traffic in hospital environments.
//!
//! Commands:
//! - submit_dda_analysis: Submit a DDA analysis job (async, emits progress events)
//! - get_dda_status: Get analysis status
//! - cancel_dda: Cancel running analysis
//! - get_dda_result_by_id: Get result by job ID
//! - get_dda_results_for_file: Get all results for a file
//! - list_dda_history: List all history entries
//! - save_dda_to_history: Save result to history
//! - get_dda_from_history: Get result from history
//! - delete_dda_from_history: Delete from history
//! - rename_dda_in_history: Rename in history

use crate::state_manager::AppStateManager;
use chrono::Utc;
use dda_rs::{transform_cd_to_network_motifs, DDARunner};
use ddalab_tauri::api::models::{DDAParameters, DDAResult};
use ddalab_tauri::api::state::ApiState;
use ddalab_tauri::api::utils::FileType;
use ddalab_tauri::file_readers::FileReaderFactory;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeRange {
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreprocessingOptions {
    pub highpass: Option<f64>,
    pub lowpass: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlgorithmSelection {
    pub enabled_variants: Vec<String>,
    pub select_mask: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowParameters {
    pub window_length: usize,
    pub window_step: usize,
    pub ct_window_length: Option<usize>,
    pub ct_window_step: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaleParameters {
    pub delay_list: Vec<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelParameters {
    pub dm: u32,
    pub order: u32,
    pub nr_tau: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DDAAnalysisRequest {
    pub file_path: String,
    #[serde(alias = "channel_list")]
    pub channels: Option<Vec<usize>>,
    pub time_range: TimeRange,
    pub preprocessing_options: PreprocessingOptions,
    pub algorithm_selection: AlgorithmSelection,
    pub window_parameters: WindowParameters,
    pub scale_parameters: ScaleParameters,
    #[serde(default)]
    pub ct_channel_pairs: Option<Vec<[usize; 2]>>,
    #[serde(default)]
    pub cd_channel_pairs: Option<Vec<[usize; 2]>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_parameters: Option<ModelParameters>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant_configs: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DDAStatusResponse {
    pub id: String,
    pub status: String,
    pub progress: u32,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DDAHistoryEntry {
    pub id: String,
    pub name: Option<String>,
    pub file_path: String,
    pub created_at: String,
    pub variant_name: String,
    pub channels_count: usize,
    pub variants_count: usize,
}

/// Lightweight DDA result summary for list views - excludes q_matrix and plot_data
/// to reduce IPC serialization overhead.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DDAResultSummary {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub file_path: String,
    pub created_at: String,
    pub status: String,
    pub channels_count: usize,
    pub variants_count: usize,
    pub variant_names: Vec<String>,
    pub window_length: u32,
    pub window_step: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelDDAResponse {
    pub success: bool,
    pub message: String,
    pub cancelled_analysis_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct VariantConfig {
    #[serde(rename = "selectedChannels")]
    selected_channels: Option<Vec<usize>>,
    #[serde(rename = "ctChannelPairs")]
    ct_channel_pairs: Option<Vec<[usize; 2]>>,
    #[serde(rename = "cdChannelPairs")]
    cd_channel_pairs: Option<Vec<[usize; 2]>>,
}

// ============================================================================
// Validation Constants
// ============================================================================

const MAX_WINDOW_LENGTH: usize = 1_000_000;
const MAX_WINDOW_STEP: usize = 1_000_000;
const MIN_SCALE_VALUE: i32 = -100;
const MAX_SCALE_VALUE: i32 = 100;
const MAX_CHANNELS: usize = 512;
const MAX_VARIANTS: usize = 10;
const MAX_CHANNEL_PAIRS: usize = 10_000;
const MAX_DELAY_LIST: usize = 100;

// ============================================================================
// Validation
// ============================================================================

fn validate_dda_request(request: &DDAAnalysisRequest) -> Result<(), String> {
    if request.window_parameters.window_length == 0 {
        return Err("window_length must be greater than 0".to_string());
    }
    if request.window_parameters.window_length > MAX_WINDOW_LENGTH {
        return Err(format!(
            "window_length {} exceeds maximum allowed value {}",
            request.window_parameters.window_length, MAX_WINDOW_LENGTH
        ));
    }

    if request.window_parameters.window_step == 0 {
        return Err("window_step must be greater than 0".to_string());
    }
    if request.window_parameters.window_step > MAX_WINDOW_STEP {
        return Err(format!(
            "window_step {} exceeds maximum allowed value {}",
            request.window_parameters.window_step, MAX_WINDOW_STEP
        ));
    }

    if let Some(ct_window_length) = request.window_parameters.ct_window_length {
        if ct_window_length == 0 {
            return Err("ct_window_length must be greater than 0".to_string());
        }
        if ct_window_length > MAX_WINDOW_LENGTH {
            return Err(format!(
                "ct_window_length {} exceeds maximum allowed value {}",
                ct_window_length, MAX_WINDOW_LENGTH
            ));
        }
    }

    if let Some(ct_window_step) = request.window_parameters.ct_window_step {
        if ct_window_step == 0 {
            return Err("ct_window_step must be greater than 0".to_string());
        }
    }

    if request.scale_parameters.delay_list.is_empty() {
        return Err("delay_list cannot be empty".to_string());
    }
    if request.scale_parameters.delay_list.len() > MAX_DELAY_LIST {
        return Err(format!(
            "Too many delay values ({}) - maximum is {}",
            request.scale_parameters.delay_list.len(),
            MAX_DELAY_LIST
        ));
    }
    for &delay in &request.scale_parameters.delay_list {
        if delay <= 0 {
            return Err(format!("delay values must be positive, got {}", delay));
        }
        if delay < MIN_SCALE_VALUE || delay > MAX_SCALE_VALUE {
            return Err(format!(
                "Delay value {} is out of range ({} to {})",
                delay, MIN_SCALE_VALUE, MAX_SCALE_VALUE
            ));
        }
    }

    if request.time_range.start < 0.0 {
        return Err("time_range.start cannot be negative".to_string());
    }
    if request.time_range.end <= request.time_range.start {
        return Err(format!(
            "time_range.end ({}) must be greater than time_range.start ({})",
            request.time_range.end, request.time_range.start
        ));
    }

    if request.algorithm_selection.enabled_variants.is_empty() {
        return Err("At least one variant must be enabled".to_string());
    }
    if request.algorithm_selection.enabled_variants.len() > MAX_VARIANTS {
        return Err(format!(
            "Too many variants ({}) - maximum is {}",
            request.algorithm_selection.enabled_variants.len(),
            MAX_VARIANTS
        ));
    }

    if let Some(ref channels) = request.channels {
        if channels.len() > MAX_CHANNELS {
            return Err(format!(
                "Too many channels ({}) - maximum is {}",
                channels.len(),
                MAX_CHANNELS
            ));
        }
    }

    if let Some(ref pairs) = request.ct_channel_pairs {
        if pairs.len() > MAX_CHANNEL_PAIRS {
            return Err(format!(
                "Too many CT channel pairs ({}) - maximum is {}",
                pairs.len(),
                MAX_CHANNEL_PAIRS
            ));
        }
    }

    if let Some(ref pairs) = request.cd_channel_pairs {
        if pairs.len() > MAX_CHANNEL_PAIRS {
            return Err(format!(
                "Too many CD channel pairs ({}) - maximum is {}",
                pairs.len(),
                MAX_CHANNEL_PAIRS
            ));
        }
    }

    Ok(())
}

// ============================================================================
// Helper Functions
// ============================================================================

fn generate_select_mask(enabled_variants: &[String]) -> String {
    let st = if enabled_variants.iter().any(|v| v == "single_timeseries") {
        "1"
    } else {
        "0"
    };
    let ct = if enabled_variants.iter().any(|v| v == "cross_timeseries") {
        "1"
    } else {
        "0"
    };
    let cd = if enabled_variants.iter().any(|v| v == "cross_dynamical") {
        "1"
    } else {
        "0"
    };
    let reserved = "0";
    let de = if enabled_variants.iter().any(|v| v == "dynamical_ergodicity") {
        "1"
    } else {
        "0"
    };
    let sy = if enabled_variants.iter().any(|v| v == "synchronization") {
        "1"
    } else {
        "0"
    };

    format!("{} {} {} {} {} {}", st, ct, cd, reserved, de, sy)
}

fn map_variant_id_to_frontend(variant_id: &str) -> String {
    match variant_id {
        "ST" => "single_timeseries".to_string(),
        "CT" => "cross_timeseries".to_string(),
        "CD" => "cross_dynamical".to_string(),
        "DE" => "dynamical_ergodicity".to_string(),
        "SY" => "synchronization".to_string(),
        _ => variant_id.to_lowercase().replace('-', "_"),
    }
}

fn get_variant_display_name(variant_id: &str) -> String {
    match variant_id {
        "single_timeseries" => "Single Timeseries (ST)".to_string(),
        "cross_timeseries" => "Cross Timeseries (CT)".to_string(),
        "cross_dynamical" => "Cross Dynamical (CD)".to_string(),
        "dynamical_ergodicity" => "Dynamical Ergodicity (DE)".to_string(),
        "synchronization" => "Synchronization (SY)".to_string(),
        _ => variant_id.to_string(),
    }
}

fn parse_variant_configs(
    variant_configs_json: &serde_json::Value,
) -> Result<HashMap<String, VariantConfig>, String> {
    serde_json::from_value(variant_configs_json.clone())
        .map_err(|e| format!("Failed to parse variant_configs: {}", e))
}

fn convert_to_dda_request(api_req: &DDAAnalysisRequest, sample_rate: f64) -> dda_rs::DDARequest {
    let select_mask = if api_req.algorithm_selection.select_mask.is_some() {
        api_req.algorithm_selection.select_mask.clone()
    } else {
        Some(generate_select_mask(
            &api_req.algorithm_selection.enabled_variants,
        ))
    };

    dda_rs::DDARequest {
        file_path: api_req.file_path.clone(),
        channels: api_req.channels.clone(),
        time_range: dda_rs::TimeRange {
            start: api_req.time_range.start,
            end: api_req.time_range.end,
        },
        preprocessing_options: dda_rs::PreprocessingOptions {
            highpass: api_req.preprocessing_options.highpass,
            lowpass: api_req.preprocessing_options.lowpass,
        },
        algorithm_selection: dda_rs::AlgorithmSelection {
            enabled_variants: api_req.algorithm_selection.enabled_variants.clone(),
            select_mask,
        },
        window_parameters: dda_rs::WindowParameters {
            window_length: api_req.window_parameters.window_length as u32,
            window_step: api_req.window_parameters.window_step as u32,
            ct_window_length: api_req.window_parameters.ct_window_length.map(|v| v as u32),
            ct_window_step: api_req.window_parameters.ct_window_step.map(|v| v as u32),
        },
        delay_parameters: dda_rs::DelayParameters {
            delays: api_req.scale_parameters.delay_list.clone(),
        },
        ct_channel_pairs: api_req.ct_channel_pairs.clone(),
        cd_channel_pairs: api_req.cd_channel_pairs.clone(),
        model_parameters: api_req
            .model_parameters
            .as_ref()
            .map(|mp| dda_rs::ModelParameters {
                dm: mp.dm,
                order: mp.order,
                nr_tau: mp.nr_tau,
            }),
        variant_configs: None,
        sampling_rate: Some(sample_rate),
    }
}

fn calculate_mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let sum: f64 = values.iter().sum();
    if !sum.is_finite() {
        return 0.0;
    }
    sum / values.len() as f64
}

fn calculate_std(values: &[f64]) -> f64 {
    if values.len() < 2 {
        return 0.0;
    }
    let mean = calculate_mean(values);
    if !mean.is_finite() {
        return 0.0;
    }
    let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / values.len() as f64;
    if !variance.is_finite() {
        return 0.0;
    }
    variance.sqrt()
}

fn get_dda_binary_path(api_state: &ApiState) -> Result<PathBuf, String> {
    if let Some(ref resolved_path) = api_state.dda_binary_path {
        return Ok(resolved_path.clone());
    }

    if let Ok(env_path) = std::env::var("DDA_BINARY_PATH") {
        return Ok(PathBuf::from(env_path));
    }

    let binary_name = if cfg!(target_os = "windows") {
        "run_DDA_AsciiEdf.exe"
    } else {
        "run_DDA_AsciiEdf"
    };

    let mut possible_paths = vec![PathBuf::from("./bin").join(binary_name)];

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            possible_paths.push(
                exe_dir
                    .join("..")
                    .join("Resources")
                    .join("bin")
                    .join(binary_name),
            );
            possible_paths.push(exe_dir.join("..").join("Resources").join(binary_name));
            possible_paths.push(exe_dir.join("bin").join(binary_name));
            possible_paths.push(exe_dir.join(binary_name));
        }
    }

    possible_paths.extend(vec![
        PathBuf::from("../Resources/bin").join(binary_name),
        PathBuf::from("../Resources").join(binary_name),
        PathBuf::from(".").join(binary_name),
        PathBuf::from("./resources/bin").join(binary_name),
        PathBuf::from("./resources").join(binary_name),
        PathBuf::from("/app/bin").join(binary_name),
    ]);

    for path in &possible_paths {
        if let Ok(canonical_path) = path.canonicalize() {
            if canonical_path.exists() {
                return Ok(canonical_path);
            }
        } else if path.exists() {
            return Ok(path.clone());
        }
    }

    Err("DDA binary not found".to_string())
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Submit a DDA analysis job. This is an async operation that emits progress events.
/// The analysis runs in the background and sends events via Tauri's event system.
#[tauri::command]
pub async fn submit_dda_analysis(
    app: AppHandle,
    api_state: State<'_, Arc<ApiState>>,
    request: DDAAnalysisRequest,
) -> Result<DDAResult, String> {
    log::info!(
        "[DDA_IPC] submit_dda_analysis called for file: {}",
        request.file_path
    );

    // Rate limiting
    if !api_state.dda_rate_limiter.check_and_increment() {
        let reset_secs = api_state.dda_rate_limiter.seconds_until_reset();
        log::warn!(
            "[DDA_IPC] Rate limit exceeded. Reset in {} seconds",
            reset_secs
        );
        return Err(format!(
            "Rate limit exceeded. Please wait {} seconds.",
            reset_secs
        ));
    }

    // Validate request
    validate_dda_request(&request)?;

    let file_path = PathBuf::from(&request.file_path);

    // Canonicalize path
    let canonical_file_path = file_path
        .canonicalize()
        .map_err(|e| format!("Failed to access file '{}': {}", request.file_path, e))?;

    // Validate file type
    let file_type = FileType::from_path(&canonical_file_path);
    if !matches!(
        file_type,
        FileType::EDF
            | FileType::FIF
            | FileType::ASCII
            | FileType::CSV
            | FileType::BrainVision
            | FileType::EEGLAB
    ) {
        return Err(format!(
            "DDA analysis not supported for {:?} files",
            file_type
        ));
    }

    // Generate analysis ID and register
    let analysis_id = Uuid::new_v4().to_string();
    api_state.start_analysis(analysis_id.clone());

    log::info!(
        "[DDA_IPC] Starting analysis {} for {}",
        analysis_id,
        canonical_file_path.display()
    );

    // Emit start event
    let _ = app.emit(
        "dda-progress",
        serde_json::json!({
            "analysisId": analysis_id,
            "status": "started",
            "progress": 0,
            "message": "Starting DDA analysis..."
        }),
    );

    let dda_binary_path = get_dda_binary_path(&api_state)?;

    // Read file metadata
    let file_path_for_reader = canonical_file_path.clone();
    let request_start = request.time_range.start;
    let request_end = request.time_range.end;

    let _ = app.emit(
        "dda-progress",
        serde_json::json!({
            "analysisId": analysis_id,
            "status": "reading_metadata",
            "progress": 10,
            "message": "Reading file metadata..."
        }),
    );

    let (start_bound, end_bound, sample_rate) =
        tokio::task::spawn_blocking(move || -> Result<(u64, u64, f64), String> {
            let reader = FileReaderFactory::create_reader(&file_path_for_reader)
                .map_err(|e| format!("Failed to create file reader: {}", e))?;

            let metadata = reader
                .metadata()
                .map_err(|e| format!("Failed to read file metadata: {}", e))?;

            let sample_rate = metadata.sample_rate;
            let total_samples = metadata.num_samples as u64;

            let start_sample = (request_start * sample_rate) as u64;
            let end_sample = (request_end * sample_rate) as u64;

            let safety_margin = std::cmp::min(256, total_samples / 10);
            let safe_end = if total_samples > safety_margin {
                std::cmp::min(end_sample, total_samples - safety_margin)
            } else {
                std::cmp::min(end_sample, total_samples)
            };

            Ok((start_sample, safe_end, sample_rate))
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?
        .map_err(|e| format!("File metadata reading error: {}", e))?;

    // Check for cancellation
    if api_state.is_analysis_cancelled() {
        log::info!(
            "[DDA_IPC] Analysis {} cancelled before processing",
            analysis_id
        );
        api_state.complete_analysis();
        return Err("Analysis cancelled".to_string());
    }

    let available_samples = if end_bound > start_bound {
        end_bound - start_bound
    } else {
        0
    };

    let window_length = request.window_parameters.window_length as u64;
    if available_samples < window_length {
        api_state.complete_analysis();
        return Err(format!(
            "Insufficient data for analysis: {} samples available, but window length is {}",
            available_samples, window_length
        ));
    }

    let _ = app.emit(
        "dda-progress",
        serde_json::json!({
            "analysisId": analysis_id,
            "status": "running",
            "progress": 30,
            "message": "Running DDA analysis..."
        }),
    );

    let runner = DDARunner::new(&dda_binary_path).map_err(|e| {
        api_state.complete_analysis();
        format!("Failed to create DDA runner: {}", e)
    })?;

    let mut dda_request = convert_to_dda_request(&request, sample_rate);
    let mut parsed_cd_channel_pairs: Option<Vec<[usize; 2]>> = None;

    // Process variant_configs if provided
    if let Some(ref variant_configs_json) = request.variant_configs {
        let variant_configs = parse_variant_configs(variant_configs_json)?;

        if let Some(ct_config) = variant_configs.get("cross_timeseries") {
            if let Some(ref pairs) = ct_config.ct_channel_pairs {
                if !pairs.is_empty() {
                    dda_request.ct_channel_pairs = Some(pairs.clone());
                }
            }
        }

        if let Some(cd_config) = variant_configs.get("cross_dynamical") {
            if let Some(ref pairs) = cd_config.cd_channel_pairs {
                if !pairs.is_empty() {
                    parsed_cd_channel_pairs = Some(pairs.clone());
                    dda_request.cd_channel_pairs = Some(pairs.clone());
                }
            }
        }

        if let Some(st_config) = variant_configs.get("single_timeseries") {
            if let Some(ref channels) = st_config.selected_channels {
                if !channels.is_empty() {
                    dda_request.channels = Some(channels.clone());
                }
            }
        }
    }

    // Check for cancellation before running
    if api_state.is_analysis_cancelled() {
        log::info!(
            "[DDA_IPC] Analysis {} cancelled before DDA execution",
            analysis_id
        );
        api_state.complete_analysis();
        return Err("Analysis cancelled".to_string());
    }

    // Get channel names from cache
    let edf_channel_names: Option<Vec<String>> = {
        let file_cache = api_state.files.read();
        file_cache
            .get(&request.file_path)
            .map(|info| info.channels.clone())
    };

    // Run DDA analysis
    let dda_result = runner
        .run(
            &dda_request,
            Some(start_bound),
            Some(end_bound),
            edf_channel_names.as_deref(),
        )
        .await
        .map_err(|e| {
            api_state.complete_analysis();
            format!("DDA analysis failed: {}", e)
        })?;

    let _ = app.emit(
        "dda-progress",
        serde_json::json!({
            "analysisId": analysis_id,
            "status": "processing_results",
            "progress": 80,
            "message": "Processing results..."
        }),
    );

    let q_matrix = &dda_result.q_matrix;
    let num_channels = q_matrix.len();
    let num_timepoints = if num_channels > 0 {
        q_matrix[0].len()
    } else {
        0
    };

    let all_values: Vec<f64> = q_matrix
        .par_iter()
        .flat_map_iter(|row| row.iter().copied())
        .collect();

    let input_edf_channels: Vec<String> = {
        let file_cache = api_state.files.read();
        if let Some(file_info) = file_cache.get(&request.file_path) {
            if let Some(ref channel_indices) = request.channels {
                channel_indices
                    .iter()
                    .filter_map(|&idx| file_info.channels.get(idx).cloned())
                    .collect()
            } else {
                file_info.channels.clone()
            }
        } else {
            Vec::new()
        }
    };

    let channel_names: Vec<String> =
        if !input_edf_channels.is_empty() && input_edf_channels.len() == num_channels {
            input_edf_channels.clone()
        } else if !input_edf_channels.is_empty() {
            (0..num_channels)
                .map(|i| {
                    if i < input_edf_channels.len() {
                        input_edf_channels[i].clone()
                    } else {
                        format!("Channel {}", i + 1)
                    }
                })
                .collect()
        } else {
            (0..num_channels)
                .map(|i| format!("Channel {}", i + 1))
                .collect()
        };

    let parameters = DDAParameters {
        variants: request.algorithm_selection.enabled_variants.clone(),
        window_length: request.window_parameters.window_length as u32,
        window_step: request.window_parameters.window_step as u32,
        selected_channels: channel_names.clone(),
        delay_list: request.scale_parameters.delay_list.clone(),
        variant_configs: request.variant_configs.clone(),
    };

    let mut dda_matrix = serde_json::Map::new();
    for (i, channel_name) in channel_names.iter().enumerate() {
        if i < q_matrix.len() {
            dda_matrix.insert(channel_name.clone(), serde_json::json!(q_matrix[i]));
        }
    }

    let scales: Vec<f64> = (0..num_timepoints).map(|i| i as f64 * 0.1).collect();

    let cd_pairs_for_motifs: Option<Vec<[usize; 2]>> = parsed_cd_channel_pairs
        .or_else(|| request.cd_channel_pairs.clone())
        .or_else(|| {
            request.variant_configs.as_ref().and_then(|vc| {
                vc.get("cross_dynamical")
                    .and_then(|v| v.get("cdChannelPairs"))
                    .and_then(|p| {
                        serde_json::from_value(p.clone())
                            .map_err(|e| log::warn!("Failed to parse cdChannelPairs: {}", e))
                            .ok()
                    })
            })
        });

    let variants_array: Vec<serde_json::Value> = if let Some(ref variant_results) =
        dda_result.variant_results
    {
        variant_results
            .par_iter()
            .map(|vr| {
                let variant_channel_labels = vr.channel_labels.as_ref().unwrap_or(&channel_names);

                let mut variant_dda_matrix = serde_json::Map::new();
                for (i, channel_label) in variant_channel_labels.iter().enumerate() {
                    if i < vr.q_matrix.len() {
                        variant_dda_matrix
                            .insert(channel_label.clone(), serde_json::json!(vr.q_matrix[i]));
                    }
                }

                let network_motifs = if vr.variant_id == "CD" {
                    if let Some(ref pairs) = cd_pairs_for_motifs {
                        let delay_values: Vec<f64> = request
                            .scale_parameters
                            .delay_list
                            .iter()
                            .map(|&d| d as f64)
                            .collect();

                        let full_channel_names = edf_channel_names
                            .as_ref()
                            .cloned()
                            .unwrap_or_else(|| channel_names.clone());

                        match transform_cd_to_network_motifs(
                            &vr.q_matrix,
                            pairs,
                            &full_channel_names,
                            &delay_values,
                            Some(0.25),
                        ) {
                            Ok(motifs) => match serde_json::to_value(motifs) {
                                Ok(value) => Some(value),
                                Err(e) => {
                                    log::error!("Failed to serialize network motifs: {}", e);
                                    None
                                }
                            },
                            Err(e) => {
                                log::warn!("Failed to compute network motifs: {}", e);
                                None
                            }
                        }
                    } else {
                        None
                    }
                } else {
                    None
                };

                let mut result = serde_json::json!({
                    "variant_id": map_variant_id_to_frontend(&vr.variant_id),
                    "variant_name": vr.variant_name.clone(),
                    "dda_matrix": variant_dda_matrix,
                    "exponents": serde_json::json!({}),
                    "quality_metrics": serde_json::json!({})
                });

                if let Some(motifs) = network_motifs {
                    if let Some(obj) = result.as_object_mut() {
                        obj.insert("network_motifs".to_string(), motifs);
                    }
                }

                if let Some(ref error_vals) = vr.error_values {
                    if let Some(obj) = result.as_object_mut() {
                        obj.insert("error_values".to_string(), serde_json::json!(error_vals));
                    }
                }

                result
            })
            .collect()
    } else {
        vec![serde_json::json!({
            "variant_id": "single_timeseries",
            "variant_name": "Single Timeseries (ST)",
            "dda_matrix": &dda_matrix,
            "exponents": serde_json::json!({}),
            "quality_metrics": serde_json::json!({})
        })]
    };

    let time_axis: Vec<f64> = (0..num_timepoints).map(|i| i as f64 * 0.1).collect();

    let mut results = serde_json::json!({
        "summary": {
            "total_windows": num_timepoints,
            "processed_windows": num_timepoints,
            "mean_complexity": calculate_mean(&all_values),
            "std_complexity": calculate_std(&all_values),
            "num_channels": num_channels
        },
        "timeseries": {
            "time": &time_axis,
            "complexity": &q_matrix
        },
        "scales": scales,
        "variants": variants_array,
        "dda_matrix": &dda_matrix
    });

    if let Some(ref error_vals) = dda_result.error_values {
        if let Some(obj) = results.as_object_mut() {
            obj.insert("error_values".to_string(), serde_json::json!(error_vals));
        }
    }

    let plot_data = serde_json::json!({
        "time_series": {
            "x": time_axis,
            "y": &q_matrix
        }
    });

    let result = DDAResult {
        id: analysis_id.clone(),
        name: None,
        file_path: request.file_path.clone(),
        channels: channel_names,
        parameters,
        results,
        plot_data: Some(plot_data),
        q_matrix: Some(q_matrix.clone()),
        created_at: Utc::now().to_rfc3339(),
        status: "completed".to_string(),
    };

    // Cache result
    {
        let mut analysis_cache = api_state.analysis_results.write();
        analysis_cache.insert(analysis_id.clone(), Arc::new(result.clone()));
    }

    // Save to database
    if let Err(e) = api_state.save_to_disk(&result) {
        log::error!("[DDA_IPC] Failed to save analysis to disk: {}", e);
    }

    api_state.complete_analysis();

    let _ = app.emit(
        "dda-progress",
        serde_json::json!({
            "analysisId": analysis_id,
            "status": "completed",
            "progress": 100,
            "message": "Analysis complete"
        }),
    );

    log::info!("[DDA_IPC] Analysis {} completed successfully", analysis_id);

    Ok(result)
}

/// Get the status of a DDA analysis
#[tauri::command]
pub async fn get_dda_status(
    api_state: State<'_, Arc<ApiState>>,
    analysis_id: String,
) -> Result<DDAStatusResponse, String> {
    log::debug!("[DDA_IPC] get_dda_status called for: {}", analysis_id);

    // Check if this is the current running analysis
    if let Some(current_id) = api_state.get_current_analysis_id() {
        if current_id == analysis_id {
            return Ok(DDAStatusResponse {
                id: analysis_id,
                status: "running".to_string(),
                progress: 50,
                message: Some("Analysis in progress".to_string()),
            });
        }
    }

    // Check cache for completed result
    let analysis_cache = api_state.analysis_results.read();
    if let Some(result) = analysis_cache.get(&analysis_id) {
        return Ok(DDAStatusResponse {
            id: analysis_id,
            status: result.status.clone(),
            progress: 100,
            message: None,
        });
    }

    // Check database
    if let Some(ref db) = api_state.analysis_db {
        if let Ok(Some(_)) = db.get_analysis(&analysis_id) {
            return Ok(DDAStatusResponse {
                id: analysis_id,
                status: "completed".to_string(),
                progress: 100,
                message: None,
            });
        }
    }

    Ok(DDAStatusResponse {
        id: analysis_id,
        status: "not_found".to_string(),
        progress: 0,
        message: Some("Analysis not found".to_string()),
    })
}

/// Cancel a running DDA analysis
#[tauri::command]
pub async fn cancel_dda(api_state: State<'_, Arc<ApiState>>) -> Result<CancelDDAResponse, String> {
    log::info!("[DDA_IPC] cancel_dda called");

    let cancelled_id = api_state.cancel_current_analysis();

    match cancelled_id {
        Some(id) => {
            log::info!("[DDA_IPC] Cancelled analysis: {}", id);
            Ok(CancelDDAResponse {
                success: true,
                message: format!("Cancellation requested for analysis {}", id),
                cancelled_analysis_id: Some(id),
            })
        }
        None => {
            log::info!("[DDA_IPC] No running analysis to cancel");
            Ok(CancelDDAResponse {
                success: false,
                message: "No running analysis to cancel".to_string(),
                cancelled_analysis_id: None,
            })
        }
    }
}

/// Get a DDA result by its ID
#[tauri::command]
pub async fn get_dda_result_by_id(
    api_state: State<'_, Arc<ApiState>>,
    analysis_id: String,
) -> Result<Option<DDAResult>, String> {
    log::debug!("[DDA_IPC] get_dda_result_by_id called for: {}", analysis_id);

    // Check cache first
    {
        let analysis_cache = api_state.analysis_results.read();
        if let Some(result) = analysis_cache.get(&analysis_id) {
            return Ok(Some((**result).clone()));
        }
    }

    // Check database
    if let Some(ref db) = api_state.analysis_db {
        if let Ok(Some(analysis)) = db.get_analysis(&analysis_id) {
            // Convert from AnalysisResult to DDAResult
            if let Ok(parameters) =
                ddalab_tauri::api::models::parse_dda_parameters(analysis.parameters.clone())
            {
                let (results, channels, q_matrix, status) = if let Some(ref complete_data) =
                    analysis.plot_data
                {
                    let results_val = complete_data.get("results").cloned()
                        .unwrap_or_else(|| serde_json::json!({
                            "variants": [{"variant_id": "single_timeseries", "variant_name": "Single Timeseries (ST)"}]
                        }));
                    let channels_val: Vec<String> = complete_data
                        .get("channels")
                        .and_then(|v| serde_json::from_value(v.clone()).ok())
                        .unwrap_or_default();
                    let q_matrix_val: Option<Vec<Vec<f64>>> = complete_data
                        .get("q_matrix")
                        .and_then(|v| serde_json::from_value(v.clone()).ok());
                    let status_val: String = complete_data
                        .get("status")
                        .and_then(|v| v.as_str().map(|s| s.to_string()))
                        .unwrap_or_else(|| "completed".to_string());
                    (results_val, channels_val, q_matrix_val, status_val)
                } else {
                    (
                        serde_json::json!({
                            "variants": [{"variant_id": "single_timeseries", "variant_name": "Single Timeseries (ST)"}]
                        }),
                        Vec::new(),
                        None,
                        "completed".to_string(),
                    )
                };

                return Ok(Some(DDAResult {
                    id: analysis.id,
                    name: analysis.name,
                    file_path: analysis.file_path,
                    channels,
                    parameters,
                    results,
                    plot_data: analysis
                        .plot_data
                        .as_ref()
                        .and_then(|d| d.get("plot_data").cloned()),
                    q_matrix,
                    created_at: analysis.timestamp,
                    status,
                }));
            }
        }
    }

    Ok(None)
}

/// Get all DDA results for a specific file
#[tauri::command]
pub async fn get_dda_results_for_file(
    api_state: State<'_, Arc<ApiState>>,
    file_path: String,
    limit: Option<usize>,
) -> Result<Vec<DDAHistoryEntry>, String> {
    log::debug!(
        "[DDA_IPC] get_dda_results_for_file called for: {}",
        file_path
    );

    let limit = limit.unwrap_or(50);

    if let Some(ref db) = api_state.analysis_db {
        match db.get_analyses_by_file(&file_path, limit) {
            Ok(analyses) => {
                let entries: Vec<DDAHistoryEntry> = analyses
                    .iter()
                    .map(|a| {
                        // Extract counts from the parameters JSON
                        let channels_count = a
                            .parameters
                            .get("selected_channels")
                            .and_then(|v| v.as_array())
                            .map(|arr| arr.len())
                            .unwrap_or(0);
                        let variants_count = a
                            .parameters
                            .get("variants")
                            .and_then(|v| v.as_array())
                            .map(|arr| arr.len())
                            .unwrap_or(1);

                        DDAHistoryEntry {
                            id: a.id.clone(),
                            name: a.name.clone(),
                            file_path: a.file_path.clone(),
                            created_at: a.timestamp.clone(),
                            variant_name: a.variant_display_name.clone(),
                            channels_count,
                            variants_count,
                        }
                    })
                    .collect();
                return Ok(entries);
            }
            Err(e) => {
                log::error!("[DDA_IPC] Failed to get analyses from database: {}", e);
            }
        }
    }

    Ok(Vec::new())
}

/// List all DDA history entries
#[tauri::command]
pub async fn list_dda_history(
    api_state: State<'_, Arc<ApiState>>,
    limit: Option<usize>,
) -> Result<Vec<DDAHistoryEntry>, String> {
    log::debug!("[DDA_IPC] list_dda_history called");

    let limit = limit.unwrap_or(50);

    if let Some(ref db) = api_state.analysis_db {
        match db.get_recent_analyses(limit) {
            Ok(analyses) => {
                let entries: Vec<DDAHistoryEntry> = analyses
                    .iter()
                    .map(|a| {
                        // Extract counts from the parameters JSON
                        let channels_count = a
                            .parameters
                            .get("selected_channels")
                            .and_then(|v| v.as_array())
                            .map(|arr| arr.len())
                            .unwrap_or(0);
                        let variants_count = a
                            .parameters
                            .get("variants")
                            .and_then(|v| v.as_array())
                            .map(|arr| arr.len())
                            .unwrap_or(1); // Default to 1 for legacy entries

                        DDAHistoryEntry {
                            id: a.id.clone(),
                            name: a.name.clone(),
                            file_path: a.file_path.clone(),
                            created_at: a.timestamp.clone(),
                            variant_name: a.variant_display_name.clone(),
                            channels_count,
                            variants_count,
                        }
                    })
                    .collect();
                return Ok(entries);
            }
            Err(e) => {
                log::error!("[DDA_IPC] Failed to get analyses from database: {}", e);
            }
        }
    }

    Ok(Vec::new())
}

/// List all DDA history summaries (lightweight, excludes q_matrix/plot_data).
/// This is the optimized endpoint for list views that need more metadata than DDAHistoryEntry
/// but not the full DDAResult.
#[tauri::command]
pub async fn list_dda_summaries(
    api_state: State<'_, Arc<ApiState>>,
    limit: Option<usize>,
) -> Result<Vec<DDAResultSummary>, String> {
    log::debug!("[DDA_IPC] list_dda_summaries called");

    let limit = limit.unwrap_or(50);

    if let Some(ref db) = api_state.analysis_db {
        match db.get_recent_analyses(limit) {
            Ok(analyses) => {
                let summaries: Vec<DDAResultSummary> = analyses
                    .iter()
                    .filter_map(|a| {
                        let parameters = match ddalab_tauri::api::models::parse_dda_parameters(
                            a.parameters.clone(),
                        ) {
                            Ok(p) => p,
                            Err(e) => {
                                log::warn!(
                                    "[DDA_IPC] Failed to parse parameters for {}: {}",
                                    a.id,
                                    e
                                );
                                return None;
                            }
                        };

                        Some(DDAResultSummary {
                            id: a.id.clone(),
                            name: a.name.clone(),
                            file_path: a.file_path.clone(),
                            created_at: a.timestamp.clone(),
                            status: "completed".to_string(),
                            channels_count: parameters.selected_channels.len(),
                            variants_count: parameters.variants.len(),
                            variant_names: parameters.variants.clone(),
                            window_length: parameters.window_length,
                            window_step: parameters.window_step,
                        })
                    })
                    .collect();
                return Ok(summaries);
            }
            Err(e) => {
                log::error!("[DDA_IPC] Failed to get analyses from database: {}", e);
            }
        }
    }

    // Fallback to in-memory cache
    let analysis_cache = api_state.analysis_results.read();
    let mut summaries: Vec<DDAResultSummary> = analysis_cache
        .values()
        .map(|arc| {
            let result = &**arc;
            DDAResultSummary {
                id: result.id.clone(),
                name: result.name.clone(),
                file_path: result.file_path.clone(),
                created_at: result.created_at.clone(),
                status: result.status.clone(),
                channels_count: result.channels.len(),
                variants_count: result.parameters.variants.len(),
                variant_names: result.parameters.variants.clone(),
                window_length: result.parameters.window_length,
                window_step: result.parameters.window_step,
            }
        })
        .collect();
    summaries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(summaries)
}

/// Save a DDA result to history (for results computed elsewhere)
#[tauri::command]
pub async fn save_dda_to_history(
    api_state: State<'_, Arc<ApiState>>,
    result: DDAResult,
) -> Result<(), String> {
    log::debug!("[DDA_IPC] save_dda_to_history called for: {}", result.id);

    // Save to cache
    {
        let mut analysis_cache = api_state.analysis_results.write();
        analysis_cache.insert(result.id.clone(), Arc::new(result.clone()));
    }

    // Save to database
    api_state
        .save_to_disk(&result)
        .map_err(|e| format!("Failed to save: {}", e))?;

    Ok(())
}

/// Get a DDA result from history by ID
#[tauri::command]
pub async fn get_dda_from_history(
    api_state: State<'_, Arc<ApiState>>,
    analysis_id: String,
) -> Result<Option<DDAResult>, String> {
    // This is essentially the same as get_dda_result_by_id
    get_dda_result_by_id(api_state, analysis_id).await
}

/// Get a DDA result from history by ID, via temp file for fast transfer.
///
/// Returns the path to a temp file containing LZ4-compressed MessagePack binary.
/// This bypasses Tauri IPC overhead for large payloads (40MB+ takes 3-4s over IPC,
/// but reading from file is ~100ms).
///
/// The frontend should:
/// 1. Read the file using Tauri's fs plugin
/// 2. Decompress with lz4js
/// 3. Decode with @msgpack/msgpack
#[tauri::command]
pub async fn get_dda_from_history_msgpack(
    api_state: State<'_, Arc<ApiState>>,
    analysis_id: String,
) -> Result<String, String> {
    use std::io::Write;
    use std::time::Instant;

    let t0 = Instant::now();
    log::info!(
        "[DDA_IPC] get_dda_from_history_msgpack START for: {}",
        analysis_id
    );

    // Create temp file path
    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join(format!("dda_result_{}.bin", &analysis_id[..8]));
    let temp_path_str = temp_path.to_string_lossy().to_string();

    // Check if temp file already exists and is recent (within 1 hour)
    if let Ok(metadata) = std::fs::metadata(&temp_path) {
        if let Ok(modified) = metadata.modified() {
            if modified
                .elapsed()
                .map(|d| d.as_secs() < 3600)
                .unwrap_or(false)
            {
                log::info!(
                    "[DDA_IPC] TEMP FILE HIT: {} ({} bytes) in {:.1}ms",
                    temp_path_str,
                    metadata.len(),
                    t0.elapsed().as_secs_f64() * 1000.0
                );
                return Ok(temp_path_str);
            }
        }
    }

    // Try to get pre-serialized blob from SQLite
    let blob = if let Some(ref db) = api_state.analysis_db {
        match db.get_msgpack_blob(&analysis_id) {
            Ok(Some(blob)) if !blob.is_empty() => {
                log::info!(
                    "[DDA_IPC] BLOB HIT: {} bytes in {:.1}ms",
                    blob.len(),
                    t0.elapsed().as_secs_f64() * 1000.0
                );
                blob
            }
            Ok(_) => {
                log::info!("[DDA_IPC] BLOB MISS: generating...");
                generate_and_save_blob(api_state.clone(), &analysis_id, t0).await?
            }
            Err(e) => {
                log::warn!("[DDA_IPC] Failed to check blob cache: {}", e);
                generate_and_save_blob(api_state.clone(), &analysis_id, t0).await?
            }
        }
    } else {
        generate_and_save_blob(api_state.clone(), &analysis_id, t0).await?
    };

    // Write to temp file
    let t_write = Instant::now();
    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    file.write_all(&blob)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    log::info!(
        "[DDA_IPC] Wrote {} bytes to {} in {:.1}ms, total: {:.1}ms",
        blob.len(),
        temp_path_str,
        t_write.elapsed().as_secs_f64() * 1000.0,
        t0.elapsed().as_secs_f64() * 1000.0
    );

    Ok(temp_path_str)
}

/// Generate the msgpack blob and save to DB
async fn generate_and_save_blob(
    api_state: State<'_, Arc<ApiState>>,
    analysis_id: &str,
    t0: std::time::Instant,
) -> Result<Vec<u8>, String> {
    use std::time::Instant;

    let result = get_dda_result_by_id(api_state.clone(), analysis_id.to_string()).await?;
    let t1 = Instant::now();
    log::info!(
        "[DDA_IPC] get_dda_result_by_id took: {:.1}ms",
        t1.duration_since(t0).as_secs_f64() * 1000.0
    );

    // Serialize to MessagePack
    let msgpack_bytes = match result {
        Some(dda_result) => rmp_serde::to_vec_named(&dda_result)
            .map_err(|e| format!("Failed to serialize: {}", e))?,
        None => rmp_serde::to_vec_named(&Option::<DDAResult>::None)
            .map_err(|e| format!("Failed to serialize null: {}", e))?,
    };
    let t2 = Instant::now();
    log::info!(
        "[DDA_IPC] MessagePack: {:.1}ms ({} bytes)",
        t2.duration_since(t1).as_secs_f64() * 1000.0,
        msgpack_bytes.len()
    );

    // Compress with LZ4
    let compressed = lz4_flex::compress_prepend_size(&msgpack_bytes);
    let t3 = Instant::now();
    log::info!(
        "[DDA_IPC] LZ4: {:.1}ms ({} -> {} bytes, {:.1}%)",
        t3.duration_since(t2).as_secs_f64() * 1000.0,
        msgpack_bytes.len(),
        compressed.len(),
        (1.0 - compressed.len() as f64 / msgpack_bytes.len() as f64) * 100.0
    );

    // Save to DB
    if let Some(ref db) = api_state.analysis_db {
        if let Err(e) = db.save_msgpack_blob(analysis_id, &compressed) {
            log::warn!("[DDA_IPC] Failed to save blob: {}", e);
        }
    }

    Ok(compressed)
}

/// Clear the msgpack blob when an analysis is modified
pub fn invalidate_msgpack_blob(api_state: &ApiState, analysis_id: &str) {
    if let Some(ref db) = api_state.analysis_db {
        // Clear the blob by setting it to NULL
        if let Err(e) = db.save_msgpack_blob(analysis_id, &[]) {
            log::warn!("[DDA_IPC] Failed to invalidate msgpack blob: {}", e);
        }
    }
}

/// Delete a DDA result from history
#[tauri::command]
pub async fn delete_dda_from_history(
    api_state: State<'_, Arc<ApiState>>,
    analysis_id: String,
) -> Result<(), String> {
    log::info!(
        "[DDA_IPC] delete_dda_from_history called for: {}",
        analysis_id
    );

    // Remove from analysis cache
    {
        let mut analysis_cache = api_state.analysis_results.write();
        analysis_cache.remove(&analysis_id);
    }

    // Remove from database (this also removes the msgpack blob)
    if let Some(ref db) = api_state.analysis_db {
        db.delete_analysis(&analysis_id)
            .map_err(|e| format!("Failed to delete analysis: {}", e))?;
    }

    Ok(())
}

/// Lightweight metadata response for fast initial load (no large arrays)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DDAMetadataResponse {
    pub id: String,
    pub name: Option<String>,
    pub file_path: String,
    pub channels: Vec<String>,
    pub status: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
    pub source: Option<String>,
    pub parameters: serde_json::Value,
    pub window_indices: Vec<f64>,
    pub variants: Vec<VariantMetadata>,
}

/// Variant metadata without the large dda_matrix
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantMetadata {
    pub variant_id: String,
    pub variant_name: String,
    pub exponents: serde_json::Value,
    pub quality_metrics: serde_json::Value,
    pub has_network_motifs: bool,
}

/// Get DDA metadata from history (fast, no large data transfer).
///
/// Returns only metadata needed for UI display. The large dda_matrix arrays
/// are NOT included - use get_dda_from_history_msgpack for full data when
/// components actually need to render the data.
///
/// FAST PATH: Uses get_analysis_metadata() which skips the 47MB plot_data blob.
/// window_indices will be empty - frontend gets them from channelData response.
#[tauri::command]
pub async fn get_dda_metadata_from_history(
    api_state: State<'_, Arc<ApiState>>,
    analysis_id: String,
) -> Result<Option<DDAMetadataResponse>, String> {
    use std::time::Instant;
    let t0 = Instant::now();

    log::info!(
        "[DDA_IPC] get_dda_metadata_from_history START for: {}",
        analysis_id
    );

    // Try cache first (this has full data including variants)
    {
        let analysis_cache = api_state.analysis_results.read();
        if let Some(result) = analysis_cache.get(&analysis_id) {
            let metadata = extract_metadata_from_result(result);
            log::info!(
                "[DDA_IPC] CACHE HIT: metadata in {:.1}ms",
                t0.elapsed().as_secs_f64() * 1000.0
            );
            return Ok(Some(metadata));
        }
    }

    // FAST PATH: Use get_analysis_metadata which skips the 47MB plot_data blob
    // window_indices and full variant details come from channelData later
    if let Some(ref db) = api_state.analysis_db {
        if let Ok(Some(analysis)) = db.get_analysis_metadata(&analysis_id) {
            if let Ok(parameters) =
                ddalab_tauri::api::models::parse_dda_parameters(analysis.parameters.clone())
            {
                // Extract channels from parameters
                let channels = parameters.selected_channels.clone();

                // Create variant metadata for ALL enabled variants from parameters
                // The database stores only ONE row per analysis run, but the analysis
                // may have multiple enabled variants (ST, CT, CD, DE, SY).
                // Extract the full list from parameters.variants.
                let variants: Vec<VariantMetadata> = parameters
                    .variants
                    .iter()
                    .map(|variant_id| VariantMetadata {
                        variant_id: variant_id.clone(),
                        variant_name: get_variant_display_name(variant_id),
                        exponents: serde_json::json!({}),
                        quality_metrics: serde_json::json!({}),
                        has_network_motifs: false,
                    })
                    .collect();

                log::info!(
                    "[DDA_IPC] DB metadata (fast) in {:.1}ms, {} variants: {:?}",
                    t0.elapsed().as_secs_f64() * 1000.0,
                    variants.len(),
                    parameters.variants
                );

                return Ok(Some(DDAMetadataResponse {
                    id: analysis.id,
                    name: analysis.name,
                    file_path: analysis.file_path,
                    channels,
                    status: "completed".to_string(),
                    created_at: analysis.timestamp,
                    completed_at: None,
                    error_message: None,
                    source: Some("local".to_string()),
                    parameters: serde_json::to_value(&parameters).unwrap_or(serde_json::json!({})),
                    window_indices: Vec::new(), // Will come from channelData
                    variants,
                }));
            }
        }
    }

    log::info!(
        "[DDA_IPC] NOT FOUND in {:.1}ms",
        t0.elapsed().as_secs_f64() * 1000.0
    );
    Ok(None)
}

/// Extract metadata from a cached DDAResult
fn extract_metadata_from_result(result: &DDAResult) -> DDAMetadataResponse {
    let results = &result.results;

    // Extract window_indices
    let window_indices: Vec<f64> = results
        .get("window_indices")
        .or_else(|| results.get("scales"))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // Extract variant metadata
    let variants: Vec<VariantMetadata> = results
        .get("variants")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|v| VariantMetadata {
                    variant_id: v
                        .get("variant_id")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                    variant_name: v
                        .get("variant_name")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                    exponents: v.get("exponents").cloned().unwrap_or(serde_json::json!({})),
                    quality_metrics: v
                        .get("quality_metrics")
                        .cloned()
                        .unwrap_or(serde_json::json!({})),
                    has_network_motifs: v.get("network_motifs").is_some(),
                })
                .collect()
        })
        .unwrap_or_default();

    DDAMetadataResponse {
        id: result.id.clone(),
        name: result.name.clone(),
        file_path: result.file_path.clone(),
        channels: result.channels.clone(),
        status: result.status.clone(),
        created_at: result.created_at.clone(),
        completed_at: None,
        error_message: None,
        source: Some("local".to_string()),
        parameters: serde_json::to_value(&result.parameters).unwrap_or(serde_json::json!({})),
        window_indices,
        variants,
    }
}

/// Rename a DDA result in history
#[tauri::command]
pub async fn rename_dda_in_history(
    api_state: State<'_, Arc<ApiState>>,
    analysis_id: String,
    new_name: String,
) -> Result<(), String> {
    log::info!(
        "[DDA_IPC] rename_dda_in_history called for: {} -> '{}'",
        analysis_id,
        new_name
    );

    let trimmed_name = new_name.trim();

    if trimmed_name.is_empty() {
        return Err("Analysis name cannot be empty".to_string());
    }

    if trimmed_name.len() > 200 {
        return Err("Analysis name must be 200 characters or less".to_string());
    }

    let sanitized_name: String = trimmed_name
        .chars()
        .filter(|c| !c.is_control() && *c != '\0')
        .collect();

    if sanitized_name.is_empty() {
        return Err("Analysis name contains only invalid characters".to_string());
    }

    if let Some(ref db) = api_state.analysis_db {
        db.rename_analysis(&analysis_id, &sanitized_name)
            .map_err(|e| format!("Failed to rename analysis: {}", e))?;
    } else {
        return Err("Analysis database not available".to_string());
    }

    Ok(())
}
