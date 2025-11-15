use serde::{Deserialize, Serialize};

/// Time range for analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeRange {
    pub start: f64,
    pub end: f64,
}

/// Preprocessing options
/// Note: Preprocessing should be done before DDA analysis, not by this package
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreprocessingOptions {
    pub highpass: Option<f64>,
    pub lowpass: Option<f64>,
}

/// Algorithm variant selection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlgorithmSelection {
    pub enabled_variants: Vec<String>,
    /// SELECT mask as 6-bit string (e.g., "1 0 1 0 0 0" for ST and CD)
    /// Format: ST CT CD RESERVED DE SY
    /// - ST: Single Timeseries (output: _DDA_ST)
    /// - CT: Cross-Timeseries (output: _DDA_CT)
    /// - CD: Cross-Dynamical (output: _CD_DDA_ST)
    /// - RESERVED: Internal development function (not for user use)
    /// - DE: Delay Embedding (output: _DE)
    /// - SY: Synchronization (output: _SY)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub select_mask: Option<String>,
}

/// Window parameters for DDA analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowParameters {
    pub window_length: u32,
    pub window_step: u32,
    /// CT-specific window length (for Cross-Timeseries variant)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ct_window_length: Option<u32>,
    /// CT-specific window step (for Cross-Timeseries variant)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ct_window_step: Option<u32>,
}

/// Scale parameters for DDA analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaleParameters {
    pub scale_min: f64,
    pub scale_max: f64,
    pub scale_num: u32,
    /// Optional list of specific delay values to use
    /// If provided, this overrides scale_min/max/num
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay_list: Option<Vec<i32>>,
}

/// MODEL parameters for DDA analysis (expert mode)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelParameters {
    pub dm: u32,     // Embedding dimension (default: 4)
    pub order: u32,  // Polynomial order (default: 4)
    pub nr_tau: u32, // Number of tau values (default: 2)
}

/// Complete DDA request configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDARequest {
    pub file_path: String,
    #[serde(alias = "channel_list")]
    pub channels: Option<Vec<usize>>, // Channel indices (0-based)
    pub time_range: TimeRange,
    pub preprocessing_options: PreprocessingOptions,
    pub algorithm_selection: AlgorithmSelection,
    pub window_parameters: WindowParameters,
    pub scale_parameters: ScaleParameters,
    /// Channel pairs for CT (Cross-Timeseries) analysis
    /// Each pair is [channel_i, channel_j] where channels are 0-based indices
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ct_channel_pairs: Option<Vec<[usize; 2]>>,
    /// Channel pairs for CD (Cross-Dynamical) analysis
    /// Each pair is [from_channel, to_channel] representing directed relationships
    /// Format: [(1, 2), (1, 3), (1, 4)] → CH_list: 1 2 1 3 1 4
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cd_channel_pairs: Option<Vec<[usize; 2]>>,
    /// MODEL parameters (expert mode)
    /// If not provided, defaults to dm=4, order=4, nr_tau=2
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_parameters: Option<ModelParameters>,
}

/// Variant-specific DDA result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariantResult {
    pub variant_id: String,      // "ST", "CT", "CD", "DE"
    pub variant_name: String,    // "Single Timeseries (ST)", etc.
    pub q_matrix: Vec<Vec<f64>>, // Q matrix for this variant [channels × timepoints]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_labels: Option<Vec<String>>, // Optional channel labels specific to this variant
}

/// DDA analysis result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDAResult {
    pub id: String,
    pub file_path: String,
    pub channels: Vec<String>,
    pub q_matrix: Vec<Vec<f64>>, // Primary variant Q matrix (for backward compatibility)
    pub variant_results: Option<Vec<VariantResult>>, // All variant results
    pub raw_output: Option<String>, // Optional: keep raw output for debugging
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
            variant_results: None,
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

    pub fn with_variant_results(mut self, variant_results: Vec<VariantResult>) -> Self {
        self.variant_results = Some(variant_results);
        self
    }
}
