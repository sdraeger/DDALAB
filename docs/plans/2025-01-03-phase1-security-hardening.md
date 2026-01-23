# Phase 1: Security Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enforce institution boundaries, add audit trails, and support optional HIPAA mode for the DDALAB collaboration system.

**Architecture:** Extend existing sync types with `DataClassification`, enhanced `AccessPolicy` (permissions, expiration), and `InstitutionConfig`. Add server-side `institutions` and `audit_log` tables. Enforce institution boundaries in share handlers. Mirror types in TypeScript frontend.

**Tech Stack:** Rust (Tauri + ddalab-server), PostgreSQL, TypeScript, React, Zustand, TanStack Query

---

## Task 1: Add DataClassification and Permission Types (Rust Server)

**Files:**
- Modify: `packages/ddalab-server/src/storage/types.rs`

**Step 1: Add the new enum types**

Add after the existing `AccessPolicy` enum:

```rust
/// Data classification for HIPAA compliance
/// When institution.hipaa_mode is false, classification is ignored
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DataClassification {
    /// Protected Health Information - institution-only, short expiry
    Phi,
    /// De-identified data - can be shared externally
    DeIdentified,
    /// Generated/test data - unrestricted
    Synthetic,
    /// Default when HIPAA mode disabled
    Unclassified,
}

impl Default for DataClassification {
    fn default() -> Self {
        Self::Unclassified
    }
}

/// Granular permissions for shared content
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    /// Can see content metadata and preview
    View,
    /// Can export content locally (implies View)
    Download,
    /// Can create new shares for others (implies Download)
    Reshare,
}
```

**Step 2: Run cargo check to verify compilation**

Run: `cd packages/ddalab-server && cargo check`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add packages/ddalab-server/src/storage/types.rs
git commit -m "feat(server): add DataClassification and Permission enums"
```

---

## Task 2: Enhance AccessPolicy with Permissions and Expiration (Rust Server)

**Files:**
- Modify: `packages/ddalab-server/src/storage/types.rs`

**Step 1: Create enhanced AccessPolicy struct**

Replace the existing `AccessPolicy` enum with a struct that wraps the policy type:

```rust
/// Access policy type - who can access
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AccessPolicyType {
    /// Anyone in the institution
    Public,
    /// Specific team members
    Team { team_id: String },
    /// Named individuals
    Users { user_ids: Vec<UserId> },
    /// All institution members (explicit)
    Institution,
}

/// Full access policy with permissions and expiration
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccessPolicy {
    /// Who can access
    #[serde(flatten)]
    pub policy_type: AccessPolicyType,
    /// Institution this share belongs to
    pub institution_id: String,
    /// What they can do
    pub permissions: Vec<Permission>,
    /// When access expires (ISO 8601)
    pub expires_at: DateTime<Utc>,
    /// Optional download limit
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_downloads: Option<u32>,
}

impl AccessPolicy {
    /// Check if a permission is granted
    pub fn has_permission(&self, permission: Permission) -> bool {
        self.permissions.contains(&permission)
    }

    /// Check if the policy has expired
    pub fn is_expired(&self) -> bool {
        Utc::now() > self.expires_at
    }

    /// Create a default public policy expiring in 30 days
    pub fn public_default(institution_id: String) -> Self {
        Self {
            policy_type: AccessPolicyType::Public,
            institution_id,
            permissions: vec![Permission::View, Permission::Download],
            expires_at: Utc::now() + chrono::Duration::days(30),
            max_downloads: None,
        }
    }
}
```

**Step 2: Run cargo check**

Run: `cd packages/ddalab-server && cargo check`
Expected: May have errors from places using old AccessPolicy - we'll fix those in Task 3

**Step 3: Commit**

```bash
git add packages/ddalab-server/src/storage/types.rs
git commit -m "feat(server): enhance AccessPolicy with permissions and expiration"
```

---

## Task 3: Add InstitutionConfig Type (Rust Server)

**Files:**
- Modify: `packages/ddalab-server/src/storage/types.rs`

**Step 1: Add InstitutionConfig struct**

```rust
/// Institution configuration for HIPAA mode and federation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstitutionConfig {
    pub id: String,
    pub name: String,
    /// When false, DataClassification checks are skipped
    pub hipaa_mode: bool,
    /// Default expiry for new shares (days)
    pub default_share_expiry_days: u32,
    /// Whether this institution can federate with others
    pub allow_federation: bool,
    /// List of trusted institution IDs (if federation enabled)
    #[serde(default)]
    pub federated_institutions: Vec<String>,
}

