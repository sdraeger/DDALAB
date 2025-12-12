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

/// Validate that a path is within the allowed data directory.
/// Returns the canonicalized path if valid, or an error if the path escapes the data directory.
fn validate_path_within_data_dir(
    requested_path: &str,
    data_directory: &std::path::Path,
) -> Result<PathBuf, StatusCode> {
    // Construct the full path
    let path_buf = if requested_path.is_empty() {
        data_directory.to_path_buf()
    } else {
        let requested = PathBuf::from(requested_path);
        if requested.is_absolute() {
            requested
        } else {
            data_directory.join(requested_path)
        }
    };

    // Canonicalize the data directory (must exist)
    let canonical_data_dir = data_directory.canonicalize().map_err(|e| {
        log::error!("Failed to canonicalize data directory: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // For the requested path, we need to handle the case where it might not exist yet
    // Use the parent directory to canonicalize, then append the filename
    let canonical_path = if path_buf.exists() {
        path_buf.canonicalize().map_err(|e| {
            log::error!("Failed to canonicalize requested path: {}", e);
            StatusCode::BAD_REQUEST
        })?
    } else {
        // Path doesn't exist - try to canonicalize parent
        if let Some(parent) = path_buf.parent() {
            if parent.exists() {
                let canonical_parent = parent.canonicalize().map_err(|e| {
                    log::error!("Failed to canonicalize parent path: {}", e);
                    StatusCode::BAD_REQUEST
                })?;
                if let Some(filename) = path_buf.file_name() {
                    canonical_parent.join(filename)
                } else {
                    return Err(StatusCode::BAD_REQUEST);
                }
            } else {
                // Parent doesn't exist either - reject
                log::warn!("Path does not exist: {:?}", path_buf);
                return Err(StatusCode::NOT_FOUND);
            }
        } else {
            return Err(StatusCode::BAD_REQUEST);
        }
    };

    // Security check: ensure the canonical path starts with the data directory
    if !canonical_path.starts_with(&canonical_data_dir) {
        log::warn!(
            "Path traversal attempt detected: {:?} is outside {:?}",
            canonical_path,
            canonical_data_dir
        );
        return Err(StatusCode::FORBIDDEN);
    }

    Ok(canonical_path)
}

/// Check if a path is a git-annex symlink that hasn't been downloaded.
///
/// SECURITY: This function validates that symlink targets stay within the
/// repository bounds by ensuring they point to .git/annex/objects within
/// the same repository, preventing path traversal attacks via malicious symlinks.
fn is_git_annex_placeholder(path: &std::path::Path) -> bool {
    // Use symlink_metadata to check if it's a symlink without following it
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() {
            // Read the symlink target
            if let Ok(target) = std::fs::read_link(path) {
                let target_str = target.to_string_lossy();

                // Git-annex symlinks point to .git/annex/objects/...
                if !target_str.contains(".git/annex/objects")
                    && !target_str.contains("annex/objects")
                {
                    return false;
                }

                // SECURITY: Validate that the resolved symlink target stays within bounds
                // For git-annex symlinks, the target should resolve to a path that:
                // 1. Contains the .git/annex/objects pattern
                // 2. When canonicalized relative to the symlink's directory, stays within
                //    the repository (doesn't escape via excessive ../ sequences)
                if let Some(parent) = path.parent() {
                    // Resolve the relative symlink target
                    let resolved = parent.join(&target);

                    // Check for path traversal attempts:
                    // - Count how many ".." components are in the path
                    // - Git-annex symlinks typically have 4-6 ".." to reach .git
                    // - More than 10 is suspicious and likely an attack
                    let dotdot_count = target
                        .components()
                        .filter(|c| matches!(c, std::path::Component::ParentDir))
                        .count();

                    if dotdot_count > 10 {
                        log::warn!(
                            "Suspicious symlink with {} parent directory traversals: {:?}",
                            dotdot_count,
                            path
                        );
                        return false;
                    }

                    // Validate the resolved path contains .git/annex in the expected location
                    // The canonical path should contain .git/annex/objects
                    let resolved_str = resolved.to_string_lossy();
                    if !resolved_str.contains(".git/annex/objects") {
                        log::warn!(
                            "Symlink claims to be git-annex but resolved path doesn't contain .git/annex/objects: {:?}",
                            resolved
                        );
                        return false;
                    }

                    // Additional check: if the file exists (symlink is valid), verify it's
                    // actually within a .git directory structure
                    if path.exists() {
                        if let Ok(canonical) = path.canonicalize() {
                            let canonical_str = canonical.to_string_lossy();
                            if !canonical_str.contains(".git/annex/objects") {
                                log::warn!(
                                    "Canonical path of symlink doesn't contain .git/annex/objects: {:?}",
                                    canonical
                                );
                                return false;
                            }
                        }
                    }
                }

                // Check if the target actually exists (resolved through the symlink)
                // If path.exists() is false but symlink_metadata succeeds, it's a broken symlink
                return !path.exists();
            }
        }
    }
    false
}

/// Helper function to process a single directory entry
fn process_directory_entry(entry: &std::fs::DirEntry) -> Option<serde_json::Value> {
    let entry_path = entry.path();
    let file_name = entry_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    // Check for git-annex placeholder (broken symlink to annex)
    let is_annex_placeholder = is_git_annex_placeholder(&entry_path);

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
    } else if entry_path.is_file() || is_annex_placeholder {
        // Handle both regular files and git-annex placeholders
        if let Some(extension) = entry_path.extension() {
            let ext = extension.to_str().unwrap_or("");
            let file_type = FileType::from_extension(ext);

            // Include supported files and MEG files (with warning flag)
            if file_type.is_supported() || file_type.is_meg() {
                // For annex placeholders, use symlink_metadata; for regular files, use metadata
                let metadata_result = if is_annex_placeholder {
                    std::fs::symlink_metadata(&entry_path)
                } else {
                    entry.metadata()
                };

                if let Ok(metadata) = metadata_result {
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

                    // For annex placeholders, size is 0 (not downloaded)
                    let file_size = if is_annex_placeholder {
                        0
                    } else {
                        metadata.len()
                    };

                    return Some(serde_json::json!({
                        "path": entry_path.to_str().unwrap_or(""),
                        "name": file_name,
                        "size": file_size,
                        "last_modified": last_modified,
                        "is_directory": false,
                        "is_meg": file_type.is_meg(),
                        "is_supported": file_type.is_supported(),
                        "is_annex_placeholder": is_annex_placeholder
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

    // Validate path is within data directory (prevents path traversal attacks)
    let search_path = validate_path_within_data_dir(path, &state.data_directory)?;

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

                log::info!("Listed {} items from {} entries", items.len(), num_entries);
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

    // Validate path is within data directory (prevents path traversal attacks)
    let validated_path = validate_path_within_data_dir(&file_path, &state.data_directory)?;
    let validated_path_str = validated_path.to_string_lossy().to_string();

    {
        let file_cache = state.files.read();
        if let Some(file_info) = file_cache.get(&validated_path_str) {
            log::info!("Found in cache, channels: {:?}", file_info.channels.len());
            // Dereference Arc to get inner value for Json response
            return Ok(Json((*file_info).clone()));
        }
    }

    if let Some(file_info) = create_file_info(validated_path.clone()).await {
        log::info!(
            "Created file info, channels: {:?}",
            file_info.channels.len()
        );
        // Clone for response before moving into cache
        let response = file_info.clone();
        {
            let mut file_cache = state.files.write();
            file_cache.insert(validated_path_str, file_info);
        }
        Ok(Json(response))
    } else {
        log::warn!("File not found: {:?}", validated_path);
        Err(StatusCode::NOT_FOUND)
    }
}

/// Get a chunk of file data for visualization.
/// Uses Arc<ChunkData> for zero-copy responses - avoids ~5MB clones on every request.
pub async fn get_file_chunk(
    State(state): State<Arc<ApiState>>,
    Path(file_path): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Arc<ChunkData>>, StatusCode> {
    // Validate path is within data directory (prevents path traversal attacks)
    let validated_path = validate_path_within_data_dir(&file_path, &state.data_directory)?;
    let validated_path_str = validated_path.to_string_lossy().to_string();

    let start_time: f64 = params
        .get("start_time")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0);
    let duration: f64 = params
        .get("duration")
        .and_then(|s| s.parse().ok())
        .unwrap_or(30.0);

    let chunk_key = format!("{}:{}:{}", validated_path_str, start_time, duration);

    {
        let chunk_cache = state.chunks_cache.read();
        if let Some(chunk) = chunk_cache.get(&chunk_key) {
            // ZERO-COPY: Return Arc directly - serde serializes Arc<T> same as T.
            return Ok(Json(chunk));
        }
    }

    let channels: Option<Vec<String>> = params
        .get("channels")
        .and_then(|s| serde_json::from_str(s).ok());

    let validated_path_clone = validated_path.clone();
    let validated_path_str_clone = validated_path_str.clone();
    let chunk = tokio::task::spawn_blocking(move || -> Result<ChunkData, String> {
        if !validated_path_clone.exists() {
            return Err(format!("File not found: {}", validated_path_str_clone));
        }

        read_chunk_with_file_reader(
            &validated_path_clone,
            &validated_path_str_clone,
            start_time,
            duration,
            channels,
        )
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

    // ZERO-COPY: Wrap in Arc once, insert Arc clone into cache, return same Arc.
    let chunk_arc = Arc::new(chunk);
    {
        let mut chunk_cache = state.chunks_cache.write();
        chunk_cache.insert_arc(chunk_key, Arc::clone(&chunk_arc));
    }

    Ok(Json(chunk_arc))
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
