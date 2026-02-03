//! File Operations Tauri IPC Commands
//!
//! Provides pure Tauri IPC commands for file operations, replacing HTTP endpoints
//! to avoid enterprise security tools (Proofpoint URLdefense) intercepting localhost
//! traffic in hospital environments.
//!
//! Commands:
//! - list_directory: List contents of a directory
//! - list_data_files: List supported data files (EDF, BrainVision, etc.)
//! - update_data_directory: Update the working data directory
//! - get_current_data_directory: Get the current data directory

use chrono::Utc;
use ddalab_tauri::api::state::ApiState;
use ddalab_tauri::api::utils::FileType;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: Option<u64>,
    pub modified: Option<String>,
    pub extension: Option<String>,
    pub is_supported: Option<bool>,
    pub is_meg: Option<bool>,
    pub is_annex_placeholder: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub path: String,
    pub entries: Vec<FileEntry>,
    pub total_files: usize,
    pub total_directories: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDirectoryResponse {
    pub path: String,
    pub is_valid: bool,
}

// ============================================================================
// Supported File Extensions
// ============================================================================

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "edf", "bdf", // EDF/BDF formats
    "vhdr", "vmrk", "eeg", // BrainVision format
    "set", // EEGLAB format
    "fif", // FIFF/FIF format (Neuromag/Elekta MEG)
    "nii", "nii.gz", // NIfTI format
    "xdf",    // XDF format (Lab Streaming Layer)
    "csv", "txt", // Text formats
    "nwb", // Neurodata Without Borders
];

fn is_supported_extension(ext: &str) -> bool {
    let lower = ext.to_lowercase();
    SUPPORTED_EXTENSIONS.contains(&lower.as_str())
}

// ============================================================================
// Helper Functions
// ============================================================================

fn is_git_annex_placeholder(path: &Path) -> bool {
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() {
            if let Ok(target) = std::fs::read_link(path) {
                let target_str = target.to_string_lossy();
                if target_str.contains(".git/annex/objects") || target_str.contains("annex/objects")
                {
                    return !path.exists();
                }
            }
        }
    }
    false
}

fn get_modified_time(metadata: &std::fs::Metadata) -> Option<String> {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| {
            chrono::DateTime::<chrono::Utc>::from_timestamp(d.as_secs() as i64, 0)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_else(|| Utc::now().to_rfc3339())
        })
}

fn validate_path_within_directory(
    requested_path: &str,
    base_directory: &Path,
) -> Result<PathBuf, String> {
    let path_buf = if requested_path.is_empty() {
        base_directory.to_path_buf()
    } else {
        let requested = PathBuf::from(requested_path);
        if requested.is_absolute() {
            requested
        } else {
            base_directory.join(requested_path)
        }
    };

    let canonical_base = base_directory
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize base directory: {}", e))?;

    let canonical_path = if path_buf.exists() {
        path_buf
            .canonicalize()
            .map_err(|e| format!("Failed to canonicalize requested path: {}", e))?
    } else {
        if let Some(parent) = path_buf.parent() {
            if parent.exists() {
                let canonical_parent = parent
                    .canonicalize()
                    .map_err(|e| format!("Failed to canonicalize parent path: {}", e))?;
                if let Some(filename) = path_buf.file_name() {
                    canonical_parent.join(filename)
                } else {
                    return Err("Invalid path - no filename".to_string());
                }
            } else {
                return Err("Path does not exist".to_string());
            }
        } else {
            return Err("Invalid path".to_string());
        }
    };

    if !canonical_path.starts_with(&canonical_base) {
        log::warn!(
            "Path traversal attempt detected: {:?} is outside {:?}",
            canonical_path,
            canonical_base
        );
        return Err("Access denied: path is outside data directory".to_string());
    }

    Ok(canonical_path)
}

