use crate::api::state::ApiState;
use crate::db::ica_db::ICAStoredResult;
use crate::file_readers::FileReaderFactory;
use crate::ica::{ICAAnalysisResult, ICAParameters, ICAProcessor};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

// Re-use TimeRange from DDA module to avoid duplicate definitions
pub use super::dda::TimeRange;

/// Request body for ICA analysis
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ICARequest {
    pub file_path: String,
    pub channels: Option<Vec<usize>>,
    pub time_range: Option<TimeRange>,
    pub parameters: ICAParametersRequest,
}

/// ICA parameters from frontend
#[derive(Debug, Clone, Deserialize, Serialize)]
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

/// Full ICA result with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ICAResultResponse {
    pub id: String,
    pub name: Option<String>,
    pub file_path: String,
    pub channels: Vec<String>,
    pub created_at: String,
    pub status: String,
    pub results: ICAAnalysisResult,
}

/// Run ICA analysis on a file
pub async fn run_ica_analysis(
    State(state): State<Arc<ApiState>>,
    Json(request): Json<ICARequest>,
) -> Result<Json<ICAResultResponse>, (StatusCode, String)> {
    let file_path = PathBuf::from(&request.file_path);

    if !file_path.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            format!("File not found: {}", request.file_path),
        ));
    }

    log::info!(
        "[ICA] Starting ICA analysis for file: {}",
        request.file_path
    );
    log::info!(
        "[ICA] Request parameters: channels={:?}, time_range={:?}",
        request.channels.as_ref().map(|c| c.len()),
        request.time_range
    );

    // Read file using FileReaderFactory
    log::info!("[ICA] Creating file reader...");
    let reader = FileReaderFactory::create_reader(&file_path).map_err(|e| {
        log::error!("[ICA] Failed to create file reader: {}", e);
        (
            StatusCode::BAD_REQUEST,
            format!("Failed to read file: {}", e),
        )
    })?;
    log::info!("[ICA] File reader created successfully");

    // Get metadata first (fast) to map channel indices to names
    log::info!("[ICA] Getting file metadata...");
    let metadata = reader.metadata().map_err(|e| {
        log::error!("[ICA] Failed to get metadata: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get file metadata: {}", e),
        )
    })?;
    log::info!(
        "[ICA] File has {} channels, {} samples",
        metadata.channels.len(),
        metadata.num_samples
    );

    // Convert channel indices to channel names for optimized loading
    let selected_channel_names: Option<Vec<String>> = request.channels.as_ref().map(|indices| {
        indices
            .iter()
            .filter_map(|&idx| metadata.channels.get(idx).cloned())
            .collect()
    });

    let channels_to_load = selected_channel_names.as_ref().map(|names| {
        log::info!(
            "[ICA] Will load only {} selected channels (optimization)",
            names.len()
        );
        names.iter().map(|s| s.as_str()).collect::<Vec<_>>()
    });

    // Convert to intermediate format - only load selected channels
    log::info!("[ICA] Converting to intermediate format (selected channels only)...");
    let convert_start = std::time::Instant::now();
    let mut intermediate_data = FileReaderFactory::to_intermediate_data(
        &*reader,
        channels_to_load
            .as_ref()
            .map(|v| {
                // Convert Vec<&str> to &[String] - need owned strings
                v.iter().map(|s| s.to_string()).collect::<Vec<_>>()
            })
            .as_deref(),
    )
    .map_err(|e| {
        log::error!("[ICA] Failed to convert to intermediate format: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to process file: {}", e),
        )
    })?;
    log::info!("[ICA] Intermediate data converted in {:.2}s: {} channels, {} samples/channel, sample_rate={}",
        convert_start.elapsed().as_secs_f64(),
        intermediate_data.channels.len(),
        intermediate_data.channels.first().map(|c| c.samples.len()).unwrap_or(0),
        intermediate_data.metadata.sample_rate);

    // Apply time range if specified (parallel processing)
    if let Some(time_range) = &request.time_range {
        log::info!(
            "[ICA] Applying time range: {:.2}s to {:.2}s",
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
        log::info!(
            "[ICA] After time range: {} samples/channel",
            intermediate_data
                .channels
                .first()
                .map(|c| c.samples.len())
                .unwrap_or(0)
        );
    }

    // Convert parameters
    let params: ICAParameters = request.parameters.into();
    log::info!(
        "[ICA] Parameters: n_components={:?}, max_iterations={}, tolerance={}",
        params.n_components,
        params.max_iterations,
        params.tolerance
    );

    // Determine actual number of channels to process
    // Since we've already filtered to selected channels, use all of them
    let n_channels = intermediate_data.channels.len();
    log::info!("[ICA] Will process {} channels", n_channels);

    // Run ICA analysis
    let start_time = std::time::Instant::now();
    log::info!(
        "[ICA] Starting FastICA computation with {} components...",
        params.n_components.unwrap_or(n_channels)
    );

    // Pass None for selected_channels since we've already loaded only the selected ones
    let ica_result = ICAProcessor::analyze(
        &intermediate_data,
        &params,
        None, // Already filtered to selected channels during loading
    )
    .map_err(|e| {
        log::error!("ICA analysis failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("ICA analysis failed: {}", e),
        )
    })?;

    let elapsed = start_time.elapsed();
    log::info!(
        "ICA analysis completed in {:.2}s - {} components extracted",
        elapsed.as_secs_f64(),
        ica_result.components.len()
    );

    // Create result response
    let analysis_id = Uuid::new_v4().to_string();
    let result = ICAResultResponse {
        id: analysis_id.clone(),
        name: None,
        file_path: request.file_path,
        channels: ica_result.channel_names.clone(),
        created_at: Utc::now().to_rfc3339(),
        status: "completed".to_string(),
        results: ica_result,
    };

    // Store in history and persist to database
    {
        let mut history = state.ica_history.lock();
        history.push(result.clone());

        // Keep only last 50 analyses in memory
        if history.len() > 50 {
            history.remove(0);
        }
    }

    // Persist to SQLite database
    if let Some(ref db) = state.ica_db {
        // Convert to storage type with results serialized as JSON Value
        match serde_json::to_value(&result.results) {
            Ok(results_json) => {
                let stored = ICAStoredResult {
                    id: result.id.clone(),
                    name: result.name.clone(),
                    file_path: result.file_path.clone(),
                    channels: result.channels.clone(),
                    created_at: result.created_at.clone(),
                    status: result.status.clone(),
                    results: results_json,
                };
                if let Err(e) = db.save_analysis(&stored) {
                    log::error!("Failed to persist ICA analysis to database: {}", e);
                } else {
                    log::info!("ICA analysis {} saved to database", result.id);
                }
            }
            Err(e) => {
                log::error!("Failed to serialize ICA results for storage: {}", e);
            }
        }
    }

    Ok(Json(result))
}

