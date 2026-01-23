# Phase 3: Team Collaboration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable team-based collaboration with management UI and share visibility

**Architecture:** Teams belong to institutions, members have roles (admin/member). Shares can target teams for group access. Frontend provides full management and browsing of incoming/outgoing shares.

**Tech Stack:** PostgreSQL (teams, team_members tables), Rust handlers, React components with Radix UI

---

## Task 1: Database Migration for Teams

**Files:**
- Create: `packages/ddalab-server/migrations/006_teams.sql`

**Step 1: Write the migration**

```sql
-- Teams within an institution
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(institution_id, name)
);

-- Team membership
CREATE TABLE IF NOT EXISTS team_members (
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by UUID,
    PRIMARY KEY (team_id, user_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_teams_institution ON teams(institution_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

-- Update trigger for teams
CREATE OR REPLACE FUNCTION update_teams_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER teams_updated_at
    BEFORE UPDATE ON teams
    FOR EACH ROW
    EXECUTE FUNCTION update_teams_updated_at();
```

**Step 2: Commit**

```bash
git add packages/ddalab-server/migrations/006_teams.sql
git commit -m "feat(collab): add teams database migration"
```

---

## Task 2: Team Types and Traits

**Files:**
- Modify: `packages/ddalab-server/src/storage/types.rs`
- Modify: `packages/ddalab-server/src/storage/traits.rs`
- Modify: `packages/ddalab-server/src/storage/mod.rs`

**Step 1: Add Team types**

In `types.rs`, add after existing types:

```rust
/// Team within an institution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Team {
    pub id: Uuid,
    pub institution_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Team member role
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TeamRole {
    Admin,
    Member,
}

impl Default for TeamRole {
    fn default() -> Self {
        Self::Member
    }
}

/// Team membership
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    pub team_id: Uuid,
    pub user_id: Uuid,
    pub role: TeamRole,
    pub added_at: DateTime<Utc>,
    pub added_by: Option<Uuid>,
}

/// Team with member count for listing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamSummary {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub member_count: i64,
    pub share_count: i64,
}
```

**Step 2: Add TeamStore trait**

In `traits.rs`:

```rust
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
```

**Step 3: Export in mod.rs**

Add `TeamStore` and team types to exports.

**Step 4: Commit**

```bash
git add packages/ddalab-server/src/storage/
git commit -m "feat(collab): add team types and TeamStore trait"
```

---

## Task 3: PostgreSQL Team Implementation

**Files:**
- Create: `packages/ddalab-server/src/storage/teams.rs`
- Modify: `packages/ddalab-server/src/storage/mod.rs`

**Step 1: Implement PostgresTeamStore**

