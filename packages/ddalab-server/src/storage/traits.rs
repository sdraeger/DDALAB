use async_trait::async_trait;
use uuid::Uuid;
use crate::storage::types::{
    AuditLogEntry, FederatedInstitutionSummary, FederationInvite, FederationTrust,
    InstitutionConfig, ShareMetadata, ShareToken, ShareableContentType, Team, TeamMember,
    TeamRole, TeamSummary, TrustLevel, UserId, UserSession,
};

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

    #[error("Institution not found: {0}")]
    InstitutionNotFound(String),

    #[error("Team not found: {0}")]
    TeamNotFound(Uuid),

    #[error("Email already exists: {0}")]
    DuplicateEmail(String),

    #[error("User is suspended")]
    UserSuspended,

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invite not found: {0}")]
    InviteNotFound(Uuid),

    #[error("Invite expired or already used")]
    InviteExpired,

    #[error("Trust not found: {0}")]
    TrustNotFound(Uuid),

    #[error("Federation not allowed: {0}")]
    FederationNotAllowed(String),

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
    /// Publish a new shared result with optional inline content data
    async fn publish_result(
        &self,
        share_token: &str,
        metadata: ShareMetadata,
        content_data: Option<serde_json::Value>,
    ) -> StorageResult<()>;

    /// Get information about a shared result
    async fn get_shared_result(&self, share_token: &str) -> StorageResult<ShareMetadata>;

    /// Get the content data for a share (returns None if content is reference-only)
    async fn get_share_content(&self, share_token: &str) -> StorageResult<Option<serde_json::Value>>;

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

    /// List shares by content type for a user
    async fn list_shares_by_type(
        &self,
        user_id: &UserId,
        content_type: ShareableContentType,
        limit: u32,
    ) -> StorageResult<Vec<ShareToken>>;
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

/// Storage trait for HIPAA compliance audit logging.
///
/// This trait is specifically designed for tracking share access and data access patterns
/// at the institution level for HIPAA compliance requirements. It differs from `AuditStore`
/// (in `audit.rs`) which handles HTTP request-level security auditing (login attempts,
/// API requests, user management actions, etc.).
///
/// Use `AuditLogStore` for:
/// - Share access tracking (who accessed what shared data, when)
/// - Institution-level compliance reporting
/// - HIPAA audit trail requirements
///
/// Use `AuditStore` for:
/// - HTTP request logging
/// - Security event monitoring (failed logins, etc.)
/// - General application auditing
#[async_trait]
pub trait AuditLogStore: Send + Sync {
    /// Log an audit entry
    async fn log_entry(&self, entry: AuditLogEntry) -> StorageResult<i64>;

    /// Get audit entries for a share
    async fn get_share_audit_log(
        &self,
        share_id: &str,
        limit: Option<i64>,
    ) -> StorageResult<Vec<AuditLogEntry>>;

    /// Get audit entries for a user
    async fn get_user_audit_log(
        &self,
        user_id: &UserId,
        limit: Option<i64>,
    ) -> StorageResult<Vec<AuditLogEntry>>;

    /// Get audit entries for an institution
    async fn get_institution_audit_log(
        &self,
        institution_id: &str,
        limit: Option<i64>,
    ) -> StorageResult<Vec<AuditLogEntry>>;
}

/// Storage trait for institution configuration
#[async_trait]
pub trait InstitutionStore: Send + Sync {
    /// Get institution configuration by ID
    async fn get_institution(&self, institution_id: &str) -> StorageResult<InstitutionConfig>;

    /// Create or update institution configuration
    async fn upsert_institution(&self, config: &InstitutionConfig) -> StorageResult<()>;

    /// List all institutions
    async fn list_institutions(&self) -> StorageResult<Vec<InstitutionConfig>>;
}

/// Storage backend for teams
#[async_trait]
pub trait TeamStore: Send + Sync {
    /// Create a new team
    async fn create_team(&self, team: &Team) -> StorageResult<()>;

    /// Get team by ID
    async fn get_team(&self, team_id: Uuid) -> StorageResult<Team>;

    /// Update team details
    async fn update_team(&self, team_id: Uuid, name: &str, description: Option<&str>) -> StorageResult<()>;

    /// Delete a team
    async fn delete_team(&self, team_id: Uuid) -> StorageResult<()>;

    /// List teams for an institution
    async fn list_institution_teams(&self, institution_id: Uuid) -> StorageResult<Vec<TeamSummary>>;

    /// List teams a user belongs to
    async fn list_user_teams(&self, user_id: Uuid) -> StorageResult<Vec<TeamSummary>>;

    /// Add member to team
    async fn add_team_member(&self, member: &TeamMember) -> StorageResult<()>;

    /// Remove member from team
    async fn remove_team_member(&self, team_id: Uuid, user_id: Uuid) -> StorageResult<()>;

    /// Update member role
    async fn update_member_role(&self, team_id: Uuid, user_id: Uuid, role: TeamRole) -> StorageResult<()>;

    /// Get team members
    async fn get_team_members(&self, team_id: Uuid) -> StorageResult<Vec<TeamMember>>;

    /// Check if user is team member
    async fn is_team_member(&self, team_id: Uuid, user_id: Uuid) -> StorageResult<bool>;

    /// Check if user is team admin
    async fn is_team_admin(&self, team_id: Uuid, user_id: Uuid) -> StorageResult<bool>;
}

/// Storage backend for federation between institutions
#[async_trait]
pub trait FederationStore: Send + Sync {
    /// Create a federation invite
    async fn create_invite(&self, invite: &FederationInvite) -> StorageResult<()>;

    /// Get invite by ID
    async fn get_invite(&self, invite_id: Uuid) -> StorageResult<FederationInvite>;

    /// Get invite by token
    async fn get_invite_by_token(&self, token: &str) -> StorageResult<FederationInvite>;

    /// Accept an invite (creates bilateral trust)
    async fn accept_invite(
        &self,
        invite_id: Uuid,
        accepting_institution_id: Uuid,
        accepting_user_id: Uuid,
    ) -> StorageResult<FederationTrust>;

    /// Revoke an invite
    async fn revoke_invite(&self, invite_id: Uuid) -> StorageResult<()>;

    /// List pending invites from an institution
    async fn list_pending_invites(&self, institution_id: Uuid) -> StorageResult<Vec<FederationInvite>>;

    /// Get trust relationship by ID
    async fn get_trust(&self, trust_id: Uuid) -> StorageResult<FederationTrust>;

    /// List all active trusts for an institution
    async fn list_trusts(&self, institution_id: Uuid) -> StorageResult<Vec<FederationTrust>>;

    /// Update trust level
    async fn update_trust_level(
        &self,
        trust_id: Uuid,
        trust_level: TrustLevel,
    ) -> StorageResult<()>;

    /// Revoke trust (soft delete)
    async fn revoke_trust(&self, trust_id: Uuid, revoked_by: Uuid) -> StorageResult<()>;

    /// Check if two institutions are federated
    async fn are_federated(
        &self,
        institution_a: Uuid,
        institution_b: Uuid,
    ) -> StorageResult<Option<FederationTrust>>;

    /// Get federated institutions with summary info
    async fn get_federated_institutions(
        &self,
        institution_id: Uuid,
    ) -> StorageResult<Vec<FederatedInstitutionSummary>>;
}
