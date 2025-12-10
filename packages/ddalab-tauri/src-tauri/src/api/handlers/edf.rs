use crate::api::models::{ApiError, ChunkData, EDFFileInfo};
use crate::api::overview_generator::ProgressiveOverviewGenerator;
use crate::api::state::ApiState;
use crate::api::utils::{
    check_git_annex_symlink, create_file_info_result, generate_overview_with_file_reader,
    read_edf_file_chunk, FileType,
};
use crate::edf::EDFReader;
use crate::file_readers::{global_cache, FileReaderFactory, LazyReaderFactory, WindowRequest};
use crate::signal_processing::{preprocess_batch, PreprocessingConfig};
use crate::text_reader::TextFileReader;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

/// Preprocessing parameters parsed from query string
#[derive(Debug, Clone, Default)]
struct PreprocessingParams {
    highpass: Option<f64>,
    lowpass: Option<f64>,
    notch: Option<Vec<f64>>,
}

impl PreprocessingParams {
    fn from_query(params: &HashMap<String, String>) -> Self {
        Self {
            highpass: params.get("highpass").and_then(|s| s.parse().ok()),
            lowpass: params.get("lowpass").and_then(|s| s.parse().ok()),
            notch: params
                .get("notch")
                .map(|s| s.split(',').filter_map(|v| v.trim().parse().ok()).collect()),
        }
    }

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

pub async fn get_edf_info(
    State(state): State<Arc<ApiState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<EDFFileInfo>, ApiError> {
    let file_path = params
        .get("file_path")
        .ok_or_else(|| ApiError::BadRequest("Missing file_path parameter".to_string()))?;
    log::info!("get_edf_info called for: {}", file_path);

    {
        let file_cache = state.files.read();
        if let Some(file_info) = file_cache.get(file_path) {
            log::info!("Found in cache, channels: {:?}", file_info.channels.len());
            return Ok(Json((*file_info).clone()));
        }
    }

    let full_path = PathBuf::from(file_path);
    log::info!("Attempting to load file: {:?}", full_path);

    // Use the new error-returning function
    let file_info = create_file_info_result(full_path).await?;

    log::info!(
        "Created file info, channels: {:?}",
        file_info.channels.len()
    );

    // Clone for response before moving into cache
    let response = file_info.clone();
    {
        let mut file_cache = state.files.write();
        file_cache.insert(file_path.clone(), file_info);
    }
    Ok(Json(response))
}

/// Get chunk data from EDF/CSV/ASCII files.
/// Uses Arc<ChunkData> for zero-copy responses - serde serializes Arc<T> identically to T,
/// avoiding ~5MB clones on every request (30s @ 256Hz, 16 channels).
///
/// Supports optional preprocessing via query params:
/// - highpass: High-pass filter cutoff frequency (Hz)
/// - lowpass: Low-pass filter cutoff frequency (Hz)
/// - notch: Comma-separated notch filter frequencies (Hz), e.g., "60,120"
pub async fn get_edf_data(
    State(state): State<Arc<ApiState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Arc<ChunkData>>, ApiError> {
    let file_path = params
        .get("file_path")
        .ok_or_else(|| ApiError::BadRequest("Missing file_path parameter".to_string()))?;

    // Check for git-annex symlinks early
    let path = std::path::Path::new(file_path);
    check_git_annex_symlink(path)?;

    // Parse preprocessing parameters
    let preprocessing = PreprocessingParams::from_query(&params);

    let (start_time, duration, needs_sample_rate) =
        if let Some(chunk_start_str) = params.get("chunk_start") {
            let chunk_start: usize = chunk_start_str.parse().unwrap_or(0);
            let chunk_size: usize = params
                .get("chunk_size")
                .and_then(|s| s.parse().ok())
                .unwrap_or(7680);

            (chunk_start as f64, chunk_size as f64, true)
        } else {
            let start_time = params
                .get("start_time")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0.0);
            let duration = params
                .get("duration")
                .and_then(|s| s.parse().ok())
                .unwrap_or(30.0);

            (start_time, duration, false)
        };

    let selected_channels: Option<Vec<String>> = params
        .get("channels")
        .map(|s| s.split(',').map(|c| c.trim().to_string()).collect());

    // Include preprocessing in cache key to ensure filtered data is cached separately
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
            // ZERO-COPY: Return Arc directly - serde serializes Arc<T> same as T.
            // This avoids cloning the ~5MB ChunkData on every cache hit.
            return Ok(Json(chunk));
        }
    }

