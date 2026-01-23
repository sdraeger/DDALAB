# Phase 4: Federation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable cross-institution sharing for non-PHI content with bilateral trust model

**Architecture:** Institutions establish bilateral trust relationships. Federated shares allow users from trusted institutions to access non-PHI content. Content metadata syncs across institutions but actual data stays at origin and is proxied on demand.

**Tech Stack:** PostgreSQL (federation_trusts, federation_invites tables), Rust handlers, React settings UI

---

## Task 1: Database Migration for Federation

**Files:**
- Create: `packages/ddalab-server/migrations/007_federation.sql`

**Step 1: Write the migration**

```sql
-- Federation invite tokens for establishing trust
CREATE TABLE IF NOT EXISTS federation_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    to_institution_id UUID,
    to_institution_name TEXT,
    invite_token TEXT NOT NULL UNIQUE,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

-- Federation trust relationships (bidirectional)
CREATE TABLE IF NOT EXISTS federation_trusts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_a UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    institution_b UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    trust_level TEXT NOT NULL DEFAULT 'full' CHECK (trust_level IN ('full', 'read_only', 'revoked')),
    established_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    established_by UUID NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID,
    UNIQUE(institution_a, institution_b),
    CHECK (institution_a < institution_b)  -- Enforce ordering to prevent duplicates
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_federation_invites_token ON federation_invites(invite_token);
CREATE INDEX IF NOT EXISTS idx_federation_invites_from ON federation_invites(from_institution_id);
CREATE INDEX IF NOT EXISTS idx_federation_trusts_institutions ON federation_trusts(institution_a, institution_b);
```

**Step 2: Commit**

```bash
git add packages/ddalab-server/migrations/007_federation.sql
git commit -m "feat(collab): add federation database migration"
```

---

## Task 2: Federation Types

**Files:**
- Modify: `packages/ddalab-server/src/storage/types.rs`

**Step 1: Add federation types**

```rust
/// Trust level between federated institutions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustLevel {
    /// Full bidirectional access to non-PHI content
    Full,
    /// Read-only access (can view but not download)
    ReadOnly,
    /// Trust has been revoked
    Revoked,
}

impl Default for TrustLevel {
    fn default() -> Self {
        Self::Full
    }
}

/// Federation invite for establishing trust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationInvite {
    pub id: Uuid,
    pub from_institution_id: Uuid,
    pub to_institution_id: Option<Uuid>,
    pub to_institution_name: Option<String>,
    pub invite_token: String,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub accepted_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
}

impl FederationInvite {
    pub fn is_valid(&self) -> bool {
        self.accepted_at.is_none()
            && self.revoked_at.is_none()
            && self.expires_at > Utc::now()
    }
}

/// Trust relationship between two institutions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationTrust {
    pub id: Uuid,
    pub institution_a: Uuid,
    pub institution_b: Uuid,
    pub trust_level: TrustLevel,
    pub established_at: DateTime<Utc>,
    pub established_by: Uuid,
    pub revoked_at: Option<DateTime<Utc>>,
    pub revoked_by: Option<Uuid>,
}

impl FederationTrust {
    pub fn is_active(&self) -> bool {
        self.revoked_at.is_none() && self.trust_level != TrustLevel::Revoked
    }

    /// Check if an institution is part of this trust
    pub fn includes_institution(&self, institution_id: Uuid) -> bool {
        self.institution_a == institution_id || self.institution_b == institution_id
    }

    /// Get the other institution in the trust relationship
    pub fn other_institution(&self, my_institution: Uuid) -> Option<Uuid> {
        if self.institution_a == my_institution {
            Some(self.institution_b)
        } else if self.institution_b == my_institution {
            Some(self.institution_a)
        } else {
            None
        }
    }
}

/// Summary of a federated institution for UI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederatedInstitutionSummary {
    pub institution_id: Uuid,
    pub institution_name: String,
    pub trust_level: TrustLevel,
    pub established_at: DateTime<Utc>,
    pub share_count: i64,
}
```

**Step 2: Commit**

```bash
git add packages/ddalab-server/src/storage/types.rs
git commit -m "feat(collab): add federation types"
```

---

## Task 3: FederationStore Trait

**Files:**
- Modify: `packages/ddalab-server/src/storage/traits.rs`
- Modify: `packages/ddalab-server/src/storage/mod.rs`

**Step 1: Add FederationStore trait**

