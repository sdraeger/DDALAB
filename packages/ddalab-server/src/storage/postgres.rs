use async_trait::async_trait;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::storage::traits::{AuditLogStore, InstitutionStore, SessionStore, SharedResultStore, StorageError, StorageResult};
use crate::storage::types::{AccessPolicy, AccessPolicyType, AuditAction, AuditLogEntry, InstitutionConfig, ShareMetadata, ShareToken, ShareableContentType, UserId, UserSession};

/// PostgreSQL implementation of SharedResultStore
pub struct PostgresShareStore {
    pool: PgPool,
}

impl PostgresShareStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Initialize database schema for shares
    pub async fn initialize(&self) -> StorageResult<()> {
        // Create shared_results table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS shared_results (
                share_token TEXT PRIMARY KEY,
                owner_user_id TEXT NOT NULL,
                result_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                access_policy JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                revoked_at TIMESTAMPTZ
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Create index
        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_shared_results_owner
                ON shared_results(owner_user_id) WHERE revoked_at IS NULL
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}

#[async_trait]
impl SharedResultStore for PostgresShareStore {
    async fn publish_result(
        &self,
        share_token: &str,
        metadata: ShareMetadata,
        content_data: Option<serde_json::Value>,
    ) -> StorageResult<()> {
        let access_policy_json = serde_json::to_value(&metadata.access_policy)?;
        let content_type_str = serde_json::to_string(&metadata.content_type)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();

        sqlx::query(
            r#"
            INSERT INTO shared_results
                (share_token, owner_user_id, content_type, result_id, title, description,
                 access_policy, created_at, content_data)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (share_token) DO UPDATE SET
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                access_policy = EXCLUDED.access_policy,
                content_data = EXCLUDED.content_data
            "#,
        )
        .bind(share_token)
        .bind(&metadata.owner_user_id)
        .bind(&content_type_str)
        .bind(&metadata.content_id)
        .bind(&metadata.title)
        .bind(&metadata.description)
        .bind(access_policy_json)
        .bind(metadata.created_at)
        .bind(&content_data)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn get_shared_result(&self, share_token: &str) -> StorageResult<ShareMetadata> {
        let row = sqlx::query(
            r#"
            SELECT owner_user_id, result_id, title, description, access_policy, created_at
            FROM shared_results
            WHERE share_token = $1 AND revoked_at IS NULL
            "#,
        )
        .bind(share_token)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::ShareNotFound(share_token.to_string()))?;

        let access_policy: AccessPolicy = serde_json::from_value(row.get("access_policy"))?;

        Ok(ShareMetadata {
            owner_user_id: row.get("owner_user_id"),
            content_type: Default::default(), // Default until migration adds column
            content_id: row.get("result_id"), // Maps from result_id column until migration
            title: row.get("title"),
            description: row.get("description"),
            created_at: row.get("created_at"),
            access_policy,
            classification: Default::default(),
            download_count: 0,
            last_accessed_at: None,
        })
    }

    async fn check_access(
        &self,
        share_token: &str,
        requester_id: &UserId,
    ) -> StorageResult<bool> {
        let metadata = self.get_shared_result(share_token).await?;

        let has_access = match &metadata.access_policy.policy_type {
            AccessPolicyType::Public => true,
            AccessPolicyType::Institution => {
                // SECURITY: Institution policy should verify requester belongs to the same institution
                // TODO: Implement institution membership check once User model has institution_id
                // For now, deny access by default for security - requires user-institution mapping
                // to be implemented in the User model and database schema.
                // The proper check would be:
                //   1. Get requester's institution_id from users table
                //   2. Compare with metadata.access_policy.institution_id
                false
            }
            AccessPolicyType::Team { team_id: _ } => {
                // TODO: Implement team membership check
                // For now, deny access - would need team registry
                false
            }
            AccessPolicyType::Users { user_ids } => user_ids.contains(requester_id),
        };

        Ok(has_access)
    }

