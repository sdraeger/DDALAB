use crate::api::models::{ChunkData, EDFFileInfo};
use crate::api::state::ApiState;
use crate::api::utils::{create_file_info, FileType};
use crate::file_readers::FileReaderFactory;
use crate::profiling::ProfileScope;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use rayon::prelude::*;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

/// Helper function to process a single directory entry
fn process_directory_entry(entry: &std::fs::DirEntry) -> Option<serde_json::Value> {
    let entry_path = entry.path();
    let file_name = entry_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    if entry_path.is_dir() {
        let last_modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                let datetime =
                    chrono::DateTime::<chrono::Utc>::from_timestamp(d.as_secs() as i64, 0);
                datetime
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_else(|| Utc::now().to_rfc3339())
            })
            .unwrap_or_else(|| Utc::now().to_rfc3339());

        Some(serde_json::json!({
            "path": entry_path.to_str().unwrap_or(""),
            "name": file_name,
            "size": 0,
            "last_modified": last_modified,
            "is_directory": true
        }))
    } else if entry_path.is_file() {
        if let Some(extension) = entry_path.extension() {
            let ext = extension.to_str().unwrap_or("");
            let file_type = FileType::from_extension(ext);

            // Include supported files and MEG files (with warning flag)
            if file_type.is_supported() || file_type.is_meg() {
                if let Ok(metadata) = entry.metadata() {
                    let last_modified = metadata
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| {
                            let datetime = chrono::DateTime::<chrono::Utc>::from_timestamp(
                                d.as_secs() as i64,
                                0,
                            );
                            datetime
                                .map(|dt| dt.to_rfc3339())
                                .unwrap_or_else(|| Utc::now().to_rfc3339())
                        })
                        .unwrap_or_else(|| Utc::now().to_rfc3339());

                    return Some(serde_json::json!({
                        "path": entry_path.to_str().unwrap_or(""),
                        "name": file_name,
                        "size": metadata.len(),
                        "last_modified": last_modified,
                        "is_directory": false,
                        "is_meg": file_type.is_meg(),
                        "is_supported": file_type.is_supported()
                    }));
                }
            }
        }
        None
    } else {
        None
    }
}

pub async fn list_files(
    State(state): State<Arc<ApiState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let path = params.get("path").map(|p| p.as_str()).unwrap_or("");

    let search_path = if path.is_empty() {
        state.data_directory.clone()
    } else {
        let path_buf = PathBuf::from(path);
        if path_buf.is_absolute() {
            path_buf
        } else {
            state.data_directory.join(path)
        }
    };

    let mut items = Vec::new();

    if search_path.exists() && search_path.is_dir() {
        log::info!("📂 Listing directory: {:?}", search_path);

        match std::fs::read_dir(&search_path) {
            Ok(entries) => {
                // Collect entries into a Vec for parallel processing
                let entries_vec: Vec<std::fs::DirEntry> = entries.filter_map(|e| e.ok()).collect();
                let num_entries = entries_vec.len();

                let _profile =
                    ProfileScope::new(format!("file_listing_parallel_{}_entries", num_entries));
                log::info!(
                    "🔀 Processing {} directory entries in PARALLEL mode",
                    num_entries
                );

                items = entries_vec
                    .par_iter()
                    .filter_map(|entry| process_directory_entry(entry))
                    .collect();

                log::info!(
                    "✅ Listed {} items from {} entries",
                    items.len(),
                    num_entries
                );
            }
            Err(e) => {
                log::error!("Failed to read directory: {}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    } else {
        log::warn!(
            "Search path does not exist or is not a directory: {:?}",
            search_path
        );
    }

    let response = serde_json::json!({
        "files": items
    });

    Ok(Json(response))
}

pub async fn get_file_info(
    State(state): State<Arc<ApiState>>,
    Path(file_path): Path<String>,
) -> Result<Json<EDFFileInfo>, StatusCode> {
    log::info!("get_file_info called for: {}", file_path);

    {
        let file_cache = state.files.read();
        if let Some(file_info) = file_cache.get(&file_path) {
            log::info!("Found in cache, channels: {:?}", file_info.channels.len());
            return Ok(Json(file_info.clone()));
        }
    }

    let full_path = PathBuf::from(&file_path);
    if let Some(file_info) = create_file_info(full_path).await {
        log::info!(
            "Created file info, channels: {:?}",
            file_info.channels.len()
        );
        {
            let mut file_cache = state.files.write();
            file_cache.insert(file_path, file_info.clone());
        }
        Ok(Json(file_info))
    } else {
        log::warn!("File not found: {}", file_path);
        Err(StatusCode::NOT_FOUND)
    }
}

pub async fn get_file_chunk(
    State(state): State<Arc<ApiState>>,
    Path(file_path): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<ChunkData>, StatusCode> {
    let start_time: f64 = params
        .get("start_time")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0);
    let duration: f64 = params
        .get("duration")
        .and_then(|s| s.parse().ok())
        .unwrap_or(30.0);

    let chunk_key = format!("{}:{}:{}", file_path, start_time, duration);

    {
        let chunk_cache = state.chunks_cache.read();
        if let Some(chunk) = chunk_cache.get(&chunk_key) {
            return Ok(Json(chunk.clone()));
        }
    }

    let channels: Option<Vec<String>> = params
        .get("channels")
        .and_then(|s| serde_json::from_str(s).ok());

    let file_path_clone = file_path.clone();
    let chunk = tokio::task::spawn_blocking(move || -> Result<ChunkData, String> {
        let path = std::path::Path::new(&file_path_clone);
        if !path.exists() {
            return Err(format!("File not found: {}", file_path_clone));
        }

        read_chunk_with_file_reader(&path, &file_path_clone, start_time, duration, channels)
    })
    .await
    .map_err(|e| {
        log::error!("Task join error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .map_err(|e| {
        log::error!("File reading error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    {
        let mut chunk_cache = state.chunks_cache.write();
        chunk_cache.insert(chunk_key, chunk.clone());
    }

    Ok(Json(chunk))
}

fn read_chunk_with_file_reader(
    path: &std::path::Path,
    file_path: &str,
    start_time: f64,
    duration: f64,
    channels: Option<Vec<String>>,
) -> Result<ChunkData, String> {
    let reader = FileReaderFactory::create_reader(path)
        .map_err(|e| format!("Failed to create file reader: {}", e))?;

    let metadata = reader
        .metadata()
        .map_err(|e| format!("Failed to read metadata: {}", e))?;

    let sample_rate = metadata.sample_rate;
    let start_sample = (start_time * sample_rate) as usize;
    let num_samples = (duration * sample_rate) as usize;

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

    Ok(ChunkData {
        data,
        channel_labels: returned_channels,
        sampling_frequency: sample_rate,
        chunk_size,
        chunk_start: start_sample,
        total_samples: Some(metadata.num_samples as u64),
    })
}