```rust
/// Storage backend for federation
#[async_trait]
pub trait FederationStore: Send + Sync {
    /// Create a federation invite
    async fn create_invite(&self, invite: &FederationInvite) -> StorageResult<()>;

    /// Get invite by token
    async fn get_invite_by_token(&self, token: &str) -> StorageResult<FederationInvite>;

    /// Accept an invite and create trust relationship
    async fn accept_invite(
        &self,
        token: &str,
        accepting_institution_id: Uuid,
        accepting_user_id: Uuid,
    ) -> StorageResult<FederationTrust>;

    /// Revoke an invite
    async fn revoke_invite(&self, invite_id: Uuid) -> StorageResult<()>;

    /// List pending invites for an institution
    async fn list_pending_invites(&self, institution_id: Uuid) -> StorageResult<Vec<FederationInvite>>;

    /// Get trust relationship between two institutions
    async fn get_trust(
        &self,
        institution_a: Uuid,
        institution_b: Uuid,
    ) -> StorageResult<Option<FederationTrust>>;

    /// List all active trusts for an institution
    async fn list_trusts(&self, institution_id: Uuid) -> StorageResult<Vec<FederationTrust>>;

    /// Update trust level
    async fn update_trust_level(
        &self,
        trust_id: Uuid,
        trust_level: TrustLevel,
        updated_by: Uuid,
    ) -> StorageResult<()>;

    /// Revoke a trust relationship
    async fn revoke_trust(&self, trust_id: Uuid, revoked_by: Uuid) -> StorageResult<()>;

    /// Check if two institutions are federated
    async fn are_federated(&self, institution_a: Uuid, institution_b: Uuid) -> StorageResult<bool>;

    /// Get federated institution summaries for UI
    async fn get_federated_institutions(
        &self,
        institution_id: Uuid,
    ) -> StorageResult<Vec<FederatedInstitutionSummary>>;
}
```

**Step 2: Export in mod.rs**

Add `FederationStore` to traits export and federation types.

**Step 3: Commit**

```bash
git add packages/ddalab-server/src/storage/
git commit -m "feat(collab): add FederationStore trait"
```

---

## Task 4: PostgreSQL Federation Implementation

**Files:**
- Create: `packages/ddalab-server/src/storage/federation.rs`
- Modify: `packages/ddalab-server/src/storage/mod.rs`

**Step 1: Implement PostgresFederationStore**

