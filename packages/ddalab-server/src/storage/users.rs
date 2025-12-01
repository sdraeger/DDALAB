use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::traits::{StorageError, StorageResult};

/// User account in the system
#[derive(Debug, Clone)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub password_hash: String,
    pub is_admin: bool,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub last_login: Option<DateTime<Utc>>,
}

/// User creation request
#[derive(Debug)]
pub struct CreateUser {
    pub email: String,
    pub display_name: String,
    pub password_hash: String,
    pub is_admin: bool,
}

/// User store trait
#[async_trait]
pub trait UserStore: Send + Sync {
    /// Create a new user
    async fn create_user(&self, user: CreateUser) -> StorageResult<User>;

    /// Get user by ID
    async fn get_user(&self, id: Uuid) -> StorageResult<User>;

    /// Get user by email
    async fn get_user_by_email(&self, email: &str) -> StorageResult<User>;

    /// List all users
    async fn list_users(&self) -> StorageResult<Vec<User>>;

    /// Update user's password
    async fn update_password(&self, id: Uuid, password_hash: &str) -> StorageResult<()>;

    /// Update user's active status
    async fn set_user_active(&self, id: Uuid, is_active: bool) -> StorageResult<()>;

    /// Update user's admin status
    async fn set_user_admin(&self, id: Uuid, is_admin: bool) -> StorageResult<()>;

    /// Update last login timestamp
    async fn update_last_login(&self, id: Uuid) -> StorageResult<()>;

    /// Delete user
    async fn delete_user(&self, id: Uuid) -> StorageResult<()>;

    /// Check if any users exist
    async fn has_users(&self) -> StorageResult<bool>;
}

/// PostgreSQL implementation of UserStore
pub struct PostgresUserStore {
    pool: PgPool,
}

impl PostgresUserStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Initialize database schema for users
    pub async fn initialize(&self) -> StorageResult<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                email VARCHAR(255) UNIQUE NOT NULL,
                display_name VARCHAR(255) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_login TIMESTAMPTZ
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Create index on email for fast lookups
        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}

#[async_trait]
impl UserStore for PostgresUserStore {
    async fn create_user(&self, user: CreateUser) -> StorageResult<User> {
        let id = Uuid::new_v4();
        let now = Utc::now();

        sqlx::query(
            r#"
            INSERT INTO users (id, email, display_name, password_hash, is_admin, is_active, created_at)
            VALUES ($1, $2, $3, $4, $5, TRUE, $6)
            "#,
        )
        .bind(id)
        .bind(&user.email)
        .bind(&user.display_name)
        .bind(&user.password_hash)
        .bind(user.is_admin)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| {
            if let Some(db_err) = e.as_database_error() {
                if db_err.is_unique_violation() {
                    return StorageError::DuplicateEmail(user.email.clone());
                }
            }
            StorageError::Database(e)
        })?;

        Ok(User {
            id,
            email: user.email,
            display_name: user.display_name,
            password_hash: user.password_hash,
            is_admin: user.is_admin,
            is_active: true,
            created_at: now,
            last_login: None,
        })
    }

    async fn get_user(&self, id: Uuid) -> StorageResult<User> {
        let row = sqlx::query(
            r#"
            SELECT id, email, display_name, password_hash, is_admin, is_active, created_at, last_login
            FROM users
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::UserNotFound(id.to_string()))?;

        Ok(User {
            id: row.get("id"),
            email: row.get("email"),
            display_name: row.get("display_name"),
            password_hash: row.get("password_hash"),
            is_admin: row.get("is_admin"),
            is_active: row.get("is_active"),
            created_at: row.get("created_at"),
            last_login: row.get("last_login"),
        })
    }

    async fn get_user_by_email(&self, email: &str) -> StorageResult<User> {
        let row = sqlx::query(
            r#"
            SELECT id, email, display_name, password_hash, is_admin, is_active, created_at, last_login
            FROM users
            WHERE email = $1
            "#,
        )
        .bind(email)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::UserNotFound(email.to_string()))?;

        Ok(User {
            id: row.get("id"),
            email: row.get("email"),
            display_name: row.get("display_name"),
            password_hash: row.get("password_hash"),
            is_admin: row.get("is_admin"),
            is_active: row.get("is_active"),
            created_at: row.get("created_at"),
            last_login: row.get("last_login"),
        })
    }

    async fn list_users(&self) -> StorageResult<Vec<User>> {
        let rows = sqlx::query(
            r#"
            SELECT id, email, display_name, password_hash, is_admin, is_active, created_at, last_login
            FROM users
            ORDER BY created_at ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| User {
                id: row.get("id"),
                email: row.get("email"),
                display_name: row.get("display_name"),
                password_hash: row.get("password_hash"),
                is_admin: row.get("is_admin"),
                is_active: row.get("is_active"),
                created_at: row.get("created_at"),
                last_login: row.get("last_login"),
            })
            .collect())
    }

    async fn update_password(&self, id: Uuid, password_hash: &str) -> StorageResult<()> {
        let result = sqlx::query(
            r#"
            UPDATE users SET password_hash = $2 WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(password_hash)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::UserNotFound(id.to_string()));
        }

        Ok(())
    }

    async fn set_user_active(&self, id: Uuid, is_active: bool) -> StorageResult<()> {
        let result = sqlx::query(
            r#"
            UPDATE users SET is_active = $2 WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(is_active)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::UserNotFound(id.to_string()));
        }

        Ok(())
    }

    async fn set_user_admin(&self, id: Uuid, is_admin: bool) -> StorageResult<()> {
        let result = sqlx::query(
            r#"
            UPDATE users SET is_admin = $2 WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(is_admin)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::UserNotFound(id.to_string()));
        }

        Ok(())
    }

    async fn update_last_login(&self, id: Uuid) -> StorageResult<()> {
        sqlx::query(
            r#"
            UPDATE users SET last_login = NOW() WHERE id = $1
            "#,
        )
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn delete_user(&self, id: Uuid) -> StorageResult<()> {
        let result = sqlx::query(
            r#"
            DELETE FROM users WHERE id = $1
            "#,
        )
        .bind(id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::UserNotFound(id.to_string()));
        }

        Ok(())
    }

    async fn has_users(&self) -> StorageResult<bool> {
        let row = sqlx::query(
            r#"
            SELECT EXISTS(SELECT 1 FROM users) as has_users
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(row.get("has_users"))
    }
}
