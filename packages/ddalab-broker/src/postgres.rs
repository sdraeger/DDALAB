use crate::traits::{BackupStore, BrokerError, BrokerResult, SharedResultStore};
use crate::types::{AccessPolicy, BackupMetadata, ShareMetadata, ShareToken, UserId};
use async_trait::async_trait;
use sqlx::{PgPool, Row};

/// PostgreSQL implementation of SharedResultStore
pub struct PostgresShareStore {
    pool: PgPool,
}

impl PostgresShareStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Initialize database schema
    pub async fn initialize(&self) -> BrokerResult<()> {
        // Create table
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
    ) -> BrokerResult<()> {
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

    async fn get_shared_result(&self, share_token: &str) -> BrokerResult<ShareMetadata> {
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
        .ok_or_else(|| BrokerError::ShareNotFound(share_token.to_string()))?;

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
    ) -> BrokerResult<bool> {
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

    async fn revoke_share(&self, share_token: &str) -> BrokerResult<()> {
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
            return Err(BrokerError::ShareNotFound(share_token.to_string()));
        }

        Ok(())
    }

    async fn list_user_shares(&self, user_id: &UserId) -> BrokerResult<Vec<ShareToken>> {
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

/// PostgreSQL implementation of BackupStore
pub struct PostgresBackupStore {
    pool: PgPool,
}

impl PostgresBackupStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Initialize database schema
    pub async fn initialize(&self) -> BrokerResult<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS user_backups (
                user_id TEXT PRIMARY KEY,
                data BYTEA NOT NULL,
                state_hash TEXT NOT NULL,
                size_bytes BIGINT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}

#[async_trait]
impl BackupStore for PostgresBackupStore {
    async fn store_backup(
        &self,
        user_id: &UserId,
        data: &[u8],
        metadata: BackupMetadata,
    ) -> BrokerResult<()> {
        sqlx::query(
            r#"
            INSERT INTO user_backups (user_id, data, state_hash, size_bytes, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                data = EXCLUDED.data,
                state_hash = EXCLUDED.state_hash,
                size_bytes = EXCLUDED.size_bytes,
                updated_at = NOW()
            "#,
        )
        .bind(user_id)
        .bind(data)
        .bind(&metadata.state_hash)
        .bind(metadata.size_bytes as i64)
        .bind(metadata.created_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn get_backup(&self, user_id: &UserId) -> BrokerResult<Vec<u8>> {
        let row = sqlx::query(
            r#"
            SELECT data FROM user_backups WHERE user_id = $1
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| BrokerError::UserNotFound(user_id.clone()))?;

        Ok(row.get("data"))
    }

    async fn get_backup_metadata(&self, user_id: &UserId) -> BrokerResult<BackupMetadata> {
        let row = sqlx::query(
            r#"
            SELECT state_hash, size_bytes, created_at
            FROM user_backups
            WHERE user_id = $1
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| BrokerError::UserNotFound(user_id.clone()))?;

        Ok(BackupMetadata {
            user_id: user_id.clone(),
            state_hash: row.get("state_hash"),
            size_bytes: row.get::<i64, _>("size_bytes") as u64,
            created_at: row.get("created_at"),
        })
    }

    async fn delete_backup(&self, user_id: &UserId) -> BrokerResult<()> {
        let result = sqlx::query(
            r#"
            DELETE FROM user_backups WHERE user_id = $1
            "#,
        )
        .bind(user_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(BrokerError::UserNotFound(user_id.clone()));
        }

        Ok(())
    }
}
