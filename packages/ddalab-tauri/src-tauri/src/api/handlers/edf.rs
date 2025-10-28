use crate::api::models::{ChunkData, EDFFileInfo};
use crate::api::overview_generator::ProgressiveOverviewGenerator;
use crate::api::state::ApiState;
use crate::api::utils::{
    create_file_info, generate_overview_with_file_reader, read_edf_file_chunk, FileType,
};
use crate::edf::EDFReader;
use crate::file_readers::FileReaderFactory;
use crate::text_reader::TextFileReader;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

pub async fn get_edf_info(
    State(state): State<Arc<ApiState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<EDFFileInfo>, StatusCode> {
    let file_path = params.get("file_path").ok_or(StatusCode::BAD_REQUEST)?;
    log::info!("get_edf_info called for: {}", file_path);

    {
        let file_cache = state.files.read();
        if let Some(file_info) = file_cache.get(file_path) {
            log::info!("Found in cache, channels: {:?}", file_info.channels.len());
            return Ok(Json(file_info.clone()));
        }
    }

    let full_path = PathBuf::from(file_path);
    log::info!("Attempting to load EDF file: {:?}", full_path);

    if let Some(file_info) = create_file_info(full_path).await {
        log::info!(
            "Created file info, channels: {:?}",
            file_info.channels.len()
        );
        {
            let mut file_cache = state.files.write();
            file_cache.insert(file_path.clone(), file_info.clone());
        }
        Ok(Json(file_info))
    } else {
        log::error!("Failed to create file info for: {}", file_path);
        Err(StatusCode::INTERNAL_SERVER_ERROR)
    }
}

pub async fn get_edf_data(
    State(state): State<Arc<ApiState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<ChunkData>, StatusCode> {
    let file_path = params.get("file_path").ok_or(StatusCode::BAD_REQUEST)?;

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

    let chunk_key = if let Some(ref channels) = selected_channels {
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

    {
        let chunk_cache = state.chunks_cache.read();
        if let Some(chunk) = chunk_cache.get(&chunk_key) {
            return Ok(Json(chunk.clone()));
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
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .map_err(|e| {
        log::error!("EDF reading error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    {
        let mut chunk_cache = state.chunks_cache.write();
        chunk_cache.insert(chunk_key, chunk.clone());
    }

    Ok(Json(chunk))
}

pub async fn get_overview_progress(
    State(state): State<Arc<ApiState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let file_path = params.get("file_path").ok_or(StatusCode::BAD_REQUEST)?;

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

pub async fn get_edf_overview(
    State(state): State<Arc<ApiState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<ChunkData>, StatusCode> {
    let file_path = params.get("file_path").ok_or(StatusCode::BAD_REQUEST)?;

    let max_points: usize = params
        .get("max_points")
        .and_then(|s| s.parse().ok())
        .unwrap_or(2000);

    let selected_channels: Option<Vec<String>> = params
        .get("channels")
        .map(|s| s.split(',').map(|c| c.trim().to_string()).collect());

    let path = std::path::Path::new(file_path);
    if !path.exists() {
        log::error!("[OVERVIEW] File not found: {}", file_path);
        return Err(StatusCode::NOT_FOUND);
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
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;

            return Ok(Json(chunk));
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
            return Ok(Json(chunk.clone()));
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
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .map_err(|e| {
        log::error!("Failed to generate overview: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    {
        let mut chunk_cache = state.chunks_cache.write();
        chunk_cache.insert(cache_key, chunk.clone());
    }

    Ok(Json(chunk))
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
            .iter()
            .filter_map(|name| reader.info.channel_labels.iter().position(|n| n == name))
            .collect();

        if filtered_channels.is_empty() {
            let num_fallback_channels = reader.info.num_channels.min(10);
            log::warn!("[OVERVIEW] None of the selected channels found in text file, falling back to first {} channels", num_fallback_channels);
            channels_to_read = (0..num_fallback_channels).collect();
            channel_labels = reader
                .info
                .channel_labels
                .iter()
                .take(num_fallback_channels)
                .cloned()
                .collect();
        } else {
            channels_to_read = filtered_channels;
            channel_labels = channels_to_read
                .iter()
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
