use ddalab_tauri::api::models::{ChunkData, EDFFileInfo};
use ddalab_tauri::api::overview_generator::ProgressiveOverviewGenerator;
use ddalab_tauri::api::state::ApiState;
use ddalab_tauri::api::utils::{
    check_git_annex_symlink, create_file_info_result, generate_overview_with_file_reader,
    read_edf_file_chunk, FileType,
};
use ddalab_tauri::edf::EDFReader;
use ddalab_tauri::file_readers::{
    global_cache, FileReaderFactory, LazyReaderFactory, WindowRequest,
};
use ddalab_tauri::signal_processing::{preprocess_batch_owned, PreprocessingConfig};
use ddalab_tauri::text_reader::TextFileReader;
use futures_util::future;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

/// Preprocessing parameters for signal filtering
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreprocessingParams {
    pub highpass: Option<f64>,
    pub lowpass: Option<f64>,
    pub notch: Option<Vec<f64>>,
}

impl PreprocessingParams {
    fn is_enabled(&self) -> bool {
        self.highpass.is_some()
            || self.lowpass.is_some()
            || self.notch.as_ref().is_some_and(|v| !v.is_empty())
    }

    fn cache_key_suffix(&self) -> String {
        if !self.is_enabled() {
            return String::new();
        }
        let mut parts = Vec::new();
        if let Some(hp) = self.highpass {
            parts.push(format!("hp{}", hp));
        }
        if let Some(lp) = self.lowpass {
            parts.push(format!("lp{}", lp));
        }
        if let Some(ref notch) = self.notch {
            if !notch.is_empty() {
                parts.push(format!(
                    "n{}",
                    notch
                        .iter()
                        .map(|v| v.to_string())
                        .collect::<Vec<_>>()
                        .join("_")
                ));
            }
        }
        format!(":pp:{}", parts.join(","))
    }
}

/// Parameters for get_edf_chunk command
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetChunkParams {
    pub file_path: String,
    pub start_time: Option<f64>,
    pub duration: Option<f64>,
    pub chunk_start: Option<usize>,
    pub chunk_size: Option<usize>,
    pub channels: Option<Vec<String>>,
    #[serde(flatten)]
    pub preprocessing: Option<PreprocessingParams>,
}

/// Single chunk request within a batch
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchChunkRequest {
    pub chunk_start: usize,
    pub chunk_size: usize,
    pub channels: Option<Vec<String>>,
    #[serde(flatten)]
    pub preprocessing: Option<PreprocessingParams>,
}

/// Parameters for batched chunk fetching (multiple chunks from same file)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetChunksBatchParams {
    pub file_path: String,
    pub requests: Vec<BatchChunkRequest>,
}

/// Response for a single chunk in a batch
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchChunkResult {
    pub index: usize,
    pub success: bool,
    pub data: Option<ChunkData>,
    pub error: Option<String>,
}

/// Response for batched chunk fetching
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetChunksBatchResponse {
    pub results: Vec<BatchChunkResult>,
    pub total_requested: usize,
    pub total_succeeded: usize,
}

/// Parameters for get_edf_overview command
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetOverviewParams {
    pub file_path: String,
    pub max_points: Option<usize>,
    pub channels: Option<Vec<String>>,
}

/// Parameters for get_edf_window command
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetWindowParams {
    pub file_path: String,
    pub start_time: Option<f64>,
    pub duration: Option<f64>,
    pub channels: Option<Vec<String>>,
}

/// Response for window-based data access
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowData {
    pub data: Vec<Vec<f64>>,
    pub channel_labels: Vec<String>,
    pub sample_rate: f64,
    pub start_time_sec: f64,
    pub duration_sec: f64,
    pub num_samples: usize,
    pub from_cache: bool,
}

/// Cache statistics response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStatsResponse {
    pub num_windows: usize,
    pub total_size_bytes: usize,
    pub total_size_mb: f64,
    pub max_windows: usize,
    pub max_size_bytes: usize,
    pub max_size_mb: f64,
}

/// Progress response for overview computation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewProgressResponse {
    pub has_cache: bool,
    pub completion_percentage: f64,
    pub is_complete: bool,
}