```rust
use async_trait::async_trait;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::storage::traits::{FederationStore, StorageError, StorageResult};
use crate::storage::types::{FederatedInstitutionSummary, FederationInvite, FederationTrust, TrustLevel};

pub struct PostgresFederationStore {
    pool: PgPool,
}

impl PostgresFederationStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    fn parse_trust_level(s: &str) -> TrustLevel {
        match s {
            "full" => TrustLevel::Full,
            "read_only" => TrustLevel::ReadOnly,
            "revoked" => TrustLevel::Revoked,
            _ => TrustLevel::Full,
        }
    }

    fn trust_level_to_str(level: TrustLevel) -> &'static str {
        match level {
            TrustLevel::Full => "full",
            TrustLevel::ReadOnly => "read_only",
            TrustLevel::Revoked => "revoked",
        }
    }
}

#[async_trait]
impl FederationStore for PostgresFederationStore {
    async fn create_invite(&self, invite: &FederationInvite) -> StorageResult<()> {
        sqlx::query(
            r#"
            INSERT INTO federation_invites
                (id, from_institution_id, to_institution_id, to_institution_name,
                 invite_token, created_by, created_at, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
        )
        .bind(invite.id)
        .bind(invite.from_institution_id)
        .bind(invite.to_institution_id)
        .bind(&invite.to_institution_name)
        .bind(&invite.invite_token)
        .bind(invite.created_by)
        .bind(invite.created_at)
        .bind(invite.expires_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn get_invite_by_token(&self, token: &str) -> StorageResult<FederationInvite> {
        let row = sqlx::query(
            r#"
            SELECT id, from_institution_id, to_institution_id, to_institution_name,
                   invite_token, created_by, created_at, expires_at, accepted_at, revoked_at
            FROM federation_invites WHERE invite_token = $1
            "#,
        )
        .bind(token)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::NotFound("Federation invite not found".to_string()))?;

        Ok(FederationInvite {
            id: row.get("id"),
            from_institution_id: row.get("from_institution_id"),
            to_institution_id: row.get("to_institution_id"),
            to_institution_name: row.get("to_institution_name"),
            invite_token: row.get("invite_token"),
            created_by: row.get("created_by"),
            created_at: row.get("created_at"),
            expires_at: row.get("expires_at"),
            accepted_at: row.get("accepted_at"),
            revoked_at: row.get("revoked_at"),
        })
    }

    async fn accept_invite(
        &self,
        token: &str,
        accepting_institution_id: Uuid,
        accepting_user_id: Uuid,
    ) -> StorageResult<FederationTrust> {
        // Get and validate invite
        let invite = self.get_invite_by_token(token).await?;

        if !invite.is_valid() {
            return Err(StorageError::AccessDenied("Invite is no longer valid".to_string()));
        }

        // Mark invite as accepted
        sqlx::query(
            "UPDATE federation_invites SET accepted_at = NOW(), to_institution_id = $2 WHERE id = $1",
        )
        .bind(invite.id)
        .bind(accepting_institution_id)
        .execute(&self.pool)
        .await?;

        // Create trust relationship (ensure consistent ordering)
        let (inst_a, inst_b) = if invite.from_institution_id < accepting_institution_id {
            (invite.from_institution_id, accepting_institution_id)
        } else {
            (accepting_institution_id, invite.from_institution_id)
        };

        let trust_id = Uuid::new_v4();
        let now = chrono::Utc::now();

        sqlx::query(
            r#"
            INSERT INTO federation_trusts
                (id, institution_a, institution_b, trust_level, established_at, established_by)
            VALUES ($1, $2, $3, 'full', $4, $5)
            ON CONFLICT (institution_a, institution_b) DO UPDATE SET
                trust_level = 'full',
                revoked_at = NULL,
                revoked_by = NULL
            "#,
        )
        .bind(trust_id)
        .bind(inst_a)
        .bind(inst_b)
        .bind(now)
        .bind(accepting_user_id)
        .execute(&self.pool)
        .await?;

        Ok(FederationTrust {
            id: trust_id,
            institution_a: inst_a,
            institution_b: inst_b,
            trust_level: TrustLevel::Full,
            established_at: now,
            established_by: accepting_user_id,
            revoked_at: None,
            revoked_by: None,
        })
    }

    async fn revoke_invite(&self, invite_id: Uuid) -> StorageResult<()> {
        sqlx::query("UPDATE federation_invites SET revoked_at = NOW() WHERE id = $1")
            .bind(invite_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_pending_invites(&self, institution_id: Uuid) -> StorageResult<Vec<FederationInvite>> {
        let rows = sqlx::query(
            r#"
            SELECT id, from_institution_id, to_institution_id, to_institution_name,
                   invite_token, created_by, created_at, expires_at, accepted_at, revoked_at
            FROM federation_invites
            WHERE from_institution_id = $1
              AND accepted_at IS NULL
              AND revoked_at IS NULL
              AND expires_at > NOW()
            ORDER BY created_at DESC
            "#,
        )
        .bind(institution_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| FederationInvite {
                id: row.get("id"),
                from_institution_id: row.get("from_institution_id"),
                to_institution_id: row.get("to_institution_id"),
                to_institution_name: row.get("to_institution_name"),
                invite_token: row.get("invite_token"),
                created_by: row.get("created_by"),
                created_at: row.get("created_at"),
                expires_at: row.get("expires_at"),
                accepted_at: row.get("accepted_at"),
                revoked_at: row.get("revoked_at"),
            })
            .collect())
    }

    async fn get_trust(
        &self,
        institution_a: Uuid,
        institution_b: Uuid,
    ) -> StorageResult<Option<FederationTrust>> {
        let (a, b) = if institution_a < institution_b {
            (institution_a, institution_b)
        } else {
            (institution_b, institution_a)
        };

        let row = sqlx::query(
            r#"
            SELECT id, institution_a, institution_b, trust_level,
                   established_at, established_by, revoked_at, revoked_by
            FROM federation_trusts
            WHERE institution_a = $1 AND institution_b = $2
            "#,
        )
        .bind(a)
        .bind(b)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| {
            let trust_level_str: String = r.get("trust_level");
            FederationTrust {
                id: r.get("id"),
                institution_a: r.get("institution_a"),
                institution_b: r.get("institution_b"),
                trust_level: Self::parse_trust_level(&trust_level_str),
                established_at: r.get("established_at"),
                established_by: r.get("established_by"),
                revoked_at: r.get("revoked_at"),
                revoked_by: r.get("revoked_by"),
            }
        }))
    }

    async fn list_trusts(&self, institution_id: Uuid) -> StorageResult<Vec<FederationTrust>> {
        let rows = sqlx::query(
            r#"
            SELECT id, institution_a, institution_b, trust_level,
                   established_at, established_by, revoked_at, revoked_by
            FROM federation_trusts
            WHERE (institution_a = $1 OR institution_b = $1)
              AND revoked_at IS NULL
              AND trust_level != 'revoked'
            ORDER BY established_at DESC
            "#,
        )
        .bind(institution_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| {
                let trust_level_str: String = r.get("trust_level");
                FederationTrust {
                    id: r.get("id"),
                    institution_a: r.get("institution_a"),
                    institution_b: r.get("institution_b"),
                    trust_level: Self::parse_trust_level(&trust_level_str),
                    established_at: r.get("established_at"),
                    established_by: r.get("established_by"),
                    revoked_at: r.get("revoked_at"),
                    revoked_by: r.get("revoked_by"),
                }
            })
            .collect())
    }

    async fn update_trust_level(
        &self,
        trust_id: Uuid,
        trust_level: TrustLevel,
        _updated_by: Uuid,
    ) -> StorageResult<()> {
        sqlx::query("UPDATE federation_trusts SET trust_level = $2 WHERE id = $1")
            .bind(trust_id)
            .bind(Self::trust_level_to_str(trust_level))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn revoke_trust(&self, trust_id: Uuid, revoked_by: Uuid) -> StorageResult<()> {
        sqlx::query(
            "UPDATE federation_trusts SET trust_level = 'revoked', revoked_at = NOW(), revoked_by = $2 WHERE id = $1",
        )
        .bind(trust_id)
        .bind(revoked_by)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn are_federated(&self, institution_a: Uuid, institution_b: Uuid) -> StorageResult<bool> {
        let trust = self.get_trust(institution_a, institution_b).await?;
        Ok(trust.map(|t| t.is_active()).unwrap_or(false))
    }

    async fn get_federated_institutions(
        &self,
        institution_id: Uuid,
    ) -> StorageResult<Vec<FederatedInstitutionSummary>> {
        let rows = sqlx::query(
            r#"
            SELECT
                CASE
                    WHEN ft.institution_a = $1 THEN ft.institution_b
                    ELSE ft.institution_a
                END as other_institution_id,
                i.name as institution_name,
                ft.trust_level,
                ft.established_at,
                COUNT(DISTINCT sr.share_token) as share_count
            FROM federation_trusts ft
            JOIN institutions i ON i.id = CASE
                WHEN ft.institution_a = $1 THEN ft.institution_b
                ELSE ft.institution_a
            END
            LEFT JOIN shared_results sr ON sr.access_policy->>'institution_id' = i.id::text
            WHERE (ft.institution_a = $1 OR ft.institution_b = $1)
              AND ft.revoked_at IS NULL
              AND ft.trust_level != 'revoked'
            GROUP BY ft.id, i.id, i.name, ft.trust_level, ft.established_at
            ORDER BY ft.established_at DESC
            "#,
        )
        .bind(institution_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| {
                let trust_level_str: String = r.get("trust_level");
                FederatedInstitutionSummary {
                    institution_id: r.get("other_institution_id"),
                    institution_name: r.get("institution_name"),
                    trust_level: Self::parse_trust_level(&trust_level_str),
                    established_at: r.get("established_at"),
                    share_count: r.get("share_count"),
                }
            })
            .collect())
    }
}
```

