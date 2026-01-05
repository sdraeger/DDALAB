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
        .ok_or_else(|| StorageError::TeamNotFound(team_id))?;

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
            return Err(StorageError::TeamNotFound(team_id));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_team_role_default() {
        assert_eq!(TeamRole::default(), TeamRole::Member);
    }
}