    let file_path_clone = file_path.clone();
    let chunk = tokio::task::spawn_blocking(move || -> Result<ChunkData, String> {
        let path = std::path::Path::new(&file_path_clone);
        if !path.exists() {
            return Err(format!("File not found: {}", file_path_clone));
        }

        match FileType::from_path(&path) {
            FileType::CSV => {
                log::info!("Reading CSV file: {}", file_path_clone);
                let reader = TextFileReader::from_csv(path).map_err(|e| {
                    log::error!("Failed to parse CSV file '{}': {}", file_path_clone, e);
                    e
                })?;
                log::info!(
                    "CSV file loaded: {} channels, {} samples",
                    reader.info.num_channels,
                    reader.info.num_samples
                );
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
                log::info!(
                    "ASCII file loaded: {} channels, {} samples",
                    reader.info.num_channels,
                    reader.info.num_samples
                );
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
    .map_err(|e| {
        log::error!("Task join error: {}", e);
        ApiError::InternalError(format!("Task join error: {}", e))
    })?
    .map_err(|e| {
        log::error!("File reading error: {}", e);
        ApiError::ParseError(e)
    })?;

    // Apply preprocessing filters if enabled
    let processed_chunk = if preprocessing.is_enabled() {
        apply_preprocessing_to_chunk(chunk, &preprocessing)?
    } else {
        chunk
    };

    // ZERO-COPY: Wrap in Arc once, insert Arc clone into cache, return same Arc.
    // No ChunkData cloning - just Arc reference counting.
    let chunk_arc = Arc::new(processed_chunk);
    {
        let mut chunk_cache = state.chunks_cache.write();
        chunk_cache.insert_arc(chunk_key, Arc::clone(&chunk_arc));
    }

    Ok(Json(chunk_arc))
}

/// Apply preprocessing filters to chunk data
fn apply_preprocessing_to_chunk(
    mut chunk: ChunkData,
    preprocessing: &PreprocessingParams,
) -> Result<ChunkData, ApiError> {
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

    // Build preprocessing config
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

    // Configure notch filter
    if let Some(ref notch_freqs) = preprocessing.notch {
        if !notch_freqs.is_empty() {
            config.notch_enabled = true;
            config.notch_frequency = notch_freqs[0];
            config.notch_harmonics = notch_freqs.len();
        }
    }

    // Configure bandpass filter
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

    // Apply filtering
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

        // Log input statistics for comparison
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

        let result =
            preprocess_batch(&chunk.data, &chunk.channel_labels, &config).map_err(|e| {
                log::error!("[PREPROCESSING] Filter error: {}", e);
                ApiError::InternalError(format!("Preprocessing failed: {}", e))
            })?;

        // Log output statistics for debugging
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

        log::info!(
            "[PREPROCESSING] Applied filters to {} channels in {:.1}ms",
            chunk.channel_labels.len(),
            elapsed.as_secs_f64() * 1000.0
        );
    }

    Ok(chunk)
}

pub async fn get_overview_progress(
    State(state): State<Arc<ApiState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let file_path = params
        .get("file_path")
        .ok_or_else(|| ApiError::BadRequest("Missing file_path parameter".to_string()))?;

    // Check for git-annex symlinks
    let path = std::path::Path::new(file_path);
    check_git_annex_symlink(path)?;

    let max_points: usize = params
        .get("max_points")
        .and_then(|s| s.parse().ok())
        .unwrap_or(2000);

    let selected_channels: Option<Vec<String>> = params
        .get("channels")
        .map(|s| s.split(',').map(|c| c.trim().to_string()).collect());

    if let Some(cache_db) = state.overview_cache_db.as_ref() {
        // Determine channels JSON for lookup
        let channels_json = if let Some(ref selected) = selected_channels {
            serde_json::to_string(selected).unwrap_or_default()
        } else {
            String::new()
        };

        // Query progress in blocking task to avoid blocking async runtime
        let cache_db = cache_db.clone();
        let file_path_clone = file_path.to_string();
        let channels_json_clone = channels_json.clone();

        match tokio::task::spawn_blocking(move || {
            cache_db.query_progress(&file_path_clone, max_points, &channels_json_clone)
        })
        .await
        {
            Ok(Ok(Some(result))) => {
                return Ok(Json(result));
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

    // No cache found or cache DB not available
    Ok(Json(serde_json::json!({
        "has_cache": false,
        "completion_percentage": 0.0,
        "is_complete": false,
    })))
}

/// Get overview data for file visualization (decimated for minimap).
/// Uses Arc<ChunkData> for zero-copy responses - same optimization as get_edf_data.
pub async fn get_edf_overview(
    State(state): State<Arc<ApiState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Arc<ChunkData>>, ApiError> {
    let file_path = params
        .get("file_path")
        .ok_or_else(|| ApiError::BadRequest("Missing file_path parameter".to_string()))?;

    let max_points: usize = params
        .get("max_points")
        .and_then(|s| s.parse().ok())
        .unwrap_or(2000);

    let selected_channels: Option<Vec<String>> = params
        .get("channels")
        .map(|s| s.split(',').map(|c| c.trim().to_string()).collect());

    let path = std::path::Path::new(file_path);

    // Check for git-annex symlinks first
    check_git_annex_symlink(path)?;

    if !path.exists() {
        log::error!("[OVERVIEW] File not found: {}", file_path);
        return Err(ApiError::FileNotFound(file_path.to_string()));
    }

    let file_type = FileType::from_path(path);

    // Use progressive cache for EDF files if available
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
                    ApiError::ParseError(e)
                })?;

            // ZERO-COPY: Wrap in Arc for consistent response type
            return Ok(Json(Arc::new(chunk)));
        } else {
            log::warn!(
                "[OVERVIEW] Cache database not available, falling back to legacy generation"
            );
        }
    }

    // Fallback to legacy cache and generation for non-EDF files or if cache DB unavailable
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
            // ZERO-COPY: Return Arc directly - no cloning needed.
            return Ok(Json(chunk));
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

        match FileType::from_path(&path) {
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
    .map_err(|e| {
        log::error!("Task join error: {}", e);
        ApiError::InternalError(format!("Task join error: {}", e))
    })?
    .map_err(|e| {
        log::error!("Failed to generate overview: {}", e);
        ApiError::ParseError(e)
    })?;

    // ZERO-COPY: Wrap in Arc once, insert Arc clone into cache, return same Arc.
    let chunk_arc = Arc::new(chunk);
    {
        let mut chunk_cache = state.chunks_cache.write();
        chunk_cache.insert_arc(cache_key, Arc::clone(&chunk_arc));
    }

    Ok(Json(chunk_arc))
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
    let mut reader = FileReaderFactory::create_reader(path)
        .map_err(|e| format!("Failed to create file reader: {}", e))?;
    log::warn!("⏱️ FileReaderFactory::create_reader: {:?}", start.elapsed());

    let metadata = reader
        .metadata()
        .map_err(|e| format!("Failed to read metadata: {}", e))?;

    let sample_rate = metadata.sample_rate;

    // If needs_sample_rate is true, parameters are already in samples
    // Otherwise, they're in seconds and need conversion
    let (start_sample, num_samples) = if needs_sample_rate {
        (start_time as usize, duration as usize)
    } else {
        (
            (start_time * sample_rate) as usize,
            (duration * sample_rate) as usize,
        )
    };

    // Validate and clamp request to file bounds
    if start_sample >= metadata.num_samples {
        log::warn!(
            "Request beyond file end: start_sample={}, file_samples={}, start_time={:.2}s, duration={:.2}s, sample_rate={:.2}Hz",
            start_sample, metadata.num_samples, start_time, duration, sample_rate
        );

        // Return properly structured empty data - empty Vec for each channel
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
            chunk_start: 0, // Reset to start
            total_samples: Some(metadata.num_samples as u64),
        });
    }

    // Clamp num_samples to not exceed file end
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
        "⏱️ read_chunk_with_file_reader TOTAL: {:?}",
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
                    .par_iter()
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

    let chunk_size = data.get(0).map(|v| v.len()).unwrap_or(0);

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
            .par_iter()
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
                .par_iter()
                .take(num_fallback_channels)
                .map(|h| h.label.trim().to_string())
                .collect();
        } else {
            channels_to_read = filtered_channels;
            channel_labels = channels_to_read
                .par_iter()
                .map(|&idx| edf.signal_headers[idx].label.trim().to_string())
                .collect();
        }
    } else {
        channels_to_read = (0..edf.signal_headers.len()).collect();
        channel_labels = edf
            .signal_headers
            .par_iter()
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

            let min_val = chunk
                .par_iter()
                .copied()
                .reduce_with(f64::min)
                .unwrap_or(f64::INFINITY);
            let max_val = chunk
                .par_iter()
                .copied()
                .reduce_with(f64::max)
                .unwrap_or(f64::NEG_INFINITY);

            channel_downsampled.push(min_val);
            channel_downsampled.push(max_val);
        }