**Step 2: Export in mod.rs**

**Step 3: Commit**

```bash
git add packages/ddalab-server/src/storage/
git commit -m "feat(collab): implement PostgresFederationStore"
```

---

## Task 5: Federation API Handlers

**Files:**
- Create: `packages/ddalab-server/src/handlers/federation.rs`
- Modify: `packages/ddalab-server/src/handlers/mod.rs`

**Step 1: Create federation handlers**

Handlers for: create_invite, accept_invite, list_trusts, revoke_trust, get_federated_institutions

**Step 2: Export in mod.rs**

**Step 3: Commit**

```bash
git add packages/ddalab-server/src/handlers/
git commit -m "feat(collab): add federation API handlers"
```

---

## Task 6: TypeScript Federation Types

**Files:**
- Modify: `packages/ddalab-tauri/src/types/sync.ts`

**Step 1: Add federation types**

```typescript
// Trust level between federated institutions
export type TrustLevel = "full" | "read_only" | "revoked";

// Federation invite
export interface FederationInvite {
  id: string;
  from_institution_id: string;
  to_institution_id: string | null;
  to_institution_name: string | null;
  invite_token: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

// Federation trust relationship
export interface FederationTrust {
  id: string;
  institution_a: string;
  institution_b: string;
  trust_level: TrustLevel;
  established_at: string;
  established_by: string;
  revoked_at: string | null;
  revoked_by: string | null;
}

// Federated institution summary for UI
export interface FederatedInstitutionSummary {
  institution_id: string;
  institution_name: string;
  trust_level: TrustLevel;
  established_at: string;
  share_count: number;
}
```

