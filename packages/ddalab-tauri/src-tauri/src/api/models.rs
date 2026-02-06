use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// API Error types with user-friendly messages
#[derive(Debug, Clone, Serialize)]
pub struct ApiErrorResponse {
    pub error: String,
    pub error_type: String,
    pub details: Option<String>,
}

/// Enum for different API error types
#[derive(Debug)]
pub enum ApiError {
    /// File is a git-annex symlink that hasn't been downloaded
    GitAnnexNotDownloaded(String),
    /// File does not exist
    FileNotFound(String),
    /// Failed to parse file
    ParseError(String),
    /// Generic internal error
    InternalError(String),
    /// Bad request parameters
    BadRequest(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error_type, message, details) = match self {
            ApiError::GitAnnexNotDownloaded(path) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "git_annex_not_downloaded",
                format!("File not downloaded: {}", path.split('/').last().unwrap_or(&path)),
                Some("This file is managed by git-annex and hasn't been downloaded yet. Run 'git annex get <filename>' in the dataset directory to download it.".to_string()),
            ),
            ApiError::FileNotFound(path) => (
                StatusCode::NOT_FOUND,
                "file_not_found",
                format!("File not found: {}", path),
                None,
            ),
            ApiError::ParseError(msg) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "parse_error",
                format!("Failed to read file: {}", msg),
                None,
            ),
            ApiError::InternalError(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                msg,
                None,
            ),
            ApiError::BadRequest(msg) => (
                StatusCode::BAD_REQUEST,
                "bad_request",
                msg,
                None,
            ),
        };

        let body = ApiErrorResponse {
            error: message,
            error_type: error_type.to_string(),
            details,
        };

        (status, Json(body)).into_response()
    }
}

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
    pub start_time: String,
    pub end_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkData {
    pub data: Vec<Vec<f64>>,
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
    pub selected_channels: Vec<String>,
    /// Explicit list of delay values (tau) used in the analysis
    pub delay_list: Vec<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant_configs: Option<serde_json::Value>,
}

/// Parse DDA parameters from JSON, with fallback for unmigrated legacy data.
///
/// NOTE: The database migration system (db/migrations.rs) handles converting
/// legacy `scale_min`/`scale_max` to `delay_list` at startup. This function
/// exists as a safety net for edge cases where migration hasn't run yet.
pub fn parse_dda_parameters(value: serde_json::Value) -> Result<DDAParameters, serde_json::Error> {
    // Check for legacy format first (has scale_min/scale_max instead of delay_list)
    // This avoids cloning in the common case where data is already migrated
    let is_legacy = value
        .as_object()
        .map(|obj| obj.contains_key("scale_min") || obj.contains_key("scale_max"))
        .unwrap_or(false);

    if is_legacy {
        // Legacy format: extract fields manually and convert scale_min/scale_max to delay_list
        if let Some(obj) = value.as_object() {
            let scale_min = obj.get("scale_min").and_then(|v| v.as_f64()).unwrap_or(1.0);
            let scale_max = obj
                .get("scale_max")
                .and_then(|v| v.as_f64())
                .unwrap_or(20.0);
            let delay_list: Vec<i32> =
                (scale_min.round() as i32..=scale_max.round() as i32).collect();

            return Ok(DDAParameters {
                variants: obj
                    .get("variants")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default(),
                window_length: obj
                    .get("window_length")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(125) as u32,
                window_step: obj
                    .get("window_step")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(10) as u32,
                selected_channels: obj
                    .get("selected_channels")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default(),
                delay_list,
                variant_configs: obj.get("variant_configs").cloned(),
            });
        }
    }

    // Current format: parse directly without cloning
    serde_json::from_value(value)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDAResult {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub file_path: String,
    pub channels: Vec<String>,
    pub parameters: DDAParameters,
    pub results: serde_json::Value,
    pub plot_data: Option<serde_json::Value>,
    #[serde(rename = "Q")]
    pub q_matrix: Option<Vec<Vec<f64>>>,
    pub created_at: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlotData {
    pub channel: String,
    pub values: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    pub status: String,
    pub services: HashMap<String, String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeRange {
    pub start: Option<usize>,
    pub end: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreprocessingOptions {
    pub normalize: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlgorithmSelection {
    pub variants: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowParameters {
    pub window_length: u32,
    pub window_step: u32,
    pub window_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaleParameters {
    pub scale_min: f64,
    pub scale_max: f64,
    pub auto_scale: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDARequest {
    pub file_path: String,
    pub selected_channels: Vec<String>,
    pub time_range: Option<TimeRange>,
    pub preprocessing: Option<PreprocessingOptions>,
    pub algorithm: AlgorithmSelection,
    pub window: WindowParameters,
    pub scale: ScaleParameters,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameAnalysisRequest {
    pub new_name: String,
}