```rust
use async_trait::async_trait;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::storage::traits::{StorageError, StorageResult, TeamStore};
use crate::storage::types::{Team, TeamMember, TeamRole, TeamSummary};

pub struct PostgresTeamStore {
    pool: PgPool,
}

impl PostgresTeamStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl TeamStore for PostgresTeamStore {
    async fn create_team(&self, team: &Team) -> StorageResult<()> {
        sqlx::query(
            r#"
            INSERT INTO teams (id, institution_id, name, description, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
        )
        .bind(team.id)
        .bind(team.institution_id)
        .bind(&team.name)
        .bind(&team.description)
        .bind(team.created_by)
        .bind(team.created_at)
        .bind(team.updated_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn get_team(&self, team_id: Uuid) -> StorageResult<Team> {
        let row = sqlx::query(
            r#"
            SELECT id, institution_id, name, description, created_by, created_at, updated_at
            FROM teams WHERE id = $1
            "#,
        )
        .bind(team_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::NotFound(format!("Team {} not found", team_id)))?;

        Ok(Team {
            id: row.get("id"),
            institution_id: row.get("institution_id"),
            name: row.get("name"),
            description: row.get("description"),
            created_by: row.get("created_by"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }

    async fn update_team(&self, team_id: Uuid, name: &str, description: Option<&str>) -> StorageResult<()> {
        let result = sqlx::query(
            r#"UPDATE teams SET name = $2, description = $3 WHERE id = $1"#,
        )
        .bind(team_id)
        .bind(name)
        .bind(description)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::NotFound(format!("Team {} not found", team_id)));
        }

        Ok(())
    }

    async fn delete_team(&self, team_id: Uuid) -> StorageResult<()> {
        sqlx::query("DELETE FROM teams WHERE id = $1")
            .bind(team_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_institution_teams(&self, institution_id: Uuid) -> StorageResult<Vec<TeamSummary>> {
        let rows = sqlx::query(
            r#"
            SELECT t.id, t.name, t.description,
                   COUNT(DISTINCT tm.user_id) as member_count,
                   COUNT(DISTINCT sr.share_token) as share_count
            FROM teams t
            LEFT JOIN team_members tm ON tm.team_id = t.id
            LEFT JOIN shared_results sr ON sr.access_policy->>'team_id' = t.id::text
            WHERE t.institution_id = $1
            GROUP BY t.id
            ORDER BY t.name
            "#,
        )
        .bind(institution_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| TeamSummary {
                id: row.get("id"),
                name: row.get("name"),
                description: row.get("description"),
                member_count: row.get("member_count"),
                share_count: row.get("share_count"),
            })
            .collect())
    }

    async fn list_user_teams(&self, user_id: Uuid) -> StorageResult<Vec<TeamSummary>> {
        let rows = sqlx::query(
            r#"
            SELECT t.id, t.name, t.description,
                   COUNT(DISTINCT tm2.user_id) as member_count,
                   COUNT(DISTINCT sr.share_token) as share_count
            FROM teams t
            INNER JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = $1
            LEFT JOIN team_members tm2 ON tm2.team_id = t.id
            LEFT JOIN shared_results sr ON sr.access_policy->>'team_id' = t.id::text
            GROUP BY t.id
            ORDER BY t.name
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| TeamSummary {
                id: row.get("id"),
                name: row.get("name"),
                description: row.get("description"),
                member_count: row.get("member_count"),
                share_count: row.get("share_count"),
            })
            .collect())
    }

    async fn add_team_member(&self, member: &TeamMember) -> StorageResult<()> {
        let role_str = match member.role {
            TeamRole::Admin => "admin",
            TeamRole::Member => "member",
        };

        sqlx::query(
            r#"
            INSERT INTO team_members (team_id, user_id, role, added_at, added_by)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role
            "#,
        )
        .bind(member.team_id)
        .bind(member.user_id)
        .bind(role_str)
        .bind(member.added_at)
        .bind(member.added_by)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn remove_team_member(&self, team_id: Uuid, user_id: Uuid) -> StorageResult<()> {
        sqlx::query("DELETE FROM team_members WHERE team_id = $1 AND user_id = $2")
            .bind(team_id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn update_member_role(&self, team_id: Uuid, user_id: Uuid, role: TeamRole) -> StorageResult<()> {
        let role_str = match role {
            TeamRole::Admin => "admin",
            TeamRole::Member => "member",
        };

        let result = sqlx::query(
            "UPDATE team_members SET role = $3 WHERE team_id = $1 AND user_id = $2",
        )
        .bind(team_id)
        .bind(user_id)
        .bind(role_str)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::NotFound("Team member not found".to_string()));
        }

        Ok(())
    }

    async fn get_team_members(&self, team_id: Uuid) -> StorageResult<Vec<TeamMember>> {
        let rows = sqlx::query(
            r#"
            SELECT team_id, user_id, role, added_at, added_by
            FROM team_members WHERE team_id = $1
            ORDER BY added_at
            "#,
        )
        .bind(team_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let role_str: String = row.get("role");
                TeamMember {
                    team_id: row.get("team_id"),
                    user_id: row.get("user_id"),
                    role: if role_str == "admin" {
                        TeamRole::Admin
                    } else {
                        TeamRole::Member
                    },
                    added_at: row.get("added_at"),
                    added_by: row.get("added_by"),
                }
            })
            .collect())
    }

    async fn is_team_member(&self, team_id: Uuid, user_id: Uuid) -> StorageResult<bool> {
        let row = sqlx::query(
            "SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2",
        )
        .bind(team_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.is_some())
    }

    async fn is_team_admin(&self, team_id: Uuid, user_id: Uuid) -> StorageResult<bool> {
        let row = sqlx::query(
            "SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2 AND role = 'admin'",
        )
        .bind(team_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.is_some())
    }
}
```