fn process_directory_entry(entry: &std::fs::DirEntry) -> Option<FileEntry> {
    let entry_path = entry.path();
    let file_name = entry_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let is_annex = is_git_annex_placeholder(&entry_path);

    if entry_path.is_dir() {
        let modified = entry.metadata().ok().as_ref().and_then(get_modified_time);

        Some(FileEntry {
            name: file_name,
            path: entry_path.to_string_lossy().to_string(),
            is_directory: true,
            size: None,
            modified,
            extension: None,
            is_supported: None,
            is_meg: None,
            is_annex_placeholder: None,
        })
    } else if entry_path.is_file() || is_annex {
        let extension = entry_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase());

        let file_type = extension
            .as_ref()
            .map(|ext| FileType::from_extension(ext))
            .unwrap_or(FileType::Unknown);

        let metadata_result = if is_annex {
            std::fs::symlink_metadata(&entry_path)
        } else {
            entry.metadata()
        };

        if let Ok(metadata) = metadata_result {
            let modified = get_modified_time(&metadata);
            let size = if is_annex { None } else { Some(metadata.len()) };

            Some(FileEntry {
                name: file_name,
                path: entry_path.to_string_lossy().to_string(),
                is_directory: false,
                size,
                modified,
                extension,
                is_supported: Some(file_type.is_supported()),
                is_meg: Some(file_type.is_meg()),
                is_annex_placeholder: Some(is_annex),
            })
        } else {
            None
        }
    } else {
        None
    }
}

fn process_data_file_entry(entry: &std::fs::DirEntry) -> Option<FileEntry> {
    let entry_path = entry.path();
    let file_name = entry_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let is_annex = is_git_annex_placeholder(&entry_path);

    if entry_path.is_dir() {
        let modified = entry.metadata().ok().as_ref().and_then(get_modified_time);

        Some(FileEntry {
            name: file_name,
            path: entry_path.to_string_lossy().to_string(),
            is_directory: true,
            size: None,
            modified,
            extension: None,
            is_supported: None,
            is_meg: None,
            is_annex_placeholder: None,
        })
    } else if entry_path.is_file() || is_annex {
        let extension = entry_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase());

        if let Some(ref ext) = extension {
            let file_type = FileType::from_extension(ext);

            if file_type.is_supported() || file_type.is_meg() {
                let metadata_result = if is_annex {
                    std::fs::symlink_metadata(&entry_path)
                } else {
                    entry.metadata()
                };

                if let Ok(metadata) = metadata_result {
                    let modified = get_modified_time(&metadata);
                    let size = if is_annex { None } else { Some(metadata.len()) };

                    return Some(FileEntry {
                        name: file_name,
                        path: entry_path.to_string_lossy().to_string(),
                        is_directory: false,
                        size,
                        modified,
                        extension: Some(ext.clone()),
                        is_supported: Some(file_type.is_supported()),
                        is_meg: Some(file_type.is_meg()),
                        is_annex_placeholder: Some(is_annex),
                    });
                }
            }
        }
        None
    } else {
        None
    }
}

