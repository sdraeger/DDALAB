use crate::api::models::{DDAParameters, DDAResult};
use crate::api::state::ApiState;
use crate::api::utils::FileType;
use crate::file_readers::FileReaderFactory;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::Utc;
use dda_rs::DDARunner;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TimeRange {
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PreprocessingOptions {
    pub highpass: Option<f64>,
    pub lowpass: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AlgorithmSelection {
    pub enabled_variants: Vec<String>,
    pub select_mask: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct WindowParameters {
    pub window_length: usize,
    pub window_step: usize,
    pub ct_window_length: Option<usize>,
    pub ct_window_step: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ScaleParameters {
    pub scale_min: i32,
    pub scale_max: i32,
    pub scale_num: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay_list: Option<Vec<i32>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelParameters {
    pub dm: u32,
    pub order: u32,
    pub nr_tau: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DDARequest {
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

#[derive(Debug, Deserialize)]
pub struct RenameAnalysisRequest {
    name: String,
}

/// Per-variant channel configuration (matches frontend structure)
#[derive(Debug, Clone, Deserialize)]
struct VariantConfig {
    #[serde(rename = "selectedChannels")]
    selected_channels: Option<Vec<usize>>,
    #[serde(rename = "ctChannelPairs")]
    ct_channel_pairs: Option<Vec<[usize; 2]>>,
    #[serde(rename = "cdChannelPairs")]
    cd_channel_pairs: Option<Vec<[usize; 2]>>,
}

/// Parse variant_configs from JSON value
fn parse_variant_configs(
    variant_configs_json: &serde_json::Value,
) -> Result<HashMap<String, VariantConfig>, String> {
    serde_json::from_value(variant_configs_json.clone())
        .map_err(|e| format!("Failed to parse variant_configs: {}", e))
}

/// Map frontend variant IDs to backend variant codes
fn map_variant_id(frontend_id: &str) -> Option<&str> {
    match frontend_id {
        "single_timeseries" => Some("ST"),
        "cross_timeseries" => Some("CT"),
        "cross_dynamical" => Some("CD"),
        "dynamical_ergodicity" => Some("DE"),
        "synchronization" => Some("SY"),
        _ => None,
    }
}

pub async fn run_dda_analysis(
    State(state): State<Arc<ApiState>>,
    Json(request): Json<DDARequest>,
) -> Result<Json<DDAResult>, StatusCode> {
    let file_path = PathBuf::from(&request.file_path);
    let file_type = FileType::from_path(&file_path);
    if !matches!(
        file_type,
        FileType::EDF
            | FileType::FIF
            | FileType::ASCII
            | FileType::CSV
            | FileType::BrainVision
            | FileType::EEGLAB
    ) {
        log::error!("DDA analysis not supported for {:?} files. The run_DDA_AsciiEdf binary only processes EDF and ASCII formats.", file_type);
        return Err(StatusCode::BAD_REQUEST);
    }

    log::info!("Starting DDA analysis for file: {}", request.file_path);

    let dda_binary_path = get_dda_binary_path(&state)?;
    log::info!("Using DDA binary at: {}", dda_binary_path.display());

    if !file_path.exists() {
        log::error!("Input file not found: {}", request.file_path);
        return Err(StatusCode::NOT_FOUND);
    }

    let start_time = std::time::Instant::now();
    log::info!("⏱️  [TIMING] Starting file metadata read...");
    let file_path_for_reader = file_path.clone();
    let request_start = request.time_range.start;
    let request_end = request.time_range.end;

    let (start_bound, end_bound) = tokio::task::spawn_blocking(move || -> Result<(u64, u64), String> {
        let reader = FileReaderFactory::create_reader(&file_path_for_reader)
            .map_err(|e| format!("Failed to create file reader: {}", e))?;

        let metadata = reader.metadata()
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

        log::info!("Time range: {:.2}s - {:.2}s -> samples: {} - {} (total: {}, sample rate: {:.1} Hz)",
            request_start, request_end, start_sample, safe_end, total_samples, sample_rate);

        Ok((start_sample, safe_end))
    })
    .await
    .map_err(|e| {
        log::error!("Task join error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .map_err(|e| {
        log::error!("File metadata reading error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    log::info!(
        "⏱️  [TIMING] File metadata read completed in {:.2}s",
        start_time.elapsed().as_secs_f64()
    );

    let available_samples = if end_bound > start_bound {
        end_bound - start_bound
    } else {
        0
    };

    let window_length = request.window_parameters.window_length as u64;
    if available_samples < window_length {
        log::error!(
            "Insufficient data for analysis: {} samples available, but window length is {}. Please use a smaller window length or select a larger time range.",
            available_samples, window_length
        );
        return Err(StatusCode::BAD_REQUEST);
    }

    log::info!(
        "Validation passed: {} samples available for window length {}",
        available_samples,
        window_length
    );

    let runner = DDARunner::new(&dda_binary_path).map_err(|e| {
        log::error!("Failed to create DDA runner: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let dda_request = convert_to_dda_request(&request);

    log::info!("📋 LOCAL DDA Analysis Parameters:");
    log::info!("   Channels: {:?}", request.channels);
    log::info!(
        "   Time range: {} - {} seconds (bounds: {:?} - {:?} samples)",
        request.time_range.start,
        request.time_range.end,
        start_bound,
        end_bound
    );
    log::info!(
        "   Window: length={}, step={}",
        request.window_parameters.window_length,
        request.window_parameters.window_step
    );
    if let Some(ref delay_list) = request.scale_parameters.delay_list {
        log::info!("   Delays (τ): {:?}", delay_list);
    } else {
        log::info!("   Delays (τ): Using defaults [7, 10]");
    }

    let edf_channel_names: Option<Vec<String>> = {
        let file_cache = state.files.read();
        file_cache
            .get(&request.file_path)
            .map(|info| info.channels.clone())
    };

    log::info!("⏱️  [TIMING] Running DDA analysis via dda-rs...");
    let dda_start = std::time::Instant::now();

    // Check if variant_configs are provided for per-variant channel configuration
    let dda_result = if let Some(ref variant_configs_json) = request.variant_configs {
        log::info!("📊 Using per-variant channel configuration");

        let variant_configs = parse_variant_configs(variant_configs_json).map_err(|e| {
            log::error!("{}", e);
            StatusCode::BAD_REQUEST
        })?;

        let mut variant_results = Vec::new();

        // Process each variant with its specific configuration
        for (frontend_variant_id, config) in variant_configs.iter() {
            let variant_id = map_variant_id(frontend_variant_id).ok_or_else(|| {
                log::error!("Unknown variant ID: {}", frontend_variant_id);
                StatusCode::BAD_REQUEST
            })?;

            log::info!("Running variant {} ({})", variant_id, frontend_variant_id);

            match variant_id {
                "CT" => {
                    // CT variant: run with channel pairs
                    if let Some(ref pairs) = config.ct_channel_pairs {
                        if pairs.is_empty() {
                            log::warn!("Skipping CT variant: no channel pairs configured");
                            continue;
                        }

                        log::info!("CT variant: {} channel pairs", pairs.len());

                        // For CT, we need to run each pair separately and combine results
                        let mut combined_ct_results: Vec<Vec<f64>> = Vec::new();

                        for (pair_idx, pair) in pairs.iter().enumerate() {
                            let pair_result = runner
                                .run_single_variant(
                                    &dda_request,
                                    variant_id,
                                    &[], // Channels not used for CT
                                    Some(&[*pair]), // Pass single pair
                                    None,
                                    Some(start_bound),
                                    Some(end_bound),
                                    edf_channel_names.as_deref(),
                                )
                                .await
                                .map_err(|e| {
                                    log::error!("CT pair {} failed: {}", pair_idx, e);
                                    StatusCode::INTERNAL_SERVER_ERROR
                                })?;

                            combined_ct_results.extend(pair_result.q_matrix);
                        }

                        // Create combined CT variant result
                        let variant_result = dda_rs::VariantResult {
                            variant_id: variant_id.to_string(),
                            variant_name: "Cross-Timeseries (CT)".to_string(),
                            q_matrix: combined_ct_results.clone(),
                            channel_labels: {
                                if let Some(names) = edf_channel_names.as_ref() {
                                    Some(
                                        pairs
                                            .iter()
                                            .map(|pair| {
                                                let ch1 = names.get(pair[0]).map(|s| s.as_str()).unwrap_or("?");
                                                let ch2 = names.get(pair[1]).map(|s| s.as_str()).unwrap_or("?");
                                                format!("{} ⟷ {}", ch1, ch2)
                                            })
                                            .collect(),
                                    )
                                } else {
                                    None
                                }
                            },
                        };
                        variant_results.push(variant_result);
                    } else {
                        log::warn!("Skipping CT variant: no channel pairs in config");
                    }
                }
                "CD" => {
                    // CD variant: run with directed channel pairs
                    if let Some(ref pairs) = config.cd_channel_pairs {
                        if pairs.is_empty() {
                            log::warn!("Skipping CD variant: no directed pairs configured");
                            continue;
                        }

                        log::info!("CD variant: {} directed pairs", pairs.len());

                        let variant_result = runner
                            .run_single_variant(
                                &dda_request,
                                variant_id,
                                &[], // Channels not used for CD
                                None,
                                Some(pairs.as_slice()),
                                Some(start_bound),
                                Some(end_bound),
                                edf_channel_names.as_deref(),
                            )
                            .await
                            .map_err(|e| {
                                log::error!("CD variant failed: {}", e);
                                StatusCode::INTERNAL_SERVER_ERROR
                            })?;

                        variant_results.push(variant_result);
                    } else {
                        log::warn!("Skipping CD variant: no directed pairs in config");
                    }
                }
                "ST" => {
                    // ST variant: run with selected channels (produces per-channel results)
                    if let Some(ref channels) = config.selected_channels {
                        if channels.is_empty() {
                            log::warn!("Skipping ST variant: no channels configured");
                            continue;
                        }

                        log::info!("ST variant: {} channels", channels.len());

                        let variant_result = runner
                            .run_single_variant(
                                &dda_request,
                                variant_id,
                                channels.as_slice(),
                                None,
                                None,
                                Some(start_bound),
                                Some(end_bound),
                                edf_channel_names.as_deref(),
                            )
                            .await
                            .map_err(|e| {
                                log::error!("ST variant failed: {}", e);
                                StatusCode::INTERNAL_SERVER_ERROR
                            })?;

                        variant_results.push(variant_result);
                    } else {
                        log::warn!("Skipping ST variant: no channels in config");
                    }
                }
                "DE" | "SY" => {
                    // DE and SY variants: run separately for each channel to get per-channel results
                    if let Some(ref channels) = config.selected_channels {
                        if channels.is_empty() {
                            log::warn!("Skipping {} variant: no channels configured", variant_id);
                            continue;
                        }

                        log::info!("{} variant: {} channels (running separately per channel)", variant_id, channels.len());

                        let mut combined_results: Vec<Vec<f64>> = Vec::new();

                        for (ch_idx, channel) in channels.iter().enumerate() {
                            let channel_result = runner
                                .run_single_variant(
                                    &dda_request,
                                    variant_id,
                                    &[*channel], // Run with single channel
                                    None,
                                    None,
                                    Some(start_bound),
                                    Some(end_bound),
                                    edf_channel_names.as_deref(),
                                )
                                .await
                                .map_err(|e| {
                                    log::error!("{} channel {} failed: {}", variant_id, ch_idx, e);
                                    StatusCode::INTERNAL_SERVER_ERROR
                                })?;

                            combined_results.extend(channel_result.q_matrix);
                        }

                        // Create combined variant result
                        let variant_result = dda_rs::VariantResult {
                            variant_id: variant_id.to_string(),
                            variant_name: match variant_id {
                                "DE" => "Dynamical Ergodicity (DE)".to_string(),
                                "SY" => "Synchronization (SY)".to_string(),
                                _ => variant_id.to_string(),
                            },
                            q_matrix: combined_results.clone(),
                            channel_labels: {
                                if let Some(names) = edf_channel_names.as_ref() {
                                    Some(
                                        channels
                                            .iter()
                                            .map(|&ch| {
                                                names.get(ch).map(|s| s.as_str()).unwrap_or("?").to_string()
                                            })
                                            .collect(),
                                    )
                                } else {
                                    None
                                }
                            },
                        };
                        variant_results.push(variant_result);
                    } else {
                        log::warn!("Skipping {} variant: no channels in config", variant_id);
                    }
                }
                _ => {
                    log::warn!("Unknown variant ID: {}", variant_id);
                }
            }
        }

        if variant_results.is_empty() {
            log::error!("No variant results produced");
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }

        // Use first variant as primary (for backward compatibility)
        let primary_variant = variant_results.first().unwrap();
        let analysis_id = Uuid::new_v4().to_string();

        dda_rs::DDAResult::new(
            analysis_id,
            request.file_path.clone(),
            primary_variant.channel_labels.clone().unwrap_or_else(|| {
                (0..primary_variant.q_matrix.len())
                    .map(|i| format!("Channel {}", i + 1))
                    .collect()
            }),
            primary_variant.q_matrix.clone(),
            dda_rs::WindowParameters {
                window_length: request.window_parameters.window_length as u32,
                window_step: request.window_parameters.window_step as u32,
                ct_window_length: request.window_parameters.ct_window_length.map(|v| v as u32),
                ct_window_step: request.window_parameters.ct_window_step.map(|v| v as u32),
            },
            dda_rs::ScaleParameters {
                scale_min: request.scale_parameters.scale_min as f64,
                scale_max: request.scale_parameters.scale_max as f64,
                scale_num: request.scale_parameters.scale_num as u32,
                delay_list: request.scale_parameters.delay_list.clone(),
            },
        )
        .with_variant_results(variant_results)
    } else {
        log::info!("📋 Using legacy format (all variants with same channels)");

        runner
            .run(
                &dda_request,
                Some(start_bound),
                Some(end_bound),
                edf_channel_names.as_deref(),
            )
            .await
            .map_err(|e| {
                log::error!("DDA analysis failed: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?
    };

    let dda_time = dda_start.elapsed();
    log::info!(
        "⏱️  [TIMING] DDA analysis completed in {:.2}s",
        dda_time.as_secs_f64()
    );

    let q_matrix = dda_result.q_matrix.clone();
    let analysis_id = dda_result.id.clone();

    let num_channels = q_matrix.len();
    let num_timepoints = q_matrix[0].len();

    log::info!(
        "Q matrix dimensions: {} channels × {} timepoints",
        num_channels,
        num_timepoints
    );

    let all_values: Vec<f64> = q_matrix
        .par_iter()
        .flat_map(|row| row.par_iter().copied())
        .collect();

    let input_edf_channels: Vec<String> = {
        let file_cache = state.files.read();
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
            log::warn!("File not in cache, cannot determine input EDF channel names");
            Vec::new()
        }
    };

    log::info!("Input EDF channels analyzed: {:?}", input_edf_channels);

    let channel_names: Vec<String> =
        if !input_edf_channels.is_empty() && input_edf_channels.len() == num_channels {
            input_edf_channels.clone()
        } else if !input_edf_channels.is_empty() {
            log::warn!(
                "Mismatch: {} EDF channels but {} Q matrix rows",
                input_edf_channels.len(),
                num_channels
            );
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
            log::warn!("No EDF channel names available, using generic labels");
            (0..num_channels)
                .map(|i| format!("Channel {}", i + 1))
                .collect()
        };

    log::info!("Output channel labels: {:?}", channel_names);

    // Log variant_configs if present
    if let Some(ref vc) = request.variant_configs {
        log::info!("📊 Received variant_configs: {}", serde_json::to_string_pretty(vc).unwrap_or_else(|_| "error serializing".to_string()));
    } else {
        log::info!("⚠️  No variant_configs received (using legacy format)");
    }

    let parameters = DDAParameters {
        variants: request.algorithm_selection.enabled_variants.clone(),
        window_length: request.window_parameters.window_length as u32,
        window_step: request.window_parameters.window_step as u32,
        selected_channels: channel_names.clone(),
        scale_min: request.scale_parameters.scale_min as f64,
        scale_max: request.scale_parameters.scale_max as f64,
        variant_configs: request.variant_configs.clone(),
    };

    let mut dda_matrix = serde_json::Map::new();
    for (i, channel_name) in channel_names.iter().enumerate() {
        dda_matrix.insert(channel_name.clone(), serde_json::json!(q_matrix[i]));
    }

    let scales: Vec<f64> = (0..num_timepoints).map(|i| i as f64 * 0.1).collect();

    let variants_array: Vec<serde_json::Value> = if let Some(ref variant_results) =
        dda_result.variant_results
    {
        variant_results
            .par_iter()
            .map(|vr| {
                let variant_channel_labels = vr.channel_labels.as_ref().unwrap_or(&channel_names);

                // DEBUG: Log variant details
                log::info!("[DEBUG] Processing variant {}:", vr.variant_id);
                log::info!("  Q matrix rows: {}", vr.q_matrix.len());
                log::info!("  Channel labels count: {}", variant_channel_labels.len());
                if !variant_channel_labels.is_empty() {
                    log::info!("  First 5 labels: {:?}", variant_channel_labels.iter().take(5).collect::<Vec<_>>());
                }

                let mut variant_dda_matrix = serde_json::Map::new();
                for (i, channel_label) in variant_channel_labels.iter().enumerate() {
                    if i < vr.q_matrix.len() {
                        variant_dda_matrix
                            .insert(channel_label.clone(), serde_json::json!(vr.q_matrix[i]));
                    }
                }

                log::info!("  DDA matrix keys added: {}", variant_dda_matrix.len());

                serde_json::json!({
                    "variant_id": map_variant_id_to_frontend(&vr.variant_id),
                    "variant_name": vr.variant_name.clone(),
                    "dda_matrix": variant_dda_matrix,
                    "exponents": serde_json::json!({}),
                    "quality_metrics": serde_json::json!({})
                })
            })
            .collect()
    } else {
        vec![serde_json::json!({
            "variant_id": "single_timeseries",
            "variant_name": "Single Timeseries (ST)",
            "dda_matrix": dda_matrix.clone(),
            "exponents": serde_json::json!({}),
            "quality_metrics": serde_json::json!({})
        })]
    };

    log::info!(
        "Built {} variant results for frontend",
        variants_array.len()
    );

    let results = serde_json::json!({
        "summary": {
            "total_windows": num_timepoints,
            "processed_windows": num_timepoints,
            "mean_complexity": calculate_mean(&all_values),
            "std_complexity": calculate_std(&all_values),
            "num_channels": num_channels
        },
        "timeseries": {
            "time": (0..num_timepoints).map(|i| i as f64 * 0.1).collect::<Vec<f64>>(),
            "complexity": q_matrix.clone()
        },
        "scales": scales,
        "variants": variants_array,
        "dda_matrix": dda_matrix.clone()
    });

    let plot_data = serde_json::json!({
        "time_series": {
            "x": (0..num_timepoints).map(|i| i as f64 * 0.1).collect::<Vec<f64>>(),
            "y": q_matrix.clone()
        }
    });

    let result = DDAResult {
        id: analysis_id.clone(),
        name: None,
        file_path: request.file_path,
        channels: channel_names,
        parameters,
        results,
        plot_data: Some(plot_data),
        q_matrix: Some(q_matrix.clone()),
        created_at: Utc::now().to_rfc3339(),
        status: "completed".to_string(),
    };

    {
        let mut analysis_cache = state.analysis_results.write();
        analysis_cache.insert(analysis_id, result.clone());
    }

    log::info!("⏱️  [TIMING] Saving result to disk...");
    let save_start = std::time::Instant::now();
    if let Err(e) = state.save_to_disk(&result) {
        log::error!("Failed to save analysis to disk: {}", e);
    }
    log::info!(
        "⏱️  [TIMING] Save completed in {:.2}s",
        save_start.elapsed().as_secs_f64()
    );

    log::info!(
        "⏱️  [TIMING] ✅ Total DDA analysis completed in {:.2}s",
        start_time.elapsed().as_secs_f64()
    );

    Ok(Json(result))
}

pub async fn get_dda_results(
    State(state): State<Arc<ApiState>>,
    Query(_params): Query<HashMap<String, String>>,
) -> Json<Vec<DDAResult>> {
    list_analysis_history(State(state)).await
}

pub async fn get_analysis_result(
    State(state): State<Arc<ApiState>>,
    Path(analysis_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if let Some(ref db) = state.analysis_db {
        match db.get_analysis(&analysis_id) {
            Ok(Some(analysis)) => {
                log::info!("✅ Retrieved analysis {} from SQLite database", analysis_id);

                if let Ok(parameters) =
                    serde_json::from_value::<DDAParameters>(analysis.parameters.clone())
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

                    let result = DDAResult {
                        id: analysis.id.clone(),
                        name: None,
                        file_path: analysis.file_path.clone(),
                        channels,
                        parameters,
                        results,
                        plot_data: analysis
                            .plot_data
                            .as_ref()
                            .and_then(|d| d.get("plot_data").cloned()),
                        q_matrix,
                        created_at: analysis.timestamp.clone(),
                        status,
                    };

                    let response = serde_json::json!({
                        "analysis": {
                            "id": result.id,
                            "result_id": result.id,
                            "analysis_data": result
                        }
                    });
                    return Ok(Json(response));
                }
            }
            Ok(None) => log::debug!("Analysis {} not found in database", analysis_id),
            Err(e) => log::error!("Failed to retrieve analysis from database: {}", e),
        }
    }

    let analysis_cache = state.analysis_results.read();
    if let Some(result) = analysis_cache.get(&analysis_id) {
        let response = serde_json::json!({
            "analysis": {
                "id": result.id,
                "result_id": result.id,
                "analysis_data": result
            }
        });
        Ok(Json(response))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

pub async fn get_analysis_status(
    State(state): State<Arc<ApiState>>,
    Path(analysis_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let analysis_cache = state.analysis_results.read();
    if let Some(result) = analysis_cache.get(&analysis_id) {
        Ok(Json(serde_json::json!({
            "id": analysis_id,
            "status": result.status,
            "created_at": result.created_at,
            "progress": 100
        })))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

pub async fn list_analysis_history(State(state): State<Arc<ApiState>>) -> Json<Vec<DDAResult>> {
    if let Some(ref db) = state.analysis_db {
        match db.get_recent_analyses(50) {
            Ok(analyses) => {
                log::info!(
                    "✅ Retrieved {} analyses from SQLite database",
                    analyses.len()
                );

                // CRITICAL FIX: plot_data is now None for list view (performance optimization)
                // We only need lightweight metadata for the history list
                let results: Vec<DDAResult> = analyses.iter().filter_map(|analysis| {
                    let parameters: DDAParameters = match serde_json::from_value(analysis.parameters.clone()) {
                        Ok(p) => p,
                        Err(e) => {
                            log::warn!("Failed to parse parameters for analysis {}: {}", analysis.id, e);
                            return None;
                        }
                    };

                    // For list view, use minimal data - no need to parse plot_data
                    // Channel count and variant count come from parameters
                    let channels = parameters.selected_channels.clone();

                    Some(DDAResult {
                        id: analysis.id.clone(),
                        name: analysis.name.clone(),
                        file_path: analysis.file_path.clone(),
                        channels, // Extract from parameters for display
                        parameters,
                        results: serde_json::json!({
                            "variants": [] // Empty for list view - populated when viewing
                        }),
                        plot_data: None, // No plot_data in list view
                        q_matrix: None,
                        created_at: analysis.timestamp.clone(),
                        status: "completed".to_string(),
                    })
                }).collect();

                return Json(results);
            }
            Err(e) => {
                log::error!("❌ Failed to retrieve analyses from database: {}", e);
            }
        }
    }

    log::warn!("⚠️ Using in-memory cache for analysis history");
    let analysis_cache = state.analysis_results.read();
    let mut results: Vec<DDAResult> = analysis_cache.values().cloned().collect();
    results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Json(results)
}

pub async fn save_analysis_to_history(
    State(_state): State<Arc<ApiState>>,
    Json(_payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "success": true,
        "status": "success"
    }))
}

pub async fn delete_analysis_result(
    State(state): State<Arc<ApiState>>,
    Path(analysis_id): Path<String>,
) -> StatusCode {
    if let Some(ref db) = state.analysis_db {
        match db.delete_analysis(&analysis_id) {
            Ok(_) => {
                log::info!("✅ Deleted analysis {} from SQLite database", analysis_id);

                let mut analysis_cache = state.analysis_results.write();
                analysis_cache.remove(&analysis_id);

                return StatusCode::NO_CONTENT;
            }
            Err(e) => {
                log::error!("❌ Failed to delete analysis from database: {}", e);
                return StatusCode::INTERNAL_SERVER_ERROR;
            }
        }
    }

    let mut analysis_cache = state.analysis_results.write();
    if analysis_cache.remove(&analysis_id).is_some() {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

pub async fn rename_analysis_result(
    State(state): State<Arc<ApiState>>,
    Path(analysis_id): Path<String>,
    Json(payload): Json<RenameAnalysisRequest>,
) -> Response {
    let trimmed_name = payload.name.trim();

    if trimmed_name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Invalid name",
                "message": "Analysis name cannot be empty"
            })),
        )
            .into_response();
    }

    if trimmed_name.len() > 200 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Invalid name",
                "message": "Analysis name must be 200 characters or less"
            })),
        )
            .into_response();
    }

    let sanitized_name: String = trimmed_name
        .chars()
        .filter(|c| !c.is_control() && *c != '\0')
        .collect();

    if sanitized_name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Invalid name",
                "message": "Analysis name contains only invalid characters"
            })),
        )
            .into_response();
    }

    if let Some(ref db) = state.analysis_db {
        match db.rename_analysis(&analysis_id, &sanitized_name) {
            Ok(_) => {
                log::info!(
                    "✅ Renamed analysis {} to '{}' in SQLite database",
                    analysis_id,
                    sanitized_name
                );

                return (
                    StatusCode::OK,
                    Json(json!({
                        "success": true
                    })),
                )
                    .into_response();
            }
            Err(e) => {
                log::error!("❌ Failed to rename analysis in database: {}", e);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "error": "Database error",
                        "message": format!("Failed to rename analysis: {}", e)
                    })),
                )
                    .into_response();
            }
        }
    }

    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "error": "Rename not supported",
            "message": "Analysis database not available"
        })),
    )
        .into_response()
}