**Step 2: Export in mod.rs**

```rust
mod teams;
pub use teams::PostgresTeamStore;
```

**Step 3: Run tests**

```bash
cd packages/ddalab-server && cargo test
```

**Step 4: Commit**

```bash
git add packages/ddalab-server/src/storage/
git commit -m "feat(collab): implement PostgresTeamStore"
```

---

## Task 4: Team API Handlers

**Files:**
- Create: `packages/ddalab-server/src/handlers/teams.rs`
- Modify: `packages/ddalab-server/src/handlers/mod.rs`

**Step 1: Create team handlers**

```rust
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::storage::{PostgresTeamStore, Team, TeamMember, TeamRole, TeamStore, TeamSummary};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateTeamRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTeamRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddMemberRequest {
    pub user_id: Uuid,
    pub role: Option<TeamRole>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMemberRoleRequest {
    pub role: TeamRole,
}

#[derive(Debug, Serialize)]
pub struct TeamResponse {
    pub team: Team,
    pub members: Vec<TeamMember>,
}

/// Create a new team
pub async fn create_team(
    State(state): State<AppState>,
    user_id: Uuid, // From auth middleware
    institution_id: Uuid,
    Json(req): Json<CreateTeamRequest>,
) -> Result<Json<Team>, (StatusCode, String)> {
    let team = Team {
        id: Uuid::new_v4(),
        institution_id,
        name: req.name,
        description: req.description,
        created_by: user_id,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };

    let store = PostgresTeamStore::new(state.pool.clone());
    store
        .create_team(&team)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Add creator as admin
    let member = TeamMember {
        team_id: team.id,
        user_id,
        role: TeamRole::Admin,
        added_at: chrono::Utc::now(),
        added_by: Some(user_id),
    };
    store
        .add_team_member(&member)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(team))
}

/// Get team details with members
pub async fn get_team(
    State(state): State<AppState>,
    Path(team_id): Path<Uuid>,
) -> Result<Json<TeamResponse>, (StatusCode, String)> {
    let store = PostgresTeamStore::new(state.pool.clone());

    let team = store
        .get_team(team_id)
        .await
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;

    let members = store
        .get_team_members(team_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(TeamResponse { team, members }))
}

/// List teams for institution
pub async fn list_institution_teams(
    State(state): State<AppState>,
    Path(institution_id): Path<Uuid>,
) -> Result<Json<Vec<TeamSummary>>, (StatusCode, String)> {
    let store = PostgresTeamStore::new(state.pool.clone());

    let teams = store
        .list_institution_teams(institution_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(teams))
}

/// List teams user belongs to
pub async fn list_my_teams(
    State(state): State<AppState>,
    user_id: Uuid,
) -> Result<Json<Vec<TeamSummary>>, (StatusCode, String)> {
    let store = PostgresTeamStore::new(state.pool.clone());

    let teams = store
        .list_user_teams(user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(teams))
}

/// Update team
pub async fn update_team(
    State(state): State<AppState>,
    Path(team_id): Path<Uuid>,
    user_id: Uuid,
    Json(req): Json<UpdateTeamRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let store = PostgresTeamStore::new(state.pool.clone());

    // Check if user is team admin
    if !store.is_team_admin(team_id, user_id).await.unwrap_or(false) {
        return Err((StatusCode::FORBIDDEN, "Not a team admin".to_string()));
    }

    store
        .update_team(team_id, &req.name, req.description.as_deref())
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::OK)
}

/// Delete team
pub async fn delete_team(
    State(state): State<AppState>,
    Path(team_id): Path<Uuid>,
    user_id: Uuid,
) -> Result<StatusCode, (StatusCode, String)> {
    let store = PostgresTeamStore::new(state.pool.clone());

    // Check if user is team admin
    if !store.is_team_admin(team_id, user_id).await.unwrap_or(false) {
        return Err((StatusCode::FORBIDDEN, "Not a team admin".to_string()));
    }

    store
        .delete_team(team_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Add member to team
pub async fn add_team_member(
    State(state): State<AppState>,
    Path(team_id): Path<Uuid>,
    user_id: Uuid,
    Json(req): Json<AddMemberRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let store = PostgresTeamStore::new(state.pool.clone());

    // Check if user is team admin
    if !store.is_team_admin(team_id, user_id).await.unwrap_or(false) {
        return Err((StatusCode::FORBIDDEN, "Not a team admin".to_string()));
    }

    let member = TeamMember {
        team_id,
        user_id: req.user_id,
        role: req.role.unwrap_or(TeamRole::Member),
        added_at: chrono::Utc::now(),
        added_by: Some(user_id),
    };

    store
        .add_team_member(&member)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::CREATED)
}

/// Remove member from team
pub async fn remove_team_member(
    State(state): State<AppState>,
    Path((team_id, member_id)): Path<(Uuid, Uuid)>,
    user_id: Uuid,
) -> Result<StatusCode, (StatusCode, String)> {
    let store = PostgresTeamStore::new(state.pool.clone());

    // Check if user is team admin or removing self
    let is_admin = store.is_team_admin(team_id, user_id).await.unwrap_or(false);
    if !is_admin && user_id != member_id {
        return Err((StatusCode::FORBIDDEN, "Not authorized".to_string()));
    }

    store
        .remove_team_member(team_id, member_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Update member role
pub async fn update_member_role(
    State(state): State<AppState>,
    Path((team_id, member_id)): Path<(Uuid, Uuid)>,
    user_id: Uuid,
    Json(req): Json<UpdateMemberRoleRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let store = PostgresTeamStore::new(state.pool.clone());

    // Check if user is team admin
    if !store.is_team_admin(team_id, user_id).await.unwrap_or(false) {
        return Err((StatusCode::FORBIDDEN, "Not a team admin".to_string()));
    }

    store
        .update_member_role(team_id, member_id, req.role)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::OK)
}
```

