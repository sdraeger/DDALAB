use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisGroup {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub source: String,
    pub member_count: usize,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisGroupWithMembers {
    pub group: AnalysisGroup,
    pub member_ids: Vec<String>,
}

pub struct AnalysisGroupsDB<'a> {
    conn: &'a Connection,
}

impl<'a> AnalysisGroupsDB<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn create_group(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
        source: &str,
        member_ids: &[String],
    ) -> Result<AnalysisGroup> {
        let now = chrono::Utc::now().to_rfc3339();

        self.conn
            .execute(
                "INSERT INTO analysis_groups (id, name, description, source, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![id, name, description, source, now],
            )
            .context("Failed to create analysis group")?;

        for (i, member_id) in member_ids.iter().enumerate() {
            self.conn
                .execute(
                    "INSERT OR IGNORE INTO analysis_group_members (group_id, analysis_id, sort_order)
                     VALUES (?1, ?2, ?3)",
                    params![id, member_id, i as i32],
                )
                .context("Failed to add group member")?;
        }

        Ok(AnalysisGroup {
            id: id.to_string(),
            name: name.to_string(),
            description: description.map(|s| s.to_string()),
            source: source.to_string(),
            member_count: member_ids.len(),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn get_group(&self, id: &str) -> Result<Option<AnalysisGroupWithMembers>> {
        let group: Option<AnalysisGroup> = self
            .conn
            .query_row(
                "SELECT g.id, g.name, g.description, g.source, g.created_at, g.updated_at,
                        (SELECT COUNT(*) FROM analysis_group_members WHERE group_id = g.id)
                 FROM analysis_groups g WHERE g.id = ?1",
                params![id],
                |row| {
                    Ok(AnalysisGroup {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        description: row.get(2)?,
                        source: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                        member_count: row.get::<_, i64>(6)? as usize,
                    })
                },
            )
            .optional()
            .context("Failed to get analysis group")?;

        let group = match group {
            Some(g) => g,
            None => return Ok(None),
        };

        let mut stmt = self.conn.prepare(
            "SELECT analysis_id FROM analysis_group_members
             WHERE group_id = ?1 ORDER BY sort_order",
        )?;

        let member_ids: Vec<String> = stmt
            .query_map(params![id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to get group members")?;

        Ok(Some(AnalysisGroupWithMembers { group, member_ids }))
    }

    pub fn list_groups(&self, limit: usize) -> Result<Vec<AnalysisGroup>> {
        let mut stmt = self.conn.prepare(
            "SELECT g.id, g.name, g.description, g.source, g.created_at, g.updated_at,
                    (SELECT COUNT(*) FROM analysis_group_members WHERE group_id = g.id)
             FROM analysis_groups g
             ORDER BY g.created_at DESC
             LIMIT ?1",
        )?;

        let groups = stmt
            .query_map(params![limit], |row| {
                Ok(AnalysisGroup {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    source: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    member_count: row.get::<_, i64>(6)? as usize,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to list analysis groups")?;

        Ok(groups)
    }

    pub fn update_group(
        &self,
        id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<bool> {
        let now = chrono::Utc::now().to_rfc3339();

        if let Some(new_name) = name {
            self.conn
                .execute(
                    "UPDATE analysis_groups SET name = ?1, updated_at = ?2 WHERE id = ?3",
                    params![new_name, now, id],
                )
                .context("Failed to update group name")?;
        }

        if let Some(new_desc) = description {
            self.conn
                .execute(
                    "UPDATE analysis_groups SET description = ?1, updated_at = ?2 WHERE id = ?3",
                    params![new_desc, now, id],
                )
                .context("Failed to update group description")?;
        }

        Ok(true)
    }

    pub fn add_members(&self, group_id: &str, analysis_ids: &[String]) -> Result<()> {
        let max_order: i32 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) FROM analysis_group_members WHERE group_id = ?1",
                params![group_id],
                |row| row.get(0),
            )
            .unwrap_or(-1);

        for (i, analysis_id) in analysis_ids.iter().enumerate() {
            self.conn
                .execute(
                    "INSERT OR IGNORE INTO analysis_group_members (group_id, analysis_id, sort_order)
                     VALUES (?1, ?2, ?3)",
                    params![group_id, analysis_id, max_order + 1 + i as i32],
                )
                .context("Failed to add group member")?;
        }

        let now = chrono::Utc::now().to_rfc3339();
        self.conn
            .execute(
                "UPDATE analysis_groups SET updated_at = ?1 WHERE id = ?2",
                params![now, group_id],
            )
            .context("Failed to update group timestamp")?;

        Ok(())
    }

    pub fn remove_members(&self, group_id: &str, analysis_ids: &[String]) -> Result<()> {
        for analysis_id in analysis_ids {
            self.conn
                .execute(
                    "DELETE FROM analysis_group_members WHERE group_id = ?1 AND analysis_id = ?2",
                    params![group_id, analysis_id],
                )
                .context("Failed to remove group member")?;
        }

        let now = chrono::Utc::now().to_rfc3339();
        self.conn
            .execute(
                "UPDATE analysis_groups SET updated_at = ?1 WHERE id = ?2",
                params![now, group_id],
            )
            .context("Failed to update group timestamp")?;

        Ok(())
    }

    pub fn delete_group(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM analysis_groups WHERE id = ?1", params![id])
            .context("Failed to delete analysis group")?;
        Ok(())
    }
}