impl Default for InstitutionConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            hipaa_mode: true,
            default_share_expiry_days: 30,
            allow_federation: false,
            federated_institutions: Vec::new(),
        }
    }
}

impl InstitutionConfig {
    /// Get default expiry duration based on classification
    pub fn default_expiry_for(&self, classification: DataClassification) -> chrono::Duration {
        if !self.hipaa_mode {
            return chrono::Duration::days(self.default_share_expiry_days as i64);
        }
        match classification {
            DataClassification::Phi => chrono::Duration::days(7),
            DataClassification::DeIdentified => chrono::Duration::days(30),
            DataClassification::Synthetic => chrono::Duration::days(90),
            DataClassification::Unclassified => chrono::Duration::days(self.default_share_expiry_days as i64),
        }
    }
}
```

**Step 2: Run cargo check**

Run: `cd packages/ddalab-server && cargo check`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add packages/ddalab-server/src/storage/types.rs
git commit -m "feat(server): add InstitutionConfig with HIPAA mode support"
```

---

## Task 4: Add AuditLogEntry Type (Rust Server)

**Files:**
- Modify: `packages/ddalab-server/src/storage/types.rs`

**Step 1: Add AuditLogEntry struct and AuditAction enum**

```rust
/// Actions that can be audited
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditAction {
    View,
    Download,
    Share,
    Revoke,
    AccessDenied,
}

/// Audit log entry for compliance tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogEntry {
    pub id: Option<i64>,
    pub timestamp: DateTime<Utc>,
    pub institution_id: String,
    pub user_id: UserId,
    pub action: AuditAction,
    pub share_id: Option<String>,
    pub content_type: Option<String>,
    pub content_id: Option<String>,
    pub source_ip: Option<String>,
    pub user_agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

impl AuditLogEntry {
    pub fn new(
        institution_id: String,
        user_id: UserId,
        action: AuditAction,
    ) -> Self {
        Self {
            id: None,
            timestamp: Utc::now(),
            institution_id,
            user_id,
            action,
            share_id: None,
            content_type: None,
            content_id: None,
            source_ip: None,
            user_agent: None,
            metadata: None,
        }
    }

    pub fn with_share(mut self, share_id: String, content_type: String, content_id: String) -> Self {
        self.share_id = Some(share_id);
        self.content_type = Some(content_type);
        self.content_id = Some(content_id);
        self
    }

    pub fn with_request_info(mut self, source_ip: Option<String>, user_agent: Option<String>) -> Self {
        self.source_ip = source_ip;
        self.user_agent = user_agent;
        self
    }
}
```

**Step 2: Run cargo check**

Run: `cd packages/ddalab-server && cargo check`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add packages/ddalab-server/src/storage/types.rs
git commit -m "feat(server): add AuditLogEntry for compliance tracking"
```

---

## Task 5: Update ShareMetadata with Classification (Rust Server)

**Files:**
- Modify: `packages/ddalab-server/src/storage/types.rs`

**Step 1: Update ShareMetadata struct**

Find the existing `ShareMetadata` struct and update it:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareMetadata {
    pub owner_user_id: UserId,
    pub result_id: String,
    pub title: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub access_policy: AccessPolicy,
    /// Data classification for HIPAA compliance
    #[serde(default)]
    pub classification: DataClassification,
    /// Number of times this share has been downloaded
    #[serde(default)]
    pub download_count: u32,
    /// Last time this share was accessed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_accessed_at: Option<DateTime<Utc>>,
}
```

**Step 2: Run cargo check**

Run: `cd packages/ddalab-server && cargo check`
Expected: Compiles (may have warnings about unused fields)

**Step 3: Commit**

```bash
git add packages/ddalab-server/src/storage/types.rs
git commit -m "feat(server): add classification and download tracking to ShareMetadata"
```

---

## Task 6: Create Database Migration for Institutions Table

**Files:**
- Create: `packages/ddalab-server/migrations/003_institutions.sql`

**Step 1: Write the migration SQL**

