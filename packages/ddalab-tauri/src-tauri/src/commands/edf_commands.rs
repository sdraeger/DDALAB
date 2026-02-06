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
        apply_preprocessing_to_chunk(chunk, &preprocessing)?
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
                                    Ok(c) => c,
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
) -> Result<ChunkData, String> {
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
        return Ok(chunk);
    }

    let sample_rate = chunk.sampling_frequency;

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

        // Use std::mem::take to avoid unnecessary data copy - we're replacing chunk.data anyway
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

        chunk.data = result.channels;
        chunk.channel_labels = result.channel_names;

        log::info!(
            "[PREPROCESSING] Applied filters to {} channels in {:.1}ms",
            chunk.channel_labels.len(),
            elapsed.as_secs_f64() * 1000.0
        );
    }

    Ok(chunk)
}