**Step 2: Commit**

```bash
git add packages/ddalab-tauri/src/types/sync.ts
git commit -m "feat(collab): add TypeScript federation types"
```

---

## Task 7: Federation Hooks

**Files:**
- Create: `packages/ddalab-tauri/src/hooks/useFederation.ts`

**Step 1: Create federation hooks**

```typescript
/**
 * Hooks for federation management
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type {
  FederationInvite,
  FederationTrust,
  FederatedInstitutionSummary,
  TrustLevel,
} from "@/types/sync";

export function useFederatedInstitutions(institutionId: string) {
  return useQuery({
    queryKey: ["federation", "institutions", institutionId],
    queryFn: async () => {
      return invoke<FederatedInstitutionSummary[]>("federation_list_institutions", {
        institutionId,
      });
    },
    enabled: !!institutionId,
  });
}

export function usePendingInvites(institutionId: string) {
  return useQuery({
    queryKey: ["federation", "invites", institutionId],
    queryFn: async () => {
      return invoke<FederationInvite[]>("federation_list_invites", {
        institutionId,
      });
    },
    enabled: !!institutionId,
  });
}

export function useCreateFederationInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      institutionId,
      targetName,
      expiresInDays,
    }: {
      institutionId: string;
      targetName?: string;
      expiresInDays?: number;
    }) => {
      return invoke<FederationInvite>("federation_create_invite", {
        institutionId,
        targetName,
        expiresInDays: expiresInDays ?? 7,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["federation"] });
    },
  });
}

export function useAcceptFederationInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inviteToken: string) => {
      return invoke<FederationTrust>("federation_accept_invite", { inviteToken });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["federation"] });
    },
  });
}

export function useRevokeFederationTrust() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (trustId: string) => {
      await invoke("federation_revoke_trust", { trustId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["federation"] });
    },
  });
}

export function useUpdateTrustLevel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      trustId,
      trustLevel,
    }: {
      trustId: string;
      trustLevel: TrustLevel;
    }) => {
      await invoke("federation_update_trust_level", { trustId, trustLevel });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["federation"] });
    },
  });
}
```

**Step 2: Commit**

```bash
git add packages/ddalab-tauri/src/hooks/useFederation.ts
git commit -m "feat(collab): add federation hooks"
```

---

## Task 8: FederationSettings Component

**Files:**
- Create: `packages/ddalab-tauri/src/components/settings/FederationSettings.tsx`

**Step 1: Create FederationSettings component**

Admin UI for:
- Viewing federated institutions
- Creating federation invites
- Accepting invites (via token input)
- Revoking trust relationships
- Updating trust levels

**Step 2: Commit**

```bash
git add packages/ddalab-tauri/src/components/settings/
git commit -m "feat(collab): add FederationSettings component"
```

---

## Task 9: Update Share Dialog for Federation

**Files:**
- Modify: `packages/ddalab-tauri/src/components/collaboration/UnifiedShareDialog.tsx`

**Step 1: Add federated sharing option**

When institution has federation enabled and trusts are established:
- Show "Share with federated institution" option
- Only allow for non-PHI content
- Display target institution selection

**Step 2: Commit**

```bash
git add packages/ddalab-tauri/src/components/collaboration/
git commit -m "feat(collab): add federated sharing to UnifiedShareDialog"
```

---

## Task 10: Integration Verification

**Step 1: Run all tests**

```bash
cd packages/ddalab-server && cargo test
cd packages/ddalab-tauri/src-tauri && cargo check
cd packages/ddalab-tauri && bun run typecheck
```

**Step 2: Final commit**

```bash
git add .
git commit -m "feat(collab): complete Phase 4 federation"
```

---

## Summary

Phase 4 adds:
- **Database**: `federation_invites` and `federation_trusts` tables
- **Backend**: FederationStore trait and PostgresFederationStore implementation
- **API**: Federation invite/accept/revoke handlers
- **Frontend**: Federation settings UI, hooks, and share dialog integration
- **Security**: PHI content cannot cross institution boundaries
