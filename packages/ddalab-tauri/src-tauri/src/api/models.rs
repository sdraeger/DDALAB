use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    pub scale_min: f64,
    pub scale_max: f64,
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
    pub detrend: bool,
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
