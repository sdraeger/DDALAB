# Phase 2: Content Type Expansion - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable sharing of any content type (annotations, workflows, parameter sets, data segments) through a unified sharing system.

**Architecture:** Extend the existing sharing infrastructure with a `ShareableContentType` enum and content-specific serialization. The `ShareMetadata` struct gains a `content_type` field, and content is stored as JSON blobs. The frontend gets a `UnifiedShareDialog` that adapts its UI based on content type.

**Tech Stack:** Rust (Tauri backend), TypeScript/React (frontend), PostgreSQL (server storage), Zustand (state management)

**Prerequisite:** Phase 1 Security Hardening must be complete (institutions, audit_log tables, access control).

---

## Task 1: Add ShareableContentType Enum to Rust Types

**Files:**
- Modify: `packages/ddalab-server/src/storage/types.rs`
- Modify: `packages/ddalab-tauri/src-tauri/src/sync/types.rs`

**Step 1: Add the enum to server types**

In `packages/ddalab-server/src/storage/types.rs`, add after `DataClassification`:

```rust
/// Types of content that can be shared through the collaboration system
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ShareableContentType {
    /// DDA analysis results (existing functionality)
    #[default]
    DdaResult,
    /// User annotations on time series or results
    Annotation,
    /// Recorded analysis workflows (DAG of actions)
    Workflow,
    /// Saved DDA parameter configurations
    ParameterSet,
    /// Time-windowed raw data excerpts
    DataSegment,
}

impl ShareableContentType {
    /// Returns true if this content type may contain PHI
    pub fn may_contain_phi(&self) -> bool {
        match self {
            ShareableContentType::DdaResult => true,
            ShareableContentType::Annotation => true,
            ShareableContentType::Workflow => false,  // Metadata only
            ShareableContentType::ParameterSet => false,  // Config only
            ShareableContentType::DataSegment => true,
        }
    }
}
```

**Step 2: Update ShareMetadata to include content_type**

Modify `ShareMetadata` struct - rename `result_id` to `content_id` and add `content_type`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareMetadata {
    pub owner_user_id: UserId,
    pub content_type: ShareableContentType,  // NEW
    pub content_id: String,  // RENAMED from result_id
    pub title: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub access_policy: AccessPolicy,
    pub classification: DataClassification,
    pub download_count: u32,
    pub last_accessed_at: Option<DateTime<Utc>>,
}
```

**Step 3: Add same enum to Tauri types**

In `packages/ddalab-tauri/src-tauri/src/sync/types.rs`, add:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ShareableContentType {
    #[default]
    DdaResult,
    Annotation,
    Workflow,
    ParameterSet,
    DataSegment,
}
```

**Step 4: Verify compilation**

Run: `cd packages/ddalab-server && cargo check`
Run: `cd packages/ddalab-tauri/src-tauri && cargo check`

Expected: Compilation errors about `result_id` → `content_id` rename (to be fixed in next tasks)

**Step 5: Commit**

```bash
git add packages/ddalab-server/src/storage/types.rs packages/ddalab-tauri/src-tauri/src/sync/types.rs
git commit -m "feat(collab): add ShareableContentType enum for multi-content sharing"
```

---

## Task 2: Update Database Schema for Content Types

**Files:**
- Create: `packages/ddalab-server/migrations/005_content_types.sql`

**Step 1: Create migration file**

```sql
-- Migration: 005_content_types.sql
-- Adds content_type column and renames result_id to content_id

-- Add content_type column with default for backward compatibility
ALTER TABLE shared_results
ADD COLUMN content_type TEXT NOT NULL DEFAULT 'dda_result';

-- Rename result_id to content_id (PostgreSQL syntax)
ALTER TABLE shared_results
RENAME COLUMN result_id TO content_id;

-- Add content_data column for storing serialized content
-- This holds the actual shareable content as JSON
ALTER TABLE shared_results
ADD COLUMN content_data JSONB;

-- Create index for content type queries
CREATE INDEX idx_shared_results_content_type ON shared_results(content_type);

-- Create index for owner + content type queries (common for "my workflows" etc)
CREATE INDEX idx_shared_results_owner_type ON shared_results(owner_user_id, content_type);

-- Update existing rows to have explicit content_type
UPDATE shared_results SET content_type = 'dda_result' WHERE content_type IS NULL;
```

**Step 2: Verify migration syntax**

Run: `cd packages/ddalab-server && cargo sqlx prepare --check` (if using sqlx) or manual syntax check.

**Step 3: Commit**

```bash
git add packages/ddalab-server/migrations/005_content_types.sql
git commit -m "feat(collab): add content_type migration for multi-content sharing"
```

---

## Task 3: Add Shareable Content Data Structures

**Files:**
- Create: `packages/ddalab-server/src/storage/content_types.rs`
- Modify: `packages/ddalab-server/src/storage/mod.rs`

**Step 1: Create content_types.rs with serializable content structures**

