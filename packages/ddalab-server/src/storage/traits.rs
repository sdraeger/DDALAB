use async_trait::async_trait;
use uuid::Uuid;
use crate::storage::types::{ShareMetadata, ShareToken, UserId, UserSession};

/// Result type for storage operations
pub type StorageResult<T> = Result<T, StorageError>;

/// Errors that can occur in storage operations
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("Share not found: {0}")]
    ShareNotFound(ShareToken),

    #[error("Access denied: {0}")]
    AccessDenied(String),

    #[error("User not found: {0}")]
    UserNotFound(UserId),

    #[error("Session not found: {0}")]
    SessionNotFound(Uuid),

    #[error("Session expired")]
    SessionExpired,

    #[error("Email already exists: {0}")]
    DuplicateEmail(String),

    #[error("User is suspended")]
    UserSuspended,

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Internal error: {0}")]
    Internal(String),
}

/// Storage backend for shared results
#[async_trait]
pub trait SharedResultStore: Send + Sync {
    /// Publish a new shared result
    async fn publish_result(
        &self,
        share_token: &str,
        metadata: ShareMetadata,
    ) -> StorageResult<()>;

    /// Get information about a shared result
    async fn get_shared_result(&self, share_token: &str) -> StorageResult<ShareMetadata>;

    /// Check if a user has access to a shared result
    async fn check_access(
        &self,
        share_token: &str,
        requester_id: &UserId,
    ) -> StorageResult<bool>;

    /// Revoke a share
    async fn revoke_share(&self, share_token: &str) -> StorageResult<()>;

    /// List all shares owned by a user
    async fn list_user_shares(&self, user_id: &UserId) -> StorageResult<Vec<ShareToken>>;
}

/// Storage backend for user sessions
#[async_trait]
pub trait SessionStore: Send + Sync {
    /// Create a new session
    async fn create_session(&self, session: &UserSession) -> StorageResult<()>;

    /// Get session by ID
    async fn get_session(&self, session_id: Uuid) -> StorageResult<UserSession>;

    /// Get session by user ID (most recent)
    async fn get_user_session(&self, user_id: &UserId) -> StorageResult<Option<UserSession>>;

    /// Update session heartbeat
    async fn update_heartbeat(&self, session_id: Uuid) -> StorageResult<()>;

    /// Delete session
    async fn delete_session(&self, session_id: Uuid) -> StorageResult<()>;

    /// Delete all sessions for a user
    async fn delete_user_sessions(&self, user_id: &UserId) -> StorageResult<()>;

    /// Clean up expired sessions
    async fn cleanup_expired_sessions(&self) -> StorageResult<u64>;
}
