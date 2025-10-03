use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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

/// Messages exchanged between local instances and the broker
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncMessage {
    // === Client -> Broker ===
    RegisterUser {
        user_id: UserId,
        endpoint: String,
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
