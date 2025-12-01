use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

/// Status of a DDA job
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    /// Job is waiting in queue
    Pending,
    /// Job is currently running
    Running,
    /// Job completed successfully
    Completed,
    /// Job failed with an error
    Failed,
    /// Job was cancelled by user
    Cancelled,
}

impl std::fmt::Display for JobStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JobStatus::Pending => write!(f, "pending"),
            JobStatus::Running => write!(f, "running"),
            JobStatus::Completed => write!(f, "completed"),
            JobStatus::Failed => write!(f, "failed"),
            JobStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

/// Source of input file for DDA job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FileSource {
    /// File already exists on server at this path
    ServerPath(PathBuf),
    /// File was uploaded and should be deleted after processing
    UploadedTemp(PathBuf),
    /// File was uploaded and should be kept in working directory
    UploadedPersistent(PathBuf),
}

/// DDA analysis parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDAParameters {
    /// Channels to analyze
    pub channels: Vec<String>,
    /// Channel pairs for cross-correlation (CT)
    pub ct_pairs: Vec<(String, String)>,
    /// Channel pairs for cross-delay (CD)
    pub cd_pairs: Vec<(String, String)>,
    /// Time window size in seconds
    pub time_window: f64,
    /// Delta parameter
    pub delta: f64,
    /// Embedding dimension
    pub embedding_dim: u32,
    /// SVD dimensions
    pub svd_dimensions: u32,
    /// Downsample factor (1 = no downsampling)
    #[serde(default = "default_downsample")]
    pub downsample: u32,
    /// Optional start time in seconds
    pub start_time: Option<f64>,
    /// Optional end time in seconds
    pub end_time: Option<f64>,
}

fn default_downsample() -> u32 {
    1
}

impl Default for DDAParameters {
    fn default() -> Self {
        Self {
            channels: vec![],
            ct_pairs: vec![],
            cd_pairs: vec![],
            time_window: 1.0,
            delta: 0.1,
            embedding_dim: 10,
            svd_dimensions: 3,
            downsample: 1,
            start_time: None,
            end_time: None,
        }
    }
}

/// A DDA job in the queue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDAJob {
    /// Unique job identifier
    pub id: Uuid,
    /// User who submitted the job
    pub user_id: String,
    /// Source of input file
    pub file_source: FileSource,
    /// Original filename (for display)
    pub original_filename: String,
    /// DDA parameters
    pub parameters: DDAParameters,
    /// Current status
    pub status: JobStatus,
    /// Progress percentage (0-100)
    pub progress: u8,
    /// Status message
    pub message: Option<String>,
    /// Path to output file (when completed)
    pub output_path: Option<PathBuf>,
    /// Error message (when failed)
    pub error: Option<String>,
    /// When the job was submitted
    pub submitted_at: DateTime<Utc>,
    /// When the job started running
    pub started_at: Option<DateTime<Utc>>,
    /// When the job completed/failed/cancelled
    pub completed_at: Option<DateTime<Utc>>,
    /// Whether to delete input file after processing
    pub delete_input_after: bool,
}

impl DDAJob {
    pub fn new(
        user_id: String,
        file_source: FileSource,
        original_filename: String,
        parameters: DDAParameters,
        delete_input_after: bool,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            file_source,
            original_filename,
            parameters,
            status: JobStatus::Pending,
            progress: 0,
            message: None,
            output_path: None,
            error: None,
            submitted_at: Utc::now(),
            started_at: None,
            completed_at: None,
            delete_input_after,
        }
    }

    /// Get the input file path
    pub fn input_path(&self) -> PathBuf {
        match &self.file_source {
            FileSource::ServerPath(p) => p.clone(),
            FileSource::UploadedTemp(p) => p.clone(),
            FileSource::UploadedPersistent(p) => p.clone(),
        }
    }
}

/// Request to submit a new job
#[derive(Debug, Clone, Deserialize)]
pub struct SubmitJobRequest {
    /// Path to file on server (for server-side files)
    pub server_path: Option<String>,
    /// Original filename (for uploaded files)
    pub filename: Option<String>,
    /// DDA parameters
    pub parameters: DDAParameters,
    /// Whether to delete uploaded file after processing
    #[serde(default)]
    pub delete_after: bool,
    /// Whether to store in persistent working directory
    #[serde(default)]
    pub persist_upload: bool,
}

/// Response after submitting a job
#[derive(Debug, Clone, Serialize)]
pub struct SubmitJobResponse {
    pub job_id: Uuid,
    pub status: JobStatus,
    pub message: String,
}

/// Job status response
#[derive(Debug, Clone, Serialize)]
pub struct JobStatusResponse {
    pub id: Uuid,
    pub status: JobStatus,
    pub progress: u8,
    pub message: Option<String>,
    pub output_path: Option<String>,
    pub error: Option<String>,
    pub submitted_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}

impl From<&DDAJob> for JobStatusResponse {
    fn from(job: &DDAJob) -> Self {
        Self {
            id: job.id,
            status: job.status,
            progress: job.progress,
            message: job.message.clone(),
            output_path: job.output_path.as_ref().map(|p| p.to_string_lossy().to_string()),
            error: job.error.clone(),
            submitted_at: job.submitted_at,
            started_at: job.started_at,
            completed_at: job.completed_at,
        }
    }
}

/// Progress update event for WebSocket notifications
#[derive(Debug, Clone, Serialize)]
pub struct JobProgressEvent {
    pub job_id: Uuid,
    pub status: JobStatus,
    pub progress: u8,
    pub message: Option<String>,
}