        downsampled_data.push(channel_downsampled);
    }

    let result_size = downsampled_data.get(0).map(|v| v.len()).unwrap_or(0);

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

            let min_val = chunk
                .par_iter()
                .copied()
                .reduce_with(f64::min)
                .unwrap_or(f64::INFINITY);
            let max_val = chunk
                .par_iter()
                .copied()
                .reduce_with(f64::max)
                .unwrap_or(f64::NEG_INFINITY);

            channel_downsampled.push(min_val);
            channel_downsampled.push(max_val);
        }

        downsampled_data.push(channel_downsampled);
    }

    let result_size = downsampled_data.get(0).map(|v| v.len()).unwrap_or(0);

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

// ============================================================================
// LAZY WINDOW-BASED ACCESS (for 100GB+ files)
// ============================================================================

/// Response for window-based data access
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowData {
    /// Channel data: channels x samples
    pub data: Vec<Vec<f64>>,
    /// Channel labels (in same order as data)
    pub channel_labels: Vec<String>,
    /// Sample rate in Hz
    pub sample_rate: f64,
    /// Start time in seconds from file start
    pub start_time_sec: f64,
    /// Duration in seconds
    pub duration_sec: f64,
    /// Number of samples per channel
    pub num_samples: usize,
    /// Whether this data came from cache
    pub from_cache: bool,
}

