use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Unique identifier for users
pub type UserId = String;

/// Share token for accessing shared results
pub type ShareToken = String;

/// Job identifier
pub type JobId = String;

/// Status of a DDA job
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

/// DDA analysis parameters for job submission
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDAJobParameters {
    pub channels: Vec<String>,
    #[serde(default)]
    pub ct_pairs: Vec<(String, String)>,
    #[serde(default)]
    pub cd_pairs: Vec<(String, String)>,
    pub time_window: f64,
    pub delta: f64,
    pub embedding_dim: u32,
    pub svd_dimensions: u32,
    #[serde(default = "default_downsample")]
    pub downsample: u32,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
}

fn default_downsample() -> u32 {
    1
}

impl Default for DDAJobParameters {
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

/// Request to submit job for server-side file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitServerFileRequest {
    pub server_path: String,
    pub parameters: DDAJobParameters,
}

/// Response after submitting a job
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitJobResponse {
    pub job_id: String,
    pub status: JobStatus,
    pub message: String,
}

/// Job status response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobStatusResponse {
    pub id: String,
    pub status: JobStatus,
    pub progress: u8,
    pub message: Option<String>,
    pub output_path: Option<String>,
    pub error: Option<String>,
    pub submitted_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}

/// Progress event from SSE stream
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobProgressEvent {
    pub job_id: String,
    pub status: JobStatus,
    pub progress: u8,
    pub message: Option<String>,
}

/// Queue statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueStats {
    pub pending: usize,
    pub running: usize,
    pub completed: usize,
    pub failed: usize,
    pub cancelled: usize,
    pub max_concurrent: usize,
    pub available_slots: usize,
}

/// Server file info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerFileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub is_directory: bool,
}

/// Access control policy for shared results
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AccessPolicy {
    /// Anyone with the link can access
    Public,
    /// Only members of a specific team
    Team { team_id: String },
    /// Only specific users
    Users { user_ids: Vec<UserId> },
}

/// Metadata about a shared result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareMetadata {
    pub owner_user_id: UserId,
    #[serde(default)]
    pub content_type: ShareableContentType,
    pub content_id: String,
    pub title: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub access_policy: AccessPolicy,
    #[serde(default)]
    pub classification: DataClassification,
    #[serde(default)]
    pub download_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_accessed_at: Option<DateTime<Utc>>,
}

/// Information about a shared result including owner availability
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedResultInfo {
    pub metadata: ShareMetadata,
    pub download_url: String,
    pub owner_online: bool,
}

/// Data classification for HIPAA compliance
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DataClassification {
    Phi,
    DeIdentified,
    Synthetic,
    #[default]
    Unclassified,
}

/// Types of content that can be shared through the collaboration system
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ShareableContentType {
    #[default]
    DdaResult,
    Annotation,
    Workflow,
    ParameterSet,
    DataSegment,
}

/// Granular permissions for shared content
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    View,
    Download,
    Reshare,
}

/// Access policy type for institutional sharing
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AccessPolicyType {
    Public,
    Team { team_id: String },
    Users { user_ids: Vec<UserId> },
    Institution,
}

/// Full access policy with permissions and expiration
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FullAccessPolicy {
    #[serde(flatten)]
    pub policy_type: AccessPolicyType,
    pub institution_id: String,
    pub permissions: Vec<Permission>,
    pub expires_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_downloads: Option<u32>,
}

/// Institution configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstitutionConfig {
    pub id: String,
    pub name: String,
    pub hipaa_mode: bool,
    pub default_share_expiry_days: u32,
    pub allow_federation: bool,
    #[serde(default)]
    pub federated_institutions: Vec<String>,
}

impl Default for InstitutionConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            hipaa_mode: false,
            default_share_expiry_days: 30,
            allow_federation: false,
            federated_institutions: Vec::new(),
        }
    }
}

/// Messages exchanged between local instances and the broker
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncMessage {
    // === Client -> Broker ===
    RegisterUser {
        user_id: UserId,
        endpoint: String,
        /// Password for legacy broker authentication (fallback)
        #[serde(skip_serializing_if = "Option::is_none")]
        password: Option<String>,
        /// Session token from HTTP login (preferred)
        #[serde(skip_serializing_if = "Option::is_none")]
        session_token: Option<String>,
    },
    Heartbeat {
        user_id: UserId,
    },
    Disconnect {
        user_id: UserId,
    },
    PublishShare {
        token: ShareToken,
        metadata: ShareMetadata,
    },
    RequestShare {
        token: ShareToken,
        requester_id: UserId,
    },
    RevokeShare {
        token: ShareToken,
    },

    // === Broker -> Client ===
    Ack {
        message_id: Option<String>,
    },
    Error {
        message: String,
        code: String,
    },
    ShareInfo {
        info: SharedResultInfo,
    },
}