```rust
//! Shareable content type definitions and serialization
//!
//! Each content type has a corresponding data structure that can be
//! serialized to JSON for storage and transmission.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Annotation shared content - user annotations on time series or results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedAnnotation {
    /// Original file path (for context, not for access)
    pub source_file: String,
    /// Channel name if channel-specific, None for global
    pub channel: Option<String>,
    /// Position on x-axis (time in seconds or sample index)
    pub position: f64,
    /// User-provided label
    pub label: String,
    /// Optional detailed description
    pub description: Option<String>,
    /// Hex color code
    pub color: String,
    /// When annotation was created
    pub created_at: DateTime<Utc>,
}

/// Workflow shared content - recorded analysis workflow
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedWorkflow {
    /// Workflow name
    pub name: String,
    /// User description
    pub description: Option<String>,
    /// Workflow version
    pub version: String,
    /// Serialized workflow nodes (actions)
    pub nodes: Vec<WorkflowNodeData>,
    /// Edges defining dependencies
    pub edges: Vec<WorkflowEdgeData>,
    /// When workflow was created
    pub created_at: DateTime<Utc>,
    /// When workflow was last modified
    pub modified_at: DateTime<Utc>,
}

/// Serialized workflow node
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowNodeData {
    pub id: String,
    pub action_type: String,
    pub action_data: serde_json::Value,
    pub timestamp: DateTime<Utc>,
    pub description: Option<String>,
    pub tags: Vec<String>,
}

/// Serialized workflow edge
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowEdgeData {
    pub source: String,
    pub target: String,
    pub dependency_type: String,
}

/// Parameter set shared content - saved DDA configurations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedParameterSet {
    /// Display name for this parameter preset
    pub name: String,
    /// User description of when to use these parameters
    pub description: Option<String>,
    /// DDA variants to run
    pub variants: Vec<String>,
    /// Window length in samples
    pub window_length: u32,
    /// Window step in samples
    pub window_step: u32,
    /// Delay configuration
    pub delay_config: DelayConfig,
    /// Cross-target parameters (optional)
    pub ct_parameters: Option<CTParameters>,
    /// Additional variant-specific parameters
    pub additional_parameters: Option<serde_json::Value>,
    /// When parameter set was created
    pub created_at: DateTime<Utc>,
}

/// Delay configuration for parameter sets
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum DelayConfig {
    Range {
        min: u32,
        max: u32,
        num: u32,
    },
    List {
        delays: Vec<u32>,
    },
}

/// Cross-target analysis parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CTParameters {
    pub ct_delay_min: u32,
    pub ct_delay_max: u32,
    pub ct_delay_step: u32,
    pub ct_window_min: u32,
    pub ct_window_max: u32,
    pub ct_window_step: u32,
}

/// Data segment shared content - time-windowed raw data excerpt
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedDataSegment {
    /// Original source file (for reference)
    pub source_file: String,
    /// File hash for integrity verification
    pub source_file_hash: String,
    /// Start time in seconds
    pub start_time: f64,
    /// End time in seconds
    pub end_time: f64,
    /// Sample rate in Hz
    pub sample_rate: f64,
    /// Channel names included in segment
    pub channels: Vec<String>,
    /// Number of samples per channel
    pub sample_count: u64,
    /// Actual data stored as base64-encoded binary or reference to blob storage
    /// For small segments (<1MB), inline as base64
    /// For larger segments, this is a reference ID to blob storage
    pub data_reference: DataReference,
    /// When segment was created
    pub created_at: DateTime<Utc>,
}

/// Reference to actual data content
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DataReference {
    /// Data is stored inline as base64
    Inline { base64_data: String },
    /// Data is stored in blob storage
    BlobReference { blob_id: String, size_bytes: u64 },
}

/// Union type for any shareable content
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "content_type", rename_all = "snake_case")]
pub enum ShareableContent {
    DdaResult {
        /// Reference to existing DDA result ID
        result_id: String,
    },
    Annotation(SharedAnnotation),
    Workflow(SharedWorkflow),
    ParameterSet(SharedParameterSet),
    DataSegment(SharedDataSegment),
}

impl ShareableContent {
    /// Returns the content type enum value
    pub fn content_type(&self) -> super::types::ShareableContentType {
        match self {
            ShareableContent::DdaResult { .. } => super::types::ShareableContentType::DdaResult,
            ShareableContent::Annotation(_) => super::types::ShareableContentType::Annotation,
            ShareableContent::Workflow(_) => super::types::ShareableContentType::Workflow,
            ShareableContent::ParameterSet(_) => super::types::ShareableContentType::ParameterSet,
            ShareableContent::DataSegment(_) => super::types::ShareableContentType::DataSegment,
        }
    }
}
```

**Step 2: Export from mod.rs**

Add to `packages/ddalab-server/src/storage/mod.rs`:

```rust
pub mod content_types;
pub use content_types::*;
```

**Step 3: Verify compilation**

Run: `cd packages/ddalab-server && cargo check`

Expected: PASS

**Step 4: Commit**

```bash
git add packages/ddalab-server/src/storage/content_types.rs packages/ddalab-server/src/storage/mod.rs
git commit -m "feat(collab): add shareable content data structures"
```

---

## Task 4: Update PostgreSQL Share Storage for Content Types

**Files:**
- Modify: `packages/ddalab-server/src/storage/postgres.rs`

**Step 1: Update publish_result to accept content_type and content_data**

Find the `publish_result` method and update it. The current signature needs to accept the new fields:

```rust
async fn publish_result(
    &self,
    token: &ShareToken,
    metadata: ShareMetadata,
    content_data: Option<serde_json::Value>,
) -> StorageResult<()> {
    let pool = self.pool.read().await;
    let pool = pool.as_ref().ok_or(StorageError::NotConnected)?;

    sqlx::query(
        r#"
        INSERT INTO shared_results (
            share_token, owner_user_id, content_type, content_id, title, description,
            access_policy, created_at, institution_id, classification, expires_at,
            download_count, content_data
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        "#,
    )
    .bind(&token.0)
    .bind(&metadata.owner_user_id.0)
    .bind(serde_json::to_string(&metadata.content_type).unwrap_or_default().trim_matches('"'))
    .bind(&metadata.content_id)
    .bind(&metadata.title)
    .bind(&metadata.description)
    .bind(serde_json::to_value(&metadata.access_policy).unwrap_or_default())
    .bind(metadata.created_at)
    .bind(&metadata.access_policy.institution_id)
    .bind(serde_json::to_string(&metadata.classification).unwrap_or_default().trim_matches('"'))
    .bind(metadata.access_policy.expires_at)
    .bind(metadata.download_count as i32)
    .bind(content_data)
    .execute(pool)
    .await
    .map_err(|e| StorageError::Database(e.to_string()))?;

    Ok(())
}
```

**Step 2: Update get_shared_result to return content_type**