```sql
-- Institution configuration table
CREATE TABLE IF NOT EXISTS institutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    hipaa_mode BOOLEAN NOT NULL DEFAULT true,
    default_share_expiry_days INTEGER NOT NULL DEFAULT 30,
    allow_federation BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create a default institution for existing data
INSERT INTO institutions (id, name, hipaa_mode, default_share_expiry_days, allow_federation)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Institution', false, 30, false)
ON CONFLICT DO NOTHING;

-- Add institution_id to shared_results if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shared_results' AND column_name = 'institution_id'
    ) THEN
        ALTER TABLE shared_results
        ADD COLUMN institution_id UUID REFERENCES institutions(id)
        DEFAULT '00000000-0000-0000-0000-000000000001';
    END IF;
END $$;

-- Add classification to shared_results if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shared_results' AND column_name = 'classification'
    ) THEN
        ALTER TABLE shared_results
        ADD COLUMN classification TEXT NOT NULL DEFAULT 'unclassified';
    END IF;
END $$;

-- Add expires_at to shared_results if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shared_results' AND column_name = 'expires_at'
    ) THEN
        ALTER TABLE shared_results
        ADD COLUMN expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days');
    END IF;
END $$;

-- Add download_count to shared_results if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shared_results' AND column_name = 'download_count'
    ) THEN
        ALTER TABLE shared_results
        ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;
    END IF;
END $$;

-- Create index for institution lookups
CREATE INDEX IF NOT EXISTS idx_shared_results_institution
    ON shared_results(institution_id) WHERE revoked_at IS NULL;

-- Create index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_shared_results_expires
    ON shared_results(expires_at) WHERE revoked_at IS NULL;
```

**Step 2: Verify SQL syntax**

Run: `cd packages/ddalab-server && cat migrations/003_institutions.sql`
Expected: File contents displayed

**Step 3: Commit**

```bash
git add packages/ddalab-server/migrations/003_institutions.sql
git commit -m "feat(server): add institutions table migration"
```

---

## Task 7: Create Database Migration for Audit Log Table

**Files:**
- Create: `packages/ddalab-server/migrations/004_audit_log.sql`

**Step 1: Write the migration SQL**

```sql
-- Audit log for compliance tracking
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    institution_id UUID NOT NULL REFERENCES institutions(id),
    user_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('view', 'download', 'share', 'revoke', 'access_denied')),
    share_id TEXT,
    content_type TEXT,
    content_id TEXT,
    source_ip INET,
    user_agent TEXT,
    metadata JSONB
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_share ON audit_log(share_id, timestamp DESC) WHERE share_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_institution ON audit_log(institution_id, timestamp DESC);

-- Partition hint comment (for future scaling)
-- COMMENT ON TABLE audit_log IS 'Consider partitioning by timestamp for large deployments';
```

**Step 2: Verify SQL syntax**

Run: `cd packages/ddalab-server && cat migrations/004_audit_log.sql`
Expected: File contents displayed

**Step 3: Commit**

```bash
git add packages/ddalab-server/migrations/004_audit_log.sql
git commit -m "feat(server): add audit_log table migration"
```

---

## Task 8: Add AuditLog Storage Trait

**Files:**
- Modify: `packages/ddalab-server/src/storage/traits.rs`

**Step 1: Add the AuditLogStore trait**

```rust
use crate::storage::types::{AuditLogEntry, InstitutionConfig};

/// Storage trait for audit logging
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
```

**Step 2: Run cargo check**

Run: `cd packages/ddalab-server && cargo check`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add packages/ddalab-server/src/storage/traits.rs
git commit -m "feat(server): add AuditLogStore and InstitutionStore traits"
```

---

## Task 9: Implement AuditLogStore for PostgreSQL

**Files:**
- Modify: `packages/ddalab-server/src/storage/postgres.rs`

**Step 1: Add the AuditLogStore implementation**

```rust
use crate::storage::types::{AuditLogEntry, AuditAction, InstitutionConfig};
use crate::storage::traits::{AuditLogStore, InstitutionStore};

#[async_trait]
impl AuditLogStore for PostgresStorage {
    async fn log_entry(&self, entry: AuditLogEntry) -> StorageResult<i64> {
        let row = sqlx::query_scalar!(
            r#"
            INSERT INTO audit_log (
                timestamp, institution_id, user_id, action,
                share_id, content_type, content_id,
                source_ip, user_agent, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9, $10)
            RETURNING id
            "#,
            entry.timestamp,
            entry.institution_id,
            entry.user_id,
            format!("{:?}", entry.action).to_lowercase(),
            entry.share_id,
            entry.content_type,
            entry.content_id,
            entry.source_ip,
            entry.user_agent,
            entry.metadata,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|e| StorageError::Database(e.to_string()))?;

        Ok(row)
    }

