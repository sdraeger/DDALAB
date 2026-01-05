use async_trait::async_trait;
use chrono::Utc;
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

    async fn get_invite(&self, invite_id: Uuid) -> StorageResult<FederationInvite> {
        let row = sqlx::query(
            r#"
            SELECT id, from_institution_id, to_institution_id, to_institution_name,
                   invite_token, created_by, created_at, expires_at, accepted_at, revoked_at
            FROM federation_invites WHERE id = $1
            "#,
        )
        .bind(invite_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::InviteNotFound(invite_id))?;

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
        .ok_or_else(|| StorageError::NotFound("Invite not found".to_string()))?;

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
        invite_id: Uuid,
        accepting_institution_id: Uuid,
        accepting_user_id: Uuid,
    ) -> StorageResult<FederationTrust> {
        // Get the invite first
        let invite_row = sqlx::query(
            r#"
            SELECT id, from_institution_id, expires_at, accepted_at, revoked_at
            FROM federation_invites WHERE id = $1
            "#,
        )
        .bind(invite_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::InviteNotFound(invite_id))?;

        let accepted_at: Option<chrono::DateTime<Utc>> = invite_row.get("accepted_at");
        let revoked_at: Option<chrono::DateTime<Utc>> = invite_row.get("revoked_at");
        let expires_at: chrono::DateTime<Utc> = invite_row.get("expires_at");
        let from_institution_id: Uuid = invite_row.get("from_institution_id");

        // Validate invite is still valid
        if accepted_at.is_some() || revoked_at.is_some() || expires_at < Utc::now() {
            return Err(StorageError::InviteExpired);
        }

        // Mark invite as accepted
        sqlx::query("UPDATE federation_invites SET accepted_at = $2, to_institution_id = $3 WHERE id = $1")
            .bind(invite_id)
            .bind(Utc::now())
            .bind(accepting_institution_id)
            .execute(&self.pool)
            .await?;

        // Create bilateral trust (order institutions for unique constraint)
        let (inst_a, inst_b) = if from_institution_id < accepting_institution_id {
            (from_institution_id, accepting_institution_id)
        } else {
            (accepting_institution_id, from_institution_id)
        };

        let trust_id = Uuid::new_v4();
        let now = Utc::now();

        sqlx::query(
            r#"
            INSERT INTO federation_trusts
                (id, institution_a, institution_b, trust_level, established_at, established_by)
            VALUES ($1, $2, $3, 'full', $4, $5)
            ON CONFLICT (institution_a, institution_b) DO UPDATE
            SET trust_level = 'full', revoked_at = NULL, revoked_by = NULL
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
        let result = sqlx::query(
            "UPDATE federation_invites SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL",
        )
        .bind(invite_id)
        .bind(Utc::now())
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::InviteNotFound(invite_id));
        }

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

    async fn get_trust(&self, trust_id: Uuid) -> StorageResult<FederationTrust> {
        let row = sqlx::query(
            r#"
            SELECT id, institution_a, institution_b, trust_level,
                   established_at, established_by, revoked_at, revoked_by
            FROM federation_trusts WHERE id = $1
            "#,
        )
        .bind(trust_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::TrustNotFound(trust_id))?;

        let trust_level_str: String = row.get("trust_level");

        Ok(FederationTrust {
            id: row.get("id"),
            institution_a: row.get("institution_a"),
            institution_b: row.get("institution_b"),
            trust_level: parse_trust_level(&trust_level_str),
            established_at: row.get("established_at"),
            established_by: row.get("established_by"),
            revoked_at: row.get("revoked_at"),
            revoked_by: row.get("revoked_by"),
        })
    }

    async fn list_trusts(&self, institution_id: Uuid) -> StorageResult<Vec<FederationTrust>> {
        let rows = sqlx::query(
            r#"
            SELECT id, institution_a, institution_b, trust_level,
                   established_at, established_by, revoked_at, revoked_by
            FROM federation_trusts
            WHERE (institution_a = $1 OR institution_b = $1) AND revoked_at IS NULL
            ORDER BY established_at DESC
            "#,
        )
        .bind(institution_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let trust_level_str: String = row.get("trust_level");
                FederationTrust {
                    id: row.get("id"),
                    institution_a: row.get("institution_a"),
                    institution_b: row.get("institution_b"),
                    trust_level: parse_trust_level(&trust_level_str),
                    established_at: row.get("established_at"),
                    established_by: row.get("established_by"),
                    revoked_at: row.get("revoked_at"),
                    revoked_by: row.get("revoked_by"),
                }
            })
            .collect())
    }

    async fn update_trust_level(
        &self,
        trust_id: Uuid,
        trust_level: TrustLevel,
    ) -> StorageResult<()> {
        let result = sqlx::query(
            "UPDATE federation_trusts SET trust_level = $2 WHERE id = $1",
        )
        .bind(trust_id)
        .bind(trust_level_to_str(trust_level))
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::TrustNotFound(trust_id));
        }

        Ok(())
    }

    async fn revoke_trust(&self, trust_id: Uuid, revoked_by: Uuid) -> StorageResult<()> {
        let result = sqlx::query(
            r#"
            UPDATE federation_trusts
            SET trust_level = 'revoked', revoked_at = $2, revoked_by = $3
            WHERE id = $1 AND revoked_at IS NULL
            "#,
        )
        .bind(trust_id)
        .bind(Utc::now())
        .bind(revoked_by)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::TrustNotFound(trust_id));
        }

        Ok(())
    }

    async fn are_federated(
        &self,
        institution_a: Uuid,
        institution_b: Uuid,
    ) -> StorageResult<Option<FederationTrust>> {
        // Order institutions for query
        let (inst_a, inst_b) = if institution_a < institution_b {
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
              AND revoked_at IS NULL
              AND trust_level != 'revoked'
            "#,
        )
        .bind(inst_a)
        .bind(inst_b)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| {
            let trust_level_str: String = row.get("trust_level");
            FederationTrust {
                id: row.get("id"),
                institution_a: row.get("institution_a"),
                institution_b: row.get("institution_b"),
                trust_level: parse_trust_level(&trust_level_str),
                established_at: row.get("established_at"),
                established_by: row.get("established_by"),
                revoked_at: row.get("revoked_at"),
                revoked_by: row.get("revoked_by"),
            }
        }))
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
                COALESCE(share_counts.count, 0) as share_count
            FROM federation_trusts ft
            JOIN institutions i ON i.id = CASE
                WHEN ft.institution_a = $1 THEN ft.institution_b
                ELSE ft.institution_a
            END
            LEFT JOIN (
                SELECT
                    sr.owner_institution_id,
                    COUNT(*) as count
                FROM shared_results sr
                WHERE sr.access_policy->>'type' = 'institution'
                GROUP BY sr.owner_institution_id
            ) share_counts ON share_counts.owner_institution_id = CASE
                WHEN ft.institution_a = $1 THEN ft.institution_b
                ELSE ft.institution_a
            END
            WHERE (ft.institution_a = $1 OR ft.institution_b = $1)
              AND ft.revoked_at IS NULL
              AND ft.trust_level != 'revoked'
            ORDER BY i.name
            "#,
        )
        .bind(institution_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let trust_level_str: String = row.get("trust_level");
                FederatedInstitutionSummary {
                    institution_id: row.get("other_institution_id"),
                    institution_name: row.get("institution_name"),
                    trust_level: parse_trust_level(&trust_level_str),
                    established_at: row.get("established_at"),
                    share_count: row.get("share_count"),
                }
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trust_level_parsing() {
        assert_eq!(parse_trust_level("full"), TrustLevel::Full);
        assert_eq!(parse_trust_level("read_only"), TrustLevel::ReadOnly);
        assert_eq!(parse_trust_level("revoked"), TrustLevel::Revoked);
        assert_eq!(parse_trust_level("unknown"), TrustLevel::Full);
    }

    #[test]
    fn test_trust_level_to_str() {
        assert_eq!(trust_level_to_str(TrustLevel::Full), "full");
        assert_eq!(trust_level_to_str(TrustLevel::ReadOnly), "read_only");
        assert_eq!(trust_level_to_str(TrustLevel::Revoked), "revoked");
    }
}