    async fn revoke_share(&self, share_token: &str) -> StorageResult<()> {
        let result = sqlx::query(
            r#"
            UPDATE shared_results
            SET revoked_at = NOW()
            WHERE share_token = $1 AND revoked_at IS NULL
            "#,
        )
        .bind(share_token)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::ShareNotFound(share_token.to_string()));
        }

        Ok(())
    }

    async fn list_user_shares(&self, user_id: &UserId) -> StorageResult<Vec<ShareToken>> {
        let rows = sqlx::query(
            r#"
            SELECT share_token
            FROM shared_results
            WHERE owner_user_id = $1 AND revoked_at IS NULL
            ORDER BY created_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|row| row.get("share_token")).collect())
    }

    async fn get_share_content(&self, share_token: &str) -> StorageResult<Option<serde_json::Value>> {
        let row = sqlx::query(
            r#"
            SELECT content_data
            FROM shared_results
            WHERE share_token = $1 AND revoked_at IS NULL
            "#,
        )
        .bind(share_token)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::ShareNotFound(share_token.to_string()))?;

        Ok(row.get("content_data"))
    }

    async fn list_shares_by_type(
        &self,
        user_id: &UserId,
        content_type: ShareableContentType,
        limit: u32,
    ) -> StorageResult<Vec<ShareToken>> {
        let content_type_str = serde_json::to_string(&content_type)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();

        let rows = sqlx::query(
            r#"
            SELECT share_token
            FROM shared_results
            WHERE owner_user_id = $1 AND content_type = $2 AND revoked_at IS NULL
            ORDER BY created_at DESC
            LIMIT $3
            "#,
        )
        .bind(user_id)
        .bind(&content_type_str)
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|row| row.get("share_token")).collect())
    }
}

/// PostgreSQL implementation of SessionStore
pub struct PostgresSessionStore {
    pool: PgPool,
}

impl PostgresSessionStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Initialize database schema for sessions
    pub async fn initialize(&self) -> StorageResult<()> {
        // Create user_sessions table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS user_sessions (
                session_id UUID PRIMARY KEY,
                user_id TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                encryption_key_id TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Create indexes
        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id)
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON user_sessions(expires_at)
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}

#[async_trait]
impl SessionStore for PostgresSessionStore {
    async fn create_session(&self, session: &UserSession) -> StorageResult<()> {
        sqlx::query(
            r#"
            INSERT INTO user_sessions
                (session_id, user_id, endpoint, encryption_key_id, created_at, last_heartbeat, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (session_id) DO UPDATE SET
                last_heartbeat = EXCLUDED.last_heartbeat,
                expires_at = EXCLUDED.expires_at
            "#,
        )
        .bind(session.session_id)
        .bind(&session.user_id)
        .bind(&session.endpoint)
        .bind(&session.encryption_key_id)
        .bind(session.created_at)
        .bind(session.last_heartbeat)
        .bind(session.expires_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn get_session(&self, session_id: Uuid) -> StorageResult<UserSession> {
        let row = sqlx::query(
            r#"
            SELECT session_id, user_id, endpoint, encryption_key_id, created_at, last_heartbeat, expires_at
            FROM user_sessions
            WHERE session_id = $1
            "#,
        )
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::SessionNotFound(session_id))?;

        let session = UserSession {
            session_id: row.get("session_id"),
            user_id: row.get("user_id"),
            endpoint: row.get("endpoint"),
            encryption_key_id: row.get("encryption_key_id"),
            created_at: row.get("created_at"),
            last_heartbeat: row.get("last_heartbeat"),
            expires_at: row.get("expires_at"),
        };

        if session.is_expired() {
            return Err(StorageError::SessionExpired);
        }

        Ok(session)
    }

    async fn get_user_session(&self, user_id: &UserId) -> StorageResult<Option<UserSession>> {
        let row = sqlx::query(
            r#"
            SELECT session_id, user_id, endpoint, encryption_key_id, created_at, last_heartbeat, expires_at
            FROM user_sessions
            WHERE user_id = $1 AND expires_at > NOW()
            ORDER BY created_at DESC
            LIMIT 1
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| UserSession {
            session_id: row.get("session_id"),
            user_id: row.get("user_id"),
            endpoint: row.get("endpoint"),
            encryption_key_id: row.get("encryption_key_id"),
            created_at: row.get("created_at"),
            last_heartbeat: row.get("last_heartbeat"),
            expires_at: row.get("expires_at"),
        }))
    }

    async fn update_heartbeat(&self, session_id: Uuid) -> StorageResult<()> {
        let result = sqlx::query(
            r#"
            UPDATE user_sessions
            SET last_heartbeat = NOW()
            WHERE session_id = $1 AND expires_at > NOW()
            "#,
        )
        .bind(session_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::SessionNotFound(session_id));
        }

        Ok(())
    }