**Step 2: Export in mod.rs**

```rust
pub mod teams;
```

**Step 3: Commit**

```bash
git add packages/ddalab-server/src/handlers/
git commit -m "feat(collab): add team API handlers"
```

---

## Task 5: TypeScript Team Types

**Files:**
- Modify: `packages/ddalab-tauri/src/types/sync.ts`

**Step 1: Add team types**

```typescript
// Team types
export interface Team {
  id: string;
  institution_id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type TeamRole = "admin" | "member";

export interface TeamMember {
  team_id: string;
  user_id: string;
  role: TeamRole;
  added_at: string;
  added_by: string | null;
}

export interface TeamSummary {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  share_count: number;
}

export interface TeamWithMembers {
  team: Team;
  members: TeamMember[];
}
```

**Step 2: Commit**

```bash
git add packages/ddalab-tauri/src/types/sync.ts
git commit -m "feat(collab): add TypeScript team types"
```

---

## Task 6: Team Hooks

**Files:**
- Create: `packages/ddalab-tauri/src/hooks/useTeams.ts`

**Step 1: Create team hooks**

```typescript
/**
 * Hooks for team management
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Team, TeamMember, TeamRole, TeamSummary, TeamWithMembers } from "@/types/sync";

interface CreateTeamRequest {
  name: string;
  description?: string;
  institution_id: string;
}

interface AddMemberRequest {
  team_id: string;
  user_id: string;
  role?: TeamRole;
}

/**
 * Get teams for current user
 */
export function useMyTeams() {
  return useQuery({
    queryKey: ["teams", "my"],
    queryFn: async () => {
      return invoke<TeamSummary[]>("team_list_my_teams");
    },
  });
}

/**
 * Get teams for an institution
 */
export function useInstitutionTeams(institutionId: string) {
  return useQuery({
    queryKey: ["teams", "institution", institutionId],
    queryFn: async () => {
      return invoke<TeamSummary[]>("team_list_institution_teams", {
        institutionId,
      });
    },
    enabled: !!institutionId,
  });
}

/**
 * Get team details with members
 */
export function useTeam(teamId: string) {
  return useQuery({
    queryKey: ["teams", teamId],
    queryFn: async () => {
      return invoke<TeamWithMembers>("team_get", { teamId });
    },
    enabled: !!teamId,
  });
}

/**
 * Create a new team
 */
export function useCreateTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: CreateTeamRequest) => {
      return invoke<Team>("team_create", { request });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}

/**
 * Update a team
 */
export function useUpdateTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      teamId,
      name,
      description,
    }: {
      teamId: string;
      name: string;
      description?: string;
    }) => {
      await invoke("team_update", { teamId, name, description });
    },
    onSuccess: (_, { teamId }) => {
      queryClient.invalidateQueries({ queryKey: ["teams", teamId] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}

/**
 * Delete a team
 */
export function useDeleteTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (teamId: string) => {
      await invoke("team_delete", { teamId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}

/**
 * Add member to team
 */
export function useAddTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: AddMemberRequest) => {
      await invoke("team_add_member", { request });
    },
    onSuccess: (_, { team_id }) => {
      queryClient.invalidateQueries({ queryKey: ["teams", team_id] });
    },
  });
}

/**
 * Remove member from team
 */
export function useRemoveTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      teamId,
      userId,
    }: {
      teamId: string;
      userId: string;
    }) => {
      await invoke("team_remove_member", { teamId, userId });
    },
    onSuccess: (_, { teamId }) => {
      queryClient.invalidateQueries({ queryKey: ["teams", teamId] });
    },
  });
}

/**
 * Update member role
 */
export function useUpdateMemberRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      teamId,
      userId,
      role,
    }: {
      teamId: string;
      userId: string;
      role: TeamRole;
    }) => {
      await invoke("team_update_member_role", { teamId, userId, role });
    },
    onSuccess: (_, { teamId }) => {
      queryClient.invalidateQueries({ queryKey: ["teams", teamId] });
    },
  });
}
```

