use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Output format for BIDS EEG data files
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BIDSOutputFormat {
    Edf,
    Brainvision,
}

/// Assignment of a source file to BIDS subject/session/task/run
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BIDSFileAssignment {
    pub source_path: String,
    pub subject_id: String,
    pub session_id: Option<String>,
    pub task: String,
    pub run: Option<u32>,
    pub file_name: String,
    pub duration: Option<f64>,
    pub channel_count: Option<usize>,
}

/// Dataset-level metadata for BIDS
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BIDSDatasetMetadata {
    pub name: String,
    pub description: Option<String>,
    pub authors: Vec<String>,
    pub license: String,
    pub funding: Option<String>,
}

/// Export options
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BIDSExportOptions {
    pub output_format: BIDSOutputFormat,
    pub power_line_frequency: u32,
    pub eeg_reference: Option<String>,
}

/// Full export request from frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BIDSExportRequest {
    pub files: Vec<BIDSFileAssignment>,
    pub dataset: BIDSDatasetMetadata,
    pub options: BIDSExportOptions,
    pub output_path: String,
}

/// Progress update during export
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BIDSExportProgress {
    pub current_file: usize,
    pub total_files: usize,
    pub current_file_name: String,
    pub step: String,
    pub percentage: u32,
}

/// Result of export operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BIDSExportResult {
    pub success: bool,
    pub dataset_path: String,
    pub files_exported: usize,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

/// Validate a BIDS export request before executing
#[tauri::command]
pub async fn validate_bids_export(request: BIDSExportRequest) -> Result<Vec<String>, String> {
    let mut errors = Vec::new();

    // Check for empty files list
    if request.files.is_empty() {
        errors.push("No files selected for export".to_string());
    }

    // Check for empty dataset name
    if request.dataset.name.trim().is_empty() {
        errors.push("Dataset name is required".to_string());
    }

    // Check for duplicate subject+session+task+run combinations
    let mut seen = std::collections::HashSet::new();
    for file in &request.files {
        let key = format!(
            "sub-{}_ses-{}_task-{}_run-{}",
            file.subject_id,
            file.session_id.as_deref().unwrap_or("none"),
            file.task,
            file.run.unwrap_or(1)
        );
        if !seen.insert(key.clone()) {
            errors.push(format!(
                "Duplicate assignment: {} (file: {})",
                key, file.file_name
            ));
        }
    }

    // Validate subject IDs (alphanumeric only)
    for file in &request.files {
        if !file
            .subject_id
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-')
        {
            errors.push(format!(
                "Invalid subject ID '{}': must be alphanumeric",
                file.subject_id
            ));
        }
    }

    Ok(errors)
}

/// Export files to BIDS format (stub - will be implemented in Task 5)
#[tauri::command]
pub async fn export_to_bids(
    _app_handle: tauri::AppHandle,
    _request: BIDSExportRequest,
) -> Result<BIDSExportResult, String> {
    // TODO: Implement in Task 5
    Err("BIDS export not yet implemented".to_string())
}

// Suppress unused warning for PathBuf - will be used in Task 5
#[allow(dead_code)]
fn _use_path_buf() -> PathBuf {
    PathBuf::new()
}