/// Cache statistics response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStatsResponse {
    pub num_windows: usize,
    pub total_size_bytes: usize,
    pub total_size_mb: f64,
    pub max_windows: usize,
    pub max_size_bytes: usize,
    pub max_size_mb: f64,
}

/// Get data window using lazy loading (optimized for large files)
///
/// This endpoint uses the lazy file reader with LRU caching, making it
/// suitable for files of any size (100GB+). Only the requested time
/// window is loaded into memory.
///
/// Query Parameters:
/// - file_path: Path to the EDF/BDF file
/// - start_time: Start time in seconds (default: 0)
/// - duration: Duration in seconds (default: 30)
/// - channels: Comma-separated channel names (optional, default: all)
pub async fn get_edf_window(
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<WindowData>, ApiError> {
    let file_path = params
        .get("file_path")
        .ok_or_else(|| ApiError::BadRequest("Missing file_path parameter".to_string()))?;

    let path = std::path::Path::new(file_path);

    // Check for git-annex symlinks
    check_git_annex_symlink(path)?;

    // Check if lazy reading is supported for this file type
    if !LazyReaderFactory::supports_lazy_reading(path) {
        return Err(ApiError::BadRequest(format!(
            "Lazy reading not supported for file type: {}",
            path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("unknown")
        )));
    }

    // Parse request parameters
    let start_time: f64 = params
        .get("start_time")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0);

    let duration: f64 = params
        .get("duration")
        .and_then(|s| s.parse().ok())
        .unwrap_or(30.0);

    let channels: Option<Vec<String>> = params.get("channels").map(|s| {
        s.split(',')
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty())
            .collect()
    });

    // Create lazy reader
    let reader = LazyReaderFactory::create_reader(path)
        .map_err(|e| ApiError::InternalError(format!("Failed to create lazy reader: {}", e)))?;

    // Build window request
    let mut request = WindowRequest::new(start_time, duration);
    if let Some(ch) = channels {
        request = request.with_channels(ch);
    }

    // Use global cache for window data
    let cache = global_cache();

    // Check if we have a cache hit before reading
    let metadata = reader
        .metadata()
        .map_err(|e| ApiError::InternalError(format!("Failed to read metadata: {}", e)))?;

    let channels_for_key = request
        .channels
        .clone()
        .unwrap_or_else(|| metadata.channels.clone());

    use crate::file_readers::WindowKey;
    let key = WindowKey::new(file_path, start_time, duration, &channels_for_key);
    let from_cache = cache.get(&key).is_some();

    // Read window (will use cache if available)
    let window = reader
        .read_window_cached(&request, cache)
        .map_err(|e| ApiError::InternalError(format!("Failed to read window: {}", e)))?;

    Ok(Json(WindowData {
        data: window.data.clone(),
        channel_labels: window.channel_labels.clone(),
        sample_rate: window.sample_rate,
        start_time_sec: window.start_time_sec,
        duration_sec: window.duration_sec,
        num_samples: window.num_samples,
        from_cache,
    }))
}

/// Get cache statistics for the lazy file reader
pub async fn get_edf_cache_stats() -> Json<CacheStatsResponse> {
    let cache = global_cache();
    let stats = cache.stats();

    Json(CacheStatsResponse {
        num_windows: stats.num_windows,
        total_size_bytes: stats.total_size_bytes,
        total_size_mb: stats.total_size_bytes as f64 / (1024.0 * 1024.0),
        max_windows: stats.max_windows,
        max_size_bytes: stats.max_size_bytes,
        max_size_mb: stats.max_size_bytes as f64 / (1024.0 * 1024.0),
    })
}

/// Clear the lazy file reader cache
pub async fn clear_edf_cache() -> Json<serde_json::Value> {
    let cache = global_cache();
    cache.clear();

    Json(serde_json::json!({
        "status": "ok",
        "message": "Cache cleared successfully"
    }))
}
