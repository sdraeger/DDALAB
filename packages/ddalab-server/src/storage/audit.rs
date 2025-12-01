use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::traits::{StorageError, StorageResult};

/// Actions that can be audited
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuditAction {
    // Authentication
    LoginSuccess,
    LoginFailed,
    Logout,

    // User management (admin)
    UserCreated,
    UserDeleted,
    UserSuspended,
    UserActivated,
    UserPasswordReset,
    UserAdminGranted,
    UserAdminRevoked,

    // Jobs
    JobSubmitted,
    JobCancelled,
    JobCompleted,
    JobFailed,
    JobResultsDownloaded,

    // File operations
    FileUploaded,
    FileListed,
    FileDeleted,

    // Shares
    ShareCreated,
    ShareAccessed,
    ShareRevoked,

    // API access
    ApiRequest,
}

impl AuditAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::LoginSuccess => "login_success",
            Self::LoginFailed => "login_failed",
            Self::Logout => "logout",
            Self::UserCreated => "user_created",
            Self::UserDeleted => "user_deleted",
            Self::UserSuspended => "user_suspended",
            Self::UserActivated => "user_activated",
            Self::UserPasswordReset => "user_password_reset",
            Self::UserAdminGranted => "user_admin_granted",
            Self::UserAdminRevoked => "user_admin_revoked",
            Self::JobSubmitted => "job_submitted",
            Self::JobCancelled => "job_cancelled",
            Self::JobCompleted => "job_completed",
            Self::JobFailed => "job_failed",
            Self::JobResultsDownloaded => "job_results_downloaded",
            Self::FileUploaded => "file_uploaded",
            Self::FileListed => "file_listed",
            Self::FileDeleted => "file_deleted",
            Self::ShareCreated => "share_created",
            Self::ShareAccessed => "share_accessed",
            Self::ShareRevoked => "share_revoked",
            Self::ApiRequest => "api_request",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "login_success" => Some(Self::LoginSuccess),
            "login_failed" => Some(Self::LoginFailed),
            "logout" => Some(Self::Logout),
            "user_created" => Some(Self::UserCreated),
            "user_deleted" => Some(Self::UserDeleted),
            "user_suspended" => Some(Self::UserSuspended),
            "user_activated" => Some(Self::UserActivated),
            "user_password_reset" => Some(Self::UserPasswordReset),
            "user_admin_granted" => Some(Self::UserAdminGranted),
            "user_admin_revoked" => Some(Self::UserAdminRevoked),
            "job_submitted" => Some(Self::JobSubmitted),
            "job_cancelled" => Some(Self::JobCancelled),
            "job_completed" => Some(Self::JobCompleted),
            "job_failed" => Some(Self::JobFailed),
            "job_results_downloaded" => Some(Self::JobResultsDownloaded),
            "file_uploaded" => Some(Self::FileUploaded),
            "file_listed" => Some(Self::FileListed),
            "file_deleted" => Some(Self::FileDeleted),
            "share_created" => Some(Self::ShareCreated),
            "share_accessed" => Some(Self::ShareAccessed),
            "share_revoked" => Some(Self::ShareRevoked),
            "api_request" => Some(Self::ApiRequest),
            _ => None,
        }
    }
}

/// Audit log entry
#[derive(Debug, Clone, Serialize)]
pub struct AuditEntry {
    pub id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub user_id: Option<Uuid>,
    pub user_email: Option<String>,
    pub action: AuditAction,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub http_method: Option<String>,
    pub http_path: Option<String>,
    pub http_status: Option<i32>,
    pub details: Option<serde_json::Value>,
    pub success: bool,
}

/// Builder for creating audit entries
#[derive(Debug, Default)]
pub struct AuditEntryBuilder {
    user_id: Option<Uuid>,
    user_email: Option<String>,
    action: Option<AuditAction>,
    resource_type: Option<String>,
    resource_id: Option<String>,
    ip_address: Option<String>,
    user_agent: Option<String>,
    http_method: Option<String>,
    http_path: Option<String>,
    http_status: Option<i32>,
    details: Option<serde_json::Value>,
    success: bool,
}

impl AuditEntryBuilder {
    pub fn new(action: AuditAction) -> Self {
        Self {
            action: Some(action),
            success: true,
            ..Default::default()
        }
    }

    pub fn user(mut self, id: Uuid, email: &str) -> Self {
        self.user_id = Some(id);
        self.user_email = Some(email.to_string());
        self
    }

    pub fn user_id(mut self, id: Uuid) -> Self {
        self.user_id = Some(id);
        self
    }

