use async_trait::async_trait;
use crate::types::{BackupMetadata, ShareMetadata, ShareToken, UserId};

/// Result type for broker operations
pub type BrokerResult<T> = Result<T, BrokerError>;

/// Errors that can occur in the broker
#[derive(Debug, thiserror::Error)]
pub enum BrokerError {
    #[error("Share not found: {0}")]
    ShareNotFound(ShareToken),

    #[error("Access denied: {0}")]
    AccessDenied(String),

    #[error("User not found: {0}")]
    UserNotFound(UserId),

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
    ) -> BrokerResult<()>;

    /// Get information about a shared result
    async fn get_shared_result(&self, share_token: &str) -> BrokerResult<ShareMetadata>;

    /// Check if a user has access to a shared result
    async fn check_access(
        &self,
        share_token: &str,
        requester_id: &UserId,
    ) -> BrokerResult<bool>;

    /// Revoke a share
    async fn revoke_share(&self, share_token: &str) -> BrokerResult<()>;

    /// List all shares owned by a user
    async fn list_user_shares(&self, user_id: &UserId) -> BrokerResult<Vec<ShareToken>>;
}

/// Storage backend for user state backups (optional feature)
#[async_trait]
pub trait BackupStore: Send + Sync {
    /// Store a backup
    async fn store_backup(
        &self,
        user_id: &UserId,
        data: &[u8],
        metadata: BackupMetadata,
    ) -> BrokerResult<()>;

    /// Retrieve a backup
    async fn get_backup(&self, user_id: &UserId) -> BrokerResult<Vec<u8>>;

    /// Get backup metadata
    async fn get_backup_metadata(&self, user_id: &UserId) -> BrokerResult<BackupMetadata>;

    /// Delete a backup
    async fn delete_backup(&self, user_id: &UserId) -> BrokerResult<()>;
}
