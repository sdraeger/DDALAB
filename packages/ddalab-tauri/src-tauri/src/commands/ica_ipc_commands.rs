//! ICA Analysis Tauri IPC Commands
//!
//! Provides pure Tauri IPC commands for ICA analysis operations, replacing HTTP
//! endpoints to avoid enterprise security tools (Proofpoint URLdefense) intercepting
//! localhost traffic in hospital environments.
//!
//! Commands:
//! - submit_ica_analysis: Submit an ICA analysis (async, emits completion events)
//! - get_ica_results: Get all ICA results
//! - get_ica_result_by_id: Get specific ICA result by ID
//! - delete_ica_result: Delete an ICA result
//! - ica_reconstruct_without_components: Reconstruct signal excluding components

use chrono::Utc;
use ddalab_tauri::api::handlers::ica::ICAResultResponse;
use ddalab_tauri::api::state::ApiState;
use ddalab_tauri::db::ica_db::ICAStoredResult;
use ddalab_tauri::file_readers::FileReaderFactory;
use ddalab_tauri::ica::{ICAAnalysisResult, ICAParameters, ICAProcessor};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ICATimeRange {
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ICAParametersRequest {
    pub n_components: Option<usize>,
    pub algorithm: Option<String>,
    pub g_function: Option<String>,
    pub max_iterations: Option<usize>,
    pub tolerance: Option<f64>,
    pub centering: Option<bool>,
    pub whitening: Option<bool>,
}

impl From<ICAParametersRequest> for ICAParameters {
    fn from(req: ICAParametersRequest) -> Self {
        let mut params = ICAParameters::default();

        if let Some(n) = req.n_components {
            params.n_components = Some(n);
        }

        if let Some(max_iter) = req.max_iterations {
            params.max_iterations = max_iter;
        }

        if let Some(tol) = req.tolerance {
            params.tolerance = tol;
        }

        if let Some(centering) = req.centering {
            params.preprocessing.centering = centering;
        }

        if let Some(whitening) = req.whitening {
            params.preprocessing.whitening = whitening;
        }

        params
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ICASubmitRequest {
    pub file_path: String,
    pub channels: Option<Vec<usize>>,
    pub time_range: Option<ICATimeRange>,
    pub parameters: ICAParametersRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ICASubmitResult {
    pub analysis_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ICAHistoryEntry {
    pub id: String,
    pub name: Option<String>,
    pub file_path: String,
    pub channels: Vec<String>,
    pub created_at: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ICAReconstructRequest {
    pub analysis_id: String,
    pub components_to_remove: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconstructedChannel {
    pub name: String,
    pub samples: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ICAReconstructResponse {
    pub channels: Vec<ReconstructedChannel>,
}

// ============================================================================
// Validation Constants
// ============================================================================

const MAX_CHANNELS: usize = 256;
const MAX_COMPONENTS: usize = 256;
const MAX_ITERATIONS: usize = 10_000;

// ============================================================================
// Validation
// ============================================================================

fn validate_ica_request(request: &ICASubmitRequest) -> Result<(), String> {
    if let Some(ref channels) = request.channels {
        if channels.len() > MAX_CHANNELS {
            return Err(format!(
                "Too many channels ({}) - maximum is {}",
                channels.len(),
                MAX_CHANNELS
            ));
        }
    }

    if let Some(n_components) = request.parameters.n_components {
        if n_components > MAX_COMPONENTS {
            return Err(format!(
                "Too many components ({}) - maximum is {}",
                n_components, MAX_COMPONENTS
            ));
        }
    }

    if let Some(max_iter) = request.parameters.max_iterations {
        if max_iter > MAX_ITERATIONS {
            return Err(format!(
                "Too many iterations ({}) - maximum is {}",
                max_iter, MAX_ITERATIONS
            ));
        }
    }

    if let Some(ref time_range) = request.time_range {
        if time_range.start < 0.0 {
            return Err("time_range.start cannot be negative".to_string());
        }
        if time_range.end <= time_range.start {
            return Err(format!(
                "time_range.end ({}) must be greater than time_range.start ({})",
                time_range.end, time_range.start
            ));
        }
    }

    Ok(())
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Submit an ICA analysis job. This is an async operation that emits progress events.
/// The analysis runs in the background and sends events via Tauri's event system.
#[tauri::command]
pub async fn submit_ica_analysis(
    app: AppHandle,
    api_state: State<'_, Arc<ApiState>>,
    request: ICASubmitRequest,
) -> Result<ICAResultResponse, String> {
    log::info!(
        "[ICA_IPC] submit_ica_analysis called for file: {}",
        request.file_path
    );

    // Validate request
    validate_ica_request(&request)?;

    let file_path = PathBuf::from(&request.file_path);

    // Canonicalize path
    let canonical_file_path = file_path
        .canonicalize()
        .map_err(|e| format!("Failed to access file '{}': {}", request.file_path, e))?;

    if !canonical_file_path.exists() {
        return Err(format!("File not found: {}", request.file_path));
    }

    // Generate analysis ID
    let analysis_id = Uuid::new_v4().to_string();

    log::info!(
        "[ICA_IPC] Starting analysis {} for {}",
        analysis_id,
        canonical_file_path.display()
    );

    // Emit start event
    let _ = app.emit(
        "ica-progress",
        serde_json::json!({
            "analysisId": analysis_id,
            "status": "started",
            "progress": 0,
            "message": "Starting ICA analysis..."
        }),
    );

    // Read file metadata
    let _ = app.emit(
        "ica-progress",
        serde_json::json!({
            "analysisId": analysis_id,
            "status": "reading_file",
            "progress": 10,
            "message": "Reading file..."
        }),
    );

    let file_path_for_reader = canonical_file_path.clone();
    let channels_opt = request.channels.clone();
    let time_range_opt = request.time_range.clone();
    let parameters_req = request.parameters.clone();

    // Run the ICA analysis in a blocking task
    let result = tokio::task::spawn_blocking(move || {
        // Create file reader
        log::info!("[ICA_IPC] Creating file reader...");
        let reader = FileReaderFactory::create_reader(&file_path_for_reader)
            .map_err(|e| format!("Failed to read file: {}", e))?;

        // Get metadata to map channel indices to names
        log::info!("[ICA_IPC] Getting file metadata...");
        let metadata = reader
            .metadata()
            .map_err(|e| format!("Failed to get file metadata: {}", e))?;

        log::info!(
            "[ICA_IPC] File has {} channels, {} samples",
            metadata.channels.len(),
            metadata.num_samples
        );

        // Convert channel indices to channel names for optimized loading
        let selected_channel_names: Option<Vec<String>> = channels_opt.as_ref().map(|indices| {
            indices
                .iter()
                .filter_map(|&idx| metadata.channels.get(idx).cloned())
                .collect()
        });

        // Convert to intermediate format - only load selected channels
        log::info!("[ICA_IPC] Converting to intermediate format...");
        let convert_start = std::time::Instant::now();
        let mut intermediate_data =
            FileReaderFactory::to_intermediate_data(&*reader, selected_channel_names.as_deref())
                .map_err(|e| format!("Failed to process file: {}", e))?;

        log::info!(
            "[ICA_IPC] Intermediate data converted in {:.2}s: {} channels",
            convert_start.elapsed().as_secs_f64(),
            intermediate_data.channels.len()
        );

        // Apply time range if specified (parallel processing)
        if let Some(time_range) = &time_range_opt {
            log::info!(
                "[ICA_IPC] Applying time range: {:.2}s to {:.2}s",
                time_range.start,
                time_range.end
            );
            let sample_rate = intermediate_data.metadata.sample_rate;
            let start_sample = (time_range.start * sample_rate) as usize;
            let end_sample = (time_range.end * sample_rate) as usize;

            // Use parallel iteration for time range slicing
            intermediate_data
                .channels
                .par_iter_mut()
                .for_each(|channel| {
                    if end_sample < channel.samples.len() {
                        channel.samples = channel.samples[start_sample..end_sample].to_vec();
                    } else if start_sample < channel.samples.len() {
                        channel.samples = channel.samples[start_sample..].to_vec();
                    }
                });
        }

        // Convert parameters
        let params: ICAParameters = parameters_req.into();
        log::info!(
            "[ICA_IPC] Parameters: n_components={:?}, max_iterations={}, tolerance={}",
            params.n_components,
            params.max_iterations,
            params.tolerance
        );

        // Run ICA analysis
        let n_channels = intermediate_data.channels.len();
        let start_time = std::time::Instant::now();
        log::info!(
            "[ICA_IPC] Starting FastICA computation with {} components...",
            params.n_components.unwrap_or(n_channels)
        );

        let ica_result = ICAProcessor::analyze(&intermediate_data, &params, None)
            .map_err(|e| format!("ICA analysis failed: {}", e))?;

        let elapsed = start_time.elapsed();
        log::info!(
            "[ICA_IPC] ICA analysis completed in {:.2}s - {} components extracted",
            elapsed.as_secs_f64(),
            ica_result.components.len()
        );

        Ok::<ICAAnalysisResult, String>(ica_result)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| format!("ICA analysis error: {}", e))?;

    let _ = app.emit(
        "ica-progress",
        serde_json::json!({
            "analysisId": analysis_id,
            "status": "processing_results",
            "progress": 80,
            "message": "Processing results..."
        }),
    );

    // Create result response
    let ica_response = ICAResultResponse {
        id: analysis_id.clone(),
        name: None,
        file_path: request.file_path.clone(),
        channels: result.channel_names.clone(),
        created_at: Utc::now().to_rfc3339(),
        status: "completed".to_string(),
        results: result,
    };

    // Store in history and persist to database
    {
        let mut history = api_state.ica_history.lock();
        history.push(ica_response.clone());

        // Keep only last 50 analyses in memory
        if history.len() > 50 {
            history.remove(0);
        }
    }

    // Persist to SQLite database
    if let Some(ref db) = api_state.ica_db {
        match serde_json::to_value(&ica_response.results) {
            Ok(results_json) => {
                let stored = ICAStoredResult {
                    id: ica_response.id.clone(),
                    name: ica_response.name.clone(),
                    file_path: ica_response.file_path.clone(),
                    channels: ica_response.channels.clone(),
                    created_at: ica_response.created_at.clone(),
                    status: ica_response.status.clone(),
                    results: results_json,
                };
                if let Err(e) = db.save_analysis(&stored) {
                    log::error!(
                        "[ICA_IPC] Failed to persist ICA analysis to database: {}",
                        e
                    );
                } else {
                    log::info!(
                        "[ICA_IPC] ICA analysis {} saved to database",
                        ica_response.id
                    );
                }
            }
            Err(e) => {
                log::error!(
                    "[ICA_IPC] Failed to serialize ICA results for storage: {}",
                    e
                );
            }
        }
    }

    let _ = app.emit(
        "ica-progress",
        serde_json::json!({
            "analysisId": analysis_id,
            "status": "completed",
            "progress": 100,
            "message": "Analysis complete"
        }),
    );

    log::info!("[ICA_IPC] Analysis {} completed successfully", analysis_id);

    Ok(ica_response)
}

/// Get all ICA analysis results
#[tauri::command]
pub async fn get_ica_results(
    api_state: State<'_, Arc<ApiState>>,
) -> Result<Vec<ICAHistoryEntry>, String> {
    log::debug!("[ICA_IPC] get_ica_results called");

    let history = api_state.ica_history.lock();

    let entries: Vec<ICAHistoryEntry> = history
        .iter()
        .map(|r| ICAHistoryEntry {
            id: r.id.clone(),
            name: r.name.clone(),
            file_path: r.file_path.clone(),
            channels: r.channels.clone(),
            created_at: r.created_at.clone(),
            status: r.status.clone(),
        })
        .collect();

    Ok(entries)
}

/// Get a specific ICA result by ID
#[tauri::command]
pub async fn get_ica_result_by_id(
    api_state: State<'_, Arc<ApiState>>,
    analysis_id: String,
) -> Result<Option<ICAResultResponse>, String> {
    log::debug!("[ICA_IPC] get_ica_result_by_id called for: {}", analysis_id);

    // Check in-memory history first
    {
        let history = api_state.ica_history.lock();
        if let Some(result) = history.iter().find(|r| r.id == analysis_id) {
            return Ok(Some(result.clone()));
        }
    }

    // Check database
    if let Some(ref db) = api_state.ica_db {
        match db.get_analysis(&analysis_id) {
            Ok(Some(stored)) => {
                // Convert from ICAStoredResult to ICAResultResponse
                match serde_json::from_value(stored.results) {
                    Ok(results) => {
                        return Ok(Some(ICAResultResponse {
                            id: stored.id,
                            name: stored.name,
                            file_path: stored.file_path,
                            channels: stored.channels,
                            created_at: stored.created_at,
                            status: stored.status,
                            results,
                        }));
                    }
                    Err(e) => {
                        log::warn!(
                            "[ICA_IPC] Failed to deserialize ICA result {}: {}",
                            analysis_id,
                            e
                        );
                    }
                }
            }
            Ok(None) => {}
            Err(e) => {
                log::error!("[ICA_IPC] Failed to get ICA analysis from database: {}", e);
            }
        }
    }

    Ok(None)
}

/// Delete an ICA result
#[tauri::command]
pub async fn delete_ica_result(
    api_state: State<'_, Arc<ApiState>>,
    analysis_id: String,
) -> Result<bool, String> {
    log::info!("[ICA_IPC] delete_ica_result called for: {}", analysis_id);

    let mut found = false;

    // Remove from in-memory history
    {
        let mut history = api_state.ica_history.lock();
        if let Some(pos) = history.iter().position(|r| r.id == analysis_id) {
            history.remove(pos);
            found = true;
        }
    }

    // Delete from database
    if let Some(ref db) = api_state.ica_db {
        match db.delete_analysis(&analysis_id) {
            Ok(deleted) => {
                if deleted {
                    found = true;
                    log::info!(
                        "[ICA_IPC] ICA analysis {} deleted from database",
                        analysis_id
                    );
                }
            }
            Err(e) => {
                log::error!(
                    "[ICA_IPC] Failed to delete ICA analysis from database: {}",
                    e
                );
            }
        }
    }

    Ok(found)
}

/// Reconstruct data with specified components removed (for artifact rejection)
#[tauri::command]
pub async fn ica_reconstruct_without_components(
    api_state: State<'_, Arc<ApiState>>,
    request: ICAReconstructRequest,
) -> Result<ICAReconstructResponse, String> {
    log::info!(
        "[ICA_IPC] ica_reconstruct_without_components called for: {}, removing {} components",
        request.analysis_id,
        request.components_to_remove.len()
    );

    // Find the ICA result in memory
    let result = {
        let history = api_state.ica_history.lock();
        history
            .iter()
            .find(|r| r.id == request.analysis_id)
            .cloned()
    };

    let result = match result {
        Some(r) => r,
        None => {
            // Try to load from database
            if let Some(ref db) = api_state.ica_db {
                match db.get_analysis(&request.analysis_id) {
                    Ok(Some(stored)) => match serde_json::from_value(stored.results) {
                        Ok(results) => ICAResultResponse {
                            id: stored.id,
                            name: stored.name,
                            file_path: stored.file_path,
                            channels: stored.channels,
                            created_at: stored.created_at,
                            status: stored.status,
                            results,
                        },
                        Err(e) => {
                            return Err(format!("Failed to deserialize ICA result: {}", e));
                        }
                    },
                    Ok(None) => {
                        return Err(format!("Analysis not found: {}", request.analysis_id));
                    }
                    Err(e) => {
                        return Err(format!("Database error: {}", e));
                    }
                }
            } else {
                return Err(format!("Analysis not found: {}", request.analysis_id));
            }
        }
    };

    // Perform reconstruction
    let reconstructed = ICAProcessor::reconstruct_without_components(
        &result.results,
        &request.components_to_remove,
    )
    .map_err(|e| format!("Reconstruction failed: {}", e))?;

    let channels: Vec<ReconstructedChannel> = result
        .channels
        .iter()
        .zip(reconstructed)
        .map(|(name, samples)| ReconstructedChannel {
            name: name.clone(),
            samples,
        })
        .collect();

    log::info!(
        "[ICA_IPC] Reconstruction complete: {} channels",
        channels.len()
    );

    Ok(ICAReconstructResponse { channels })
}