**Step 2: Commit**

```bash
git add packages/ddalab-tauri/src/hooks/useTeams.ts
git commit -m "feat(collab): add team management hooks"
```

---

## Task 7: TeamManagement Component

**Files:**
- Create: `packages/ddalab-tauri/src/components/collaboration/TeamManagement.tsx`

**Step 1: Create component**

```tsx
/**
 * TeamManagement - Create and manage teams within an institution
 */
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Settings, Trash2 } from "lucide-react";
import {
  useMyTeams,
  useCreateTeam,
  useDeleteTeam,
} from "@/hooks/useTeams";
import type { TeamSummary } from "@/types/sync";

interface TeamManagementProps {
  institutionId: string;
  onTeamSelect?: (teamId: string) => void;
}

export function TeamManagement({
  institutionId,
  onTeamSelect,
}: TeamManagementProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamDescription, setNewTeamDescription] = useState("");

  const { data: teams, isLoading } = useMyTeams();
  const { mutateAsync: createTeam, isPending: isCreating } = useCreateTeam();
  const { mutateAsync: deleteTeam } = useDeleteTeam();

  const handleCreateTeam = useCallback(async () => {
    if (!newTeamName.trim()) return;

    try {
      await createTeam({
        name: newTeamName.trim(),
        description: newTeamDescription.trim() || undefined,
        institution_id: institutionId,
      });
      setCreateDialogOpen(false);
      setNewTeamName("");
      setNewTeamDescription("");
    } catch (error) {
      console.error("Failed to create team:", error);
    }
  }, [createTeam, newTeamName, newTeamDescription, institutionId]);

  const handleDeleteTeam = useCallback(
    async (teamId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (confirm("Are you sure you want to delete this team?")) {
        await deleteTeam(teamId);
      }
    },
    [deleteTeam]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Teams</h2>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Create Team
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Team</DialogTitle>
              <DialogDescription>
                Create a team to share content with a group of colleagues.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="team-name">Team Name</Label>
                <Input
                  id="team-name"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="e.g., Neurology Lab"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="team-description">Description (optional)</Label>
                <Textarea
                  id="team-description"
                  value={newTeamDescription}
                  onChange={(e) => setNewTeamDescription(e.target.value)}
                  placeholder="What is this team for?"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateTeam}
                disabled={!newTeamName.trim() || isCreating}
              >
                {isCreating ? "Creating..." : "Create Team"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {teams?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              You're not a member of any teams yet.
            </p>
            <p className="text-sm text-muted-foreground">
              Create a team to start collaborating.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {teams?.map((team: TeamSummary) => (
            <Card
              key={team.id}
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => onTeamSelect?.(team.id)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      {team.name}
                    </CardTitle>
                    {team.description && (
                      <CardDescription className="mt-1">
                        {team.description}
                      </CardDescription>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTeamSelect?.(team.id);
                      }}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => handleDeleteTeam(team.id, e)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 text-sm text-muted-foreground">
                  <Badge variant="secondary">
                    {team.member_count} member{team.member_count !== 1 ? "s" : ""}
                  </Badge>
                  <Badge variant="outline">
                    {team.share_count} shared item{team.share_count !== 1 ? "s" : ""}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/ddalab-tauri/src/components/collaboration/TeamManagement.tsx
git commit -m "feat(collab): add TeamManagement component"
```