```rust
async fn get_shared_result(&self, token: &ShareToken) -> StorageResult<ShareMetadata> {
    let pool = self.pool.read().await;
    let pool = pool.as_ref().ok_or(StorageError::NotConnected)?;

    let row = sqlx::query(
        r#"
        SELECT owner_user_id, content_type, content_id, title, description,
               access_policy, created_at, classification, download_count, last_accessed_at
        FROM shared_results
        WHERE share_token = $1 AND revoked_at IS NULL
        "#,
    )
    .bind(&token.0)
    .fetch_optional(pool)
    .await
    .map_err(|e| StorageError::Database(e.to_string()))?
    .ok_or(StorageError::NotFound)?;

    let content_type_str: String = row.get("content_type");
    let content_type: ShareableContentType = serde_json::from_str(&format!("\"{}\"", content_type_str))
        .unwrap_or_default();

    Ok(ShareMetadata {
        owner_user_id: UserId(row.get("owner_user_id")),
        content_type,
        content_id: row.get("content_id"),
        title: row.get("title"),
        description: row.get("description"),
        access_policy: serde_json::from_value(row.get("access_policy")).unwrap_or_default(),
        created_at: row.get("created_at"),
        classification: {
            let s: String = row.get("classification");
            serde_json::from_str(&format!("\"{}\"", s)).unwrap_or_default()
        },
        download_count: row.get::<i32, _>("download_count") as u32,
        last_accessed_at: row.get("last_accessed_at"),
    })
}
```

**Step 3: Add method to retrieve content_data**

```rust
/// Retrieves the content data for a share
pub async fn get_share_content(&self, token: &ShareToken) -> StorageResult<Option<serde_json::Value>> {
    let pool = self.pool.read().await;
    let pool = pool.as_ref().ok_or(StorageError::NotConnected)?;

    let row = sqlx::query(
        "SELECT content_data FROM shared_results WHERE share_token = $1 AND revoked_at IS NULL"
    )
    .bind(&token.0)
    .fetch_optional(pool)
    .await
    .map_err(|e| StorageError::Database(e.to_string()))?
    .ok_or(StorageError::NotFound)?;

    Ok(row.get("content_data"))
}
```

**Step 4: Add list_shares_by_type method**

```rust
/// Lists shares by content type for a user
pub async fn list_shares_by_type(
    &self,
    user_id: &UserId,
    content_type: ShareableContentType,
    limit: u32,
) -> StorageResult<Vec<ShareToken>> {
    let pool = self.pool.read().await;
    let pool = pool.as_ref().ok_or(StorageError::NotConnected)?;

    let content_type_str = serde_json::to_string(&content_type)
        .unwrap_or_default()
        .trim_matches('"')
        .to_string();

    let rows = sqlx::query(
        r#"
        SELECT share_token FROM shared_results
        WHERE owner_user_id = $1 AND content_type = $2 AND revoked_at IS NULL
        ORDER BY created_at DESC
        LIMIT $3
        "#,
    )
    .bind(&user_id.0)
    .bind(&content_type_str)
    .bind(limit as i64)
    .fetch_all(pool)
    .await
    .map_err(|e| StorageError::Database(e.to_string()))?;

    Ok(rows.iter().map(|r| ShareToken(r.get("share_token"))).collect())
}
```

**Step 5: Update SharedResultStore trait if needed**

In `packages/ddalab-server/src/storage/traits.rs`, update the trait:

```rust
#[async_trait]
pub trait SharedResultStore: Send + Sync {
    async fn publish_result(
        &self,
        token: &ShareToken,
        metadata: ShareMetadata,
        content_data: Option<serde_json::Value>,
    ) -> StorageResult<()>;

    async fn get_shared_result(&self, token: &ShareToken) -> StorageResult<ShareMetadata>;
    async fn get_share_content(&self, token: &ShareToken) -> StorageResult<Option<serde_json::Value>>;
    async fn check_access(&self, token: &ShareToken, requester_id: &UserId) -> StorageResult<bool>;
    async fn revoke_share(&self, token: &ShareToken) -> StorageResult<()>;
    async fn list_user_shares(&self, user_id: &UserId) -> StorageResult<Vec<ShareToken>>;
    async fn list_shares_by_type(
        &self,
        user_id: &UserId,
        content_type: ShareableContentType,
        limit: u32,
    ) -> StorageResult<Vec<ShareToken>>;
}
```

**Step 6: Verify compilation**

Run: `cd packages/ddalab-server && cargo check`

Expected: May have errors from other code using old signatures - fix as needed

**Step 7: Run tests**

Run: `cd packages/ddalab-server && cargo test`

Expected: Tests may need updates for new signatures

**Step 8: Commit**

```bash
git add packages/ddalab-server/src/storage/postgres.rs packages/ddalab-server/src/storage/traits.rs
git commit -m "feat(collab): update PostgreSQL storage for content types"
```

---

## Task 5: Update Share Handlers for Content Types

**Files:**
- Modify: `packages/ddalab-server/src/handlers/shares.rs`

**Step 1: Update CreateShareRequest**

```rust
#[derive(Debug, Deserialize)]
pub struct CreateShareRequest {
    pub content_type: ShareableContentType,
    pub content_id: String,
    pub title: String,
    pub description: Option<String>,
    pub access_policy: AccessPolicyType,
    pub classification: DataClassification,
    pub expires_in_days: Option<u32>,
    /// Optional inline content data (for annotations, parameters, etc.)
    pub content_data: Option<serde_json::Value>,
}
```

**Step 2: Update create_share handler**