/// Execute rich preprocessing pipeline on chunk data
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutePreprocessingPipelineRequest {
    pub chunk: ChunkData,
    /// Frontend preprocessing pipeline object from `types/preprocessing.ts`
    pub pipeline: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStepReport {
    pub step_type: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutePreprocessingPipelineResponse {
    pub chunk: ChunkData,
    pub bad_channels: Vec<String>,
    pub artifact_count: usize,
    pub step_reports: Vec<PipelineStepReport>,
    pub diagnostic_log: Vec<String>,
}

/// Get EDF/neurophysiology file information (channels, duration, sample rate)
#[tauri::command]
pub async fn get_edf_info(
    state: State<'_, Arc<ApiState>>,
    file_path: String,
) -> Result<EDFFileInfo, String> {
    log::info!("get_edf_info called for: {}", file_path);

    {
        let file_cache = state.files.read();
        if let Some(file_info) = file_cache.get(&file_path) {
            log::info!("Found in cache, channels: {:?}", file_info.channels.len());
            return Ok((*file_info).clone());
        }
    }

    let full_path = PathBuf::from(&file_path);
    log::info!("Attempting to load file: {:?}", full_path);

    let file_info = create_file_info_result(full_path)
        .await
        .map_err(|e| format!("{:?}", e))?;

    log::info!(
        "Created file info, channels: {:?}",
        file_info.channels.len()
    );

    let response = file_info.clone();
    {
        let mut file_cache = state.files.write();
        file_cache.insert(file_path, file_info);
    }
    Ok(response)
}

/// Get chunk data for visualization with optional preprocessing
#[tauri::command]
pub async fn get_edf_chunk(
    state: State<'_, Arc<ApiState>>,
    params: GetChunkParams,
) -> Result<ChunkData, String> {
    let file_path = &params.file_path;

    let path = std::path::Path::new(file_path);
    check_git_annex_symlink(path).map_err(|e| format!("{:?}", e))?;

    let preprocessing = params.preprocessing.clone().unwrap_or_default();

    let (start_time, duration, needs_sample_rate) = if let Some(chunk_start) = params.chunk_start {
        let chunk_size = params.chunk_size.unwrap_or(7680);
        (chunk_start as f64, chunk_size as f64, true)
    } else {
        let start_time = params.start_time.unwrap_or(0.0);
        let duration = params.duration.unwrap_or(30.0);
        (start_time, duration, false)
    };

    let selected_channels = params.channels.clone();

    let base_key = if let Some(ref channels) = selected_channels {
        format!(
            "{}:{}:{}:{}",
            file_path,
            start_time,
            duration,
            channels.join(",")
        )
    } else {
        format!("{}:{}:{}", file_path, start_time, duration)
    };
    let chunk_key = format!("{}{}", base_key, preprocessing.cache_key_suffix());

    {
        let chunk_cache = state.chunks_cache.read();
        if let Some(chunk) = chunk_cache.get(&chunk_key) {
            return Ok((*chunk).clone());
        }
    }

    let file_path_clone = file_path.clone();
    let chunk = tokio::task::spawn_blocking(move || -> Result<ChunkData, String> {
        let path = std::path::Path::new(&file_path_clone);
        if !path.exists() {
            return Err(format!("File not found: {}", file_path_clone));
        }

        match FileType::from_path(path) {
            FileType::CSV => {
                log::info!("Reading CSV file: {}", file_path_clone);
                let reader = TextFileReader::from_csv(path).map_err(|e| {
                    log::error!("Failed to parse CSV file '{}': {}", file_path_clone, e);
                    e
                })?;
                read_text_file_chunk(
                    reader,
                    &file_path_clone,
                    start_time,
                    duration,
                    needs_sample_rate,
                    selected_channels,
                )
            }
            FileType::ASCII => {
                log::info!("Reading ASCII file: {}", file_path_clone);
                let reader = TextFileReader::from_ascii(path).map_err(|e| {
                    log::error!("Failed to parse ASCII file '{}': {}", file_path_clone, e);
                    e
                })?;
                read_text_file_chunk(
                    reader,
                    &file_path_clone,
                    start_time,
                    duration,
                    needs_sample_rate,
                    selected_channels,
                )
            }
            FileType::EDF => read_edf_file_chunk(
                path,
                &file_path_clone,
                start_time,
                duration,
                needs_sample_rate,
                selected_channels,
            ),
            FileType::FIF | FileType::BrainVision | FileType::EEGLAB => {
                log::info!("Reading file using modular reader: {}", file_path_clone);
                read_chunk_with_file_reader(
                    path,
                    &file_path_clone,
                    start_time,
                    duration,
                    needs_sample_rate,
                    selected_channels,
                )
            }
            FileType::MEG => Err(format!(
                "MEG files are not yet supported for analysis: {}",
                file_path_clone
            )),
            FileType::Unknown => Err(format!("Unknown file type: {}", file_path_clone)),
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| format!("File reading error: {}", e))?;

    let processed_chunk = if preprocessing.is_enabled() {
        let (processed, _) = apply_preprocessing_to_chunk(chunk, &preprocessing)?;
        processed
    } else {
        chunk
    };

    let chunk_arc = Arc::new(processed_chunk);
    {
        let mut chunk_cache = state.chunks_cache.write();
        chunk_cache.insert_arc(chunk_key, Arc::clone(&chunk_arc));
    }

    Ok((*chunk_arc).clone())
}

/// Execute rich preprocessing pipeline against an already-loaded chunk.
/// This bridges the frontend pipeline model to backend execution.
#[tauri::command]
pub async fn execute_preprocessing_pipeline(
    request: ExecutePreprocessingPipelineRequest,
) -> Result<ExecutePreprocessingPipelineResponse, String> {
    let mut chunk = request.chunk;
    let mut step_reports = Vec::new();
    let mut bad_channels = Vec::new();
    let mut artifact_count = 0usize;
    let run_id = chrono::Utc::now().to_rfc3339();
    let mut diagnostic_log = vec![
        format!("run_id={}", run_id),
        format!("start: {}", format_chunk_summary(&chunk)),
    ];

    let steps = request
        .pipeline
        .get("steps")
        .and_then(|v| v.as_object())
        .ok_or("Invalid preprocessing pipeline: missing steps")?;

    if let Some(step) = steps.get("badChannelDetection") {
        let enabled = step
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if enabled {
            bad_channels = detect_bad_channels(&chunk, step.get("config"));
            step_reports.push(PipelineStepReport {
                step_type: "bad_channel_detection".to_string(),
                status: "completed".to_string(),
                details: Some(format!("Detected {} bad channels", bad_channels.len())),
            });
            diagnostic_log.push(format!(
                "bad_channel_detection: detected={} [{}]",
                bad_channels.len(),
                bad_channels.join(", ")
            ));
        } else {
            step_reports.push(PipelineStepReport {
                step_type: "bad_channel_detection".to_string(),
                status: "skipped".to_string(),
                details: Some("Step disabled".to_string()),
            });
            diagnostic_log.push("bad_channel_detection: skipped".to_string());
        }
    }

    if let Some(step) = steps.get("filtering") {
        let enabled = step
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if enabled {
            let filter_params = extract_filter_params(step.get("config"));
            if filter_params.is_enabled() {
                diagnostic_log.push(format!(
                    "filtering: hp={:?}, lp={:?}, notch={:?}",
                    filter_params.highpass, filter_params.lowpass, filter_params.notch
                ));
                let (filtered_chunk, filter_details) =
                    apply_preprocessing_to_chunk(chunk, &filter_params)?;
                chunk = filtered_chunk;
                step_reports.push(PipelineStepReport {
                    step_type: "filtering".to_string(),
                    status: "completed".to_string(),
                    details: Some("Applied backend filtering".to_string()),
                });
                for detail in filter_details {
                    diagnostic_log.push(format!("filtering_detail: {}", detail));
                }
                diagnostic_log.push(format!("after_filtering: {}", format_chunk_summary(&chunk)));
            } else {
                step_reports.push(PipelineStepReport {
                    step_type: "filtering".to_string(),
                    status: "skipped".to_string(),
                    details: Some("No active filters in config".to_string()),
                });
                diagnostic_log.push("filtering: skipped (no active filters)".to_string());
            }
        } else {
            step_reports.push(PipelineStepReport {
                step_type: "filtering".to_string(),
                status: "skipped".to_string(),
                details: Some("Step disabled".to_string()),
            });
            diagnostic_log.push("filtering: skipped".to_string());
        }
    }

    if let Some(step) = steps.get("rereference") {
        let enabled = step
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if enabled {
            let ref_type = step
                .get("config")
                .and_then(|cfg| cfg.get("type"))
                .and_then(|v| v.as_str())
                .unwrap_or("none");
            diagnostic_log.push(format!(
                "rereference: type={}, channels={}",
                ref_type,
                chunk.data.len()
            ));

            if matches!(ref_type, "average" | "laplacian") && chunk.data.len() < 2 {
                step_reports.push(PipelineStepReport {
                    step_type: "rereference".to_string(),
                    status: "skipped".to_string(),
                    details: Some(
                        "Average/Laplacian rereference requires at least 2 channels".to_string(),
                    ),
                });
                diagnostic_log.push(
                    "rereference: skipped (average/laplacian requires >=2 channels)".to_string(),
                );
            } else {
                apply_rereference_step(&mut chunk, step.get("config"))?;
                step_reports.push(PipelineStepReport {
                    step_type: "rereference".to_string(),
                    status: "completed".to_string(),
                    details: Some("Applied rereferencing transform".to_string()),
                });
                diagnostic_log.push(format!(
                    "after_rereference: {}",
                    format_chunk_summary(&chunk)
                ));
            }
        } else {
            step_reports.push(PipelineStepReport {
                step_type: "rereference".to_string(),
                status: "skipped".to_string(),
                details: Some("Step disabled".to_string()),
            });
            diagnostic_log.push("rereference: skipped".to_string());
        }
    }

    if let Some(step) = steps.get("ica") {
        let enabled = step
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if enabled {
            step_reports.push(PipelineStepReport {
                step_type: "ica".to_string(),
                status: "skipped".to_string(),
                details: Some(
                    "ICA requires full-dataset execution; use submit_ica_analysis for this step"
                        .to_string(),
                ),
            });
            diagnostic_log.push("ica: requested but skipped (chunk mode)".to_string());
        } else {
            step_reports.push(PipelineStepReport {
                step_type: "ica".to_string(),
                status: "skipped".to_string(),
                details: Some("Step disabled".to_string()),
            });
            diagnostic_log.push("ica: skipped".to_string());
        }
    }

    if let Some(step) = steps.get("artifactRemoval") {
        let enabled = step
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if enabled {
            artifact_count = apply_artifact_removal_step(&mut chunk, step.get("config"));
            let total_points = chunk
                .data
                .first()
                .map(|ch| ch.len())
                .unwrap_or(0)
                .saturating_mul(chunk.data.len());
            let masked_pct = if total_points > 0 {
                (artifact_count as f64 / total_points as f64) * 100.0
            } else {
                0.0
            };
            step_reports.push(PipelineStepReport {
                step_type: "artifact_removal".to_string(),
                status: "completed".to_string(),
                details: Some(format!("Processed {} artifact samples", artifact_count)),
            });
            diagnostic_log.push(format!(
                "artifact_removal: action={} detectors={} masked={}/{} ({:.2}%)",
                step.get("config")
                    .and_then(|cfg| cfg.get("action"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("mark"),
                describe_artifact_detectors(step.get("config")),
                artifact_count,
                total_points,
                masked_pct
            ));
            diagnostic_log.push(format!(
                "after_artifact_removal: {}",
                format_chunk_summary(&chunk)
            ));
        } else {
            step_reports.push(PipelineStepReport {
                step_type: "artifact_removal".to_string(),
                status: "skipped".to_string(),
                details: Some("Step disabled".to_string()),
            });
            diagnostic_log.push("artifact_removal: skipped".to_string());
        }
    }

    diagnostic_log.push(format!("end: {}", format_chunk_summary(&chunk)));
    for line in &diagnostic_log {
        log::info!("pipeline_diagnostic {}", line);
    }

    Ok(ExecutePreprocessingPipelineResponse {
        chunk,
        bad_channels,
        artifact_count,
        step_reports,
        diagnostic_log,
    })
}

/// Get multiple chunks in a single IPC call (batched for efficiency)
/// This reduces IPC overhead when fetching multiple contiguous or nearby chunks
#[tauri::command]
pub async fn get_edf_chunks_batch(
    state: State<'_, Arc<ApiState>>,
    params: GetChunksBatchParams,
) -> Result<GetChunksBatchResponse, String> {
    let file_path = params.file_path.clone();
    let path = std::path::Path::new(&file_path);

    check_git_annex_symlink(path).map_err(|e| format!("{:?}", e))?;

    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let total_requested = params.requests.len();
    let mut results: Vec<BatchChunkResult> = Vec::with_capacity(total_requested);
    let mut total_succeeded = 0;

    // Check cache for all requests first
    let mut cache_hits: Vec<(usize, ChunkData)> = Vec::new();
    let mut cache_misses: Vec<(usize, &BatchChunkRequest)> = Vec::new();

    {
        let chunk_cache = state.chunks_cache.read();
        for (index, request) in params.requests.iter().enumerate() {
            let preprocessing = request.preprocessing.clone().unwrap_or_default();
            let base_key = if let Some(ref channels) = request.channels {
                format!(
                    "{}:{}:{}:{}",
                    file_path,
                    request.chunk_start,
                    request.chunk_size,
                    channels.join(",")
                )
            } else {
                format!(
                    "{}:{}:{}",
                    file_path, request.chunk_start, request.chunk_size
                )
            };
            let chunk_key = format!("{}{}", base_key, preprocessing.cache_key_suffix());

            if let Some(chunk) = chunk_cache.get(&chunk_key) {
                cache_hits.push((index, (*chunk).clone()));
            } else {
                cache_misses.push((index, request));
            }
        }
    }

    log::info!(
        "[BATCH] Processing {} requests: {} cache hits, {} cache misses",
        total_requested,
        cache_hits.len(),
        cache_misses.len()
    );

    // Process cache hits
    for (index, chunk) in cache_hits {
        results.push(BatchChunkResult {
            index,
            success: true,
            data: Some(chunk),
            error: None,
        });
        total_succeeded += 1;
    }

    // Process cache misses in parallel using tokio tasks
    if !cache_misses.is_empty() {
        let file_path_arc = Arc::new(file_path.clone());
        let state_arc = Arc::clone(&state);

        let futures: Vec<_> = cache_misses
            .into_iter()
            .map(|(index, request)| {
                let file_path = Arc::clone(&file_path_arc);
                let state = Arc::clone(&state_arc);
                let request = request.clone();

                async move {
                    let preprocessing = request.preprocessing.clone().unwrap_or_default();
                    let chunk_start = request.chunk_start;
                    let chunk_size = request.chunk_size;
                    let selected_channels = request.channels.clone();

                    // Generate cache key
                    let base_key = if let Some(ref channels) = selected_channels {
                        format!(
                            "{}:{}:{}:{}",
                            file_path,
                            chunk_start,
                            chunk_size,
                            channels.join(",")
                        )
                    } else {
                        format!("{}:{}:{}", file_path, chunk_start, chunk_size)
                    };
                    let chunk_key = format!("{}{}", base_key, preprocessing.cache_key_suffix());

                    // Read chunk
                    let file_path_clone = (*file_path).clone();
                    let chunk_result =
                        tokio::task::spawn_blocking(move || -> Result<ChunkData, String> {
                            let path = std::path::Path::new(&file_path_clone);

                            match FileType::from_path(path) {
                                FileType::CSV => {
                                    let reader = TextFileReader::from_csv(path)?;
                                    read_text_file_chunk(
                                        reader,
                                        &file_path_clone,
                                        chunk_start as f64,
                                        chunk_size as f64,
                                        true,
                                        selected_channels,
                                    )
                                }
                                FileType::ASCII => {
                                    let reader = TextFileReader::from_ascii(path)?;
                                    read_text_file_chunk(
                                        reader,
                                        &file_path_clone,
                                        chunk_start as f64,
                                        chunk_size as f64,
                                        true,
                                        selected_channels,
                                    )
                                }
                                FileType::EDF => read_edf_file_chunk(
                                    path,
                                    &file_path_clone,
                                    chunk_start as f64,
                                    chunk_size as f64,
                                    true,
                                    selected_channels,
                                ),
                                FileType::FIF | FileType::BrainVision | FileType::EEGLAB => {
                                    read_chunk_with_file_reader(
                                        path,
                                        &file_path_clone,
                                        chunk_start as f64,
                                        chunk_size as f64,
                                        true,
                                        selected_channels,
                                    )
                                }
                                FileType::MEG => Err(format!(
                                    "MEG files are not yet supported for analysis: {}",
                                    file_path_clone
                                )),
                                FileType::Unknown => {
                                    Err(format!("Unknown file type: {}", file_path_clone))
                                }
                            }
                        })
                        .await;

                    match chunk_result {
                        Ok(Ok(chunk)) => {
                            // Apply preprocessing if needed
                            let processed_chunk = if preprocessing.is_enabled() {
                                match apply_preprocessing_to_chunk(chunk, &preprocessing) {
                                    Ok((c, _)) => c,
                                    Err(e) => return (index, Err(e)),
                                }
                            } else {
                                chunk
                            };

                            // Cache the result
                            let chunk_arc = Arc::new(processed_chunk.clone());
                            {
                                let mut chunk_cache = state.chunks_cache.write();
                                chunk_cache.insert_arc(chunk_key, chunk_arc);
                            }

                            (index, Ok(processed_chunk))
                        }
                        Ok(Err(e)) => (index, Err(e)),
                        Err(e) => (index, Err(format!("Task join error: {}", e))),
                    }
                }
            })
            .collect();

        // Execute all futures concurrently
        let batch_results = future::join_all(futures).await;

        for (index, result) in batch_results {
            match result {
                Ok(chunk) => {
                    results.push(BatchChunkResult {
                        index,
                        success: true,
                        data: Some(chunk),
                        error: None,
                    });
                    total_succeeded += 1;
                }
                Err(e) => {
                    results.push(BatchChunkResult {
                        index,
                        success: false,
                        data: None,
                        error: Some(e),
                    });
                }
            }
        }
    }

    // Sort results by index to maintain request order
    results.sort_by_key(|r| r.index);

    log::info!(
        "[BATCH] Completed: {}/{} succeeded",
        total_succeeded,
        total_requested
    );

    Ok(GetChunksBatchResponse {
        results,
        total_requested,
        total_succeeded,
    })
}

/// Get downsampled overview data for file visualization (minimap)
#[tauri::command]
pub async fn get_edf_overview(
    state: State<'_, Arc<ApiState>>,
    params: GetOverviewParams,
) -> Result<ChunkData, String> {
    let file_path = &params.file_path;
    let max_points = params.max_points.unwrap_or(2000);
    let selected_channels = params.channels.clone();

    let path = std::path::Path::new(file_path);

    check_git_annex_symlink(path).map_err(|e| format!("{:?}", e))?;

    if !path.exists() {
        log::error!("[OVERVIEW] File not found: {}", file_path);
        return Err(format!("File not found: {}", file_path));
    }

    let file_type = FileType::from_path(path);

    if matches!(file_type, FileType::EDF) {
        if let Some(ref cache_db) = state.overview_cache_db {
            log::info!(
                "[OVERVIEW] Using progressive cache for EDF file: {}",
                file_path
            );

            let generator = ProgressiveOverviewGenerator::new(cache_db.clone());
            let file_path_clone = file_path.to_string();
            let selected_channels_clone = selected_channels.clone();

            let chunk = generator
                .generate_overview(&file_path_clone, max_points, selected_channels_clone, None)
                .await
                .map_err(|e| {
                    log::error!("[OVERVIEW] Progressive generation failed: {}", e);
                    e
                })?;

            return Ok(chunk);
        } else {
            log::warn!(
                "[OVERVIEW] Cache database not available, falling back to legacy generation"
            );
        }
    }

    let cache_key = if let Some(ref channels) = selected_channels {
        format!(
            "overview:{}:{}:{}",
            file_path,
            max_points,
            channels.join(",")
        )
    } else {
        format!("overview:{}:{}", file_path, max_points)
    };

    {
        let chunk_cache = state.chunks_cache.read();
        if let Some(chunk) = chunk_cache.get(&cache_key) {
            log::info!("[OVERVIEW] In-memory cache HIT for {}", file_path);
            return Ok((*chunk).clone());
        }
    }

    log::info!(
        "[OVERVIEW] Generating overview for {} with max_points={}",
        file_path,
        max_points
    );

    let file_path_clone = file_path.clone();
    let chunk = tokio::task::spawn_blocking(move || -> Result<ChunkData, String> {
        let path = std::path::Path::new(&file_path_clone);

        match FileType::from_path(path) {
            FileType::CSV => {
                let reader = TextFileReader::from_csv(path)?;
                generate_text_file_overview(reader, &file_path_clone, max_points, selected_channels)
            }
            FileType::ASCII => {
                let reader = TextFileReader::from_ascii(path)?;
                generate_text_file_overview(reader, &file_path_clone, max_points, selected_channels)
            }
            FileType::EDF => {
                generate_edf_file_overview(path, &file_path_clone, max_points, selected_channels)
            }
            FileType::FIF | FileType::BrainVision | FileType::EEGLAB => {
                log::info!(
                    "Generating overview using modular reader: {}",
                    file_path_clone
                );
                generate_overview_with_file_reader(path, max_points, selected_channels)
            }
            FileType::MEG => Err(format!(
                "MEG files are not yet supported for analysis: {}",
                file_path_clone
            )),
            FileType::Unknown => Err(format!("Unknown file type: {}", file_path_clone)),
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| format!("Failed to generate overview: {}", e))?;

    let chunk_arc = Arc::new(chunk);
    {
        let mut chunk_cache = state.chunks_cache.write();
        chunk_cache.insert_arc(cache_key, Arc::clone(&chunk_arc));
    }

    Ok((*chunk_arc).clone())
}

/// Get overview computation progress
#[tauri::command]
pub async fn get_edf_overview_progress(
    state: State<'_, Arc<ApiState>>,
    file_path: String,
    max_points: Option<usize>,
    channels: Option<Vec<String>>,
) -> Result<OverviewProgressResponse, String> {
    let path = std::path::Path::new(&file_path);
    check_git_annex_symlink(path).map_err(|e| format!("{:?}", e))?;

    let max_points = max_points.unwrap_or(2000);

    if let Some(cache_db) = state.overview_cache_db.as_ref() {
        let channels_json = if let Some(ref selected) = channels {
            serde_json::to_string(selected).unwrap_or_default()
        } else {
            String::new()
        };

        let cache_db = cache_db.clone();
        let file_path_clone = file_path.to_string();
        let channels_json_clone = channels_json.clone();

        match tokio::task::spawn_blocking(move || {
            cache_db.query_progress(&file_path_clone, max_points, &channels_json_clone)
        })
        .await
        {
            Ok(Ok(Some(result))) => {
                let has_cache = result
                    .get("has_cache")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let completion_percentage = result
                    .get("completion_percentage")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let is_complete = result
                    .get("is_complete")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                return Ok(OverviewProgressResponse {
                    has_cache,
                    completion_percentage,
                    is_complete,
                });
            }
            Ok(Ok(None)) => {}
            Ok(Err(e)) => {
                log::warn!("[PROGRESS] Error querying cache: {}", e);
            }
            Err(e) => {
                log::error!("[PROGRESS] Join error: {}", e);
            }
        }
    }

    Ok(OverviewProgressResponse {
        has_cache: false,
        completion_percentage: 0.0,
        is_complete: false,
    })
}

/// Get lazy-loaded time window for large files (100GB+)
#[tauri::command]
pub async fn get_edf_window(params: GetWindowParams) -> Result<WindowData, String> {
    let file_path = &params.file_path;
    let path = std::path::Path::new(file_path);

    check_git_annex_symlink(path).map_err(|e| format!("{:?}", e))?;

    if !LazyReaderFactory::supports_lazy_reading(path) {
        return Err(format!(
            "Lazy reading not supported for file type: {}",
            path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("unknown")
        ));
    }

    let start_time = params.start_time.unwrap_or(0.0);
    let duration = params.duration.unwrap_or(30.0);
    let channels = params.channels.clone();

    let reader = LazyReaderFactory::create_reader(path)
        .map_err(|e| format!("Failed to create lazy reader: {}", e))?;

    let mut request = WindowRequest::new(start_time, duration);
    if let Some(ch) = channels {
        request = request.with_channels(ch);
    }

    let cache = global_cache();

    let metadata = reader
        .metadata()
        .map_err(|e| format!("Failed to read metadata: {}", e))?;

    let channels_for_key = request
        .channels
        .clone()
        .unwrap_or_else(|| metadata.channels.clone());

    use ddalab_tauri::file_readers::WindowKey;
    let key = WindowKey::new(file_path, start_time, duration, &channels_for_key);
    let from_cache = cache.get(&key).is_some();

    let window = reader
        .read_window_cached(&request, cache)
        .map_err(|e| format!("Failed to read window: {}", e))?;

    Ok(WindowData {
        data: window.data.clone(),
        channel_labels: window.channel_labels.clone(),
        sample_rate: window.sample_rate,
        start_time_sec: window.start_time_sec,
        duration_sec: window.duration_sec,
        num_samples: window.num_samples,
        from_cache,
    })
}

/// Get cache statistics for the lazy file reader
#[tauri::command]
pub fn get_edf_cache_stats() -> CacheStatsResponse {
    let cache = global_cache();
    let stats = cache.stats();

    CacheStatsResponse {
        num_windows: stats.num_windows,
        total_size_bytes: stats.total_size_bytes,
        total_size_mb: stats.total_size_bytes as f64 / (1024.0 * 1024.0),
        max_windows: stats.max_windows,
        max_size_bytes: stats.max_size_bytes,
        max_size_mb: stats.max_size_bytes as f64 / (1024.0 * 1024.0),
    }
}

/// Clear the lazy file reader cache
#[tauri::command]
pub fn clear_edf_cache() -> serde_json::Value {
    let cache = global_cache();
    cache.clear();

    serde_json::json!({
        "status": "ok",
        "message": "Cache cleared successfully"
    })
}

fn read_chunk_with_file_reader(
    path: &std::path::Path,
    file_path: &str,
    start_time: f64,
    duration: f64,
    needs_sample_rate: bool,
    channels: Option<Vec<String>>,
) -> Result<ChunkData, String> {
    let start_total = std::time::Instant::now();

    let start = std::time::Instant::now();
    let reader = FileReaderFactory::create_reader(path)
        .map_err(|e| format!("Failed to create file reader: {}", e))?;
    log::warn!("FileReaderFactory::create_reader: {:?}", start.elapsed());

    let metadata = reader
        .metadata()
        .map_err(|e| format!("Failed to read metadata: {}", e))?;

    let sample_rate = metadata.sample_rate;

    let (start_sample, num_samples) = if needs_sample_rate {
        (start_time as usize, duration as usize)
    } else {
        (
            (start_time * sample_rate) as usize,
            (duration * sample_rate) as usize,
        )
    };

    if start_sample >= metadata.num_samples {
        log::warn!(
            "Request beyond file end: start_sample={}, file_samples={}, start_time={:.2}s, duration={:.2}s, sample_rate={:.2}Hz",
            start_sample, metadata.num_samples, start_time, duration, sample_rate
        );

        let returned_channels = if let Some(selected) = &channels {
            selected.clone()
        } else {
            metadata.channels.clone()
        };

        let empty_data = vec![vec![]; returned_channels.len()];

        return Ok(ChunkData {
            data: empty_data,
            channel_labels: returned_channels,
            sampling_frequency: sample_rate,
            chunk_size: 0,
            chunk_start: 0,
            total_samples: Some(metadata.num_samples as u64),
        });
    }

    let num_samples = num_samples.min(metadata.num_samples - start_sample);

    log::info!(
        "Reading chunk: start_sample={}, num_samples={}, start_time={:.2}s, duration={:.2}s",
        start_sample,
        num_samples,
        start_time,
        duration
    );

    let channel_names = channels.as_ref().map(|v| v.as_slice());
    let data = reader
        .read_chunk(start_sample, num_samples, channel_names)
        .map_err(|e| format!("Failed to read chunk: {}", e))?;

    let returned_channels = if let Some(selected) = &channels {
        selected.clone()
    } else {
        metadata.channels
    };

    let chunk_size = if !data.is_empty() { data[0].len() } else { 0 };

    let result = ChunkData {
        data,
        channel_labels: returned_channels,
        sampling_frequency: sample_rate,
        chunk_size,
        chunk_start: start_sample,
        total_samples: Some(metadata.num_samples as u64),
    };

    log::warn!(
        "read_chunk_with_file_reader TOTAL: {:?}",
        start_total.elapsed()
    );
    Ok(result)
}

fn read_text_file_chunk(
    reader: TextFileReader,
    file_path_clone: &str,
    start_time: f64,
    duration: f64,
    needs_sample_rate: bool,
    selected_channels: Option<Vec<String>>,
) -> Result<ChunkData, String> {
    let all_channel_labels = &reader.info.channel_labels;

    if all_channel_labels.is_empty() {
        return Err(format!("No channels found in file '{}'", file_path_clone));
    }

    let (channels_to_read, channel_labels): (Vec<usize>, Vec<String>) = if let Some(ref selected) =
        selected_channels
    {
        let mut indices = Vec::new();
        let mut labels = Vec::new();

        for channel_name in selected {
            if let Some(idx) = all_channel_labels
                .iter()
                .position(|label| label == channel_name)
            {
                indices.push(idx);
                labels.push(channel_name.clone());
            } else {
                log::warn!("Channel '{}' not found in file", channel_name);
            }
        }

        if indices.is_empty() {
            let num_fallback_channels = all_channel_labels.len().min(10);
            log::warn!("[CHUNK] None of the selected channels found in text file, falling back to first {} channels", num_fallback_channels);
            (
                (0..num_fallback_channels).collect(),
                all_channel_labels
                    .iter()
                    .take(num_fallback_channels)
                    .cloned()
                    .collect(),
            )
        } else {
            (indices, labels)
        }
    } else {
        (
            (0..all_channel_labels.len()).collect(),
            all_channel_labels.clone(),
        )
    };

    let sample_rate = 1.0;

    let (start_sample, num_samples) = if needs_sample_rate {
        (start_time as usize, duration as usize)
    } else {
        (
            (start_time * sample_rate) as usize,
            (duration * sample_rate) as usize,
        )
    };

    log::info!(
        "Reading chunk from '{}': start_sample={}, num_samples={}, channels={:?}",
        file_path_clone,
        start_sample,
        num_samples,
        channel_labels
    );

    let data = reader.read_window(start_sample, num_samples, &channels_to_read)?;

    let chunk_size = data.first().map(|v| v.len()).unwrap_or(0);

    log::info!(
        "Read {} channels, {} samples per channel",
        data.len(),
        chunk_size
    );

    Ok(ChunkData {
        data,
        channel_labels,
        sampling_frequency: sample_rate,
        chunk_size,
        chunk_start: start_sample,
        total_samples: Some(reader.info.num_samples as u64),
    })
}

fn generate_edf_file_overview(
    path: &std::path::Path,
    file_path: &str,
    max_points: usize,
    selected_channels: Option<Vec<String>>,
) -> Result<ChunkData, String> {
    let mut edf = EDFReader::new(path).map_err(|e| format!("Failed to open EDF file: {}", e))?;

    let channels_to_read: Vec<usize>;
    let channel_labels: Vec<String>;

    if let Some(ref selected) = selected_channels {
        let filtered_channels: Vec<usize> = selected
            .iter()
            .filter_map(|name| {
                edf.signal_headers
                    .iter()
                    .position(|h| h.label.trim() == name.trim())
            })
            .collect();

        if filtered_channels.is_empty() {
            let num_fallback_channels = edf.signal_headers.len().min(10);
            log::warn!("[OVERVIEW] None of the selected channels found in EDF file, falling back to first {} channels", num_fallback_channels);
            channels_to_read = (0..num_fallback_channels).collect();
            channel_labels = edf
                .signal_headers
                .iter()
                .take(num_fallback_channels)
                .map(|h| h.label.trim().to_string())
                .collect();
        } else {
            channels_to_read = filtered_channels;
            channel_labels = channels_to_read
                .iter()
                .map(|&idx| edf.signal_headers[idx].label.trim().to_string())
                .collect();
        }
    } else {
        channels_to_read = (0..edf.signal_headers.len()).collect();
        channel_labels = edf
            .signal_headers
            .iter()
            .map(|h| h.label.trim().to_string())
            .collect();
    }

    if channels_to_read.is_empty() {
        return Err("No valid channels found".to_string());
    }

    let sample_rate = edf.signal_headers[channels_to_read[0]]
        .sample_frequency(edf.header.duration_of_data_record);
    let duration = edf.header.num_data_records as f64 * edf.header.duration_of_data_record;
    let total_samples = (duration * sample_rate) as usize;

    log::info!(
        "[OVERVIEW] File: '{}', duration={:.2}s, total_samples={}, max_points={}",
        file_path,
        duration,
        total_samples,
        max_points
    );

    let downsample_ratio = (total_samples as f64 / max_points as f64).ceil() as usize;
    let bucket_size = downsample_ratio.max(1);

    log::info!(
        "[OVERVIEW] Using min-max downsampling with bucket_size={}",
        bucket_size
    );

    let mut downsampled_data: Vec<Vec<f64>> = Vec::new();

    for &signal_idx in &channels_to_read {
        let full_data = edf.read_signal_window(signal_idx, 0.0, duration)?;

        let mut channel_downsampled = Vec::with_capacity(max_points * 2);

        for chunk in full_data.chunks(bucket_size) {
            if chunk.is_empty() {
                continue;
            }

            let min_val = chunk.iter().copied().fold(f64::INFINITY, f64::min);
            let max_val = chunk.iter().copied().fold(f64::NEG_INFINITY, f64::max);

            channel_downsampled.push(min_val);
            channel_downsampled.push(max_val);
        }

        downsampled_data.push(channel_downsampled);
    }

    let result_size = downsampled_data.first().map(|v| v.len()).unwrap_or(0);

    log::info!(
        "[OVERVIEW] Generated overview: {} channels, {} points per channel ({}% of original)",
        downsampled_data.len(),
        result_size,
        (result_size as f64 / total_samples as f64 * 100.0) as i32
    );

    Ok(ChunkData {
        data: downsampled_data,
        channel_labels,
        sampling_frequency: sample_rate,
        chunk_size: result_size,
        chunk_start: 0,
        total_samples: Some(total_samples as u64),
    })
}

fn generate_text_file_overview(
    reader: TextFileReader,
    file_path: &str,
    max_points: usize,
    selected_channels: Option<Vec<String>>,
) -> Result<ChunkData, String> {
    let sample_rate = 1.0;
    let total_samples = reader.info.num_samples;

    let channels_to_read: Vec<usize>;
    let channel_labels: Vec<String>;

    if let Some(ref selected) = selected_channels {
        let filtered_channels: Vec<usize> = selected
            .par_iter()
            .filter_map(|name| reader.info.channel_labels.iter().position(|n| n == name))
            .collect();

        if filtered_channels.is_empty() {
            let num_fallback_channels = reader.info.num_channels.min(10);
            log::warn!("[OVERVIEW] None of the selected channels found in text file, falling back to first {} channels", num_fallback_channels);
            channels_to_read = (0..num_fallback_channels).collect();
            channel_labels = reader
                .info
                .channel_labels
                .par_iter()
                .take(num_fallback_channels)
                .cloned()
                .collect();
        } else {
            channels_to_read = filtered_channels;
            channel_labels = channels_to_read
                .par_iter()
                .map(|&idx| reader.info.channel_labels[idx].clone())
                .collect();
        }
    } else {
        channels_to_read = (0..reader.info.num_channels).collect();
        channel_labels = reader.info.channel_labels.clone();
    }

    if channels_to_read.is_empty() {
        return Err("No valid channels found".to_string());
    }

    log::info!(
        "[OVERVIEW] File: '{}', total_samples={}, max_points={}",
        file_path,
        total_samples,
        max_points
    );

    let downsample_ratio = (total_samples as f64 / max_points as f64).ceil() as usize;
    let bucket_size = downsample_ratio.max(1);

    log::info!(
        "[OVERVIEW] Using min-max downsampling with bucket_size={}",
        bucket_size
    );

    let full_data = reader.read_window(0, total_samples, &channels_to_read)?;

    let mut downsampled_data: Vec<Vec<f64>> = Vec::new();

    for channel_data in full_data {
        let mut channel_downsampled = Vec::with_capacity(max_points * 2);

        for chunk in channel_data.chunks(bucket_size) {
            if chunk.is_empty() {
                continue;
            }

            let min_val = chunk.iter().copied().fold(f64::INFINITY, f64::min);
            let max_val = chunk.iter().copied().fold(f64::NEG_INFINITY, f64::max);

            channel_downsampled.push(min_val);
            channel_downsampled.push(max_val);
        }

        downsampled_data.push(channel_downsampled);
    }

    let result_size = downsampled_data.first().map(|v| v.len()).unwrap_or(0);

    log::info!(
        "[OVERVIEW] Generated overview: {} channels, {} points per channel",
        downsampled_data.len(),
        result_size
    );

    Ok(ChunkData {
        data: downsampled_data,
        channel_labels,
        sampling_frequency: sample_rate,
        chunk_size: result_size,
        chunk_start: 0,
        total_samples: Some(total_samples as u64),
    })
}

fn apply_preprocessing_to_chunk(
    mut chunk: ChunkData,
    preprocessing: &PreprocessingParams,
) -> Result<(ChunkData, Vec<String>), String> {
    log::info!(
        "[PREPROCESSING] Input: {} channels, {} samples/channel, sample_rate={}",
        chunk.channel_labels.len(),
        chunk.data.first().map(|c| c.len()).unwrap_or(0),
        chunk.sampling_frequency
    );
    log::info!(
        "[PREPROCESSING] Params: highpass={:?}, lowpass={:?}, notch={:?}",
        preprocessing.highpass,
        preprocessing.lowpass,
        preprocessing.notch
    );

    if chunk.data.is_empty() || chunk.sampling_frequency <= 0.0 {
        log::warn!("[PREPROCESSING] Skipping: empty data or invalid sample rate");
        return Ok((chunk, Vec::new()));
    }

    let sample_rate = chunk.sampling_frequency;
    let mut details = Vec::new();

    let mut config = PreprocessingConfig {
        sample_rate,
        notch_enabled: false,
        notch_frequency: 60.0,
        notch_harmonics: 1,
        notch_q: 30.0,
        bandpass_enabled: false,
        bandpass_low: 0.5,
        bandpass_high: sample_rate / 2.0 - 1.0,
        filter_order: 4,
    };

    if let Some(ref notch_freqs) = preprocessing.notch {
        if !notch_freqs.is_empty() {
            config.notch_enabled = true;
            config.notch_frequency = notch_freqs[0];
            config.notch_harmonics = notch_freqs.len();
        }
    }

    let has_highpass = preprocessing.highpass.is_some();
    let has_lowpass = preprocessing.lowpass.is_some();

    if has_highpass || has_lowpass {
        config.bandpass_enabled = true;
        if let Some(hp) = preprocessing.highpass {
            config.bandpass_low = hp;
        }
        if let Some(lp) = preprocessing.lowpass {
            config.bandpass_high = lp;
        }
    }

    if config.notch_enabled || config.bandpass_enabled {
        let start_time = std::time::Instant::now();

        log::info!(
            "[PREPROCESSING] Config: notch={}@{}Hz (harmonics={}), bandpass={}@{}-{}Hz",
            config.notch_enabled,
            config.notch_frequency,
            config.notch_harmonics,
            config.bandpass_enabled,
            config.bandpass_low,
            config.bandpass_high
        );

        if let Some(first_channel) = chunk.data.first() {
            let (min, max) = first_channel
                .iter()
                .fold((f64::MAX, f64::MIN), |(min, max), &v| {
                    (min.min(v), max.max(v))
                });
            log::info!(
                "[PREPROCESSING] Input ch0: min={:.4}, max={:.4}, range={:.4}",
                min,
                max,
                max - min
            );
        }

        // Keep original data as a safety fallback if filtering produces unstable values.
        let original_channels = chunk.data.clone();
        let input_channel_max_abs: Vec<f64> = original_channels
            .iter()
            .map(|channel| {
                channel
                    .iter()
                    .filter(|v| v.is_finite())
                    .fold(0.0_f64, |acc, v| acc.max(v.abs()))
            })
            .collect();

        // Use std::mem::take to avoid additional copy for filtered output path.
        let channels = std::mem::take(&mut chunk.data);
        let channel_labels = std::mem::take(&mut chunk.channel_labels);
        let result = preprocess_batch_owned(channels, channel_labels, &config).map_err(|e| {
            log::error!("[PREPROCESSING] Filter error: {}", e);
            format!("Preprocessing failed: {}", e)
        })?;

        let elapsed = start_time.elapsed();
        if let Some(first_channel) = result.channels.first() {
            let (min, max) = first_channel
                .iter()
                .fold((f64::MAX, f64::MIN), |(min, max), &v| {
                    (min.min(v), max.max(v))
                });
            let has_nan = first_channel.iter().any(|v| v.is_nan());
            let has_inf = first_channel.iter().any(|v| v.is_infinite());
            log::info!(
                "[PREPROCESSING] Output ch0: min={:.4}, max={:.4}, nan={}, inf={}",
                min,
                max,
                has_nan,
                has_inf
            );
        }

        if !result.warnings.is_empty() {
            log::warn!(
                "[PREPROCESSING] Pipeline warnings: {}",
                result.warnings.join(" | ")
            );
            details.push(format!("pipeline_warnings={}", result.warnings.join(" | ")));
        }

        let mut filtered_channels = result.channels;
        let mut replaced_labels = Vec::new();
        let mut replaced_non_finite = 0usize;
        let mut replaced_extreme = 0usize;

        for (idx, filtered_channel) in filtered_channels.iter_mut().enumerate() {
            let input_max_abs = input_channel_max_abs.get(idx).copied().unwrap_or(0.0);
            let extreme_threshold = (input_max_abs * 1_000.0).max(1_000_000.0);

            let mut non_finite_count = 0usize;
            let mut extreme_count = 0usize;
            for &value in filtered_channel.iter() {
                if !value.is_finite() {
                    non_finite_count += 1;
                } else if value.abs() > extreme_threshold {
                    extreme_count += 1;
                }
            }

            if non_finite_count > 0 || extreme_count > 0 {
                replaced_non_finite += non_finite_count;
                replaced_extreme += extreme_count;
                replaced_labels.push(
                    result
                        .channel_names
                        .get(idx)
                        .cloned()
                        .unwrap_or_else(|| format!("ch{}", idx)),
                );

                if let Some(original) = original_channels.get(idx) {
                    *filtered_channel = original.clone();
                }
            }
        }

        if !replaced_labels.is_empty() {
            log::warn!(
                "[PREPROCESSING] Replaced {} unstable filtered channels with original data (non_finite_samples={}, extreme_samples={}): {}",
                replaced_labels.len(),
                replaced_non_finite,
                replaced_extreme,
                replaced_labels.join(", ")
            );
            details.push(format!(
                "filter_safety_fallback replaced_channels={} non_finite_samples={} extreme_samples={} labels={}",
                replaced_labels.len(),
                replaced_non_finite,
                replaced_extreme,
                replaced_labels.join(",")
            ));
        }

        chunk.data = filtered_channels;
        chunk.channel_labels = result.channel_names;

        log::info!(
            "[PREPROCESSING] Applied filters to {} channels in {:.1}ms",
            chunk.channel_labels.len(),
            elapsed.as_secs_f64() * 1000.0
        );
    }

    Ok((chunk, details))
}

fn detect_bad_channels(chunk: &ChunkData, config: Option<&serde_json::Value>) -> Vec<String> {
    if chunk.data.is_empty() || chunk.channel_labels.is_empty() {
        return Vec::new();
    }

    let Some(cfg) = config.and_then(|v| v.as_object()) else {
        return Vec::new();
    };

    let auto_detect = cfg
        .get("autoDetect")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let variance_threshold = cfg
        .get("varianceThreshold")
        .and_then(|v| v.as_f64())
        .unwrap_or(3.5);
    let flat_threshold = cfg
        .get("flatThreshold")
        .and_then(|v| v.as_f64())
        .unwrap_or(1e-6);

    let mut detected = Vec::new();

    if auto_detect {
        let variances: Vec<f64> = chunk
            .data
            .iter()
            .map(|channel| {
                if channel.is_empty() {
                    return 0.0;
                }
                let mean = channel.iter().sum::<f64>() / channel.len() as f64;
                channel.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / channel.len() as f64
            })
            .collect();

        let var_mean = variances.iter().sum::<f64>() / variances.len() as f64;
        let var_std = (variances
            .iter()
            .map(|v| (v - var_mean).powi(2))
            .sum::<f64>()
            / variances.len() as f64)
            .sqrt();

        for (idx, variance) in variances.iter().enumerate() {
            let is_flat = *variance < flat_threshold;
            let is_high_var = if var_std > 0.0 {
                ((*variance - var_mean) / var_std) > variance_threshold
            } else {
                false
            };

            if is_flat || is_high_var {
                if let Some(label) = chunk.channel_labels.get(idx) {
                    detected.push(label.clone());
                }
            }
        }
    }

    if let Some(manual_bad_channels) = cfg.get("manualBadChannels").and_then(|v| v.as_array()) {
        for label in manual_bad_channels.iter().filter_map(|v| v.as_str()) {
            if !detected.iter().any(|existing| existing == label) {
                detected.push(label.to_string());
            }
        }
    }

    detected
}

fn format_chunk_summary(chunk: &ChunkData) -> String {
    let channel_count = chunk.data.len();
    let sample_count = chunk.data.first().map(|ch| ch.len()).unwrap_or(0);
    if channel_count == 0 || sample_count == 0 {
        return format!(
            "channels={}, samples/ch={}, summary=empty",
            channel_count, sample_count
        );
    }

    let mut min_value = f64::INFINITY;
    let mut max_value = f64::NEG_INFINITY;
    let mut abs_sum = 0.0;
    let mut sq_sum = 0.0;
    let mut near_zero = 0usize;
    let mut finite_count = 0usize;
    let mut total_count = 0usize;
    let mut non_finite_count = 0usize;
    let mut flat_channels = 0usize;

    for channel in &chunk.data {
        if channel.is_empty() {
            continue;
        }
        let mut channel_min = f64::INFINITY;
        let mut channel_max = f64::NEG_INFINITY;
        let mut channel_finite_count = 0usize;
        for &value in channel {
            total_count += 1;
            if !value.is_finite() {
                non_finite_count += 1;
                continue;
            }
            min_value = min_value.min(value);
            max_value = max_value.max(value);
            channel_min = channel_min.min(value);
            channel_max = channel_max.max(value);
            abs_sum += value.abs();
            sq_sum += value * value;
            if value.abs() < 1e-6 {
                near_zero += 1;
            }
            finite_count += 1;
            channel_finite_count += 1;
        }
        if channel_finite_count > 0 && (channel_max - channel_min).abs() < 1e-9 {
            flat_channels += 1;
        }
    }

    if total_count == 0 {
        return format!(
            "channels={}, samples/ch={}, summary=empty",
            channel_count, sample_count
        );
    }

    let mean_abs = if finite_count > 0 {
        abs_sum / finite_count as f64
    } else {
        f64::NAN
    };
    let rms = if finite_count > 0 {
        (sq_sum / finite_count as f64).sqrt()
    } else {
        f64::NAN
    };
    let near_zero_pct = if finite_count > 0 {
        (near_zero as f64 / finite_count as f64) * 100.0
    } else {
        0.0
    };
    let min_display = if finite_count > 0 {
        min_value
    } else {
        f64::NAN
    };
    let max_display = if finite_count > 0 {
        max_value
    } else {
        f64::NAN
    };

    format!(
        "channels={}, samples/ch={}, min={:.6}, max={:.6}, mean_abs={:.6}, rms={:.6}, near_zero={:.2}%, non_finite={}/{}, flat_channels={}/{}",
        channel_count,
        sample_count,
        min_display,
        max_display,
        mean_abs,
        rms,
        near_zero_pct,
        non_finite_count,
        total_count,
        flat_channels,
        channel_count
    )
}

fn describe_artifact_detectors(config: Option<&serde_json::Value>) -> String {
    let Some(detectors) = config
        .and_then(|cfg| cfg.get("detectors"))
        .and_then(|v| v.as_array())
    else {
        return "none".to_string();
    };

    let mut parts = Vec::new();
    for detector in detectors {
        let detector_type = detector
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let enabled = detector
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let threshold = detector
            .get("threshold")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let min_duration = detector
            .get("minDuration")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let window_size = detector
            .get("windowSize")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        parts.push(format!(
            "{}(enabled={},thr={:.6},minDur={},win={})",
            detector_type, enabled, threshold, min_duration, window_size
        ));
    }

    if parts.is_empty() {
        "none".to_string()
    } else {
        parts.join(";")
    }
}

fn extract_filter_params(config: Option<&serde_json::Value>) -> PreprocessingParams {
    let mut result = PreprocessingParams::default();
    let mut notch_freqs: Vec<f64> = Vec::new();

    let Some(filters) = config
        .and_then(|v| v.get("filters"))
        .and_then(|v| v.as_array())
    else {
        return result;
    };

    for filter in filters {
        let filter_type = filter
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        match filter_type {
            "highpass" => {
                if let Some(v) = filter.get("highpassFreq").and_then(|v| v.as_f64()) {
                    result.highpass = Some(result.highpass.map_or(v, |prev| prev.max(v)));
                }
            }
            "lowpass" => {
                if let Some(v) = filter.get("lowpassFreq").and_then(|v| v.as_f64()) {
                    result.lowpass = Some(result.lowpass.map_or(v, |prev| prev.min(v)));
                }
            }
            "bandpass" => {
                if let Some(v) = filter.get("highpassFreq").and_then(|v| v.as_f64()) {
                    result.highpass = Some(result.highpass.map_or(v, |prev| prev.max(v)));
                }
                if let Some(v) = filter.get("lowpassFreq").and_then(|v| v.as_f64()) {
                    result.lowpass = Some(result.lowpass.map_or(v, |prev| prev.min(v)));
                }
            }
            "notch" => {
                if let Some(values) = filter.get("notchFreqs").and_then(|v| v.as_array()) {
                    notch_freqs.extend(values.iter().filter_map(|v| v.as_f64()));
                }
            }
            _ => {}
        }
    }

    if !notch_freqs.is_empty() {
        notch_freqs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        notch_freqs.dedup_by(|a, b| (*a - *b).abs() < f64::EPSILON);
        result.notch = Some(notch_freqs);
    }

    result
}

fn apply_rereference_step(
    chunk: &mut ChunkData,
    config: Option<&serde_json::Value>,
) -> Result<(), String> {
    if chunk.data.is_empty() || chunk.channel_labels.is_empty() {
        return Ok(());
    }

    let Some(cfg) = config.and_then(|v| v.as_object()) else {
        return Ok(());
    };
    let ref_type = cfg.get("type").and_then(|v| v.as_str()).unwrap_or("none");
    let sample_count = chunk.data[0].len();
    if sample_count == 0 {
        return Ok(());
    }

    match ref_type {
        "none" => Ok(()),
        "bipolar" => {
            let Some(pairs) = cfg.get("bipolarPairs").and_then(|v| v.as_array()) else {
                return Ok(());
            };
            let mut new_data = Vec::new();
            let mut new_labels = Vec::new();
            for pair in pairs {
                let Some(pair_arr) = pair.as_array() else {
                    continue;
                };
                if pair_arr.len() != 2 {
                    continue;
                }
                let from = pair_arr[0].as_str().unwrap_or_default();
                let to = pair_arr[1].as_str().unwrap_or_default();
                let from_idx = chunk.channel_labels.iter().position(|label| label == from);
                let to_idx = chunk.channel_labels.iter().position(|label| label == to);
                let (Some(from_idx), Some(to_idx)) = (from_idx, to_idx) else {
                    continue;
                };
                let diff: Vec<f64> = chunk.data[from_idx]
                    .iter()
                    .zip(chunk.data[to_idx].iter())
                    .map(|(a, b)| a - b)
                    .collect();
                new_data.push(diff);
                new_labels.push(format!("{}-{}", from, to));
            }

            if new_data.is_empty() {
                return Err("No valid bipolar pairs found in rereference config".to_string());
            }

            chunk.data = new_data;
            chunk.channel_labels = new_labels;
            chunk.chunk_size = chunk.data[0].len();
            Ok(())
        }
        "average" | "laplacian" | "single" | "linked_mastoid" | "custom" => {
            let reference_channels: Vec<String> = cfg
                .get("referenceChannels")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .map(ToString::to_string)
                        .collect()
                })
                .unwrap_or_default();

            let exclude_channels: Vec<String> = cfg
                .get("excludeChannels")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .map(ToString::to_string)
                        .collect()
                })
                .unwrap_or_default();

            let reference_indices: Vec<usize> = match ref_type {
                "single" | "linked_mastoid" | "custom" => {
                    if reference_channels.is_empty() {
                        return Err(
                            "Rereference config requires referenceChannels for this mode"
                                .to_string(),
                        );
                    }
                    chunk
                        .channel_labels
                        .iter()
                        .enumerate()
                        .filter_map(|(idx, label)| {
                            if reference_channels.iter().any(|c| c == label) {
                                Some(idx)
                            } else {
                                None
                            }
                        })
                        .collect()
                }
                _ => chunk
                    .channel_labels
                    .iter()
                    .enumerate()
                    .filter_map(|(idx, label)| {
                        if exclude_channels.iter().any(|c| c == label) {
                            None
                        } else {
                            Some(idx)
                        }
                    })
                    .collect(),
            };

            if matches!(ref_type, "average" | "laplacian") && reference_indices.len() < 2 {
                return Ok(());
            }

            if reference_indices.is_empty() {
                return Err("No channels available for rereferencing".to_string());
            }

            let mut reference_signal = vec![0.0; sample_count];
            for sample_idx in 0..sample_count {
                let mut sum = 0.0;
                for ch_idx in &reference_indices {
                    sum += chunk.data[*ch_idx][sample_idx];
                }
                reference_signal[sample_idx] = sum / reference_indices.len() as f64;
            }

            for channel in &mut chunk.data {
                for sample_idx in 0..sample_count {
                    channel[sample_idx] -= reference_signal[sample_idx];
                }
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn apply_artifact_removal_step(chunk: &mut ChunkData, config: Option<&serde_json::Value>) -> usize {
    if chunk.data.is_empty() {
        return 0;
    }

    let sample_count = chunk.data[0].len();
    if sample_count == 0 {
        return 0;
    }

    let action = config
        .and_then(|v| v.get("action"))
        .and_then(|v| v.as_str())
        .unwrap_or("mark");

    let mut mask = vec![vec![false; sample_count]; chunk.data.len()];
    let detectors = config
        .and_then(|v| v.get("detectors"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for detector in detectors {
        let enabled = detector
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        if !enabled {
            continue;
        }

        let detector_type = detector
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("threshold");
        let threshold = detector
            .get("threshold")
            .and_then(|v| v.as_f64())
            .unwrap_or(100.0);

        if detector_type == "flat" {
            let min_duration = detector
                .get("minDuration")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize)
                .unwrap_or(100)
                .max(2);

            let flat_threshold = threshold.abs();
            if flat_threshold <= 0.0 {
                continue;
            }

            for (ch_idx, channel) in chunk.data.iter().enumerate() {
                mark_flat_segments(channel, &mut mask[ch_idx], flat_threshold, min_duration);
            }
            continue;
        }

        for (ch_idx, channel) in chunk.data.iter().enumerate() {
            for sample_idx in 0..sample_count {
                let value = channel[sample_idx];
                let is_artifact = match detector_type {
                    "threshold" | "muscle" | "eye_blink" => value.abs() > threshold,
                    "gradient" | "jump" => {
                        sample_idx > 0 && (value - channel[sample_idx - 1]).abs() > threshold
                    }
                    _ => false,
                };
                if is_artifact {
                    mask[ch_idx][sample_idx] = true;
                }
            }
        }
    }

    let artifact_count = mask
        .iter()
        .map(|channel_mask| channel_mask.iter().filter(|is_bad| **is_bad).count())
        .sum();

    match action {
        "zero" | "reject_epoch" => {
            for (ch_idx, channel) in chunk.data.iter_mut().enumerate() {
                for (sample_idx, value) in channel.iter_mut().enumerate() {
                    if mask[ch_idx][sample_idx] {
                        *value = 0.0;
                    }
                }
            }
        }
        "interpolate" => {
            for (ch_idx, channel) in chunk.data.iter_mut().enumerate() {
                interpolate_masked_samples(channel, &mask[ch_idx]);
            }
        }
        _ => {}
    }

    artifact_count
}

fn mark_flat_segments(channel: &[f64], mask: &mut [bool], threshold: f64, min_duration: usize) {
    if channel.is_empty() || mask.len() != channel.len() {
        return;
    }

    let mut run_start = 0usize;
    let mut run_min = channel[0];
    let mut run_max = channel[0];

    for idx in 1..channel.len() {
        let value = channel[idx];
        run_min = run_min.min(value);
        run_max = run_max.max(value);

        if (run_max - run_min) <= threshold {
            continue;
        }

        let run_len = idx - run_start;
        if run_len >= min_duration {
            for slot in mask.iter_mut().take(idx).skip(run_start) {
                *slot = true;
            }
        }

        run_start = idx;
        run_min = value;
        run_max = value;
    }

    let tail_len = channel.len() - run_start;
    if tail_len >= min_duration && (run_max - run_min) <= threshold {
        for slot in mask.iter_mut().skip(run_start) {
            *slot = true;
        }
    }
}

fn interpolate_masked_samples(channel: &mut [f64], mask: &[bool]) {
    if channel.is_empty() || mask.is_empty() {
        return;
    }

    let n = channel.len();
    let mut idx = 0usize;
    while idx < n {
        if !mask[idx] {
            idx += 1;
            continue;
        }

        let start = idx;
        while idx < n && mask[idx] {
            idx += 1;
        }
        let end = idx - 1;

        let left = if start > 0 {
            Some(channel[start - 1])
        } else {
            None
        };
        let right = if idx < n { Some(channel[idx]) } else { None };

        match (left, right) {
            (Some(l), Some(r)) => {
                let span = (end - start + 2) as f64;
                for i in start..=end {
                    let alpha = (i - start + 1) as f64 / span;
                    channel[i] = l + alpha * (r - l);
                }
            }
            (Some(l), None) => {
                for value in channel.iter_mut().take(end + 1).skip(start) {
                    *value = l;
                }
            }
            (None, Some(r)) => {
                for value in channel.iter_mut().take(end + 1).skip(start) {
                    *value = r;
                }
            }
            (None, None) => {
                for value in channel.iter_mut().take(end + 1).skip(start) {
                    *value = 0.0;
                }
            }
        }
    }
}
