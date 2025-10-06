use serde::{Deserialize, Serialize};

/// Time range for analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeRange {
    pub start: f64,
    pub end: f64,
}

/// Preprocessing options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreprocessingOptions {
    pub detrending: Option<String>,
    pub highpass: Option<f64>,
    pub lowpass: Option<f64>,
}

/// Algorithm variant selection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlgorithmSelection {
    pub enabled_variants: Vec<String>,
}

/// Window parameters for DDA analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowParameters {
    pub window_length: u32,
    pub window_step: u32,
}

/// Scale parameters for DDA analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaleParameters {
    pub scale_min: f64,
    pub scale_max: f64,
    pub scale_num: u32,
}

/// Complete DDA request configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDARequest {
    pub file_path: String,
    #[serde(alias = "channel_list")]
    pub channels: Option<Vec<usize>>,  // Channel indices (0-based)
    pub time_range: TimeRange,
    pub preprocessing_options: PreprocessingOptions,
    pub algorithm_selection: AlgorithmSelection,
    pub window_parameters: WindowParameters,
    pub scale_parameters: ScaleParameters,
}

/// DDA analysis result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDAResult {
    pub id: String,
    pub file_path: String,
    pub channels: Vec<String>,
    pub q_matrix: Vec<Vec<f64>>,  // Processed DDA output matrix [channels × timepoints]
    pub raw_output: Option<String>,  // Optional: keep raw output for debugging
    pub window_parameters: WindowParameters,
    pub scale_parameters: ScaleParameters,
    pub created_at: String,
}

impl DDAResult {
    pub fn new(
        id: String,
        file_path: String,
        channels: Vec<String>,
        q_matrix: Vec<Vec<f64>>,
        window_parameters: WindowParameters,
        scale_parameters: ScaleParameters,
    ) -> Self {
        Self {
            id,
            file_path,
            channels,
            q_matrix,
            raw_output: None,
            window_parameters,
            scale_parameters,
            created_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    pub fn with_raw_output(mut self, raw_output: String) -> Self {
        self.raw_output = Some(raw_output);
        self
    }
}