```rust
pub async fn create_share(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreateShareRequest>,
) -> Result<Json<CreateShareResponse>, AppError> {
    // Validate request
    if request.title.len() > MAX_TITLE_LENGTH {
        return Err(AppError::BadRequest("Title too long".to_string()));
    }
    if let Some(ref desc) = request.description {
        if desc.len() > MAX_DESCRIPTION_LENGTH {
            return Err(AppError::BadRequest("Description too long".to_string()));
        }
    }

    // Extract user from session
    let user_id = extract_user_id(&headers, &state).await?;

    // Get institution config for expiry defaults
    let institution = state.storage.get_institution(&user_id).await
        .unwrap_or_else(|_| InstitutionConfig::default());

    // Calculate expiry
    let expires_in_days = request.expires_in_days.unwrap_or_else(|| {
        match request.classification {
            DataClassification::Phi => 7,
            DataClassification::DeIdentified => 30,
            DataClassification::Synthetic => 90,
            DataClassification::Unclassified => institution.default_share_expiry_days,
        }
    });

    let expires_at = Utc::now() + chrono::Duration::days(expires_in_days as i64);

    // Generate share token
    let token = ShareToken(generate_secure_token());

    // Build access policy
    let access_policy = AccessPolicy {
        policy_type: request.access_policy,
        institution_id: institution.id.clone(),
        permissions: vec![Permission::View, Permission::Download],
        expires_at,
        max_downloads: None,
    };

    // Build metadata
    let metadata = ShareMetadata {
        owner_user_id: user_id.clone(),
        content_type: request.content_type,
        content_id: request.content_id.clone(),
        title: request.title.clone(),
        description: request.description.clone(),
        created_at: Utc::now(),
        access_policy,
        classification: request.classification,
        download_count: 0,
        last_accessed_at: None,
    };

    // Store the share
    state.storage.publish_result(&token, metadata, request.content_data).await?;

    // Log the share action
    let audit_entry = AuditLogEntry {
        timestamp: Utc::now(),
        institution_id: institution.id,
        user_id: user_id.0.clone(),
        action: AuditAction::Share,
        share_id: Some(token.0.clone()),
        content_type: Some(request.content_type),
        content_id: Some(request.content_id),
        source_ip: None,
        user_agent: None,
        metadata: None,
    };
    let _ = state.storage.log_entry(audit_entry).await;

    Ok(Json(CreateShareResponse {
        share_token: token.0,
        expires_at,
    }))
}
```

**Step 3: Add endpoint to get share content**

```rust
pub async fn get_share_content(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Json<ShareContentResponse>, AppError> {
    let share_token = ShareToken(token);
    let user_id = extract_user_id(&headers, &state).await?;

    // Check access
    let metadata = state.storage.get_shared_result(&share_token).await?;

    // Use access control module
    let check_result = check_access(&user_id, &metadata, &state.institution_config).await;
    if let AccessCheckResult::Denied(reason) = check_result {
        // Log denied access
        let audit_entry = AuditLogEntry {
            timestamp: Utc::now(),
            institution_id: metadata.access_policy.institution_id.clone(),
            user_id: user_id.0.clone(),
            action: AuditAction::AccessDenied,
            share_id: Some(share_token.0.clone()),
            content_type: Some(metadata.content_type),
            content_id: Some(metadata.content_id.clone()),
            source_ip: None,
            user_agent: None,
            metadata: Some(serde_json::json!({ "reason": format!("{:?}", reason) })),
        };
        let _ = state.storage.log_entry(audit_entry).await;

        return Err(AppError::Forbidden(format!("Access denied: {:?}", reason)));
    }

    // Get content
    let content_data = state.storage.get_share_content(&share_token).await?;

    // Log successful access
    let audit_entry = AuditLogEntry {
        timestamp: Utc::now(),
        institution_id: metadata.access_policy.institution_id.clone(),
        user_id: user_id.0.clone(),
        action: AuditAction::View,
        share_id: Some(share_token.0.clone()),
        content_type: Some(metadata.content_type),
        content_id: Some(metadata.content_id.clone()),
        source_ip: None,
        user_agent: None,
        metadata: None,
    };
    let _ = state.storage.log_entry(audit_entry).await;

    Ok(Json(ShareContentResponse {
        metadata,
        content_data,
    }))
}

#[derive(Debug, Serialize)]
pub struct ShareContentResponse {
    pub metadata: ShareMetadata,
    pub content_data: Option<serde_json::Value>,
}
```

**Step 4: Update router to include new endpoint**

In the router configuration, add:

```rust
.route("/shares/:token/content", get(get_share_content))
```

**Step 5: Verify compilation and run tests**

Run: `cd packages/ddalab-server && cargo check && cargo test`

**Step 6: Commit**

```bash
git add packages/ddalab-server/src/handlers/shares.rs
git commit -m "feat(collab): update share handlers for multi-content support"
```

---

## Task 6: Add TypeScript Content Types

**Files:**
- Modify: `packages/ddalab-tauri/src/types/sync.ts`

**Step 1: Add ShareableContentType enum**

```typescript
// Shareable content types
export type ShareableContentType =
  | "dda_result"
  | "annotation"
  | "workflow"
  | "parameter_set"
  | "data_segment";

export const SHAREABLE_CONTENT_LABELS: Record<ShareableContentType, string> = {
  dda_result: "DDA Result",
  annotation: "Annotation",
  workflow: "Workflow",
  parameter_set: "Parameter Set",
  data_segment: "Data Segment",
};
```

**Step 2: Add content data interfaces**

```typescript
// Shared annotation content
export interface SharedAnnotation {
  source_file: string;
  channel: string | null;
  position: number;
  label: string;
  description: string | null;
  color: string;
  created_at: string;
}

// Shared workflow content
export interface SharedWorkflow {
  name: string;
  description: string | null;
  version: string;
  nodes: WorkflowNodeData[];
  edges: WorkflowEdgeData[];
  created_at: string;
  modified_at: string;
}

export interface WorkflowNodeData {
  id: string;
  action_type: string;
  action_data: unknown;
  timestamp: string;
  description: string | null;
  tags: string[];
}

export interface WorkflowEdgeData {
  source: string;
  target: string;
  dependency_type: string;
}

// Shared parameter set content
export interface SharedParameterSet {
  name: string;
  description: string | null;
  variants: string[];
  window_length: number;
  window_step: number;
  delay_config: DelayConfig;
  ct_parameters: CTParameters | null;
  additional_parameters: Record<string, unknown> | null;
  created_at: string;
}

export type DelayConfig =
  | { mode: "range"; min: number; max: number; num: number }
  | { mode: "list"; delays: number[] };

export interface CTParameters {
  ct_delay_min: number;
  ct_delay_max: number;
  ct_delay_step: number;
  ct_window_min: number;
  ct_window_max: number;
  ct_window_step: number;
}

// Shared data segment content
export interface SharedDataSegment {
  source_file: string;
  source_file_hash: string;
  start_time: number;
  end_time: number;
  sample_rate: number;
  channels: string[];
  sample_count: number;
  data_reference: DataReference;
  created_at: string;
}

export type DataReference =
  | { type: "inline"; base64_data: string }
  | { type: "blob_reference"; blob_id: string; size_bytes: number };

// Union type for any shareable content
export type ShareableContent =
  | { content_type: "dda_result"; result_id: string }
  | { content_type: "annotation"; data: SharedAnnotation }
  | { content_type: "workflow"; data: SharedWorkflow }
  | { content_type: "parameter_set"; data: SharedParameterSet }
  | { content_type: "data_segment"; data: SharedDataSegment };
```