fn sort_entries(entries: &mut Vec<FileEntry>) {
    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// List contents of a directory
#[tauri::command]
pub async fn list_directory(
    api_state: State<'_, Arc<ApiState>>,
    path: Option<String>,
) -> Result<DirectoryListing, String> {
    let data_dir = api_state.get_data_directory();
    let requested_path = path.unwrap_or_default();

    log::info!(
        "[FILE_IPC] list_directory called for: {} (data_dir: {:?})",
        requested_path,
        data_dir
    );

    let search_path = if requested_path.is_empty() {
        data_dir.clone()
    } else {
        validate_path_within_directory(&requested_path, &data_dir)?
    };

    if !search_path.exists() {
        return Err(format!("Directory does not exist: {:?}", search_path));
    }

    if !search_path.is_dir() {
        return Err(format!("Path is not a directory: {:?}", search_path));
    }

    let entries_result =
        std::fs::read_dir(&search_path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let dir_entries: Vec<std::fs::DirEntry> = entries_result.filter_map(|e| e.ok()).collect();

    let mut entries: Vec<FileEntry> = dir_entries
        .par_iter()
        .filter_map(process_directory_entry)
        .collect();

    sort_entries(&mut entries);

    let total_directories = entries.iter().filter(|e| e.is_directory).count();
    let total_files = entries.iter().filter(|e| !e.is_directory).count();

    log::info!(
        "[FILE_IPC] Listed {} entries ({} directories, {} files) from {:?}",
        entries.len(),
        total_directories,
        total_files,
        search_path
    );

    Ok(DirectoryListing {
        path: search_path.to_string_lossy().to_string(),
        entries,
        total_files,
        total_directories,
    })
}

/// List supported data files (EDF, BrainVision, etc.) in a directory
#[tauri::command]
pub async fn list_data_files(
    api_state: State<'_, Arc<ApiState>>,
    path: Option<String>,
) -> Result<DirectoryListing, String> {
    let data_dir = api_state.get_data_directory();
    let requested_path = path.unwrap_or_default();

    log::info!(
        "[FILE_IPC] list_data_files called for: {} (data_dir: {:?})",
        requested_path,
        data_dir
    );

    let search_path = if requested_path.is_empty() {
        data_dir.clone()
    } else {
        validate_path_within_directory(&requested_path, &data_dir)?
    };

    if !search_path.exists() {
        return Err(format!("Directory does not exist: {:?}", search_path));
    }

    if !search_path.is_dir() {
        return Err(format!("Path is not a directory: {:?}", search_path));
    }

    let entries_result =
        std::fs::read_dir(&search_path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let dir_entries: Vec<std::fs::DirEntry> = entries_result.filter_map(|e| e.ok()).collect();

    let mut entries: Vec<FileEntry> = dir_entries
        .par_iter()
        .filter_map(process_data_file_entry)
        .collect();

    sort_entries(&mut entries);

    let total_directories = entries.iter().filter(|e| e.is_directory).count();
    let total_files = entries.iter().filter(|e| !e.is_directory).count();

    log::info!(
        "[FILE_IPC] Listed {} data entries ({} directories, {} files) from {:?}",
        entries.len(),
        total_directories,
        total_files,
        search_path
    );

    Ok(DirectoryListing {
        path: search_path.to_string_lossy().to_string(),
        entries,
        total_files,
        total_directories,
    })
}

/// Update the working data directory
#[tauri::command]
pub async fn update_data_directory(
    app_handle: AppHandle,
    api_state: State<'_, Arc<ApiState>>,
    path: String,
) -> Result<DataDirectoryResponse, String> {
    log::info!("[FILE_IPC] update_data_directory called with: {}", path);

    let new_path = PathBuf::from(&path);

    if !new_path.exists() {
        log::warn!(
            "[FILE_IPC] Attempted to set non-existent data directory: {:?}",
            new_path
        );
        return Err(format!("Path does not exist: {}", path));
    }

    if !new_path.is_dir() {
        log::warn!(
            "[FILE_IPC] Attempted to set data directory to non-directory: {:?}",
            new_path
        );
        return Err(format!("Path is not a directory: {}", path));
    }

    // Update the ApiState
    api_state.set_data_directory(new_path.clone());

    // Also update the app-level data directory config (for persistence)
    if let Some(state) = app_handle.try_state::<parking_lot::RwLock<Option<super::data_directory_commands::DataDirectoryConfig>>>() {
        let mut guard = state.write();
        *guard = Some(super::data_directory_commands::DataDirectoryConfig {
            path: path.clone(),
        });
    }

    // Persist to disk
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;

    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;

    let config_file = config_dir.join("data_directory.json");
    let config = super::data_directory_commands::DataDirectoryConfig { path: path.clone() };
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&config_file, json)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    log::info!("[FILE_IPC] Data directory updated to: {:?}", new_path);

    Ok(DataDirectoryResponse {
        path,
        is_valid: true,
    })
}

/// Get the current data directory
#[tauri::command]
pub async fn get_current_data_directory(
    api_state: State<'_, Arc<ApiState>>,
) -> Result<DataDirectoryResponse, String> {
    let data_dir = api_state.get_data_directory();
    let path_str = data_dir.to_string_lossy().to_string();
    let is_valid = data_dir.exists() && data_dir.is_dir();

    log::debug!(
        "[FILE_IPC] get_current_data_directory returning: {} (valid: {})",
        path_str,
        is_valid
    );

    Ok(DataDirectoryResponse {
        path: path_str,
        is_valid,
    })
}