    pub fn user_email(mut self, email: &str) -> Self {
        self.user_email = Some(email.to_string());
        self
    }

    pub fn resource(mut self, resource_type: &str, resource_id: &str) -> Self {
        self.resource_type = Some(resource_type.to_string());
        self.resource_id = Some(resource_id.to_string());
        self
    }

    pub fn ip_address(mut self, ip: &str) -> Self {
        self.ip_address = Some(ip.to_string());
        self
    }

    pub fn user_agent(mut self, ua: &str) -> Self {
        self.user_agent = Some(ua.to_string());
        self
    }

    pub fn http_request(mut self, method: &str, path: &str) -> Self {
        self.http_method = Some(method.to_string());
        self.http_path = Some(path.to_string());
        self
    }

    pub fn http_status(mut self, status: i32) -> Self {
        self.http_status = Some(status);
        self
    }

    pub fn details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn success(mut self, success: bool) -> Self {
        self.success = success;
        self
    }

    pub fn build(self) -> AuditEntry {
        AuditEntry {
            id: Uuid::new_v4(),
            timestamp: Utc::now(),
            user_id: self.user_id,
            user_email: self.user_email,
            action: self.action.unwrap_or(AuditAction::ApiRequest),
            resource_type: self.resource_type,
            resource_id: self.resource_id,
            ip_address: self.ip_address,
            user_agent: self.user_agent,
            http_method: self.http_method,
            http_path: self.http_path,
            http_status: self.http_status,
            details: self.details,
            success: self.success,
        }
    }
}

/// Query filters for audit logs
#[derive(Debug, Default)]
pub struct AuditQuery {
    pub user_id: Option<Uuid>,
    pub action: Option<AuditAction>,
    pub resource_type: Option<String>,
    pub from_date: Option<DateTime<Utc>>,
    pub to_date: Option<DateTime<Utc>>,
    pub success_only: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Audit store trait
#[async_trait]
pub trait AuditStore: Send + Sync {
    /// Log an audit entry
    async fn log(&self, entry: AuditEntry) -> StorageResult<()>;

    /// Query audit logs
    async fn query(&self, query: AuditQuery) -> StorageResult<Vec<AuditEntry>>;

    /// Get recent audit logs
    async fn recent(&self, limit: i64) -> StorageResult<Vec<AuditEntry>>;

    /// Get audit logs for a specific user
    async fn for_user(&self, user_id: Uuid, limit: i64) -> StorageResult<Vec<AuditEntry>>;

    /// Count audit entries matching criteria
    async fn count(&self, query: AuditQuery) -> StorageResult<i64>;
}

/// PostgreSQL implementation of AuditStore
pub struct PostgresAuditStore {
    pool: PgPool,
}

impl PostgresAuditStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Initialize database schema for audit logs
    pub async fn initialize(&self) -> StorageResult<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                user_id UUID,
                user_email VARCHAR(255),
                action VARCHAR(50) NOT NULL,
                resource_type VARCHAR(50),
                resource_id VARCHAR(255),
                ip_address VARCHAR(45),
                user_agent TEXT,
                http_method VARCHAR(10),
                http_path TEXT,
                http_status SMALLINT,
                details JSONB,
                success BOOLEAN NOT NULL DEFAULT TRUE
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Create indexes for common queries
        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC)
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id) WHERE user_id IS NOT NULL
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id)
            WHERE resource_type IS NOT NULL
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}