    async fn delete_session(&self, session_id: Uuid) -> StorageResult<()> {
        sqlx::query(
            r#"
            DELETE FROM user_sessions WHERE session_id = $1
            "#,
        )
        .bind(session_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn delete_user_sessions(&self, user_id: &UserId) -> StorageResult<()> {
        sqlx::query(
            r#"
            DELETE FROM user_sessions WHERE user_id = $1
            "#,
        )
        .bind(user_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn cleanup_expired_sessions(&self) -> StorageResult<u64> {
        let result = sqlx::query(
            r#"
            DELETE FROM user_sessions WHERE expires_at < NOW()
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }
}

/// PostgreSQL implementation for audit logging and institution management
pub struct PostgresStorage {
    pool: PgPool,
}

impl PostgresStorage {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AuditLogStore for PostgresStorage {
    async fn log_entry(&self, entry: AuditLogEntry) -> StorageResult<i64> {
        let action_str = match entry.action {
            AuditAction::View => "view",
            AuditAction::Download => "download",
            AuditAction::Share => "share",
            AuditAction::Revoke => "revoke",
            AuditAction::AccessDenied => "access_denied",
        };

        let row = sqlx::query_scalar(
            r#"
            INSERT INTO audit_log (
                timestamp, institution_id, user_id, action,
                share_id, content_type, content_id,
                source_ip, user_agent, metadata
            )
            VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8::inet, $9, $10)
            RETURNING id
            "#,
        )
        .bind(entry.timestamp)
        .bind(&entry.institution_id)
        .bind(&entry.user_id)
        .bind(action_str)
        .bind(&entry.share_id)
        .bind(&entry.content_type)
        .bind(&entry.content_id)
        .bind(&entry.source_ip)
        .bind(&entry.user_agent)
        .bind(&entry.metadata)
        .fetch_one(&self.pool)
        .await?;

        Ok(row)
    }

    async fn get_share_audit_log(
        &self,
        share_id: &str,
        limit: Option<i64>,
    ) -> StorageResult<Vec<AuditLogEntry>> {
        let limit = limit.unwrap_or(100);
        let rows = sqlx::query(
            r#"
            SELECT id, timestamp, institution_id, user_id, action,
                   share_id, content_type, content_id,
                   source_ip::text, user_agent, metadata
            FROM audit_log
            WHERE share_id = $1
            ORDER BY timestamp DESC
            LIMIT $2
            "#,
        )
        .bind(share_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(row_to_audit_entry).collect())
    }

    async fn get_user_audit_log(
        &self,
        user_id: &UserId,
        limit: Option<i64>,
    ) -> StorageResult<Vec<AuditLogEntry>> {
        let limit = limit.unwrap_or(100);
        let rows = sqlx::query(
            r#"
            SELECT id, timestamp, institution_id, user_id, action,
                   share_id, content_type, content_id,
                   source_ip::text, user_agent, metadata
            FROM audit_log
            WHERE user_id = $1
            ORDER BY timestamp DESC
            LIMIT $2
            "#,
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(row_to_audit_entry).collect())
    }

    async fn get_institution_audit_log(
        &self,
        institution_id: &str,
        limit: Option<i64>,
    ) -> StorageResult<Vec<AuditLogEntry>> {
        let limit = limit.unwrap_or(100);
        let rows = sqlx::query(
            r#"
            SELECT id, timestamp, institution_id, user_id, action,
                   share_id, content_type, content_id,
                   source_ip::text, user_agent, metadata
            FROM audit_log
            WHERE institution_id = $1::uuid
            ORDER BY timestamp DESC
            LIMIT $2
            "#,
        )
        .bind(institution_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(row_to_audit_entry).collect())
    }
}

fn parse_audit_action(s: &str) -> AuditAction {
    match s {
        "view" => AuditAction::View,
        "download" => AuditAction::Download,
        "share" => AuditAction::Share,
        "revoke" => AuditAction::Revoke,
        "access_denied" => AuditAction::AccessDenied,
        _ => AuditAction::View, // Default fallback
    }
}

fn row_to_audit_entry(r: sqlx::postgres::PgRow) -> AuditLogEntry {
    AuditLogEntry {
        id: Some(r.get("id")),
        timestamp: r.get("timestamp"),
        institution_id: r.get::<Uuid, _>("institution_id").to_string(),
        user_id: r.get("user_id"),
        action: parse_audit_action(r.get("action")),
        share_id: r.get("share_id"),
        content_type: r.get("content_type"),
        content_id: r.get("content_id"),
        source_ip: r.get("source_ip"),
        user_agent: r.get("user_agent"),
        metadata: r.get("metadata"),
    }
}

#[async_trait]
impl InstitutionStore for PostgresStorage {
    async fn get_institution(&self, institution_id: &str) -> StorageResult<InstitutionConfig> {
        let row = sqlx::query(
            r#"
            SELECT id, name, hipaa_mode, default_share_expiry_days, allow_federation
            FROM institutions
            WHERE id = $1::uuid
            "#,
        )
        .bind(institution_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::InstitutionNotFound(institution_id.to_string()))?;

        Ok(InstitutionConfig {
            id: row.get::<Uuid, _>("id").to_string(),
            name: row.get("name"),
            hipaa_mode: row.get("hipaa_mode"),
            default_share_expiry_days: row.get::<i32, _>("default_share_expiry_days") as u32,
            allow_federation: row.get("allow_federation"),
            federated_institutions: Vec::new(), // Load separately if needed
        })
    }

    async fn upsert_institution(&self, config: &InstitutionConfig) -> StorageResult<()> {
        sqlx::query(
            r#"
            INSERT INTO institutions (id, name, hipaa_mode, default_share_expiry_days, allow_federation, updated_at)
            VALUES ($1::uuid, $2, $3, $4, $5, NOW())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                hipaa_mode = EXCLUDED.hipaa_mode,
                default_share_expiry_days = EXCLUDED.default_share_expiry_days,
                allow_federation = EXCLUDED.allow_federation,
                updated_at = NOW()
            "#,
        )
        .bind(&config.id)
        .bind(&config.name)
        .bind(config.hipaa_mode)
        .bind(config.default_share_expiry_days as i32)
        .bind(config.allow_federation)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn list_institutions(&self) -> StorageResult<Vec<InstitutionConfig>> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, hipaa_mode, default_share_expiry_days, allow_federation
            FROM institutions
            ORDER BY name
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| InstitutionConfig {
                id: r.get::<Uuid, _>("id").to_string(),
                name: r.get("name"),
                hipaa_mode: r.get("hipaa_mode"),
                default_share_expiry_days: r.get::<i32, _>("default_share_expiry_days") as u32,
                allow_federation: r.get("allow_federation"),
                federated_institutions: Vec::new(),
            })
            .collect())
    }
}