/// Get all ICA analysis results
pub async fn get_ica_results(State(state): State<Arc<ApiState>>) -> Json<Vec<ICAResultResponse>> {
    let history = state.ica_history.lock();
    Json(history.clone())
}

/// Get a specific ICA analysis result
pub async fn get_ica_result(
    State(state): State<Arc<ApiState>>,
    Path(analysis_id): Path<String>,
) -> Result<Json<ICAResultResponse>, StatusCode> {
    let history = state.ica_history.lock();

    history
        .iter()
        .find(|r| r.id == analysis_id)
        .cloned()
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

/// Delete an ICA analysis result
pub async fn delete_ica_result(
    State(state): State<Arc<ApiState>>,
    Path(analysis_id): Path<String>,
) -> StatusCode {
    let mut history = state.ica_history.lock();

    if let Some(pos) = history.iter().position(|r| r.id == analysis_id) {
        history.remove(pos);

        // Also delete from database
        if let Some(ref db) = state.ica_db {
            if let Err(e) = db.delete_analysis(&analysis_id) {
                log::error!("Failed to delete ICA analysis from database: {}", e);
            } else {
                log::info!("ICA analysis {} deleted from database", analysis_id);
            }
        }

        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

/// Reconstruct data with components removed
#[derive(Debug, Deserialize)]
pub struct ReconstructRequest {
    pub analysis_id: String,
    pub components_to_remove: Vec<usize>,
}

#[derive(Debug, Serialize)]
pub struct ReconstructResponse {
    pub channels: Vec<ReconstructedChannel>,
}

#[derive(Debug, Serialize)]
pub struct ReconstructedChannel {
    pub name: String,
    pub samples: Vec<f64>,
}

pub async fn reconstruct_without_components(
    State(state): State<Arc<ApiState>>,
    Json(request): Json<ReconstructRequest>,
) -> Result<Json<ReconstructResponse>, (StatusCode, String)> {
    let history = state.ica_history.lock();

    let result = history
        .iter()
        .find(|r| r.id == request.analysis_id)
        .ok_or((StatusCode::NOT_FOUND, "Analysis not found".to_string()))?;

    let reconstructed = ICAProcessor::reconstruct_without_components(
        &result.results,
        &request.components_to_remove,
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Reconstruction failed: {}", e),
        )
    })?;

    let channels: Vec<ReconstructedChannel> = result
        .channels
        .iter()
        .zip(reconstructed)
        .map(|(name, samples)| ReconstructedChannel {
            name: name.clone(),
            samples,
        })
        .collect();

    Ok(Json(ReconstructResponse { channels }))
}