**Step 3: Update ShareMetadata interface**

```typescript
export interface ShareMetadata {
  owner_user_id: string;
  content_type: ShareableContentType;
  content_id: string;
  title: string;
  description: string | null;
  created_at: string;
  access_policy: AccessPolicy;
  classification: DataClassification;
  download_count: number;
  last_accessed_at: string | null;
}
```

**Step 4: Run typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`

Expected: May have errors from components using old ShareMetadata - note for next task

**Step 5: Commit**

```bash
git add packages/ddalab-tauri/src/types/sync.ts
git commit -m "feat(collab): add TypeScript content type definitions"
```

---

## Task 7: Update Tauri Share Commands

**Files:**
- Modify: `packages/ddalab-tauri/src-tauri/src/sync/commands.rs`

**Step 1: Update share command to accept content type**

```rust
#[derive(Debug, Deserialize)]
pub struct ShareContentRequest {
    pub content_type: ShareableContentType,
    pub content_id: String,
    pub title: String,
    pub description: Option<String>,
    pub access_policy: AccessPolicyType,
    pub classification: DataClassification,
    pub expires_in_days: Option<u32>,
    pub content_data: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn sync_share_content(
    state: State<'_, SyncState>,
    request: ShareContentRequest,
) -> Result<String, String> {
    let client = state.client.read().await;
    let client = client.as_ref().ok_or("Not connected to server")?;

    let response = client
        .post(&format!("{}/api/shares", client.server_url))
        .header("Authorization", format!("Bearer {}", client.session_token))
        .json(&serde_json::json!({
            "content_type": request.content_type,
            "content_id": request.content_id,
            "title": request.title,
            "description": request.description,
            "access_policy": request.access_policy,
            "classification": request.classification,
            "expires_in_days": request.expires_in_days,
            "content_data": request.content_data,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to create share: {}", error_text));
    }

    let result: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let share_token = result["share_token"]
        .as_str()
        .ok_or("Missing share_token in response")?;

    Ok(share_token.to_string())
}
```

**Step 2: Add command to get share with content**

```rust
#[derive(Debug, Serialize)]
pub struct ShareWithContent {
    pub metadata: ShareMetadata,
    pub content_data: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn sync_get_share_content(
    state: State<'_, SyncState>,
    token: String,
) -> Result<ShareWithContent, String> {
    let client = state.client.read().await;
    let client = client.as_ref().ok_or("Not connected to server")?;

    let response = client
        .get(&format!("{}/api/shares/{}/content", client.server_url, token))
        .header("Authorization", format!("Bearer {}", client.session_token))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to get share: {}", error_text));
    }

    let result: ShareWithContent = response.json().await.map_err(|e| e.to_string())?;
    Ok(result)
}
```

**Step 3: Add command to list shares by type**

```rust
#[tauri::command]
pub async fn sync_list_shares_by_type(
    state: State<'_, SyncState>,
    content_type: ShareableContentType,
    limit: Option<u32>,
) -> Result<Vec<String>, String> {
    let client = state.client.read().await;
    let client = client.as_ref().ok_or("Not connected to server")?;

    let limit = limit.unwrap_or(50);
    let content_type_str = serde_json::to_string(&content_type)
        .unwrap_or_default()
        .trim_matches('"')
        .to_string();

    let response = client
        .get(&format!(
            "{}/api/shares?content_type={}&limit={}",
            client.server_url, content_type_str, limit
        ))
        .header("Authorization", format!("Bearer {}", client.session_token))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to list shares: {}", error_text));
    }

    let result: Vec<String> = response.json().await.map_err(|e| e.to_string())?;
    Ok(result)
}
```

**Step 4: Register new commands in Tauri**

In the Tauri command registration, add:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    sync_share_content,
    sync_get_share_content,
    sync_list_shares_by_type,
])
```

**Step 5: Verify compilation**

Run: `cd packages/ddalab-tauri/src-tauri && cargo check`

**Step 6: Commit**

```bash
git add packages/ddalab-tauri/src-tauri/src/sync/commands.rs
git commit -m "feat(collab): add Tauri commands for multi-content sharing"
```

---

## Task 8: Create useShareContent Hook

**Files:**
- Create: `packages/ddalab-tauri/src/hooks/useShareContent.ts`

**Step 1: Create the hook**

```typescript
/**
 * Hook for sharing any content type through the collaboration system
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type {
  ShareableContentType,
  ShareableContent,
  ShareMetadata,
  AccessPolicyType,
  DataClassification,
} from "@/types/sync";

interface ShareContentRequest {
  contentType: ShareableContentType;
  contentId: string;
  title: string;
  description?: string;
  accessPolicy: AccessPolicyType;
  classification: DataClassification;
  expiresInDays?: number;
  contentData?: unknown;
}

interface ShareWithContent {
  metadata: ShareMetadata;
  content_data: unknown | null;
}

/**
 * Share any content type
 */
export function useShareContent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: ShareContentRequest): Promise<string> => {
      const shareToken = await invoke<string>("sync_share_content", {
        request: {
          content_type: request.contentType,
          content_id: request.contentId,
          title: request.title,
          description: request.description ?? null,
          access_policy: request.accessPolicy,
          classification: request.classification,
          expires_in_days: request.expiresInDays ?? null,
          content_data: request.contentData ?? null,
        },
      });
      return shareToken;
    },
    onSuccess: () => {
      // Invalidate share lists
      queryClient.invalidateQueries({ queryKey: ["shares"] });
    },
  });
}

/**
 * Get a share with its content
 */
export function useShareWithContent(token: string | null) {
  return useQuery({
    queryKey: ["share", token],
    queryFn: async (): Promise<ShareWithContent> => {
      if (!token) throw new Error("No token provided");
      return invoke<ShareWithContent>("sync_get_share_content", { token });
    },
    enabled: !!token,
  });
}

/**
 * List shares by content type
 */
export function useSharesByType(contentType: ShareableContentType, limit?: number) {
  return useQuery({
    queryKey: ["shares", contentType, limit],
    queryFn: async (): Promise<string[]> => {
      return invoke<string[]>("sync_list_shares_by_type", {
        contentType,
        limit: limit ?? null,
      });
    },
  });
}

/**
 * Helper to build share content data from various sources
 */
export function buildShareableContent(
  contentType: ShareableContentType,
  data: unknown
): ShareableContent {
  switch (contentType) {
    case "dda_result":
      return { content_type: "dda_result", result_id: data as string };
    case "annotation":
      return { content_type: "annotation", data: data as ShareableContent extends { content_type: "annotation" } ? ShareableContent["data"] : never };
    case "workflow":
      return { content_type: "workflow", data: data as ShareableContent extends { content_type: "workflow" } ? ShareableContent["data"] : never };
    case "parameter_set":
      return { content_type: "parameter_set", data: data as ShareableContent extends { content_type: "parameter_set" } ? ShareableContent["data"] : never };
    case "data_segment":
      return { content_type: "data_segment", data: data as ShareableContent extends { content_type: "data_segment" } ? ShareableContent["data"] : never };
  }
}
```

**Step 2: Run typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/hooks/useShareContent.ts
git commit -m "feat(collab): add useShareContent hook for multi-content sharing"
```

---

## Task 9: Create UnifiedShareDialog Component

**Files:**
- Create: `packages/ddalab-tauri/src/components/collaboration/UnifiedShareDialog.tsx`

**Step 1: Create the component**

```typescript
/**
 * UnifiedShareDialog - Share any content type through the collaboration system
 *
 * Adapts UI based on content type while providing a consistent sharing experience.
 */
import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Check, Share2 } from "lucide-react";
import { useShareContent } from "@/hooks/useShareContent";
import { useHipaaMode } from "@/hooks/useInstitutionConfig";
import type {
  ShareableContentType,
  AccessPolicyType,
  DataClassification,
} from "@/types/sync";
import { SHAREABLE_CONTENT_LABELS, DEFAULT_EXPIRY_DAYS } from "@/types/sync";

interface UnifiedShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: ShareableContentType;
  contentId: string;
  contentData?: unknown;
  defaultTitle?: string;
  defaultDescription?: string;
}

