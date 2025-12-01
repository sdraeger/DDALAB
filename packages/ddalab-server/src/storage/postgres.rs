use async_trait::async_trait;
use chrono::Utc;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::storage::traits::{SessionStore, SharedResultStore, StorageError, StorageResult};
use crate::storage::types::{AccessPolicy, ShareMetadata, ShareToken, UserId, UserSession};

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
    ) -> StorageResult<()> {
        let access_policy_json = serde_json::to_value(&metadata.access_policy)?;

        sqlx::query(
            r#"
            INSERT INTO shared_results
                (share_token, owner_user_id, result_id, title, description, access_policy, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (share_token) DO UPDATE SET
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                access_policy = EXCLUDED.access_policy
            "#,
        )
        .bind(share_token)
        .bind(&metadata.owner_user_id)
        .bind(&metadata.result_id)
        .bind(&metadata.title)
        .bind(&metadata.description)
        .bind(access_policy_json)
        .bind(metadata.created_at)
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
            result_id: row.get("result_id"),
            title: row.get("title"),
            description: row.get("description"),
            created_at: row.get("created_at"),
            access_policy,
        })
    }

    async fn check_access(
        &self,
        share_token: &str,
        requester_id: &UserId,
    ) -> StorageResult<bool> {
        let metadata = self.get_shared_result(share_token).await?;

        let has_access = match metadata.access_policy {
            AccessPolicy::Public => true,
            AccessPolicy::Team { team_id: _ } => {
                // TODO: Implement team membership check
                // For now, deny access - would need team registry
                false
            }
            AccessPolicy::Users { user_ids } => user_ids.contains(requester_id),
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