    async fn get_share_audit_log(
        &self,
        share_id: &str,
        limit: Option<i64>,
    ) -> StorageResult<Vec<AuditLogEntry>> {
        let limit = limit.unwrap_or(100);
        let rows = sqlx::query!(
            r#"
            SELECT id, timestamp, institution_id, user_id, action,
                   share_id, content_type, content_id,
                   source_ip::text, user_agent, metadata
            FROM audit_log
            WHERE share_id = $1
            ORDER BY timestamp DESC
            LIMIT $2
            "#,
            share_id,
            limit,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StorageError::Database(e.to_string()))?;

        Ok(rows.into_iter().map(|r| AuditLogEntry {
            id: Some(r.id),
            timestamp: r.timestamp,
            institution_id: r.institution_id.to_string(),
            user_id: r.user_id,
            action: parse_audit_action(&r.action),
            share_id: r.share_id,
            content_type: r.content_type,
            content_id: r.content_id,
            source_ip: r.source_ip,
            user_agent: r.user_agent,
            metadata: r.metadata,
        }).collect())
    }

    async fn get_user_audit_log(
        &self,
        user_id: &UserId,
        limit: Option<i64>,
    ) -> StorageResult<Vec<AuditLogEntry>> {
        let limit = limit.unwrap_or(100);
        let rows = sqlx::query!(
            r#"
            SELECT id, timestamp, institution_id, user_id, action,
                   share_id, content_type, content_id,
                   source_ip::text, user_agent, metadata
            FROM audit_log
            WHERE user_id = $1
            ORDER BY timestamp DESC
            LIMIT $2
            "#,
            user_id,
            limit,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StorageError::Database(e.to_string()))?;

        Ok(rows.into_iter().map(|r| AuditLogEntry {
            id: Some(r.id),
            timestamp: r.timestamp,
            institution_id: r.institution_id.to_string(),
            user_id: r.user_id,
            action: parse_audit_action(&r.action),
            share_id: r.share_id,
            content_type: r.content_type,
            content_id: r.content_id,
            source_ip: r.source_ip,
            user_agent: r.user_agent,
            metadata: r.metadata,
        }).collect())
    }

    async fn get_institution_audit_log(
        &self,
        institution_id: &str,
        limit: Option<i64>,
    ) -> StorageResult<Vec<AuditLogEntry>> {
        let limit = limit.unwrap_or(100);
        let rows = sqlx::query!(
            r#"
            SELECT id, timestamp, institution_id, user_id, action,
                   share_id, content_type, content_id,
                   source_ip::text, user_agent, metadata
            FROM audit_log
            WHERE institution_id = $1::uuid
            ORDER BY timestamp DESC
            LIMIT $2
            "#,
            institution_id,
            limit,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StorageError::Database(e.to_string()))?;

        Ok(rows.into_iter().map(|r| AuditLogEntry {
            id: Some(r.id),
            timestamp: r.timestamp,
            institution_id: r.institution_id.to_string(),
            user_id: r.user_id,
            action: parse_audit_action(&r.action),
            share_id: r.share_id,
            content_type: r.content_type,
            content_id: r.content_id,
            source_ip: r.source_ip,
            user_agent: r.user_agent,
            metadata: r.metadata,
        }).collect())
    }
}

fn parse_audit_action(s: &str) -> AuditAction {
    match s {
        "view" => AuditAction::View,
        "download" => AuditAction::Download,
        "share" => AuditAction::Share,
        "revoke" => AuditAction::Revoke,
        "access_denied" => AuditAction::AccessDenied,
        _ => AuditAction::View,
    }
}
```

**Step 2: Run cargo check**

Run: `cd packages/ddalab-server && cargo check`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add packages/ddalab-server/src/storage/postgres.rs
git commit -m "feat(server): implement AuditLogStore for PostgreSQL"
```

---

## Task 10: Implement InstitutionStore for PostgreSQL

**Files:**
- Modify: `packages/ddalab-server/src/storage/postgres.rs`

**Step 1: Add the InstitutionStore implementation**

