use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Unique identifier for users
pub type UserId = String;

/// Share token for accessing shared results
pub type ShareToken = String;

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
    pub result_id: String,
    pub title: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub access_policy: AccessPolicy,
}

/// Information about a shared result including owner availability
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedResultInfo {
    pub metadata: ShareMetadata,
    pub download_url: String,
    pub owner_online: bool,
}

/// User session information stored in database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSession {
    pub session_id: Uuid,
    pub user_id: UserId,
    pub endpoint: String,
    pub encryption_key_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_heartbeat: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

impl UserSession {
    /// Check if the session has expired
    pub fn is_expired(&self) -> bool {
        Utc::now() > self.expires_at
    }

    /// Check if the session needs heartbeat refresh
    pub fn needs_heartbeat_refresh(&self, timeout_seconds: i64) -> bool {
        let now = Utc::now();
        (now - self.last_heartbeat).num_seconds() > timeout_seconds
    }
}

/// Information about a connected user (in-memory)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub user_id: UserId,
    pub session_id: Uuid,
    pub endpoint: String,
    pub connected_at: DateTime<Utc>,
    pub last_heartbeat: DateTime<Utc>,
}

/// Backup metadata stored by broker
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupMetadata {
    pub user_id: UserId,
    pub state_hash: String,
    pub size_bytes: u64,
    pub created_at: DateTime<Utc>,
}