---

## Task 8: SharedWithMe Component

**Files:**
- Create: `packages/ddalab-tauri/src/components/collaboration/SharedWithMe.tsx`
- Create: `packages/ddalab-tauri/src/hooks/useSharedContent.ts`

**Step 1: Create useSharedContent hook**

```typescript
/**
 * Hooks for accessing shared content
 */
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { ShareMetadata, SharedResultInfo } from "@/types/sync";

interface SharedItem extends ShareMetadata {
  owner_name?: string;
}

/**
 * Get content shared with the current user
 */
export function useSharedWithMe() {
  return useQuery({
    queryKey: ["shares", "with-me"],
    queryFn: async () => {
      return invoke<SharedItem[]>("sync_list_shared_with_me");
    },
  });
}

/**
 * Get content the current user has shared
 */
export function useMyShares() {
  return useQuery({
    queryKey: ["shares", "my-shares"],
    queryFn: async () => {
      return invoke<ShareMetadata[]>("sync_list_my_shares");
    },
  });
}

/**
 * Access a specific share by token
 */
export function useAccessShare(token: string) {
  return useQuery({
    queryKey: ["shares", "access", token],
    queryFn: async () => {
      return invoke<SharedResultInfo>("sync_access_share", { token });
    },
    enabled: !!token,
  });
}
```

**Step 2: Create SharedWithMe component**