```rust
#[async_trait]
impl InstitutionStore for PostgresStorage {
    async fn get_institution(&self, institution_id: &str) -> StorageResult<InstitutionConfig> {
        let row = sqlx::query!(
            r#"
            SELECT id, name, hipaa_mode, default_share_expiry_days, allow_federation
            FROM institutions
            WHERE id = $1::uuid
            "#,
            institution_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| StorageError::Database(e.to_string()))?
        .ok_or_else(|| StorageError::NotFound(format!("Institution {} not found", institution_id)))?;

        // Get federated institutions if federation is enabled
        let federated = if row.allow_federation {
            sqlx::query_scalar!(
                r#"
                SELECT CASE
                    WHEN institution_a = $1::uuid THEN institution_b::text
                    ELSE institution_a::text
                END as institution_id
                FROM federation_trusts
                WHERE (institution_a = $1::uuid OR institution_b = $1::uuid)
                  AND trust_level = 'full'
                "#,
                institution_id,
            )
            .fetch_all(&self.pool)
            .await
            .map_err(|e| StorageError::Database(e.to_string()))?
            .into_iter()
            .flatten()
            .collect()
        } else {
            Vec::new()
        };

        Ok(InstitutionConfig {
            id: row.id.to_string(),
            name: row.name,
            hipaa_mode: row.hipaa_mode,
            default_share_expiry_days: row.default_share_expiry_days as u32,
            allow_federation: row.allow_federation,
            federated_institutions: federated,
        })
    }

    async fn upsert_institution(&self, config: &InstitutionConfig) -> StorageResult<()> {
        sqlx::query!(
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
            config.id,
            config.name,
            config.hipaa_mode,
            config.default_share_expiry_days as i32,
            config.allow_federation,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| StorageError::Database(e.to_string()))?;

        Ok(())
    }

    async fn list_institutions(&self) -> StorageResult<Vec<InstitutionConfig>> {
        let rows = sqlx::query!(
            r#"
            SELECT id, name, hipaa_mode, default_share_expiry_days, allow_federation
            FROM institutions
            ORDER BY name
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StorageError::Database(e.to_string()))?;

        Ok(rows.into_iter().map(|r| InstitutionConfig {
            id: r.id.to_string(),
            name: r.name,
            hipaa_mode: r.hipaa_mode,
            default_share_expiry_days: r.default_share_expiry_days as u32,
            allow_federation: r.allow_federation,
            federated_institutions: Vec::new(), // Load separately if needed
        }).collect())
    }
}
```

**Step 2: Run cargo check**

Run: `cd packages/ddalab-server && cargo check`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add packages/ddalab-server/src/storage/postgres.rs
git commit -m "feat(server): implement InstitutionStore for PostgreSQL"
```

---

## Task 11: Add Access Control Enforcement Module

**Files:**
- Create: `packages/ddalab-server/src/handlers/access_control.rs`

**Step 1: Create the access control module**

```rust
//! Access control enforcement for shares

use crate::storage::types::{
    AccessPolicy, AccessPolicyType, DataClassification, InstitutionConfig, Permission,
};

/// Result of an access check
#[derive(Debug, Clone)]
pub enum AccessCheckResult {
    /// Access granted with these permissions
    Granted { permissions: Vec<Permission> },
    /// Access denied with reason
    Denied { reason: AccessDeniedReason },
}

/// Reasons for access denial
#[derive(Debug, Clone)]
pub enum AccessDeniedReason {
    Expired,
    WrongInstitution,
    NotInTeam,
    NotInUserList,
    PhiCrossInstitution,
    PhiPublicShare,
    DownloadLimitReached,
}

impl std::fmt::Display for AccessDeniedReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Expired => write!(f, "Share has expired"),
            Self::WrongInstitution => write!(f, "User is not in the share's institution"),
            Self::NotInTeam => write!(f, "User is not a member of the required team"),
            Self::NotInUserList => write!(f, "User is not in the allowed users list"),
            Self::PhiCrossInstitution => write!(f, "PHI content cannot be shared across institutions"),
            Self::PhiPublicShare => write!(f, "PHI content cannot be shared publicly"),
            Self::DownloadLimitReached => write!(f, "Download limit has been reached"),
        }
    }
}

/// Check if a user can access a share
pub fn check_access(
    user_id: &str,
    user_institution_id: &str,
    user_team_ids: &[String],
    share_policy: &AccessPolicy,
    classification: DataClassification,
    institution_config: &InstitutionConfig,
    download_count: u32,
) -> AccessCheckResult {
    // 1. Check expiration
    if share_policy.is_expired() {
        return AccessCheckResult::Denied {
            reason: AccessDeniedReason::Expired,
        };
    }

    // 2. Check download limit
    if let Some(max) = share_policy.max_downloads {
        if download_count >= max {
            return AccessCheckResult::Denied {
                reason: AccessDeniedReason::DownloadLimitReached,
            };
        }
    }

    // 3. Institution boundary check
    let same_institution = user_institution_id == share_policy.institution_id;
    if !same_institution {
        // Cross-institution access requires federation (not implemented in Phase 1)
        return AccessCheckResult::Denied {
            reason: AccessDeniedReason::WrongInstitution,
        };
    }

    // 4. HIPAA mode enforcement
    if institution_config.hipaa_mode {
        // PHI cannot be public
        if classification == DataClassification::Phi {
            if matches!(share_policy.policy_type, AccessPolicyType::Public) {
                return AccessCheckResult::Denied {
                    reason: AccessDeniedReason::PhiPublicShare,
                };
            }
        }
    }

    // 5. Policy-specific checks
    let access_allowed = match &share_policy.policy_type {
        AccessPolicyType::Public => true,
        AccessPolicyType::Institution => true, // Already checked same institution
        AccessPolicyType::Team { team_id } => user_team_ids.contains(team_id),
        AccessPolicyType::Users { user_ids } => user_ids.contains(&user_id.to_string()),
    };

    if !access_allowed {
        let reason = match &share_policy.policy_type {
            AccessPolicyType::Team { .. } => AccessDeniedReason::NotInTeam,
            AccessPolicyType::Users { .. } => AccessDeniedReason::NotInUserList,
            _ => AccessDeniedReason::WrongInstitution,
        };
        return AccessCheckResult::Denied { reason };
    }

    AccessCheckResult::Granted {
        permissions: share_policy.permissions.clone(),
    }
}

