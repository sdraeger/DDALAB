use std::sync::Arc;
use std::path::PathBuf;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use chrono::Utc;
use axum::{
    extract::{Path, Query, State, DefaultBodyLimit},
    http::StatusCode,
    response::Json,
    routing::{get, post, delete},
    Router,
};
use tower_http::cors::{CorsLayer, Any};
use parking_lot::RwLock;
use crate::edf::EDFReader;
use crate::text_reader::TextFileReader;
use crate::file_readers::FileReaderFactory;
use dda_rs::DDARunner;

// File type detection
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FileType {
    CSV,
    ASCII,
    EDF,
    BrainVision,
    EEGLAB,
}

impl FileType {
    fn from_extension(ext: &str) -> Self {
        match ext.to_lowercase().as_str() {
            "csv" => FileType::CSV,
            "ascii" | "txt" => FileType::ASCII,
            "vhdr" => FileType::BrainVision,
            "set" => FileType::EEGLAB,
            _ => FileType::EDF, // Default to EDF for .edf and unknown extensions
        }
    }

    fn from_path(path: &std::path::Path) -> Self {
        path.extension()
            .and_then(|e| e.to_str())
            .map(|ext| Self::from_extension(ext))
            .unwrap_or(FileType::EDF)
    }
}

// API Models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EDFFileInfo {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub duration: Option<f64>,
    pub sample_rate: f64,
    pub total_samples: Option<u64>,
    pub channels: Vec<String>,
    pub created_at: String,
    pub last_modified: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkData {
    pub data: Vec<Vec<f64>>,  // Array of arrays - one array per channel
    pub channel_labels: Vec<String>,
    pub sampling_frequency: f64,
    pub chunk_size: usize,
    pub chunk_start: usize,
    pub total_samples: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDAParameters {
    pub variants: Vec<String>,
    pub window_length: u32,
    pub window_step: u32,
    pub detrending: String,
    pub scale_min: f64,
    pub scale_max: f64,
    pub scale_num: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDAResult {
    pub id: String,
    pub file_path: String,
    pub channels: Vec<String>,
    pub parameters: DDAParameters,
    pub results: Value,
    pub plot_data: Option<Value>,
    #[serde(rename = "Q")]
    pub q_matrix: Option<Vec<Vec<f64>>>,  // Add Q matrix for frontend compatibility
    pub created_at: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    pub status: String,
    pub services: HashMap<String, String>,
    pub timestamp: String,
}

// API State
#[derive(Debug)]
pub struct ApiState {
    pub files: Arc<RwLock<HashMap<String, EDFFileInfo>>>,
    pub analysis_results: Arc<RwLock<HashMap<String, DDAResult>>>,
    pub chunks_cache: Arc<RwLock<HashMap<String, ChunkData>>>,
    pub data_directory: PathBuf,
    pub history_directory: PathBuf,
    pub dda_binary_path: Option<PathBuf>,  // Resolved DDA binary path for bundled apps
}

impl ApiState {
    pub fn new(data_directory: PathBuf) -> Self {
        // Create history directory in app data directory
        let history_directory = data_directory.parent()
            .unwrap_or(&data_directory)
            .join("dda_history");

        // Ensure history directory exists
        if let Err(e) = std::fs::create_dir_all(&history_directory) {
            log::error!("Failed to create history directory: {}", e);
        }

        let state = Self {
            files: Arc::new(RwLock::new(HashMap::new())),
            analysis_results: Arc::new(RwLock::new(HashMap::new())),
            chunks_cache: Arc::new(RwLock::new(HashMap::new())),
            data_directory,
            history_directory,
            dda_binary_path: None,  // Will be set via set_dda_binary_path if in Tauri context
        };

        // Load existing history from disk
        state.load_history_from_disk();

        state
    }

    // Load all saved analyses from disk into memory
    fn load_history_from_disk(&self) {
        log::info!("Loading analysis history from: {:?}", self.history_directory);

        match std::fs::read_dir(&self.history_directory) {
            Ok(entries) => {
                let mut loaded_count = 0;
                let mut results_to_load = Vec::new();

                // First, read and parse all files
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|s| s.to_str()) == Some("json") {
                        match std::fs::read_to_string(&path) {
                            Ok(contents) => {
                                match serde_json::from_str::<DDAResult>(&contents) {
                                    Ok(result) => {
                                        log::info!("Loaded analysis {} with {} channels", result.id, result.channels.len());
                                        log::info!("  Q matrix present: {}", result.q_matrix.is_some());
                                        log::info!("  Plot data present: {}", result.plot_data.is_some());
                                        results_to_load.push(result);
                                        loaded_count += 1;
                                    }
                                    Err(e) => log::warn!("Failed to parse history file {:?}: {}", path, e),
                                }
                            }
                            Err(e) => log::warn!("Failed to read history file {:?}: {}", path, e),
                        }
                    }
                }

                // Then, insert all results into the cache, migrating old format to new if needed
                let mut cache = self.analysis_results.write();
                for mut result in results_to_load {
                    let mut needs_save = false;

                    // Migrate channel names if they use old "Scale N" or "τ=N" format
                    if !result.channels.is_empty() && (result.channels[0].starts_with("Scale ") || result.channels[0].starts_with("τ=")) {
                        if let Some(ref mut results_value) = result.results.as_object_mut() {
                            let scale_min = if let Some(params) = results_value.get("parameters")
                                .and_then(|p| p.as_object()) {
                                params.get("scale_min")
                                    .and_then(|v| v.as_f64())
                                    .unwrap_or(1.0) as i32
                            } else {
                                1
                            };

                            let scale_max = if let Some(params) = results_value.get("parameters")
                                .and_then(|p| p.as_object()) {
                                params.get("scale_max")
                                    .and_then(|v| v.as_f64())
                                    .unwrap_or(result.channels.len() as f64) as i32
                            } else {
                                result.channels.len() as i32
                            };

                            // Try to extract channel names from old label format "τ=1 (CH1, CH2, CH3)"
                            let updated_channel_names: Vec<String> = if let Some(first_channel) = result.channels.first() {
                                if let Some(start) = first_channel.find('(') {
                                    if let Some(end) = first_channel.find(')') {
                                        // Extract channel names from parentheses
                                        let channels_str = &first_channel[start + 1..end];
                                        let extracted: Vec<String> = channels_str
                                            .split(',')
                                            .map(|s| s.trim().to_string())
                                            .collect();

                                        log::info!("Extracted {} channel names from old format: {:?}", extracted.len(), extracted);

                                        // Use extracted names if count matches Q matrix rows
                                        if extracted.len() == result.channels.len() {
                                            extracted
                                        } else {
                                            // Fallback to generic names
                                            (0..result.channels.len())
                                                .map(|i| format!("Channel {}", i + 1))
                                                .collect()
                                        }
                                    } else {
                                        // No closing paren, use generic names
                                        (0..result.channels.len())
                                            .map(|i| format!("Channel {}", i + 1))
                                            .collect()
                                    }
                                } else {
                                    // No opening paren, use generic names
                                    (0..result.channels.len())
                                        .map(|i| format!("Channel {}", i + 1))
                                        .collect()
                                }
                            } else {
                                // No channels at all
                                Vec::new()
                            };

                            log::info!("Migrating channel names from {:?} to {:?}", result.channels, updated_channel_names);
                            result.channels = updated_channel_names.clone();

                            // Update dda_matrix keys if it exists
                            if let Some(variants) = results_value.get_mut("variants")
                                .and_then(|v| v.as_array_mut()) {
                                for variant in variants {
                                    if let Some(dda_matrix) = variant.get_mut("dda_matrix")
                                        .and_then(|dm| dm.as_object_mut()) {
                                        // Rebuild dda_matrix with new keys from Q matrix
                                        if let Some(ref q_matrix) = result.q_matrix {
                                            let mut new_dda_matrix = serde_json::Map::new();
                                            for (i, channel_name) in result.channels.iter().enumerate() {
                                                if i < q_matrix.len() {
                                                    new_dda_matrix.insert(
                                                        channel_name.clone(),
                                                        serde_json::json!(q_matrix[i])
                                                    );
                                                }
                                            }
                                            *dda_matrix = new_dda_matrix;
                                        }
                                    }
                                }
                            }

                            // Update top-level dda_matrix if it exists
                            if let Some(ref q_matrix) = result.q_matrix {
                                let mut new_dda_matrix = serde_json::Map::new();
                                for (i, channel_name) in result.channels.iter().enumerate() {
                                    if i < q_matrix.len() {
                                        new_dda_matrix.insert(
                                            channel_name.clone(),
                                            serde_json::json!(q_matrix[i])
                                        );
                                    }
                                }
                                results_value.insert("dda_matrix".to_string(), serde_json::json!(new_dda_matrix));
                            }

                            needs_save = true;
                        }
                    }

                    // Migrate old format to new format if needed
                    if let Some(ref mut results_value) = result.results.as_object_mut() {
                        // Check if variants and dda_matrix are missing but Q matrix exists
                        if !results_value.contains_key("variants") && !results_value.contains_key("dda_matrix") {
                            if let Some(ref q_matrix) = result.q_matrix {
                                log::info!("Migrating old format to new for analysis {}", result.id);

                                // Get scale range from parameters if available
                                let scale_min = if let Some(params) = results_value.get("parameters")
                                    .and_then(|p| p.as_object()) {
                                    params.get("scale_min")
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(1.0) as i32
                                } else {
                                    1
                                };

                                let scale_max = if let Some(params) = results_value.get("parameters")
                                    .and_then(|p| p.as_object()) {
                                    params.get("scale_max")
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(result.channels.len() as f64) as i32
                                } else {
                                    result.channels.len() as i32
                                };

                                // Create scales array as time axis (x-axis for heatmap)
                                // Get the number of time points from the Q matrix
                                let num_timepoints = q_matrix.get(0).map(|row| row.len()).unwrap_or(0);
                                let scales: Vec<f64> = (0..num_timepoints).map(|i| i as f64 * 0.1).collect();

                                // For old analyses without proper channel info, use generic names
                                // This migration handles the case where no channel info exists at all
                                let updated_channel_names: Vec<String> = (0..q_matrix.len())
                                    .map(|i| format!("Channel {}", i + 1))
                                    .collect();

                                result.channels = updated_channel_names.clone();

                                // Create dda_matrix from Q matrix with updated names
                                let mut dda_matrix = serde_json::Map::new();
                                for (i, channel_name) in result.channels.iter().enumerate() {
                                    if i < q_matrix.len() {
                                        dda_matrix.insert(
                                            channel_name.clone(),
                                            serde_json::json!(q_matrix[i])
                                        );
                                    }
                                }

                                // Add scales array
                                results_value.insert("scales".to_string(), serde_json::json!(scales));

                                // Add variants array
                                results_value.insert("variants".to_string(), serde_json::json!([{
                                    "variant_id": "single_timeseries",
                                    "variant_name": "Single Timeseries (ST)",
                                    "dda_matrix": dda_matrix,
                                    "exponents": serde_json::json!({}),
                                    "quality_metrics": serde_json::json!({})
                                }]));

                                // Also add at top level for compatibility
                                results_value.insert("dda_matrix".to_string(), serde_json::json!(dda_matrix));

                                // Re-save the migrated result
                                if let Err(e) = self.save_to_disk(&result) {
                                    log::warn!("Failed to save migrated result: {}", e);
                                }
                                needs_save = false;  // Already saved
                            }
                        }
                    }

                    // Save if channel names were updated
                    if needs_save {
                        if let Err(e) = self.save_to_disk(&result) {
                            log::warn!("Failed to save updated result: {}", e);
                        }
                    }

                    cache.insert(result.id.clone(), result);
                }

                log::info!("Loaded {} analysis results from history", loaded_count);
            }
            Err(e) => log::warn!("Failed to read history directory: {}", e),
        }
    }

    // Save a single analysis result to disk
    fn save_to_disk(&self, result: &DDAResult) -> Result<(), String> {
        let file_path = self.history_directory.join(format!("{}.json", result.id));

        log::info!("Saving analysis {} with {} channels", result.id, result.channels.len());
        log::info!("  Q matrix present: {}", result.q_matrix.is_some());
        log::info!("  Plot data present: {}", result.plot_data.is_some());

        let json = serde_json::to_string_pretty(result)
            .map_err(|e| format!("Failed to serialize result: {}", e))?;

        log::info!("  Serialized JSON size: {} bytes", json.len());

        std::fs::write(&file_path, json)
            .map_err(|e| format!("Failed to write result to disk: {}", e))?;

        log::info!("Saved analysis {} to disk at {:?}", result.id, file_path);
        Ok(())
    }

    // Delete an analysis result from disk
    fn delete_from_disk(&self, analysis_id: &str) -> Result<(), String> {
        let file_path = self.history_directory.join(format!("{}.json", analysis_id));
        if file_path.exists() {
            std::fs::remove_file(&file_path)
                .map_err(|e| format!("Failed to delete result from disk: {}", e))?;
            log::info!("Deleted analysis {} from disk", analysis_id);
        }
        Ok(())
    }

    /// Set the DDA binary path (should be called with Tauri-resolved path)
    pub fn set_dda_binary_path(&mut self, path: PathBuf) {
        log::info!("Setting DDA binary path to: {:?}", path);
        self.dda_binary_path = Some(path);
    }
}