```tsx
/**
 * SharedWithMe - Display content shared with the current user
 */
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileBarChart,
  FileText,
  GitBranch,
  Settings2,
  Database,
  Download,
  Eye,
  Clock,
  Search,
  AlertTriangle,
} from "lucide-react";
import { useSharedWithMe } from "@/hooks/useSharedContent";
import { SHAREABLE_CONTENT_LABELS } from "@/types/sync";
import type { ShareableContentType, ShareMetadata } from "@/types/sync";
import { formatDistanceToNow, differenceInDays } from "date-fns";

const CONTENT_ICONS: Record<ShareableContentType, React.ElementType> = {
  dda_result: FileBarChart,
  annotation: FileText,
  workflow: GitBranch,
  parameter_set: Settings2,
  data_segment: Database,
};

interface SharedWithMeProps {
  onViewShare?: (share: ShareMetadata) => void;
  onDownloadShare?: (share: ShareMetadata) => void;
}

export function SharedWithMe({
  onViewShare,
  onDownloadShare,
}: SharedWithMeProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ShareableContentType | "all">(
    "all"
  );

  const { data: shares, isLoading } = useSharedWithMe();

  const filteredShares = shares?.filter((share) => {
    const matchesSearch =
      searchQuery === "" ||
      share.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      share.description?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesType =
      typeFilter === "all" || share.content_type === typeFilter;

    return matchesSearch && matchesType;
  });

  // Group by date
  const today = new Date();
  const groupedShares = {
    today: filteredShares?.filter(
      (s) => differenceInDays(today, new Date(s.created_at)) === 0
    ),
    thisWeek: filteredShares?.filter((s) => {
      const days = differenceInDays(today, new Date(s.created_at));
      return days > 0 && days <= 7;
    }),
    older: filteredShares?.filter(
      (s) => differenceInDays(today, new Date(s.created_at)) > 7
    ),
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const renderShareItem = (share: ShareMetadata & { owner_name?: string }) => {
    const Icon = CONTENT_ICONS[share.content_type];
    const expiresAt = new Date(share.access_policy.expires_at);
    const daysUntilExpiry = differenceInDays(expiresAt, today);
    const isExpiringSoon = daysUntilExpiry <= 7;

    return (
      <Card key={share.content_id} className="mb-2">
        <CardHeader className="py-3">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-muted rounded-md">
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm font-medium">
                  {share.title}
                </CardTitle>
                <CardDescription className="text-xs">
                  {SHAREABLE_CONTENT_LABELS[share.content_type]}
                  {share.owner_name && ` from @${share.owner_name}`}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {share.classification === "phi" && (
                <Badge variant="destructive" className="text-xs">
                  PHI
                </Badge>
              )}
              {isExpiringSoon && (
                <Badge variant="outline" className="text-xs text-amber-600">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {daysUntilExpiry} days
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(share.created_at), {
                addSuffix: true,
              })}
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onViewShare?.(share)}
              >
                <Eye className="h-4 w-4 mr-1" />
                View
              </Button>
              {share.access_policy.permissions.includes("download") &&
                share.classification !== "phi" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDownloadShare?.(share)}
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Download
                  </Button>
                )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Shared With Me</h2>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search shares..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          value={typeFilter}
          onValueChange={(v) =>
            setTypeFilter(v as ShareableContentType | "all")
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {Object.entries(SHAREABLE_CONTENT_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredShares?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <FileBarChart className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              No content has been shared with you yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groupedShares.today && groupedShares.today.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                Today
              </h3>
              {groupedShares.today.map(renderShareItem)}
            </div>
          )}

          {groupedShares.thisWeek && groupedShares.thisWeek.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                This Week
              </h3>
              {groupedShares.thisWeek.map(renderShareItem)}
            </div>
          )}

          {groupedShares.older && groupedShares.older.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                Older
              </h3>
              {groupedShares.older.map(renderShareItem)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/hooks/useSharedContent.ts packages/ddalab-tauri/src/components/collaboration/SharedWithMe.tsx
git commit -m "feat(collab): add SharedWithMe component and hooks"
```

---

## Task 9: MyShares Component

**Files:**
- Create: `packages/ddalab-tauri/src/components/collaboration/MyShares.tsx`

**Step 1: Create component**