/// Check if a specific permission is granted
pub fn has_permission(result: &AccessCheckResult, permission: Permission) -> bool {
    match result {
        AccessCheckResult::Granted { permissions } => permissions.contains(&permission),
        AccessCheckResult::Denied { .. } => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, Utc};

    fn default_institution() -> InstitutionConfig {
        InstitutionConfig {
            id: "inst-1".to_string(),
            name: "Test Institution".to_string(),
            hipaa_mode: true,
            default_share_expiry_days: 30,
            allow_federation: false,
            federated_institutions: Vec::new(),
        }
    }

    fn public_policy(institution_id: &str) -> AccessPolicy {
        AccessPolicy {
            policy_type: AccessPolicyType::Public,
            institution_id: institution_id.to_string(),
            permissions: vec![Permission::View, Permission::Download],
            expires_at: Utc::now() + Duration::days(30),
            max_downloads: None,
        }
    }

    #[test]
    fn test_same_institution_public_access() {
        let policy = public_policy("inst-1");
        let inst = default_institution();

        let result = check_access(
            "user-1",
            "inst-1",
            &[],
            &policy,
            DataClassification::Unclassified,
            &inst,
            0,
        );

        assert!(matches!(result, AccessCheckResult::Granted { .. }));
    }

    #[test]
    fn test_wrong_institution_denied() {
        let policy = public_policy("inst-1");
        let inst = default_institution();

        let result = check_access(
            "user-1",
            "inst-2", // Different institution
            &[],
            &policy,
            DataClassification::Unclassified,
            &inst,
            0,
        );

        assert!(matches!(
            result,
            AccessCheckResult::Denied {
                reason: AccessDeniedReason::WrongInstitution
            }
        ));
    }

    #[test]
    fn test_expired_share_denied() {
        let mut policy = public_policy("inst-1");
        policy.expires_at = Utc::now() - Duration::days(1); // Expired
        let inst = default_institution();

        let result = check_access(
            "user-1",
            "inst-1",
            &[],
            &policy,
            DataClassification::Unclassified,
            &inst,
            0,
        );

        assert!(matches!(
            result,
            AccessCheckResult::Denied {
                reason: AccessDeniedReason::Expired
            }
        ));
    }

    #[test]
    fn test_phi_cannot_be_public() {
        let policy = public_policy("inst-1");
        let inst = default_institution(); // hipaa_mode: true

        let result = check_access(
            "user-1",
            "inst-1",
            &[],
            &policy,
            DataClassification::Phi,
            &inst,
            0,
        );

        assert!(matches!(
            result,
            AccessCheckResult::Denied {
                reason: AccessDeniedReason::PhiPublicShare
            }
        ));
    }

    #[test]
    fn test_phi_allowed_when_hipaa_disabled() {
        let policy = public_policy("inst-1");
        let mut inst = default_institution();
        inst.hipaa_mode = false;

        let result = check_access(
            "user-1",
            "inst-1",
            &[],
            &policy,
            DataClassification::Phi,
            &inst,
            0,
        );

        assert!(matches!(result, AccessCheckResult::Granted { .. }));
    }
}
```

**Step 2: Register the module**

Add to `packages/ddalab-server/src/handlers/mod.rs`:

```rust
pub mod access_control;
```

**Step 3: Run tests**

Run: `cd packages/ddalab-server && cargo test access_control`
Expected: All tests pass

**Step 4: Commit**

```bash
git add packages/ddalab-server/src/handlers/access_control.rs packages/ddalab-server/src/handlers/mod.rs
git commit -m "feat(server): add access control enforcement with tests"
```

---

## Task 12: Mirror Types in TypeScript

**Files:**
- Modify: `packages/ddalab-tauri/src/types/sync.ts`

**Step 1: Add the new TypeScript types**

```typescript
// Data classification for HIPAA compliance
export type DataClassification = "phi" | "de_identified" | "synthetic" | "unclassified";