export function UnifiedShareDialog({
  open,
  onOpenChange,
  contentType,
  contentId,
  contentData,
  defaultTitle = "",
  defaultDescription = "",
}: UnifiedShareDialogProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);
  const [accessPolicy, setAccessPolicy] = useState<AccessPolicyType>({ type: "public" });
  const [classification, setClassification] = useState<DataClassification>("unclassified");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { mutateAsync: shareContent, isPending } = useShareContent();
  const { isHipaaMode } = useHipaaMode();

  const handleShare = useCallback(async () => {
    try {
      const token = await shareContent({
        contentType,
        contentId,
        title: title || `Shared ${SHAREABLE_CONTENT_LABELS[contentType]}`,
        description: description || undefined,
        accessPolicy,
        classification,
        contentData,
      });
      setShareLink(`ddalab://share/${token}`);
    } catch (error) {
      console.error("Failed to create share:", error);
    }
  }, [shareContent, contentType, contentId, title, description, accessPolicy, classification, contentData]);

  const handleCopy = useCallback(async () => {
    if (shareLink) {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [shareLink]);

  const handleClose = useCallback(() => {
    setShareLink(null);
    setTitle(defaultTitle);
    setDescription(defaultDescription);
    setCopied(false);
    onOpenChange(false);
  }, [defaultTitle, defaultDescription, onOpenChange]);

  const contentLabel = SHAREABLE_CONTENT_LABELS[contentType];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share {contentLabel}
          </DialogTitle>
          <DialogDescription>
            Create a shareable link for this {contentLabel.toLowerCase()}.
          </DialogDescription>
        </DialogHeader>

        {!shareLink ? (
          <div className="space-y-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`My ${contentLabel}`}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description..."
                rows={3}
              />
            </div>

            {/* Data Classification (only in HIPAA mode) */}
            {isHipaaMode && (
              <div className="space-y-2">
                <Label>Data Classification</Label>
                <RadioGroup
                  value={classification}
                  onValueChange={(v) => setClassification(v as DataClassification)}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="phi" id="phi" />
                    <Label htmlFor="phi" className="font-normal">
                      PHI (Institution only, 7-day expiry)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="de_identified" id="de_identified" />
                    <Label htmlFor="de_identified" className="font-normal">
                      De-identified (30-day expiry)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="synthetic" id="synthetic" />
                    <Label htmlFor="synthetic" className="font-normal">
                      Synthetic / Test data (90-day expiry)
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* Access Policy */}
            <div className="space-y-2">
              <Label>Share With</Label>
              <RadioGroup
                value={accessPolicy.type}
                onValueChange={(v) => setAccessPolicy({ type: v as "public" | "institution" })}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="public" id="public" />
                  <Label htmlFor="public" className="font-normal">
                    Anyone in institution
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="institution" id="institution" />
                  <Label htmlFor="institution" className="font-normal">
                    All institution members
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleShare} disabled={isPending}>
                {isPending ? "Creating..." : "Create Share Link"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Share Link</Label>
              <div className="flex gap-2">
                <Input value={shareLink} readOnly className="flex-1" />
                <Button variant="outline" size="icon" onClick={handleCopy}>
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Share this link with colleagues. Expires in{" "}
                {DEFAULT_EXPIRY_DAYS[classification]} days.
              </p>
            </div>

            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Create directory if needed**

Run: `mkdir -p packages/ddalab-tauri/src/components/collaboration`

**Step 3: Run typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`

**Step 4: Commit**

```bash
git add packages/ddalab-tauri/src/components/collaboration/UnifiedShareDialog.tsx
git commit -m "feat(collab): add UnifiedShareDialog component"
```

---

## Task 10: Add Share Actions to Annotation Components

**Files:**
- Modify: `packages/ddalab-tauri/src/components/annotations/AnnotationPanel.tsx` (or wherever annotations are displayed)

**Step 1: Find the annotation display component**

Look for where annotations are rendered in the UI - likely in a panel or list component.

**Step 2: Add share button and dialog**

Add to the component:

```typescript
import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnifiedShareDialog } from "@/components/collaboration/UnifiedShareDialog";
import type { PlotAnnotation } from "@/types/annotations";

// Inside the component:
const [shareDialogOpen, setShareDialogOpen] = useState(false);
const [annotationToShare, setAnnotationToShare] = useState<PlotAnnotation | null>(null);

const handleShareAnnotation = (annotation: PlotAnnotation) => {
  setAnnotationToShare(annotation);
  setShareDialogOpen(true);
};

// In the render, for each annotation item:
<Button
  variant="ghost"
  size="icon"
  onClick={() => handleShareAnnotation(annotation)}
  title="Share annotation"
>
  <Share2 className="h-4 w-4" />
</Button>

// At the end of the component:
{annotationToShare && (
  <UnifiedShareDialog
    open={shareDialogOpen}
    onOpenChange={setShareDialogOpen}
    contentType="annotation"
    contentId={annotationToShare.id ?? crypto.randomUUID()}
    contentData={{
      source_file: filePath,
      channel: channelName ?? null,
      position: annotationToShare.position,
      label: annotationToShare.label,
      description: annotationToShare.description ?? null,
      color: annotationToShare.color,
      created_at: annotationToShare.createdAt,
    }}
    defaultTitle={annotationToShare.label}
    defaultDescription={annotationToShare.description}
  />
)}
```

**Step 3: Run typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`

**Step 4: Commit**

```bash
git add packages/ddalab-tauri/src/components/annotations/
git commit -m "feat(collab): add share action to annotations"
```

---

## Task 11: Add Share Actions to Workflow Components

**Files:**
- Modify: `packages/ddalab-tauri/src/components/workflow/WorkflowRecorder.tsx`

**Step 1: Add share functionality to workflow recorder**

The WorkflowRecorder component should have an export/share option when a workflow is complete. Add:

```typescript
import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnifiedShareDialog } from "@/components/collaboration/UnifiedShareDialog";

// Inside the component:
const [shareDialogOpen, setShareDialogOpen] = useState(false);

const handleShareWorkflow = () => {
  setShareDialogOpen(true);
};

// Build workflow content data from current state
const buildWorkflowContent = () => ({
  name: currentSessionName ?? "Unnamed Workflow",
  description: null,
  version: "1.0.0",
  nodes: workflowNodes.map(node => ({
    id: node.id,
    action_type: node.action.type,
    action_data: node.action,
    timestamp: node.timestamp,
    description: node.metadata?.description ?? null,
    tags: node.metadata?.tags ?? [],
  })),
  edges: workflowEdges.map(edge => ({
    source: edge.source,
    target: edge.target,
    dependency_type: edge.dependency_type,
  })),
  created_at: new Date().toISOString(),
  modified_at: new Date().toISOString(),
});

// Add share button near export button:
<Button
  variant="outline"
  size="sm"
  onClick={handleShareWorkflow}
  disabled={!isRecording && actionCount === 0}
>
  <Share2 className="h-4 w-4 mr-2" />
  Share
</Button>

// Add dialog:
<UnifiedShareDialog
  open={shareDialogOpen}
  onOpenChange={setShareDialogOpen}
  contentType="workflow"
  contentId={crypto.randomUUID()}
  contentData={buildWorkflowContent()}
  defaultTitle={currentSessionName ?? "Recorded Workflow"}
/>
```

**Step 2: Run typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/components/workflow/
git commit -m "feat(collab): add share action to workflows"
```

---

## Task 12: Add Share Actions to Parameter Sets

**Files:**
- Find and modify the component where DDA parameters are configured (likely in `packages/ddalab-tauri/src/components/dda/` directory)

**Step 1: Find the parameter configuration component**

Look for where DDA parameters (window length, step, delays, variants) are configured.

**Step 2: Add "Save & Share Parameters" action**

```typescript
import { useState } from "react";
import { Share2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnifiedShareDialog } from "@/components/collaboration/UnifiedShareDialog";

// Inside the component:
const [shareDialogOpen, setShareDialogOpen] = useState(false);

const buildParameterSetContent = () => ({
  name: "Custom Parameters",
  description: null,
  variants: selectedVariants,
  window_length: windowLength,
  window_step: windowStep,
  delay_config: delayMode === "range"
    ? { mode: "range" as const, min: delayMin, max: delayMax, num: delayNum }
    : { mode: "list" as const, delays: delayList },
  ct_parameters: useCrossTarget ? {
    ct_delay_min: ctDelayMin,
    ct_delay_max: ctDelayMax,
    ct_delay_step: ctDelayStep,
    ct_window_min: ctWindowMin,
    ct_window_max: ctWindowMax,
    ct_window_step: ctWindowStep,
  } : null,
  additional_parameters: null,
  created_at: new Date().toISOString(),
});

// Add share button:
<Button
  variant="outline"
  onClick={() => setShareDialogOpen(true)}
>
  <Share2 className="h-4 w-4 mr-2" />
  Share Parameters
</Button>

// Add dialog:
<UnifiedShareDialog
  open={shareDialogOpen}
  onOpenChange={setShareDialogOpen}
  contentType="parameter_set"
  contentId={crypto.randomUUID()}
  contentData={buildParameterSetContent()}
  defaultTitle="DDA Parameters"
  defaultDescription="Shared DDA analysis configuration"
/>
```

**Step 3: Run typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`

**Step 4: Commit**

```bash
git add packages/ddalab-tauri/src/components/dda/
git commit -m "feat(collab): add share action to parameter sets"
```

---

## Task 13: Update Existing ShareResultDialog

**Files:**
- Modify: `packages/ddalab-tauri/src/components/dda/ShareResultDialog.tsx`

**Step 1: Update to use UnifiedShareDialog internally or deprecate**

Option A: Refactor to use UnifiedShareDialog:

```typescript
import { UnifiedShareDialog } from "@/components/collaboration/UnifiedShareDialog";

interface ShareResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: DDAResult;
  existingShareLink?: string | null;
}

export function ShareResultDialog({
  open,
  onOpenChange,
  result,
  existingShareLink,
}: ShareResultDialogProps) {
  // If already shared, show existing link
  if (existingShareLink) {
    return (
      <ExistingShareLinkDialog
        open={open}
        onOpenChange={onOpenChange}
        shareLink={existingShareLink}
      />
    );
  }

  return (
    <UnifiedShareDialog
      open={open}
      onOpenChange={onOpenChange}
      contentType="dda_result"
      contentId={result.id}
      defaultTitle={result.name ?? `DDA Analysis - ${result.variant}`}
      defaultDescription={`Analysis of ${result.sourcePath}`}
    />
  );
}
```

Option B: Keep both and mark old one as deprecated.

**Step 2: Run typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/components/dda/ShareResultDialog.tsx
git commit -m "refactor(collab): update ShareResultDialog to use unified sharing"
```

---

## Task 14: Add Tests for Content Type Sharing

**Files:**
- Modify: `packages/ddalab-server/src/handlers/shares.rs` (add test module)

**Step 1: Add unit tests for content type handling**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::types::*;

    #[test]
    fn test_shareable_content_type_serialization() {
        let types = vec![
            (ShareableContentType::DdaResult, "\"dda_result\""),
            (ShareableContentType::Annotation, "\"annotation\""),
            (ShareableContentType::Workflow, "\"workflow\""),
            (ShareableContentType::ParameterSet, "\"parameter_set\""),
            (ShareableContentType::DataSegment, "\"data_segment\""),
        ];

        for (content_type, expected) in types {
            let serialized = serde_json::to_string(&content_type).unwrap();
            assert_eq!(serialized, expected);

            let deserialized: ShareableContentType = serde_json::from_str(&serialized).unwrap();
            assert_eq!(deserialized, content_type);
        }
    }

    #[test]
    fn test_may_contain_phi() {
        assert!(ShareableContentType::DdaResult.may_contain_phi());
        assert!(ShareableContentType::Annotation.may_contain_phi());
        assert!(!ShareableContentType::Workflow.may_contain_phi());
        assert!(!ShareableContentType::ParameterSet.may_contain_phi());
        assert!(ShareableContentType::DataSegment.may_contain_phi());
    }

    #[test]
    fn test_shared_parameter_set_serialization() {
        let params = SharedParameterSet {
            name: "Test Config".to_string(),
            description: Some("For testing".to_string()),
            variants: vec!["ST".to_string(), "CT".to_string()],
            window_length: 1000,
            window_step: 100,
            delay_config: DelayConfig::Range { min: 1, max: 50, num: 10 },
            ct_parameters: None,
            additional_parameters: None,
            created_at: Utc::now(),
        };

        let json = serde_json::to_string(&params).unwrap();
        let deserialized: SharedParameterSet = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.name, "Test Config");
        assert_eq!(deserialized.variants.len(), 2);
    }

    #[test]
    fn test_shared_workflow_serialization() {
        let workflow = SharedWorkflow {
            name: "Test Workflow".to_string(),
            description: None,
            version: "1.0.0".to_string(),
            nodes: vec![],
            edges: vec![],
            created_at: Utc::now(),
            modified_at: Utc::now(),
        };

        let json = serde_json::to_string(&workflow).unwrap();
        let deserialized: SharedWorkflow = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.name, "Test Workflow");
        assert_eq!(deserialized.version, "1.0.0");
    }
}
```

**Step 2: Run tests**

Run: `cd packages/ddalab-server && cargo test`

Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/ddalab-server/src/handlers/shares.rs
git commit -m "test(collab): add unit tests for content type sharing"
```

---

## Task 15: Full Integration Verification

**Files:** None (verification only)

**Step 1: Run all Rust tests**

Run: `cd packages/ddalab-server && cargo test`

Expected: All tests pass

**Step 2: Verify Tauri compilation**

Run: `cd packages/ddalab-tauri/src-tauri && cargo check`

Expected: No errors

**Step 3: Run TypeScript typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`

Expected: No errors

**Step 4: Verify frontend builds**

Run: `cd packages/ddalab-tauri && bun run build`

Expected: Build succeeds

**Step 5: Manual testing checklist**

Start the app and verify:
- [ ] Can share a DDA result using the new system
- [ ] UnifiedShareDialog shows correct content type label
- [ ] HIPAA mode toggle shows/hides classification options
- [ ] Share link is generated and copyable
- [ ] Annotations have share button (if implemented)
- [ ] Workflows have share button (if implemented)
- [ ] Parameters have share button (if implemented)

**Step 6: Final commit**

```bash
git add .
git commit -m "feat(collab): complete Phase 2 content type expansion"
```

---

## Summary

Phase 2 adds multi-content sharing to DDALAB:

1. **Tasks 1-2**: Backend type definitions and database migration
2. **Tasks 3-5**: Server storage and handler updates
3. **Tasks 6-8**: Frontend types and hooks
4. **Task 9**: UnifiedShareDialog component
5. **Tasks 10-13**: Share actions on all content types
6. **Tasks 14-15**: Testing and verification

**Dependencies**: Phase 1 Security Hardening must be complete.

**Next Phase**: Phase 3 (Team Collaboration) builds on this with team management UI and SharedWithMe/MyShares views.