```tsx
/**
 * MyShares - Display content the current user has shared
 */
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  FileBarChart,
  FileText,
  GitBranch,
  Settings2,
  Database,
  Link2,
  Trash2,
  Clock,
  Search,
  Users,
  Eye,
} from "lucide-react";
import { useMyShares } from "@/hooks/useSharedContent";
import { SHAREABLE_CONTENT_LABELS } from "@/types/sync";
import type { ShareableContentType, ShareMetadata } from "@/types/sync";
import { formatDistanceToNow, format } from "date-fns";
import { invoke } from "@tauri-apps/api/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";

const CONTENT_ICONS: Record<ShareableContentType, React.ElementType> = {
  dda_result: FileBarChart,
  annotation: FileText,
  workflow: GitBranch,
  parameter_set: Settings2,
  data_segment: Database,
};

export function MyShares() {
  const [searchQuery, setSearchQuery] = useState("");
  const queryClient = useQueryClient();

  const { data: shares, isLoading } = useMyShares();

  const { mutateAsync: revokeShare } = useMutation({
    mutationFn: async (token: string) => {
      await invoke("sync_revoke_share", { token });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shares"] });
    },
  });

  const filteredShares = shares?.filter((share) => {
    return (
      searchQuery === "" ||
      share.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      share.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const copyShareLink = async (contentId: string) => {
    const link = `ddalab://share/${contentId}`;
    await navigator.clipboard.writeText(link);
  };

  const handleRevoke = async (contentId: string) => {
    await revokeShare(contentId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const renderShareItem = (share: ShareMetadata) => {
    const Icon = CONTENT_ICONS[share.content_type];
    const expiresAt = new Date(share.access_policy.expires_at);

    return (
      <Card key={share.content_id} className="mb-2">
        <CardHeader className="py-3">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-muted rounded-md">
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm font-medium">
                  {share.title}
                </CardTitle>
                <CardDescription className="text-xs">
                  {SHAREABLE_CONTENT_LABELS[share.content_type]}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {share.access_policy.type === "public"
                  ? "Anyone"
                  : share.access_policy.type === "team"
                    ? "Team"
                    : share.access_policy.type === "users"
                      ? "Specific users"
                      : "Institution"}
              </Badge>
              {share.classification !== "unclassified" && (
                <Badge
                  variant={
                    share.classification === "phi" ? "destructive" : "secondary"
                  }
                  className="text-xs"
                >
                  {share.classification.toUpperCase()}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Expires {format(expiresAt, "MMM d, yyyy")}
              </div>
              <div className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {share.download_count} view{share.download_count !== 1 ? "s" : ""}
              </div>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyShareLink(share.content_id)}
              >
                <Link2 className="h-4 w-4 mr-1" />
                Copy Link
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Revoke Share</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to revoke this share? Anyone with
                      the link will no longer be able to access this content.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleRevoke(share.content_id)}
                    >
                      Revoke
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">My Shares</h2>
        <Badge variant="secondary">
          {shares?.length || 0} active share{shares?.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search your shares..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8"
        />
      </div>

      {filteredShares?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              You haven't shared anything yet.
            </p>
            <p className="text-sm text-muted-foreground">
              Share DDA results, annotations, or workflows with your team.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredShares?.map(renderShareItem)}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/ddalab-tauri/src/components/collaboration/MyShares.tsx
git commit -m "feat(collab): add MyShares component"
```

---

## Task 10: Export Collaboration Components

**Files:**
- Create: `packages/ddalab-tauri/src/components/collaboration/index.ts`

**Step 1: Create index file**

```typescript
export { UnifiedShareDialog } from "./UnifiedShareDialog";
export { TeamManagement } from "./TeamManagement";
export { SharedWithMe } from "./SharedWithMe";
export { MyShares } from "./MyShares";
```

**Step 2: Run typecheck**

```bash
cd packages/ddalab-tauri && bun run typecheck
```

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/components/collaboration/
git commit -m "feat(collab): export collaboration components"
```

---

## Task 11: Integration Verification

**Step 1: Run all tests**

```bash
cd packages/ddalab-server && cargo test
cd packages/ddalab-tauri/src-tauri && cargo check
cd packages/ddalab-tauri && bun run typecheck
```

**Step 2: Final commit**

```bash
git add .
git commit -m "feat(collab): complete Phase 3 team collaboration"
```

---

## Summary

Phase 3 adds:
- **Database**: `teams` and `team_members` tables with roles
- **Backend**: TeamStore trait and PostgresTeamStore implementation
- **API**: Team CRUD handlers with admin authorization
- **Frontend**: Team management UI, shared content browsing, share management
- **Hooks**: useTeams, useSharedContent for data fetching
