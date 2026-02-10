use serde::{Deserialize, Serialize};

pub const SNAPSHOT_FORMAT_VERSION: &str = "1.0.0";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotMode {
    Full,
    RecipeOnly,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SourceFileInfo {
    pub original_path: String,
    pub file_name: String,
    pub file_hash: String,
    pub file_size: u64,
    pub duration_seconds: Option<f64>,
    pub sample_rate: Option<f64>,
    pub channels: Vec<String>,
    pub format: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SnapshotAnalysisEntry {
    pub id: String,
    pub name: Option<String>,
    pub created_at: String,
    pub variant_name: String,
    pub variant_display_name: String,
    pub parameters: serde_json::Value,
    pub results_file: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SnapshotManifest {
    pub format_version: String,
    pub mode: SnapshotMode,
    pub created_at: String,
    pub application_version: String,
    pub name: String,
    pub description: Option<String>,
    pub source_file: SourceFileInfo,
    pub analyses: Vec<SnapshotAnalysisEntry>,
    pub has_annotations: bool,
    pub has_workflow: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SnapshotValidation {
    pub valid: bool,
    pub format_version_compatible: bool,
    pub source_file_found: bool,
    pub source_file_hash_match: bool,
    pub analysis_count: usize,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SnapshotInspectResult {
    pub manifest: SnapshotManifest,
    pub file_size_bytes: u64,
    pub validation: SnapshotValidation,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SnapshotImportResult {
    pub manifest: SnapshotManifest,
    pub validation: SnapshotValidation,
    pub snapshot_path: String,
    pub suggested_source_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SnapshotApplyResult {
    pub analyses_restored: usize,
    pub annotations_restored: usize,
    pub source_file_path: String,
}