fn get_dda_binary_path(state: &ApiState) -> Result<PathBuf, StatusCode> {
    if let Some(ref resolved_path) = state.dda_binary_path {
        return Ok(resolved_path.clone());
    }

    if let Ok(env_path) = std::env::var("DDA_BINARY_PATH") {
        return Ok(PathBuf::from(env_path));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap();

    let binary_name = if cfg!(target_os = "windows") {
        "run_DDA_AsciiEdf.exe"
    } else {
        "run_DDA_AsciiEdf"
    };

    let mut possible_paths = vec![
        repo_root.join("bin").join(binary_name),
        PathBuf::from("./bin").join(binary_name),
    ];

    // When running in a bundled app, resolve paths relative to the executable
    // This handles cases where the app is launched from a different working directory
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // On macOS: DDALAB.app/Contents/MacOS/DDALAB -> check ../Resources/
            // On Linux/Windows: check relative to exe directory
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

    // Add remaining fallback paths
    possible_paths.extend(vec![
        PathBuf::from("../Resources/bin").join(binary_name),
        PathBuf::from("../Resources").join(binary_name),
        PathBuf::from(".").join(binary_name),
        PathBuf::from("./resources/bin").join(binary_name),
        PathBuf::from("./resources").join(binary_name),
        PathBuf::from("/app/bin").join(binary_name),
    ]);

    for path in &possible_paths {
        // Canonicalize to resolve .. and . components, then check existence
        if let Ok(canonical_path) = path.canonicalize() {
            if canonical_path.exists() {
                log::info!("Found DDA binary at: {:?}", canonical_path);
                return Ok(canonical_path);
            }
        } else if path.exists() {
            // Fallback if canonicalize fails (e.g., for relative paths)
            log::info!("Found DDA binary at: {:?}", path);
            return Ok(path.clone());
        }
    }

    log::error!("DDA binary not found. Tried: {:?}", possible_paths);
    Err(StatusCode::INTERNAL_SERVER_ERROR)
}

fn generate_select_mask(enabled_variants: &[String]) -> String {
    // Check which variants are explicitly enabled
    // Format: ST CT CD RESERVED DE SY
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
    let reserved = "0"; // Reserved bit for internal development
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

fn convert_to_dda_request(api_req: &DDARequest) -> dda_rs::DDARequest {
    let select_mask = if api_req.algorithm_selection.select_mask.is_some() {
        log::info!(
            "Using provided SELECT mask: {:?}",
            api_req.algorithm_selection.select_mask
        );
        api_req.algorithm_selection.select_mask.clone()
    } else {
        let generated = Some(generate_select_mask(
            &api_req.algorithm_selection.enabled_variants,
        ));
        log::info!(
            "Generated SELECT mask: {:?} from variants: {:?}",
            generated,
            api_req.algorithm_selection.enabled_variants
        );
        generated
    };

    log::info!(
        "🎯 Final SELECT mask being passed to runner: {:?}",
        select_mask
    );

    let dda_request = dda_rs::DDARequest {
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
        scale_parameters: dda_rs::ScaleParameters {
            scale_min: api_req.scale_parameters.scale_min as f64,
            scale_max: api_req.scale_parameters.scale_max as f64,
            scale_num: api_req.scale_parameters.scale_num as u32,
            delay_list: api_req.scale_parameters.delay_list.clone(),
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
        variant_configs: None, // Not used by legacy run() method
    };

    dda_request
}

fn map_variant_id_to_frontend(variant_id: &str) -> String {
    match variant_id {
        "ST" => "single_timeseries".to_string(),
        "CT" => "cross_timeseries".to_string(),
        "CD" => "cross_dynamical".to_string(),
        "DE" => "delay_evolution".to_string(),
        "SY" => "synchronization".to_string(),
        _ => variant_id.to_lowercase().replace('-', "_"),
    }
}

fn calculate_mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.par_iter().sum::<f64>() / values.len() as f64
}

fn calculate_std(values: &[f64]) -> f64 {
    if values.len() < 2 {
        return 0.0;
    }
    let mean = calculate_mean(values);
    let variance = values.par_iter().map(|v| (v - mean).powi(2)).sum::<f64>() / values.len() as f64;
    variance.sqrt()
}