#[async_trait]
impl AuditStore for PostgresAuditStore {
    async fn log(&self, entry: AuditEntry) -> StorageResult<()> {
        sqlx::query(
            r#"
            INSERT INTO audit_logs (
                id, timestamp, user_id, user_email, action, resource_type, resource_id,
                ip_address, user_agent, http_method, http_path, http_status, details, success
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            "#,
        )
        .bind(entry.id)
        .bind(entry.timestamp)
        .bind(entry.user_id)
        .bind(&entry.user_email)
        .bind(entry.action.as_str())
        .bind(&entry.resource_type)
        .bind(&entry.resource_id)
        .bind(&entry.ip_address)
        .bind(&entry.user_agent)
        .bind(&entry.http_method)
        .bind(&entry.http_path)
        .bind(entry.http_status)
        .bind(&entry.details)
        .bind(entry.success)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn query(&self, query: AuditQuery) -> StorageResult<Vec<AuditEntry>> {
        let mut sql = String::from(
            r#"
            SELECT id, timestamp, user_id, user_email, action, resource_type, resource_id,
                   ip_address, user_agent, http_method, http_path, http_status, details, success
            FROM audit_logs
            WHERE 1=1
            "#,
        );

        let mut params: Vec<String> = Vec::new();
        let mut param_idx = 1;

        if query.user_id.is_some() {
            sql.push_str(&format!(" AND user_id = ${}", param_idx));
            param_idx += 1;
        }

        if query.action.is_some() {
            sql.push_str(&format!(" AND action = ${}", param_idx));
            param_idx += 1;
        }

        if query.resource_type.is_some() {
            sql.push_str(&format!(" AND resource_type = ${}", param_idx));
            param_idx += 1;
        }

        if query.from_date.is_some() {
            sql.push_str(&format!(" AND timestamp >= ${}", param_idx));
            param_idx += 1;
        }

        if query.to_date.is_some() {
            sql.push_str(&format!(" AND timestamp <= ${}", param_idx));
            param_idx += 1;
        }

        if let Some(success) = query.success_only {
            sql.push_str(&format!(" AND success = ${}", param_idx));
            param_idx += 1;
        }

        sql.push_str(" ORDER BY timestamp DESC");

        let limit = query.limit.unwrap_or(100);
        let offset = query.offset.unwrap_or(0);
        sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

        // Build dynamic query - for now, use simpler approach
        let rows = sqlx::query(&sql)
            .fetch_all(&self.pool)
            .await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let action_str: String = row.get("action");
                let action = AuditAction::from_str(&action_str)?;

                Some(AuditEntry {
                    id: row.get("id"),
                    timestamp: row.get("timestamp"),
                    user_id: row.get("user_id"),
                    user_email: row.get("user_email"),
                    action,
                    resource_type: row.get("resource_type"),
                    resource_id: row.get("resource_id"),
                    ip_address: row.get("ip_address"),
                    user_agent: row.get("user_agent"),
                    http_method: row.get("http_method"),
                    http_path: row.get("http_path"),
                    http_status: row.get("http_status"),
                    details: row.get("details"),
                    success: row.get("success"),
                })
            })
            .collect())
    }

    async fn recent(&self, limit: i64) -> StorageResult<Vec<AuditEntry>> {
        let rows = sqlx::query(
            r#"
            SELECT id, timestamp, user_id, user_email, action, resource_type, resource_id,
                   ip_address, user_agent, http_method, http_path, http_status, details, success
            FROM audit_logs
            ORDER BY timestamp DESC
            LIMIT $1
            "#,
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let action_str: String = row.get("action");
                let action = AuditAction::from_str(&action_str)?;

                Some(AuditEntry {
                    id: row.get("id"),
                    timestamp: row.get("timestamp"),
                    user_id: row.get("user_id"),
                    user_email: row.get("user_email"),
                    action,
                    resource_type: row.get("resource_type"),
                    resource_id: row.get("resource_id"),
                    ip_address: row.get("ip_address"),
                    user_agent: row.get("user_agent"),
                    http_method: row.get("http_method"),
                    http_path: row.get("http_path"),
                    http_status: row.get("http_status"),
                    details: row.get("details"),
                    success: row.get("success"),
                })
            })
            .collect())
    }

    async fn for_user(&self, user_id: Uuid, limit: i64) -> StorageResult<Vec<AuditEntry>> {
        let rows = sqlx::query(
            r#"
            SELECT id, timestamp, user_id, user_email, action, resource_type, resource_id,
                   ip_address, user_agent, http_method, http_path, http_status, details, success
            FROM audit_logs
            WHERE user_id = $1
            ORDER BY timestamp DESC
            LIMIT $2
            "#,
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let action_str: String = row.get("action");
                let action = AuditAction::from_str(&action_str)?;

                Some(AuditEntry {
                    id: row.get("id"),
                    timestamp: row.get("timestamp"),
                    user_id: row.get("user_id"),
                    user_email: row.get("user_email"),
                    action,
                    resource_type: row.get("resource_type"),
                    resource_id: row.get("resource_id"),
                    ip_address: row.get("ip_address"),
                    user_agent: row.get("user_agent"),
                    http_method: row.get("http_method"),
                    http_path: row.get("http_path"),
                    http_status: row.get("http_status"),
                    details: row.get("details"),
                    success: row.get("success"),
                })
            })
            .collect())
    }

    async fn count(&self, query: AuditQuery) -> StorageResult<i64> {
        // Simplified count - just count all for now
        let row = sqlx::query(
            r#"
            SELECT COUNT(*) as count FROM audit_logs
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(row.get("count"))
    }
}