// API Handlers

// Health endpoint
pub async fn health() -> Json<HealthStatus> {
    let mut services = HashMap::new();
    services.insert("api".to_string(), "healthy".to_string());
    services.insert("embedded".to_string(), "running".to_string());

    Json(HealthStatus {
        status: "healthy".to_string(),
        services,
        timestamp: Utc::now().to_rfc3339(),
    })
}

// File management endpoints
pub async fn list_files(
    State(state): State<Arc<ApiState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let path = params.get("path").map(|p| p.as_str()).unwrap_or("");

    // If path is absolute, use it directly. Otherwise, join with data_directory
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

    // List directory contents (non-recursive)
    if search_path.exists() && search_path.is_dir() {
        log::info!("Listing directory: {:?}", search_path);

        match std::fs::read_dir(&search_path) {
            Ok(entries) => {
                for entry in entries.filter_map(|e| e.ok()) {
                    let entry_path = entry.path();
                    let file_name = entry_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string();

                    if entry_path.is_dir() {
                        // Add directory entry
                        items.push(serde_json::json!({
                            "path": entry_path.to_str().unwrap_or(""),
                            "name": file_name,
                            "size": 0,
                            "last_modified": entry.metadata()
                                .and_then(|m| m.modified())
                                .ok()
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| {
                                    let datetime = chrono::DateTime::<chrono::Utc>::from_timestamp(d.as_secs() as i64, 0);
                                    datetime.map(|dt| dt.to_rfc3339()).unwrap_or_else(|| Utc::now().to_rfc3339())
                                })
                                .unwrap_or_else(|| Utc::now().to_rfc3339()),
                            "is_directory": true
                        }));
                    } else if entry_path.is_file() {
                        // Check if it's a supported data file
                        if let Some(extension) = entry_path.extension() {
                            let ext = extension.to_str().unwrap_or("");
                            // Accept all file types that we can read
                            let file_type = FileType::from_extension(ext);
                            if matches!(file_type, FileType::EDF | FileType::CSV | FileType::ASCII) {
                                log::debug!("Found data file: {:?}", entry_path);

                                // Get file metadata
                                if let Ok(metadata) = entry.metadata() {
                                    let last_modified = metadata.modified()
                                        .ok()
                                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                        .map(|d| {
                                            let datetime = chrono::DateTime::<chrono::Utc>::from_timestamp(d.as_secs() as i64, 0);
                                            datetime.map(|dt| dt.to_rfc3339()).unwrap_or_else(|| Utc::now().to_rfc3339())
                                        })
                                        .unwrap_or_else(|| Utc::now().to_rfc3339());

                                    items.push(serde_json::json!({
                                        "path": entry_path.to_str().unwrap_or(""),
                                        "name": file_name,
                                        "size": metadata.len(),
                                        "last_modified": last_modified,
                                        "is_directory": false
                                    }));
                                }
                            }
                        }
                    }
                }

                log::info!("Listed {} items in directory", items.len());
            }
            Err(e) => {
                log::error!("Failed to read directory: {}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    } else {
        log::warn!("Search path does not exist or is not a directory: {:?}", search_path);
    }

    // Convert to the format expected by the frontend
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

    // Check cache first
    {
        let file_cache = state.files.read();
        if let Some(file_info) = file_cache.get(&file_path) {
            log::info!("Found in cache, channels: {:?}", file_info.channels.len());
            return Ok(Json(file_info.clone()));
        }
    }

    // If not in cache, try to load from filesystem
    let full_path = PathBuf::from(&file_path);
    if let Some(file_info) = create_file_info(full_path).await {
        log::info!("Created file info, channels: {:?}", file_info.channels.len());
        // Update cache
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

    // Check cache first
    {
        let chunk_cache = state.chunks_cache.read();
        if let Some(chunk) = chunk_cache.get(&chunk_key) {
            return Ok(Json(chunk.clone()));
        }
    }

    // Parse channels parameter if provided
    let channels: Option<Vec<String>> = params
        .get("channels")
        .and_then(|s| serde_json::from_str(s).ok());

    // Detect file type and read data in a blocking task
    let file_path_clone = file_path.clone();
    let chunk = tokio::task::spawn_blocking(move || -> Result<ChunkData, String> {
        let path = std::path::Path::new(&file_path_clone);
        if !path.exists() {
            return Err(format!("File not found: {}", file_path_clone));
        }

        // Use the new modular file reader
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

    // Update cache
    {
        let mut chunk_cache = state.chunks_cache.write();
        chunk_cache.insert(chunk_key, chunk.clone());
    }

    Ok(Json(chunk))
}

/// Helper function to read chunk data using the modular file reader architecture
fn read_chunk_with_file_reader(
    path: &std::path::Path,
    file_path: &str,
    start_time: f64,
    duration: f64,
    channels: Option<Vec<String>>,
) -> Result<ChunkData, String> {
    // Create reader using factory
    let reader = FileReaderFactory::create_reader(path)
        .map_err(|e| format!("Failed to create file reader: {}", e))?;

    // Get metadata
    let metadata = reader.metadata()
        .map_err(|e| format!("Failed to read metadata: {}", e))?;

    let sample_rate = metadata.sample_rate;
    let start_sample = (start_time * sample_rate) as usize;
    let num_samples = (duration * sample_rate) as usize;

    // Read chunk
    let channel_names = channels.as_ref().map(|v| v.as_slice());
    let data = reader.read_chunk(start_sample, num_samples, channel_names)
        .map_err(|e| format!("Failed to read chunk: {}", e))?;

    // Get channel labels for the returned data
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

/// Helper function to read file metadata using the modular file reader architecture
fn read_file_metadata_with_reader(path: &std::path::Path) -> Result<EDFFileInfo, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;

    let file_name = path.file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?
        .to_string();

    let file_path = path.to_str()
        .ok_or("Invalid file path")?
        .to_string();

    // Get file timestamps
    let last_modified = metadata.modified().ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| {
            let datetime = chrono::DateTime::<chrono::Utc>::from_timestamp(duration.as_secs() as i64, 0);
            datetime.map(|dt| dt.to_rfc3339()).unwrap_or_else(|| Utc::now().to_rfc3339())
        })
        .unwrap_or_else(|| Utc::now().to_rfc3339());

    let created_at = metadata.created().ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| {
            let datetime = chrono::DateTime::<chrono::Utc>::from_timestamp(duration.as_secs() as i64, 0);
            datetime.map(|dt| dt.to_rfc3339()).unwrap_or_else(|| Utc::now().to_rfc3339())
        })
        .unwrap_or_else(|| last_modified.clone());

    // Create reader using factory
    let reader = FileReaderFactory::create_reader(path)
        .map_err(|e| format!("Failed to create file reader: {}", e))?;

    // Get metadata from reader
    let file_metadata = reader.metadata()
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;

    Ok(EDFFileInfo {
        file_path,
        file_name,
        file_size: metadata.len(),
        duration: Some(file_metadata.duration),
        sample_rate: file_metadata.sample_rate,
        total_samples: Some(file_metadata.num_samples as u64),
        channels: file_metadata.channels,
        created_at,
        last_modified,
    })
}

/// Helper function to generate overview using the modular file reader architecture
fn generate_overview_with_file_reader(
    path: &std::path::Path,
    file_path: &str,
    max_points: usize,
    selected_channels: Option<Vec<String>>,
) -> Result<ChunkData, String> {
    // Create reader using factory
    let reader = FileReaderFactory::create_reader(path)
        .map_err(|e| format!("Failed to create file reader: {}", e))?;

    // Get metadata
    let metadata = reader.metadata()
        .map_err(|e| format!("Failed to read metadata: {}", e))?;

    // Read overview data
    let channel_names = selected_channels.as_ref().map(|v| v.as_slice());
    let data = reader.read_overview(max_points, channel_names)
        .map_err(|e| format!("Failed to read overview: {}", e))?;

    // Get channel labels for the returned data
    let returned_channels = if let Some(selected) = &selected_channels {
        selected.clone()
    } else {
        metadata.channels
    };

    let chunk_size = if !data.is_empty() { data[0].len() } else { 0 };

    Ok(ChunkData {
        data,
        channel_labels: returned_channels,
        sampling_frequency: metadata.sample_rate,
        chunk_size,
        chunk_start: 0,
        total_samples: Some(metadata.num_samples as u64),
    })
}

fn read_edf_file_chunk(
    path: &std::path::Path,
    file_path_clone: &str,
    start_time: f64,
    duration: f64,
    needs_sample_rate: bool,
    channels: Option<Vec<String>>,
) -> Result<ChunkData, String> {
    // Use our custom EDF reader
    let mut edf = EDFReader::new(path)?;

    // Get all channel information
    let all_channel_labels: Vec<String> = edf.signal_headers
        .iter()
        .map(|sh| sh.label.trim().to_string())
        .collect();

    if all_channel_labels.is_empty() {
        return Err(format!("No channels found in EDF file '{}'", file_path_clone));
    }

    // Determine which channels to read
    let (channels_to_read, channel_labels): (Vec<usize>, Vec<String>) = if let Some(ref selected) = channels {
        // Filter to only selected channels
        let mut indices = Vec::new();
        let mut labels = Vec::new();

        for channel_name in selected {
            if let Some(idx) = all_channel_labels.iter().position(|label| label == channel_name) {
                indices.push(idx);
                labels.push(channel_name.clone());
            } else {
                log::warn!("Channel '{}' not found in file", channel_name);
            }
        }

        // If none of the selected channels exist, fall back to first 10 channels
        if indices.is_empty() {
            let num_fallback_channels = all_channel_labels.len().min(10);
            log::warn!("[CHUNK] None of the selected channels found in EDF file, falling back to first {} channels", num_fallback_channels);
            ((0..num_fallback_channels).collect(), all_channel_labels.iter().take(num_fallback_channels).cloned().collect())
        } else {
            (indices, labels)
        }
    } else {
        // Read all channels
        ((0..all_channel_labels.len()).collect(), all_channel_labels.clone())
    };

    // Get sampling rate (use first channel to be read)
    let sample_rate = edf.signal_headers[channels_to_read[0]].sample_frequency(edf.header.duration_of_data_record);

    // Convert sample-based parameters to time-based if needed
    let (actual_start_time, actual_duration) = if needs_sample_rate {
        let start_samples = start_time as usize;
        let num_samples = duration as usize;
        (start_samples as f64 / sample_rate, num_samples as f64 / sample_rate)
    } else {
        (start_time, duration)
    };

    log::info!(
        "Reading chunk from '{}': start_time={:.2}s, duration={:.2}s, channels={:?}",
        file_path_clone, actual_start_time, actual_duration, channel_labels
    );

    // Read data window for selected channels
    let mut data: Vec<Vec<f64>> = Vec::new();
    for &signal_idx in &channels_to_read {
        let signal_data = edf.read_signal_window(signal_idx, actual_start_time, actual_duration)?;
        data.push(signal_data);
    }

    let chunk_start_sample = (actual_start_time * sample_rate) as usize;
    let chunk_size = data.get(0).map(|v| v.len()).unwrap_or(0);

    // Calculate total samples
    let samples_per_record = edf.signal_headers[channels_to_read[0]].num_samples_per_record as u64;
    let total_samples_per_channel = edf.header.num_data_records as u64 * samples_per_record;

    log::info!(
        "Read {} channels, {} samples per channel",
        data.len(), chunk_size
    );

    Ok(ChunkData {
        data,
        channel_labels,
        sampling_frequency: sample_rate,
        chunk_size,
        chunk_start: chunk_start_sample,
        total_samples: Some(total_samples_per_channel),
    })
}

// DDA Analysis endpoints
#[derive(Debug, Deserialize)]
pub struct TimeRange {
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Deserialize)]
pub struct PreprocessingOptions {
    pub detrending: Option<String>,
    pub highpass: Option<f64>,
    pub lowpass: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct AlgorithmSelection {
    pub enabled_variants: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct WindowParameters {
    pub window_length: u32,
    pub window_step: u32,
}

#[derive(Debug, Deserialize)]
pub struct ScaleParameters {
    pub scale_min: f64,
    pub scale_max: f64,
    pub scale_num: u32,
}

#[derive(Debug, Deserialize)]
pub struct DDARequest {
    pub file_path: String,
    #[serde(alias = "channel_list")]
    pub channels: Option<Vec<usize>>,  // Channel indices from frontend
    pub time_range: TimeRange,
    pub preprocessing_options: PreprocessingOptions,
    pub algorithm_selection: AlgorithmSelection,
    pub window_parameters: WindowParameters,
    pub scale_parameters: ScaleParameters,
}

// Get DDA binary path from state or search for it
fn get_dda_binary_path(state: &ApiState) -> Result<PathBuf, StatusCode> {
    if let Some(ref resolved_path) = state.dda_binary_path {
        return Ok(resolved_path.clone());
    }

    if let Ok(env_path) = std::env::var("DDA_BINARY_PATH") {
        return Ok(PathBuf::from(env_path));
    }

    // Fallback: search common locations
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap().parent().unwrap();

    let binary_name = if cfg!(target_os = "windows") {
        "run_DDA_ASCII.exe"
    } else {
        "run_DDA_ASCII"
    };

    let possible_paths = vec![
        repo_root.join("bin").join(binary_name),
        PathBuf::from("./bin").join(binary_name),
        PathBuf::from("../Resources/bin").join(binary_name),
        PathBuf::from("../Resources").join(binary_name),
        PathBuf::from(".").join(binary_name),
        PathBuf::from("./resources/bin").join(binary_name),
        PathBuf::from("./resources").join(binary_name),
        PathBuf::from("/app/bin").join(binary_name),
    ];

    for path in &possible_paths {
        if path.exists() {
            log::info!("Found DDA binary at: {:?}", path);
            return Ok(path.clone());
        }
    }

    log::error!("DDA binary not found. Tried: {:?}", possible_paths);
    Err(StatusCode::INTERNAL_SERVER_ERROR)
}

// Convert API request to dda-rs request
fn convert_to_dda_request(api_req: &DDARequest) -> dda_rs::DDARequest {
    dda_rs::DDARequest {
        file_path: api_req.file_path.clone(),
        channels: api_req.channels.clone(),
        time_range: dda_rs::TimeRange {
            start: api_req.time_range.start,
            end: api_req.time_range.end,
        },
        preprocessing_options: dda_rs::PreprocessingOptions {
            detrending: api_req.preprocessing_options.detrending.clone(),
            highpass: api_req.preprocessing_options.highpass,
            lowpass: api_req.preprocessing_options.lowpass,
        },
        algorithm_selection: dda_rs::AlgorithmSelection {
            enabled_variants: api_req.algorithm_selection.enabled_variants.clone(),
        },
        window_parameters: dda_rs::WindowParameters {
            window_length: api_req.window_parameters.window_length,
            window_step: api_req.window_parameters.window_step,
        },
        scale_parameters: dda_rs::ScaleParameters {
            scale_min: api_req.scale_parameters.scale_min,
            scale_max: api_req.scale_parameters.scale_max,
            scale_num: api_req.scale_parameters.scale_num,
        },
    }
}

pub async fn run_dda_analysis(
    State(state): State<Arc<ApiState>>,
    Json(request): Json<DDARequest>,
) -> Result<Json<DDAResult>, StatusCode> {

    // Check file type - DDA binary only supports EDF files currently
    let file_path = PathBuf::from(&request.file_path);
    let file_type = FileType::from_path(&file_path);
    if file_type != FileType::EDF {
        log::error!("DDA analysis not supported for {:?} files. The run_DDA_ASCII binary only processes EDF format.", file_type);
        return Err(StatusCode::BAD_REQUEST);
    }

    log::info!("Starting DDA analysis for file: {}", request.file_path);

    // Get DDA binary path
    let dda_binary_path = get_dda_binary_path(&state)?;
    log::info!("Using DDA binary at: {}", dda_binary_path.display());

    // Read EDF file to get metadata in a blocking task
    if !file_path.exists() {
        log::error!("Input file not found: {}", request.file_path);
        return Err(StatusCode::NOT_FOUND);
    }

    let start_time = std::time::Instant::now();
    log::info!("⏱️  [TIMING] Starting EDF metadata read...");
    let file_path_for_edf = file_path.clone();
    let end_bound = tokio::task::spawn_blocking(move || -> Result<u64, String> {
        let edf = EDFReader::new(&file_path_for_edf)?;
        let samples_per_record = if !edf.signal_headers.is_empty() {
            edf.signal_headers[0].num_samples_per_record as u64
        } else {
            1
        };
        let total_samples = edf.header.num_data_records as u64 * samples_per_record;
        let safety_margin = 256;
        Ok(total_samples.saturating_sub(safety_margin))
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

    log::info!("⏱️  [TIMING] EDF metadata read completed in {:.2}s", start_time.elapsed().as_secs_f64());

    // Use dda-rs to run analysis
    let runner = DDARunner::new(&dda_binary_path)
        .map_err(|e| {
            log::error!("Failed to create DDA runner: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let dda_request = convert_to_dda_request(&request);

    log::info!("⏱️  [TIMING] Running DDA analysis via dda-rs...");
    let dda_result = runner.run(&dda_request, end_bound).await
        .map_err(|e| {
            log::error!("DDA analysis failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let q_matrix = dda_result.q_matrix.clone();
    let analysis_id = dda_result.id.clone();

    let num_channels = q_matrix.len();
    let num_timepoints = q_matrix[0].len();

    log::info!("Q matrix dimensions: {} channels × {} timepoints", num_channels, num_timepoints);

    // Flatten for summary statistics
    let all_values: Vec<f64> = q_matrix.iter().flat_map(|row| row.iter().copied()).collect();

    // Create parameters object for compatibility with DDAResult
    let parameters = DDAParameters {
        variants: request.algorithm_selection.enabled_variants.clone(),
        window_length: request.window_parameters.window_length,
        window_step: request.window_parameters.window_step,
        detrending: request.preprocessing_options.detrending.clone().unwrap_or_else(|| "linear".to_string()),
        scale_min: request.scale_parameters.scale_min,
        scale_max: request.scale_parameters.scale_max,
        scale_num: request.scale_parameters.scale_num,
    };

    // Get the input EDF channel names that were analyzed
    let input_edf_channels: Vec<String> = {
        let file_cache = state.files.read();
        if let Some(file_info) = file_cache.get(&request.file_path) {
            // If channel indices are specified, get those specific channel names
            if let Some(ref channel_indices) = request.channels {
                channel_indices.iter()
                    .filter_map(|&idx| file_info.channels.get(idx).cloned())
                    .collect()
            } else {
                // Use all channels from the file
                file_info.channels.clone()
            }
        } else {
            log::warn!("File not in cache, cannot determine input EDF channel names");
            Vec::new()
        }
    };

    log::info!("Input EDF channels analyzed: {:?}", input_edf_channels);

    // Use EDF channel names directly - Q matrix rows correspond to input EDF channels
    // Each row represents DDA complexity for one EDF channel
    let channel_names: Vec<String> = if !input_edf_channels.is_empty() && input_edf_channels.len() == num_channels {
        // Use actual EDF channel names
        input_edf_channels.clone()
    } else if !input_edf_channels.is_empty() {
        // If we have fewer names than rows, append indices
        log::warn!("Mismatch: {} EDF channels but {} Q matrix rows", input_edf_channels.len(), num_channels);
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
        // Fallback if no EDF channel info available
        log::warn!("No EDF channel names available, using generic labels");
        (0..num_channels)
            .map(|i| format!("Channel {}", i + 1))
            .collect()
    };

    log::info!("Output channel labels: {:?}", channel_names);

    // Convert Q matrix to dda_matrix format for frontend compatibility
    // dda_matrix is { channelName: [timepoints] }
    let mut dda_matrix = serde_json::Map::new();
    for (i, channel_name) in channel_names.iter().enumerate() {
        dda_matrix.insert(
            channel_name.clone(),
            serde_json::json!(q_matrix[i])
        );
    }

    // Create scales array (time axis for heatmap x-axis)
    let scales: Vec<f64> = (0..num_timepoints).map(|i| i as f64 * 0.1).collect();

    // Update results to include variants format expected by frontend
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
        "variants": [{
            "variant_id": "single_timeseries",
            "variant_name": "Single Timeseries (ST)",
            "dda_matrix": dda_matrix,
            "exponents": serde_json::json!({}),
            "quality_metrics": serde_json::json!({})
        }],
        "dda_matrix": dda_matrix.clone()  // Also include at top level for compatibility
    });

    // Create plot_data structure for compatibility
    let plot_data = serde_json::json!({
        "time_series": {
            "x": (0..num_timepoints).map(|i| i as f64 * 0.1).collect::<Vec<f64>>(),
            "y": q_matrix.clone()
        }
    });

    let result = DDAResult {
        id: analysis_id.clone(),
        file_path: request.file_path,
        channels: channel_names,
        parameters,
        results,
        plot_data: Some(plot_data),
        q_matrix: Some(q_matrix.clone()),  // Already in correct [channels × timepoints] format
        created_at: Utc::now().to_rfc3339(),
        status: "completed".to_string(),
    };

    // Store in cache and save to disk
    {
        let mut analysis_cache = state.analysis_results.write();
        analysis_cache.insert(analysis_id, result.clone());
    }

    // Save to disk for persistence
    log::info!("⏱️  [TIMING] Saving result to disk...");
    let save_start = std::time::Instant::now();
    if let Err(e) = state.save_to_disk(&result) {
        log::error!("Failed to save analysis to disk: {}", e);
    }
    log::info!("⏱️  [TIMING] Save completed in {:.2}s", save_start.elapsed().as_secs_f64());
    eprintln!("⏱️  [DDA TIMING] Result persistence: {:.2}s", save_start.elapsed().as_secs_f64());

    log::info!("⏱️  [TIMING] ✅ Total DDA analysis completed in {:.2}s", start_time.elapsed().as_secs_f64());
    eprintln!("⏱️  [DDA TIMING] ========== TOTAL: {:.2}s ==========\n", start_time.elapsed().as_secs_f64());

    Ok(Json(result))
}
// Helper function to calculate mean
fn calculate_mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / values.len() as f64
}

// Helper function to calculate standard deviation
fn calculate_std(values: &[f64]) -> f64 {
    if values.len() < 2 {
        return 0.0;
    }
    let mean = calculate_mean(values);
    let variance = values.iter()
        .map(|v| (v - mean).powi(2))
        .sum::<f64>() / values.len() as f64;
    variance.sqrt()
}

pub async fn get_analysis_result(
    State(state): State<Arc<ApiState>>,
    Path(analysis_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let analysis_cache = state.analysis_results.read();
    if let Some(result) = analysis_cache.get(&analysis_id) {
        // Wrap result in expected format for frontend compatibility
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

pub async fn list_analysis_history(
    State(state): State<Arc<ApiState>>,
) -> Json<Vec<DDAResult>> {
    let analysis_cache = state.analysis_results.read();
    let mut results: Vec<DDAResult> = analysis_cache.values().cloned().collect();
    results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Json(results)
}

pub async fn save_analysis_to_history(
    State(_state): State<Arc<ApiState>>,
    Json(_payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    // Analysis is already saved in cache by run_dda_analysis
    // This endpoint just returns success for frontend compatibility
    Json(serde_json::json!({
        "success": true,
        "status": "success"
    }))
}

pub async fn delete_analysis_result(
    State(state): State<Arc<ApiState>>,
    Path(analysis_id): Path<String>,
) -> StatusCode {
    let mut analysis_cache = state.analysis_results.write();
    if analysis_cache.remove(&analysis_id).is_some() {
        // Also delete from disk
        if let Err(e) = state.delete_from_disk(&analysis_id) {
            log::error!("Failed to delete analysis from disk: {}", e);
        }
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

// EDF-specific endpoints to match frontend expectations
pub async fn get_edf_info(
    State(state): State<Arc<ApiState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<EDFFileInfo>, StatusCode> {
    let file_path = params.get("file_path").ok_or(StatusCode::BAD_REQUEST)?;
    log::info!("get_edf_info called for: {}", file_path);

    // Check cache first
    {
        let file_cache = state.files.read();
        if let Some(file_info) = file_cache.get(file_path) {
            log::info!("Found in cache, channels: {:?}", file_info.channels.len());
            return Ok(Json(file_info.clone()));
        }
    }

    // If not in cache, try to load from filesystem
    let full_path = PathBuf::from(file_path);
    log::info!("Attempting to load EDF file: {:?}", full_path);

    if let Some(file_info) = create_file_info(full_path).await {
        log::info!("Created file info, channels: {:?}", file_info.channels.len());
        // Update cache
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

    // Support both time-based and sample-based parameters
    let (start_time, duration, needs_sample_rate) = if let Some(chunk_start_str) = params.get("chunk_start") {
        // Sample-based parameters (from frontend)
        let chunk_start: usize = chunk_start_str.parse().unwrap_or(0);
        let chunk_size: usize = params.get("chunk_size")
            .and_then(|s| s.parse().ok())
            .unwrap_or(7680); // Default ~30 seconds at 256 Hz

        // We'll get sample rate from the file when reading
        (chunk_start as f64, chunk_size as f64, true)
    } else {
        // Time-based parameters (backward compatible)
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

    // Parse selected channels from query parameters
    let selected_channels: Option<Vec<String>> = params.get("channels")
        .map(|s| s.split(',').map(|c| c.trim().to_string()).collect());

    let chunk_key = if let Some(ref channels) = selected_channels {
        format!("{}:{}:{}:{}", file_path, start_time, duration, channels.join(","))
    } else {
        format!("{}:{}:{}", file_path, start_time, duration)
    };

    // Check cache first
    {
        let chunk_cache = state.chunks_cache.read();
        if let Some(chunk) = chunk_cache.get(&chunk_key) {
            return Ok(Json(chunk.clone()));
        }
    }

    // Read actual data in a blocking task to avoid blocking the async runtime
    let file_path_clone = file_path.clone();
    let chunk = tokio::task::spawn_blocking(move || -> Result<ChunkData, String> {
        let path = std::path::Path::new(&file_path_clone);
        if !path.exists() {
            return Err(format!("File not found: {}", file_path_clone));
        }

        // Detect file type and route to appropriate reader
        match FileType::from_path(&path) {
            FileType::CSV => {
                log::info!("Reading CSV file: {}", file_path_clone);
                let reader = TextFileReader::from_csv(path).map_err(|e| {
                    log::error!("Failed to parse CSV file '{}': {}", file_path_clone, e);
                    e
                })?;
                log::info!("CSV file loaded: {} channels, {} samples", reader.info.num_channels, reader.info.num_samples);
                read_text_file_chunk(reader, &file_path_clone, start_time, duration, needs_sample_rate, selected_channels)
            }
            FileType::ASCII => {
                log::info!("Reading ASCII file: {}", file_path_clone);
                let reader = TextFileReader::from_ascii(path).map_err(|e| {
                    log::error!("Failed to parse ASCII file '{}': {}", file_path_clone, e);
                    e
                })?;
                log::info!("ASCII file loaded: {} channels, {} samples", reader.info.num_channels, reader.info.num_samples);
                read_text_file_chunk(reader, &file_path_clone, start_time, duration, needs_sample_rate, selected_channels)
            }
            FileType::EDF => {
                read_edf_file_chunk(path, &file_path_clone, start_time, duration, needs_sample_rate, selected_channels)
            }
            FileType::BrainVision | FileType::EEGLAB => {
                log::info!("Reading file using modular reader: {}", file_path_clone);
                read_chunk_with_file_reader(path, &file_path_clone, start_time, duration, selected_channels)
            }
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

    // Update cache
    {
        let mut chunk_cache = state.chunks_cache.write();
        chunk_cache.insert(chunk_key, chunk.clone());
    }

    Ok(Json(chunk))
}

// DDA results endpoint (different from single result)
pub async fn get_dda_results(
    State(state): State<Arc<ApiState>>,
    Query(_params): Query<HashMap<String, String>>,
) -> Json<Vec<DDAResult>> {
    // For compatibility, return the same as history for now
    list_analysis_history(State(state)).await
}

// Analysis status endpoint
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

// Helper functions
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

    // Determine which channels to read
    let (channels_to_read, channel_labels): (Vec<usize>, Vec<String>) = if let Some(ref selected) = selected_channels {
        // Filter to only selected channels
        let mut indices = Vec::new();
        let mut labels = Vec::new();

        for channel_name in selected {
            if let Some(idx) = all_channel_labels.iter().position(|label| label == channel_name) {
                indices.push(idx);
                labels.push(channel_name.clone());
            } else {
                log::warn!("Channel '{}' not found in file", channel_name);
            }
        }

        // If none of the selected channels exist, fall back to first 10 channels
        if indices.is_empty() {
            let num_fallback_channels = all_channel_labels.len().min(10);
            log::warn!("[CHUNK] None of the selected channels found in text file, falling back to first {} channels", num_fallback_channels);
            ((0..num_fallback_channels).collect(), all_channel_labels.iter().take(num_fallback_channels).cloned().collect())
        } else {
            (indices, labels)
        }
    } else {
        // Read all channels
        ((0..all_channel_labels.len()).collect(), all_channel_labels.clone())
    };

    // For text files, assume 1.0 Hz sample rate (1 sample per second)
    let sample_rate = 1.0;

    // Convert parameters based on sample rate
    let (start_sample, num_samples) = if needs_sample_rate {
        // Already in samples
        (start_time as usize, duration as usize)
    } else {
        // Convert from time to samples (at 1 Hz, time == samples)
        (
            (start_time * sample_rate) as usize,
            (duration * sample_rate) as usize
        )
    };

    log::info!(
        "Reading chunk from '{}': start_sample={}, num_samples={}, channels={:?}",
        file_path_clone, start_sample, num_samples, channel_labels
    );

    // Read data window for selected channels
    let data = reader.read_window(start_sample, num_samples, &channels_to_read)?;

    let chunk_size = data.get(0).map(|v| v.len()).unwrap_or(0);

    log::info!(
        "Read {} channels, {} samples per channel",
        data.len(), chunk_size
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

async fn create_file_info(path: PathBuf) -> Option<EDFFileInfo> {
    // Run file reading in a blocking task to avoid blocking the async runtime
    tokio::task::spawn_blocking(move || {
        // Check if path is a broken symlink (e.g., git-annex file not downloaded)
        if path.symlink_metadata().is_ok() && path.symlink_metadata().unwrap().is_symlink() {
            if !path.exists() {
                log::error!("File is a broken symlink (possibly git-annex): {:?}. Run 'git annex get' to download the actual file.", path);
                return None;
            }
        }

        if !path.exists() || !path.is_file() {
            log::error!("File does not exist or is not a file: {:?}", path);
            return None;
        }

        // Try using the new modular file reader first
        match read_file_metadata_with_reader(&path) {
            Ok(file_info) => {
                log::info!("Successfully read file metadata using modular reader for: {:?}", path);
                return Some(file_info);
            }
            Err(e) => {
                log::error!("Modular file reader failed for {:?}: {}", path, e);
            }
        }

        // Fallback to old method if new reader fails

        let metadata = std::fs::metadata(&path).ok()?;
        let file_name = path.file_name()?.to_str()?.to_string();
        let file_path = path.to_str()?.to_string();

        // Get actual file timestamps
        let last_modified = metadata.modified().ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| {
                let datetime = chrono::DateTime::<chrono::Utc>::from_timestamp(duration.as_secs() as i64, 0);
                datetime.map(|dt| dt.to_rfc3339()).unwrap_or_else(|| Utc::now().to_rfc3339())
            })
            .unwrap_or_else(|| Utc::now().to_rfc3339());

        let created_at = metadata.created().ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| {
                let datetime = chrono::DateTime::<chrono::Utc>::from_timestamp(duration.as_secs() as i64, 0);
                datetime.map(|dt| dt.to_rfc3339()).unwrap_or_else(|| Utc::now().to_rfc3339())
            })
            .unwrap_or_else(|| last_modified.clone());

        // Detect file type and route to appropriate reader
        match FileType::from_path(&path) {
            FileType::CSV => {
                match TextFileReader::from_csv(&path) {
                    Ok(reader) => {
                        let channels = reader.info.channel_labels.clone();
                        let num_channels = channels.len();
                        let num_samples = reader.info.num_samples;

                        log::info!("Read CSV file '{}' with {} channels, {} samples", file_name, num_channels, num_samples);

                        // For text files, we don't have a real sampling rate, use 1.0 Hz (1 sample per second)
                        let sample_rate = 1.0;
                        let duration = num_samples as f64 / sample_rate;

                        let file_info = EDFFileInfo {
                            file_path,
                            file_name,
                            file_size: metadata.len(),
                            duration: Some(duration),
                            sample_rate,
                            total_samples: Some(num_samples as u64),
                            channels,
                            created_at,
                            last_modified,
                        };

                        Some(file_info)
                    }
                    Err(e) => {
                        log::error!("Failed to read CSV file '{}': {}", file_name, e);
                        None
                    }
                }
            }
            FileType::ASCII => {
                match TextFileReader::from_ascii(&path) {
                    Ok(reader) => {
                        let channels = reader.info.channel_labels.clone();
                        let num_channels = channels.len();
                        let num_samples = reader.info.num_samples;

                        log::info!("Read ASCII file '{}' with {} channels, {} samples", file_name, num_channels, num_samples);

                        // For text files, we don't have a real sampling rate, use 1.0 Hz (1 sample per second)
                        let sample_rate = 1.0;
                        let duration = num_samples as f64 / sample_rate;

                        let file_info = EDFFileInfo {
                            file_path,
                            file_name,
                            file_size: metadata.len(),
                            duration: Some(duration),
                            sample_rate,
                            total_samples: Some(num_samples as u64),
                            channels,
                            created_at,
                            last_modified,
                        };

                        Some(file_info)
                    }
                    Err(e) => {
                        log::error!("Failed to read ASCII file '{}': {}", file_name, e);
                        None
                    }
                }
            }
            FileType::EDF => {
                match EDFReader::new(&path) {
                    Ok(edf) => {
                        let header = &edf.header;

                        // Get channel labels from EDF header
                        let channels: Vec<String> = edf.signal_headers
                            .iter()
                            .map(|sh| sh.label.trim().to_string())
                            .collect();

                        let num_channels = channels.len();
                        log::info!("Read EDF file '{}' with {} channels", file_name, num_channels);

                        // Get sampling rate (use first channel's rate if available)
                        let sample_rate = if num_channels > 0 {
                            edf.signal_headers[0].sample_frequency(header.duration_of_data_record)
                        } else {
                            256.0
                        };

                        // Calculate total samples per channel
                        let samples_per_record = if num_channels > 0 {
                            edf.signal_headers[0].num_samples_per_record as u64
                        } else {
                            1
                        };
                        let total_samples_per_channel = header.num_data_records as u64 * samples_per_record;

                        // Calculate duration in seconds
                        let duration = edf.total_duration();

                        log::info!(
                            "EDF file '{}': channels={}, sample_rate={:.2}Hz, data_records={}, samples/record={}, total_samples={}, duration={:.2}s ({:.1}min)",
                            file_name, num_channels, sample_rate, header.num_data_records, samples_per_record, total_samples_per_channel, duration, duration / 60.0
                        );

                        let file_info = EDFFileInfo {
                            file_path,
                            file_name,
                            file_size: metadata.len(),
                            duration: Some(duration),
                            sample_rate,
                            total_samples: Some(total_samples_per_channel),
                            channels,
                            created_at,
                            last_modified,
                        };

                        log::info!("Returning file info with duration: {:?}", file_info.duration);

                        Some(file_info)
                    }
                    Err(e) => {
                        log::error!("Failed to read EDF file '{}': {}", file_name, e);
                        None
                    }
                }
            }
            FileType::BrainVision | FileType::EEGLAB => {
                // Use modular reader helper function
                match read_file_metadata_with_reader(&path) {
                    Ok(file_info) => {
                        log::info!("Read file '{}' using modular reader", file_name);
                        Some(file_info)
                    }
                    Err(e) => {
                        log::error!("Failed to read file '{}': {}", file_name, e);
                        None
                    }
                }
            }
        }
    })
    .await
    .ok()
    .flatten()
}

// Catch-all handler to log missing endpoints
async fn handle_404() -> (StatusCode, Json<serde_json::Value>) {
    log::warn!("404 - Endpoint not found");
    (StatusCode::NOT_FOUND, Json(serde_json::json!({
        "error": "Endpoint not found",
        "message": "The requested API endpoint is not implemented in the embedded server"
    })))
}

pub async fn get_edf_overview(
    State(state): State<Arc<ApiState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<ChunkData>, StatusCode> {
    let file_path = params.get("file_path").ok_or(StatusCode::BAD_REQUEST)?;

    // Maximum number of points to return for overview (e.g., 1000-2000 points total)
    let max_points: usize = params.get("max_points")
        .and_then(|s| s.parse().ok())
        .unwrap_or(2000);

    // Parse selected channels
    let selected_channels: Option<Vec<String>> = params.get("channels")
        .map(|s| s.split(',').map(|c| c.trim().to_string()).collect());

    // Create cache key for overview
    let cache_key = if let Some(ref channels) = selected_channels {
        format!("overview:{}:{}:{}", file_path, max_points, channels.join(","))
    } else {
        format!("overview:{}:{}", file_path, max_points)
    };

    // Check cache first
    {
        let chunk_cache = state.chunks_cache.read();
        if let Some(chunk) = chunk_cache.get(&cache_key) {
            log::info!("[OVERVIEW] Cache HIT for {}", file_path);
            return Ok(Json(chunk.clone()));
        }
    }

    log::info!("[OVERVIEW] Generating overview for {} with max_points={}", file_path, max_points);

    // Read overview data in a blocking task
    let file_path_clone = file_path.clone();
    let chunk = tokio::task::spawn_blocking(move || -> Result<ChunkData, String> {
        let path = std::path::Path::new(&file_path_clone);
        if !path.exists() {
            return Err(format!("File not found: {}", file_path_clone));
        }

        // Detect file type and generate overview
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
            FileType::BrainVision | FileType::EEGLAB => {
                log::info!("Generating overview using modular reader: {}", file_path_clone);
                generate_overview_with_file_reader(path, &file_path_clone, max_points, selected_channels)
            }
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

    // Update cache
    {
        let mut chunk_cache = state.chunks_cache.write();
        chunk_cache.insert(cache_key, chunk.clone());
    }

    Ok(Json(chunk))
}

fn generate_edf_file_overview(
    path: &std::path::Path,
    file_path: &str,
    max_points: usize,
    selected_channels: Option<Vec<String>>,
) -> Result<ChunkData, String> {
    let mut edf = EDFReader::new(path).map_err(|e| format!("Failed to open EDF file: {}", e))?;

    // Determine which channels to read
    let channels_to_read: Vec<usize>;
    let channel_labels: Vec<String>;

    if let Some(ref selected) = selected_channels {
        let filtered_channels: Vec<usize> = selected
            .iter()
            .filter_map(|name| edf.signal_headers.iter().position(|h| h.label.trim() == name.trim()))
            .collect();

        // If none of the selected channels exist, fall back to first 10 channels
        if filtered_channels.is_empty() {
            let num_fallback_channels = edf.signal_headers.len().min(10);
            log::warn!("[OVERVIEW] None of the selected channels found in EDF file, falling back to first {} channels", num_fallback_channels);
            channels_to_read = (0..num_fallback_channels).collect();
            channel_labels = edf.signal_headers.iter().take(num_fallback_channels).map(|h| h.label.trim().to_string()).collect();
        } else {
            channels_to_read = filtered_channels;
            // Only include channel labels that were found
            channel_labels = channels_to_read.iter()
                .map(|&idx| edf.signal_headers[idx].label.trim().to_string())
                .collect();
        }
    } else {
        channels_to_read = (0..edf.signal_headers.len()).collect();
        channel_labels = edf.signal_headers.iter().map(|h| h.label.trim().to_string()).collect();
    }

    if channels_to_read.is_empty() {
        return Err("No valid channels found".to_string());
    }

    let sample_rate = edf.signal_headers[channels_to_read[0]].sample_frequency(edf.header.duration_of_data_record);
    let duration = edf.header.num_data_records as f64 * edf.header.duration_of_data_record;
    let total_samples = (duration * sample_rate) as usize;

    log::info!(
        "[OVERVIEW] File: '{}', duration={:.2}s, total_samples={}, max_points={}",
        file_path, duration, total_samples, max_points
    );

    // Calculate downsampling ratio using min-max approach
    let downsample_ratio = (total_samples as f64 / max_points as f64).ceil() as usize;
    let bucket_size = downsample_ratio.max(1);

    log::info!("[OVERVIEW] Using min-max downsampling with bucket_size={}", bucket_size);

    // Read and downsample data for each channel
    let mut downsampled_data: Vec<Vec<f64>> = Vec::new();

    for &signal_idx in &channels_to_read {
        // Read entire channel (this is expensive but only done once per file)
        let full_data = edf.read_signal_window(signal_idx, 0.0, duration)?;

        // Apply min-max downsampling
        let mut channel_downsampled = Vec::with_capacity(max_points * 2);

        for chunk in full_data.chunks(bucket_size) {
            if chunk.is_empty() {
                continue;
            }

            // Store both min and max for this bucket to preserve peaks
            let min_val = chunk.iter().copied().fold(f64::INFINITY, f64::min);
            let max_val = chunk.iter().copied().fold(f64::NEG_INFINITY, f64::max);

            // Alternate min/max to create envelope visualization
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
    let sample_rate = 1.0; // Text files don't have sample rate, use 1 Hz as default
    let total_samples = reader.info.num_samples;

    // Determine which channels to read
    let channels_to_read: Vec<usize>;
    let channel_labels: Vec<String>;

    if let Some(ref selected) = selected_channels {
        let filtered_channels: Vec<usize> = selected
            .iter()
            .filter_map(|name| reader.info.channel_labels.iter().position(|n| n == name))
            .collect();

        // If none of the selected channels exist, fall back to first 10 channels
        if filtered_channels.is_empty() {
            let num_fallback_channels = reader.info.num_channels.min(10);
            log::warn!("[OVERVIEW] None of the selected channels found in text file, falling back to first {} channels", num_fallback_channels);
            channels_to_read = (0..num_fallback_channels).collect();
            channel_labels = reader.info.channel_labels.iter().take(num_fallback_channels).cloned().collect();
        } else {
            channels_to_read = filtered_channels;
            // Only include channel labels that were found
            channel_labels = channels_to_read.iter()
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
        file_path, total_samples, max_points
    );

    // Calculate downsampling ratio
    let downsample_ratio = (total_samples as f64 / max_points as f64).ceil() as usize;
    let bucket_size = downsample_ratio.max(1);

    log::info!("[OVERVIEW] Using min-max downsampling with bucket_size={}", bucket_size);

    // Read entire file for selected channels
    let full_data = reader.read_window(0, total_samples, &channels_to_read)?;

    // Apply min-max downsampling
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

// Create the API router
pub fn create_router(state: Arc<ApiState>) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/files/list", get(list_files))
        .route("/api/files/{file_path}", get(get_file_info))
        .route("/api/files/{file_path}/chunk", get(get_file_chunk))
        .route("/api/edf/info", get(get_edf_info))
        .route("/api/edf/data", get(get_edf_data))
        .route("/api/edf/overview", get(get_edf_overview))
        .route("/api/dda", post(run_dda_analysis))
        .route("/api/dda/analyze", post(run_dda_analysis))
        .route("/api/dda/results", get(get_dda_results))
        .route("/api/dda/results/{analysis_id}", get(get_analysis_result))
        .route("/api/dda/results/{analysis_id}", delete(delete_analysis_result))
        .route("/api/dda/status/{analysis_id}", get(get_analysis_status))
        .route("/api/dda/history", get(list_analysis_history))
        .route("/api/dda/history/save", post(save_analysis_to_history))
        .route("/api/dda/history/{analysis_id}", get(get_analysis_result))
        .route("/api/dda/history/{analysis_id}", delete(delete_analysis_result))
        .fallback(handle_404)
        .layer(DefaultBodyLimit::max(100 * 1024 * 1024)) // 100 MB limit for large DDA results
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state)
}

// Test module
#[cfg(test)]
#[path = "embedded_api_tests.rs"]
mod embedded_api_tests;

// Start the embedded API server
pub async fn start_embedded_api_server(port: u16, data_directory: PathBuf, dda_binary_path: Option<PathBuf>) -> anyhow::Result<()> {
    log::info!("🚀 Initializing embedded API server...");
    log::info!("📁 Data directory: {:?}", data_directory);
    log::info!("🔌 Port: {}", port);
    if let Some(ref path) = dda_binary_path {
        log::info!("🔧 DDA binary path: {:?}", path);
    }

    // First, test if port is available
    let bind_addr = format!("127.0.0.1:{}", port);
    log::info!("🔍 Testing port availability: {}", bind_addr);

    // Quick port test with retry logic
    let mut port_to_use = port;
    let mut attempts = 0;
    let test_listener = loop {
        match tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port_to_use)).await {
            Ok(listener) => {
                log::info!("✅ Port {} is available", port_to_use);
                break listener;
            }
            Err(e) => {
                log::warn!("⚠️ Port {} is not available: {}", port_to_use, e);
                attempts += 1;
                if attempts >= 3 {
                    log::error!("❌ Failed to find available port after {} attempts", attempts);
                    return Err(anyhow::anyhow!("No available ports found after trying {}, {}, and {}", port, port + 1, port + 2));
                }
                port_to_use += 1;
                log::info!("🔄 Trying next port: {}", port_to_use);
            }
        }
    };

    // Update bind_addr with the actual port we'll use
    let bind_addr = format!("127.0.0.1:{}", port_to_use);
    drop(test_listener); // Release the test listener

    log::info!("🏗️  Creating API state and router...");
    let mut api_state = ApiState::new(data_directory);
    if let Some(binary_path) = dda_binary_path {
        api_state.set_dda_binary_path(binary_path);
    }
    let state = Arc::new(api_state);
    let app = create_router(state);
    log::info!("✅ Router created successfully");

    log::info!("🔗 Binding to: {}", bind_addr);
    let listener = tokio::net::TcpListener::bind(&bind_addr).await
        .map_err(|e| anyhow::anyhow!("Failed to bind to {}: {}", bind_addr, e))?;

    log::info!("✅ Successfully bound to port {}", port_to_use);
    log::info!("🌐 Embedded API server listening on http://127.0.0.1:{}", port_to_use);
    log::info!("🎯 Health endpoint: http://127.0.0.1:{}/api/health", port_to_use);
    log::info!("🚀 Starting server...");

    // Start serving - this will run indefinitely until the task is aborted
    log::info!("🔄 Starting axum::serve...");
    match axum::serve(listener, app).await {
        Ok(_) => {
            log::info!("✅ Server completed normally (shutdown)");
            Ok(())
        }
        Err(e) => {
            log::error!("❌ Server error: {}", e);
            Err(anyhow::anyhow!("Server error: {}", e))
        }
    }
}
