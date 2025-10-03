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

/// Information about a connected user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub user_id: UserId,
    pub endpoint: String, // User's local server endpoint
    pub connected_at: DateTime<Utc>,
    pub last_heartbeat: DateTime<Utc>,
}

/// Messages exchanged between local instances and the broker
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncMessage {
    // === Presence Management ===
    /// Register user presence with broker
    RegisterUser {
        user_id: UserId,
        endpoint: String,
    },

    /// Heartbeat to maintain connection
    Heartbeat {
        user_id: UserId,
    },

    /// Explicitly disconnect
    Disconnect {
        user_id: UserId,
    },

    // === Share Management ===
    /// Publish a shareable result
    PublishShare {
        token: ShareToken,
        metadata: ShareMetadata,
    },

    /// Request information about a shared result
    RequestShare {
        token: ShareToken,
        requester_id: UserId,
    },

    /// Revoke access to a shared result
    RevokeShare {
        token: ShareToken,
    },

    // === Backup/Restore (Optional) ===
    /// Backup state metadata to broker
    BackupState {
        user_id: UserId,
        state_hash: String,
    },

    /// Request state restoration
    RestoreState {
        user_id: UserId,
    },

    // === Responses ===
    /// Acknowledge successful operation
    Ack {
        message_id: Option<Uuid>,
    },

    /// Error response
    Error {
        message: String,
        code: String,
    },

    /// Response to RequestShare
    ShareInfo {
        info: SharedResultInfo,
    },
}

/// Backup metadata stored by broker
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupMetadata {
    pub user_id: UserId,
    pub state_hash: String,
    pub size_bytes: u64,
    pub created_at: DateTime<Utc>,
}
