use std::sync::Arc;
use std::path::PathBuf;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use chrono::Utc;
use uuid::Uuid;
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
                        // Check if it's an EDF file
                        if let Some(extension) = entry_path.extension() {
                            let ext = extension.to_str().unwrap_or("").to_lowercase();
                            if ext == "edf" || ext == "ascii" || ext == "txt" {
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

    // Read actual EDF data in a blocking task to avoid blocking the async runtime
    let file_path_clone = file_path.clone();
    let chunk = tokio::task::spawn_blocking(move || -> Result<ChunkData, String> {
        let path = std::path::Path::new(&file_path_clone);
        if !path.exists() {
            return Err(format!("File not found: {}", file_path_clone));
        }

        // Use our custom EDF reader
        let mut edf = EDFReader::new(path)?;

        // Get channel information
        let channel_labels: Vec<String> = edf.signal_headers
            .iter()
            .map(|sh| sh.label.trim().to_string())
            .collect();

        let num_channels = channel_labels.len();
        if num_channels == 0 {
            return Err(format!("No channels found in EDF file '{}'", file_path_clone));
        }

        // Get sampling rate (use first channel)
        let sample_rate = edf.signal_headers[0].sample_frequency(edf.header.duration_of_data_record);

        log::info!(
            "Reading chunk from '{}': start_time={:.2}s, duration={:.2}s",
            file_path_clone, start_time, duration
        );

        // Read data window for each channel
        let mut data: Vec<Vec<f64>> = Vec::new();
        for signal_idx in 0..num_channels {
            let signal_data = edf.read_signal_window(signal_idx, start_time, duration)?;
            data.push(signal_data);
        }

        let chunk_start_sample = (start_time * sample_rate) as usize;
        let chunk_size = data.get(0).map(|v| v.len()).unwrap_or(0);

        // Calculate total samples
        let samples_per_record = edf.signal_headers[0].num_samples_per_record as u64;
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

pub async fn run_dda_analysis(
    State(state): State<Arc<ApiState>>,
    Json(request): Json<DDARequest>,
) -> Result<Json<DDAResult>, StatusCode> {
    let analysis_id = Uuid::new_v4().to_string();

    log::info!("Starting DDA analysis for file: {}", request.file_path);
    log::info!("Channel indices: {:?}", request.channels);
    log::info!("Time range: {:?}", request.time_range);
    log::info!("Window parameters: {:?}", request.window_parameters);
    log::info!("Scale parameters: {:?}", request.scale_parameters);
    log::info!("Variants: {:?}", request.algorithm_selection.enabled_variants);

    // Get DDA binary path - check state first (for Tauri-resolved paths), then try multiple locations
    let dda_binary_path = if let Some(ref resolved_path) = state.dda_binary_path {
        // Use Tauri-resolved path if available (best for bundled apps)
        resolved_path.to_string_lossy().to_string()
    } else if let Ok(env_path) = std::env::var("DDA_BINARY_PATH") {
        // Use environment variable if set
        env_path
    } else {
        // Fallback: Try to find the binary in common locations (for development or non-Tauri contexts)
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        log::debug!("CARGO_MANIFEST_DIR: {:?}", manifest_dir);

        // For development: go up from packages/ddalab-tauri/src-tauri to DDALAB root
        let repo_root = manifest_dir.parent().unwrap().parent().unwrap().parent().unwrap();
        log::debug!("Computed repo root: {:?}", repo_root);

        let possible_paths = vec![
            // Development: project bin directory
            repo_root.join("bin/run_DDA_ASCII"),
            // Bundled with app (Tauri resources) - Tauri preserves directory structure
            PathBuf::from("./bin/run_DDA_ASCII"),
            // macOS app bundle - resources go in Contents/Resources/
            PathBuf::from("../Resources/bin/run_DDA_ASCII"),
            PathBuf::from("../Resources/run_DDA_ASCII"),  // In case directory structure is flattened
            // Linux/Windows relative
            PathBuf::from("./resources/bin/run_DDA_ASCII"),
            PathBuf::from("./resources/run_DDA_ASCII"),  // Flattened fallback
            // Absolute fallback for Docker
            PathBuf::from("/app/bin/run_DDA_ASCII"),
        ];

        let paths_for_error: Vec<_> = possible_paths.iter().cloned().collect();
        let found_path = possible_paths.into_iter()
            .find(|p| {
                let exists = p.exists();
                log::debug!("Checking path: {:?} - exists: {}", p, exists);
                exists
            })
            .ok_or_else(|| {
                log::error!("DDA binary not found in any expected location. Tried:");
                for path in &paths_for_error {
                    log::error!("  - {:?}", path);
                }
                log::error!("Set DDA_BINARY_PATH environment variable to specify location");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;

        found_path.to_string_lossy().to_string()
    };

    log::info!("Using DDA binary at: {}", dda_binary_path);
    let start_time = std::time::Instant::now();

    // Verify the binary exists
    if !PathBuf::from(&dda_binary_path).exists() {
        log::error!("DDA binary not found at: {}", dda_binary_path);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    // Read EDF file to get metadata in a blocking task
    let file_path = PathBuf::from(&request.file_path);
    if !file_path.exists() {
        log::error!("Input file not found: {}", request.file_path);
        return Err(StatusCode::NOT_FOUND);
    }

    log::info!("⏱️  [TIMING] Starting EDF metadata read...");
    let metadata_start = std::time::Instant::now();
    let file_path_for_edf = file_path.clone();
    let end_bound = tokio::task::spawn_blocking(move || -> Result<u64, String> {
        let edf = EDFReader::new(&file_path_for_edf)?;

        // Calculate bounds (total samples with safety margin)
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

    log::info!("⏱️  [TIMING] EDF metadata read completed in {:.2}s", metadata_start.elapsed().as_secs_f64());

    // Create temporary output file
    let temp_dir = std::env::temp_dir();
    let output_file = temp_dir.join(format!("dda_output_{}.txt", analysis_id));

    // Use channel indices from request (convert to 1-based for DDA binary)
    let channel_indices: Vec<String> = if let Some(ref channels) = request.channels {
        channels.iter().map(|&idx| (idx + 1).to_string()).collect()
    } else {
        vec!["1".to_string()]  // Default to first channel
    };

    // Build DDA command - APE binary on macOS needs to run through sh
    let mut command = if cfg!(target_os = "macos") {
        let mut cmd = tokio::process::Command::new("sh");
        cmd.arg(&dda_binary_path);
        cmd
    } else {
        tokio::process::Command::new(&dda_binary_path)
    };

    // Add DDA parameters
    command
        .arg("-DATA_FN").arg(&request.file_path)
        .arg("-OUT_FN").arg(output_file.to_str().unwrap())
        .arg("-EDF")
        .arg("-CH_list");

    // Add channel indices as separate arguments (not comma-separated)
    for ch in &channel_indices {
        command.arg(ch);
    }

    // Add base parameters (matching dda-py BASE_PARAMS)
    command
        .arg("-dm").arg("4")
        .arg("-order").arg("4")
        .arg("-nr_tau").arg("2")
        .arg("-WL").arg(request.window_parameters.window_length.to_string())
        .arg("-WS").arg(request.window_parameters.window_step.to_string())
        .arg("-SELECT").arg("1").arg("0").arg("0").arg("0")
        .arg("-MODEL").arg("1").arg("2").arg("10");

    // Generate delay values from scale parameters
    let delay_min = request.scale_parameters.scale_min as i32;
    let delay_max = request.scale_parameters.scale_max as i32;
    command.arg("-TAU");
    for delay in delay_min..=delay_max {
        command.arg(delay.to_string());
    }

    // Add time bounds
    command.arg("-StartEnd").arg("0").arg(end_bound.to_string());

    log::info!("Executing DDA command: {:?}", command);

    // Execute DDA binary asynchronously
    log::info!("⏱️  [TIMING] Starting DDA binary execution...");
    let binary_start = std::time::Instant::now();
    let output = command.output().await.map_err(|e| {
        log::error!("Failed to execute DDA binary: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    log::info!("⏱️  [TIMING] DDA binary execution completed in {:.2}s", binary_start.elapsed().as_secs_f64());

    if !output.status.success() {
        log::error!("DDA binary failed with status: {}", output.status);
        log::error!("stdout: {}", String::from_utf8_lossy(&output.stdout));
        log::error!("stderr: {}", String::from_utf8_lossy(&output.stderr));
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    log::info!("DDA binary execution completed successfully");

    // DDA binary creates output file with _ST suffix
    // Try both possible naming conventions:
    // 1. filename_ST (expected)
    // 2. filename.ext_ST (actual format sometimes used)
    let output_file_stem = output_file.file_stem()
        .and_then(|s| s.to_str())
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let output_dir = output_file.parent().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    let st_file_path = output_dir.join(format!("{}_ST", output_file_stem));
    let st_file_with_ext = output_file.to_str()
        .map(|s| PathBuf::from(format!("{}_ST", s)))
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    let actual_output_file = if st_file_path.exists() {
        st_file_path
    } else if st_file_with_ext.exists() {
        st_file_with_ext
    } else {
        log::error!("DDA output file not found. Tried:");
        log::error!("  - {:?}", st_file_path);
        log::error!("  - {:?}", st_file_with_ext);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    };

    log::info!("Reading DDA output from: {:?}", actual_output_file);

    // Read and parse DDA output
    log::info!("⏱️  [TIMING] Reading DDA output file...");
    let read_start = std::time::Instant::now();
    let output_content = tokio::fs::read_to_string(&actual_output_file).await.map_err(|e| {
        log::error!("Failed to read DDA output file: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    log::info!("⏱️  [TIMING] File read completed in {:.2}s", read_start.elapsed().as_secs_f64());
    log::info!("DDA output file saved at: {:?}", actual_output_file);
    log::info!("Output file size: {} bytes", output_content.len());

    // Parse the output file to extract Q matrix [channels × timepoints]
    log::info!("⏱️  [TIMING] Parsing DDA output...");
    let parse_start = std::time::Instant::now();
    let q_matrix = parse_dda_output(&output_content);
    log::info!("⏱️  [TIMING] Parsing completed in {:.2}s", parse_start.elapsed().as_secs_f64());

    // Clean up temporary files (temporarily disabled for debugging)
    // let _ = tokio::fs::remove_file(&output_file).await;
    // let _ = tokio::fs::remove_file(&actual_output_file).await;

    if q_matrix.is_empty() {
        log::error!("Failed to parse DDA output - no data extracted");
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

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

    log::info!("⏱️  [TIMING] ✅ Total DDA analysis completed in {:.2}s", start_time.elapsed().as_secs_f64());

    Ok(Json(result))
}

// Helper function to parse DDA output and return as 2D matrix [channels × timepoints]
// Based on dda-py _process_output: skip first 2 columns, take every 4th column, then transpose
fn parse_dda_output(content: &str) -> Vec<Vec<f64>> {
    let mut matrix: Vec<Vec<f64>> = Vec::new();

    // Parse the file into a matrix (rows = time windows, columns = various outputs)
    for line in content.lines() {
        // Skip comments and empty lines
        if line.trim().is_empty() || line.trim().starts_with('#') {
            continue;
        }

        // Parse all values in the line
        let values: Vec<f64> = line
            .split_whitespace()
            .filter_map(|s| s.parse::<f64>().ok())
            .filter(|v| v.is_finite())
            .collect();

        if !values.is_empty() {
            matrix.push(values);
        }
    }

    if matrix.is_empty() {
        log::warn!("DDA output file contained no valid data");
        return Vec::new();
    }

    log::info!("Loaded DDA output shape: {} rows × {} columns", matrix.len(), matrix[0].len());

    // Log first row for debugging
    if !matrix.is_empty() && matrix[0].len() >= 10 {
        log::info!("First row sample (first 10 values): {:?}", &matrix[0][0..10]);
    }

    // Process according to DDA format: skip first 2 columns, then take every 4th column
    // Python does: Q[:, 2:] then Q[:, 1::4]
    // This means: skip first 2, then from remaining take indices 1, 5, 9... = original columns 3, 7, 11...
    if matrix[0].len() > 2 {
        // First, skip first 2 columns to match Python's Q[:, 2:]
        let mut after_skip: Vec<Vec<f64>> = Vec::new();
        for row in &matrix {
            let skipped: Vec<f64> = row.iter().skip(2).copied().collect();
            after_skip.push(skipped);
        }

        log::info!("After skipping first 2 columns: {} rows × {} columns", after_skip.len(), after_skip[0].len());

        // Log some values from after_skip to see what we have
        if !after_skip.is_empty() && after_skip[0].len() >= 10 {
            log::info!("After skip, first row (first 10 values): {:?}", &after_skip[0][0..10]);
        }

        // Now take every 4th column starting from index 0 (0-indexed from the skipped array)
        // Try index 0 first: [:, 0::4] which takes indices 0, 4, 8, 12...
        let mut extracted: Vec<Vec<f64>> = Vec::new();

        for row in &after_skip {
            let mut row_values = Vec::new();
            let mut col_idx = 0; // Start at column index 0 of the already-skipped array
            while col_idx < row.len() {
                row_values.push(row[col_idx]);
                col_idx += 4;
            }
            extracted.push(row_values);
        }

        // Log extracted sample
        if !extracted.is_empty() && extracted[0].len() >= 5 {
            log::info!("First extracted row sample (first 5 values): {:?}", &extracted[0][0..5]);
        }

        if extracted.is_empty() || extracted[0].is_empty() {
            log::warn!("No data after column extraction");
            return Vec::new();
        }

        let num_rows = extracted.len();
        let num_cols = extracted[0].len();

        log::info!("Extracted matrix shape: {} rows × {} columns (time windows × delays/scales)", num_rows, num_cols);

        // Transpose: convert from [time_windows × scales] to [scales × time_windows]
        // This gives us [channel/scale][timepoint] format expected by frontend
        let mut transposed: Vec<Vec<f64>> = vec![Vec::new(); num_cols];

        for (row_idx, row) in extracted.iter().enumerate() {
            if row.len() != num_cols {
                log::warn!("Row {} has {} columns, expected {}. Skipping this row.", row_idx, row.len(), num_cols);
                continue;
            }
            for (col_idx, &value) in row.iter().enumerate() {
                transposed[col_idx].push(value);
            }
        }

        if transposed.is_empty() || transposed[0].is_empty() {
            log::error!("Transpose resulted in empty data");
            return Vec::new();
        }

        log::info!("Transposed to: {} channels × {} timepoints", transposed.len(), transposed[0].len());

        transposed
    } else {
        // If we have <= 2 columns, return as single channel
        vec![matrix.into_iter().flatten().collect()]
    }
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

    // Read actual EDF data in a blocking task to avoid blocking the async runtime
    let file_path_clone = file_path.clone();
    let chunk = tokio::task::spawn_blocking(move || -> Result<ChunkData, String> {
        let path = std::path::Path::new(&file_path_clone);
        if !path.exists() {
            return Err(format!("File not found: {}", file_path_clone));
        }

        // Use our custom EDF reader
        let mut edf = EDFReader::new(path)?;

        // Get all channel labels
        let all_channel_labels: Vec<String> = edf.signal_headers
            .iter()
            .map(|sh| sh.label.trim().to_string())
            .collect();

        if all_channel_labels.is_empty() {
            return Err(format!("No channels found in EDF file '{}'", file_path_clone));
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

            if indices.is_empty() {
                return Err(format!("None of the selected channels found in file"));
            }

            (indices, labels)
        } else {
            // Read all channels
            ((0..all_channel_labels.len()).collect(), all_channel_labels)
        };

        // Get sampling rate (use first channel to be read)
        let sample_rate = edf.signal_headers[channels_to_read[0]].sample_frequency(edf.header.duration_of_data_record);

        // Convert sample-based parameters to time-based
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

        // Read data window for selected channels only
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
async fn create_file_info(path: PathBuf) -> Option<EDFFileInfo> {
    // Run EDF reading in a blocking task to avoid blocking the async runtime
    tokio::task::spawn_blocking(move || {
        if !path.exists() || !path.is_file() {
            return None;
        }

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

        // Read actual EDF file header using our custom EDF reader
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

// Create the API router
pub fn create_router(state: Arc<ApiState>) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/files/list", get(list_files))
        .route("/api/files/:file_path", get(get_file_info))
        .route("/api/files/:file_path/chunk", get(get_file_chunk))
        .route("/api/edf/info", get(get_edf_info))
        .route("/api/edf/data", get(get_edf_data))
        .route("/api/dda", post(run_dda_analysis))
        .route("/api/dda/analyze", post(run_dda_analysis))
        .route("/api/dda/results", get(get_dda_results))
        .route("/api/dda/results/:analysis_id", get(get_analysis_result))
        .route("/api/dda/results/:analysis_id", delete(delete_analysis_result))
        .route("/api/dda/status/:analysis_id", get(get_analysis_status))
        .route("/api/dda/history", get(list_analysis_history))
        .route("/api/dda/history/save", post(save_analysis_to_history))
        .route("/api/dda/history/:analysis_id", get(get_analysis_result))
        .route("/api/dda/history/:analysis_id", delete(delete_analysis_result))
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