// Granular permissions
export type Permission = "view" | "download" | "reshare";

// Enhanced access policy type
export type AccessPolicyType = "public" | "team" | "users" | "institution";

// Full access policy with permissions and expiration
export interface AccessPolicy {
  type: AccessPolicyType;
  team_id?: string;
  user_ids?: string[];
  institution_id: string;
  permissions: Permission[];
  expires_at: string; // ISO 8601
  max_downloads?: number;
}

// Updated share metadata
export interface ShareMetadata {
  owner_user_id: string;
  result_id: string;
  title: string;
  description?: string;
  created_at: string;
  access_policy: AccessPolicy;
  classification: DataClassification;
  download_count: number;
  last_accessed_at?: string;
}

// Institution configuration
export interface InstitutionConfig {
  id: string;
  name: string;
  hipaa_mode: boolean;
  default_share_expiry_days: number;
  allow_federation: boolean;
  federated_institutions?: string[];
}

// Audit log entry
export interface AuditLogEntry {
  id?: number;
  timestamp: string;
  institution_id: string;
  user_id: string;
  action: "view" | "download" | "share" | "revoke" | "access_denied";
  share_id?: string;
  content_type?: string;
  content_id?: string;
  source_ip?: string;
  user_agent?: string;
  metadata?: Record<string, unknown>;
}

// Default expiry days by classification
export const DEFAULT_EXPIRY_DAYS: Record<DataClassification, number> = {
  phi: 7,
  de_identified: 30,
  synthetic: 90,
  unclassified: 30,
};

// Helper to check if a policy has expired
export function isPolicyExpired(policy: AccessPolicy): boolean {
  return new Date(policy.expires_at) < new Date();
}

// Helper to check if a permission is granted
export function hasPermission(policy: AccessPolicy, permission: Permission): boolean {
  return policy.permissions.includes(permission);
}
```

**Step 2: Run typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/types/sync.ts
git commit -m "feat(frontend): add enhanced sync types for security hardening"
```

---

## Task 13: Create useInstitutionConfig Hook

**Files:**
- Create: `packages/ddalab-tauri/src/hooks/useInstitutionConfig.ts`

**Step 1: Create the hook**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { InstitutionConfig } from "@/types/sync";

const INSTITUTION_CONFIG_KEY = ["institutionConfig"];

/**
 * Fetch the current institution configuration
 */
async function fetchInstitutionConfig(): Promise<InstitutionConfig> {
  return invoke<InstitutionConfig>("get_institution_config");
}

/**
 * Update institution configuration (admin only)
 */
async function updateInstitutionConfig(config: Partial<InstitutionConfig>): Promise<InstitutionConfig> {
  return invoke<InstitutionConfig>("update_institution_config", { config });
}

/**
 * Hook for accessing and managing institution configuration
 */
export function useInstitutionConfig() {
  const queryClient = useQueryClient();

  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: INSTITUTION_CONFIG_KEY,
    queryFn: fetchInstitutionConfig,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 1,
  });

  const updateMutation = useMutation({
    mutationFn: updateInstitutionConfig,
    onSuccess: (newConfig) => {
      queryClient.setQueryData(INSTITUTION_CONFIG_KEY, newConfig);
    },
  });

  return {
    config,
    isLoading,
    error: error as Error | null,
    refetch,

    // Derived state
    isHipaaMode: config?.hipaa_mode ?? true,
    allowsFederation: config?.allow_federation ?? false,
    defaultExpiryDays: config?.default_share_expiry_days ?? 30,

    // Actions
    updateConfig: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    updateError: updateMutation.error as Error | null,
  };
}

/**
 * Hook for just reading HIPAA mode (lightweight)
 */
