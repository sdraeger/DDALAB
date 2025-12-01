use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::storage::{ShareMetadata, SharedResultInfo, UserId, ShareToken};

/// Messages exchanged between local instances and the server
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncMessage {
    // === Presence Management ===
    /// Register user presence with server
    RegisterUser {
        user_id: UserId,
        endpoint: String,
        /// Password for broker authentication (if required)
        #[serde(skip_serializing_if = "Option::is_none")]
        password: Option<String>,
        /// Session token if already authenticated via HTTP
        #[serde(skip_serializing_if = "Option::is_none")]
        session_token: Option<String>,
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

    /// List my shares
    ListMyShares {
        user_id: UserId,
    },

    // === Backup/Restore (Optional) ===
    /// Backup state metadata to server
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

    /// Response to ListMyShares
    ShareList {
        shares: Vec<ShareToken>,
    },

    /// Connection established response
    Connected {
        server_version: String,
        institution: String,
        user_id: UserId,
    },
}