export function useHipaaMode(): boolean {
  const { data } = useQuery({
    queryKey: INSTITUTION_CONFIG_KEY,
    queryFn: fetchInstitutionConfig,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return data?.hipaa_mode ?? true; // Default to true for safety
}
```

**Step 2: Run typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors (may show error about missing Tauri command - that's expected until backend is updated)

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/hooks/useInstitutionConfig.ts
git commit -m "feat(frontend): add useInstitutionConfig hook"
```

---

## Task 14: Add Tauri Commands for Institution Config

**Files:**
- Modify: `packages/ddalab-tauri/src-tauri/src/sync/commands.rs`

**Step 1: Add the institution config commands**

```rust
use crate::sync::types::InstitutionConfig;

/// Get the current institution configuration
#[tauri::command]
pub async fn get_institution_config(
    state: tauri::State<'_, SyncState>,
) -> Result<InstitutionConfig, String> {
    let client = state.client.lock().await;

    // If connected to a server, fetch from server
    if let Some(ref client) = *client {
        client
            .get_institution_config()
            .await
            .map_err(|e| e.to_string())
    } else {
        // Return default config when not connected
        Ok(InstitutionConfig::default())
    }
}

/// Update institution configuration (admin only)
#[tauri::command]
pub async fn update_institution_config(
    config: InstitutionConfig,
    state: tauri::State<'_, SyncState>,
) -> Result<InstitutionConfig, String> {
    let client = state.client.lock().await;

    if let Some(ref client) = *client {
        client
            .update_institution_config(config)
            .await
            .map_err(|e| e.to_string())
    } else {
        Err("Not connected to server".to_string())
    }
}
```

**Step 2: Register commands in main.rs**

Add to the `tauri::Builder` invoke_handler:

```rust
get_institution_config,
update_institution_config,
```

**Step 3: Run cargo check**

Run: `cd packages/ddalab-tauri/src-tauri && cargo check`
Expected: May have errors about SyncClient methods - those will be added in next task

**Step 4: Commit**

```bash
git add packages/ddalab-tauri/src-tauri/src/sync/commands.rs packages/ddalab-tauri/src-tauri/src/main.rs
git commit -m "feat(tauri): add institution config commands"
```

---

## Task 15: Add Types to Tauri Sync Module

**Files:**
- Modify: `packages/ddalab-tauri/src-tauri/src/sync/types.rs`

**Step 1: Add the new types to match server**

Add the same types from Tasks 1-4 to the Tauri client:

```rust
/// Data classification for HIPAA compliance
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DataClassification {
    Phi,
    DeIdentified,
    Synthetic,
    #[default]
    Unclassified,
}

/// Granular permissions for shared content
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    View,
    Download,
    Reshare,
}

/// Access policy type
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AccessPolicyType {
    Public,
    Team { team_id: String },
    Users { user_ids: Vec<UserId> },
    Institution,
}

/// Full access policy
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccessPolicy {
    #[serde(flatten)]
    pub policy_type: AccessPolicyType,
    pub institution_id: String,
    pub permissions: Vec<Permission>,
    pub expires_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_downloads: Option<u32>,
}

/// Institution configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InstitutionConfig {
    pub id: String,
    pub name: String,
    pub hipaa_mode: bool,
    pub default_share_expiry_days: u32,
    pub allow_federation: bool,
    #[serde(default)]
    pub federated_institutions: Vec<String>,
}
```

**Step 2: Run cargo check**

Run: `cd packages/ddalab-tauri/src-tauri && cargo check`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src-tauri/src/sync/types.rs
git commit -m "feat(tauri): add security hardening types"
```

---

## Task 16: Run Full Build and Test

**Files:** None (verification only)

**Step 1: Run server tests**

Run: `cd packages/ddalab-server && cargo test`
Expected: All tests pass

**Step 2: Run Tauri check**

Run: `cd packages/ddalab-tauri/src-tauri && cargo check`
Expected: Compiles successfully

**Step 3: Run frontend typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No type errors

**Step 4: Run frontend build**

Run: `cd packages/ddalab-tauri && bun run build`
Expected: Builds successfully

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase 1 security hardening foundation"
```

---

## Summary

Phase 1 establishes the security foundation:

1. **New Types** (Tasks 1-5, 15): `DataClassification`, `Permission`, enhanced `AccessPolicy`, `InstitutionConfig`, `AuditLogEntry`

2. **Database Schema** (Tasks 6-7): `institutions` and `audit_log` tables with proper indexes

3. **Storage Layer** (Tasks 8-10): `AuditLogStore` and `InstitutionStore` traits with PostgreSQL implementations

4. **Access Control** (Task 11): Institution boundary enforcement with comprehensive tests

5. **Frontend Integration** (Tasks 12-14): TypeScript types and `useInstitutionConfig` hook

6. **Tauri Bridge** (Tasks 14-15): Commands for fetching/updating institution config

**Next Phase:** Phase 2 will add content type expansion (annotations, workflows, parameters, data segments) building on this security foundation.
