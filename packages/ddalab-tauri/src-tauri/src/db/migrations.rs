//! Database migration system for DDALAB
//!
//! This module provides a versioned migration system for SQLite databases.
//! Migrations are run in order and tracked in a schema_migrations table.
//!
//! # Adding a new migration
//!
//! 1. Create a new struct implementing the `Migration` trait
//! 2. Add it to the `ALL_MIGRATIONS` array in order
//! 3. Migrations are run automatically on database initialization

use anyhow::{Context, Result};
use rusqlite::Connection;

/// A database migration that can be applied
pub trait Migration: Send + Sync {
    /// Unique version identifier (use format: YYYYMMDDHHMMSS)
    fn version(&self) -> &'static str;

    /// Human-readable description of what this migration does
    fn description(&self) -> &'static str;

    /// Apply the migration to the database
    fn up(&self, conn: &Connection) -> Result<()>;

    /// Optionally reverse the migration (for rollbacks)
    fn down(&self, _conn: &Connection) -> Result<()> {
        Ok(()) // Default: no-op (migration cannot be reversed)
    }
}

/// Registry of all migrations in order
pub static ALL_MIGRATIONS: &[&dyn Migration] =
    &[&MigrateLegacyDDAParameters, &AddMsgpackBlobColumn];

/// Migration runner that tracks and applies migrations
pub struct MigrationRunner<'a> {
    conn: &'a Connection,
}

impl<'a> MigrationRunner<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Initialize the schema_migrations table if it doesn't exist
    fn ensure_migrations_table(&self) -> Result<()> {
        self.conn
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS schema_migrations (
                    version TEXT PRIMARY KEY,
                    description TEXT NOT NULL,
                    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
                );",
            )
            .context("Failed to create schema_migrations table")?;
        Ok(())
    }

    /// Check if a migration has been applied
    fn is_applied(&self, version: &str) -> Result<bool> {
        let count: i32 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
                [version],
                |row| row.get(0),
            )
            .unwrap_or(0);
        Ok(count > 0)
    }

    /// Mark a migration as applied
    fn mark_applied(&self, migration: &dyn Migration) -> Result<()> {
        self.conn
            .execute(
                "INSERT INTO schema_migrations (version, description) VALUES (?1, ?2)",
                [migration.version(), migration.description()],
            )
            .context("Failed to mark migration as applied")?;
        Ok(())
    }

    /// Run all pending migrations
    pub fn run_pending(&self) -> Result<MigrationReport> {
        self.ensure_migrations_table()?;

        let mut report = MigrationReport::default();

        for migration in ALL_MIGRATIONS {
            if self.is_applied(migration.version())? {
                report.skipped += 1;
                continue;
            }

            log::info!(
                "🔄 Running migration {}: {}",
                migration.version(),
                migration.description()
            );

            migration.up(self.conn)?;
            self.mark_applied(*migration)?;
            report.applied += 1;

            log::info!("Migration {} applied successfully", migration.version());
        }

        Ok(report)
    }

    /// Get list of applied migrations
    pub fn get_applied(&self) -> Result<Vec<AppliedMigration>> {
        self.ensure_migrations_table()?;

        let mut stmt = self.conn.prepare(
            "SELECT version, description, applied_at FROM schema_migrations ORDER BY version",
        )?;

        let migrations = stmt
            .query_map([], |row| {
                Ok(AppliedMigration {
                    version: row.get(0)?,
                    description: row.get(1)?,
                    applied_at: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to get applied migrations")?;

        Ok(migrations)
    }
}

/// Report of migration run results
#[derive(Debug, Default)]
pub struct MigrationReport {
    pub applied: usize,
    pub skipped: usize,
}

/// Information about an applied migration
#[derive(Debug)]
pub struct AppliedMigration {
    pub version: String,
    pub description: String,
    pub applied_at: String,
}

// ============================================================================
// MIGRATIONS
// ============================================================================

/// Migration: Convert legacy DDA parameters (scale_min/scale_max) to new format (delay_list)
///
/// Old format stored in parameters JSON:
///   { "scale_min": 1.0, "scale_max": 20.0, ... }
///
/// New format:
///   { "delay_list": [1, 2, 3, ..., 20], ... }
pub struct MigrateLegacyDDAParameters;

impl Migration for MigrateLegacyDDAParameters {
    fn version(&self) -> &'static str {
        "20241204000001"
    }

    fn description(&self) -> &'static str {
        "Convert legacy scale_min/scale_max to delay_list in DDA parameters"
    }

    fn up(&self, conn: &Connection) -> Result<()> {
        // Find all analyses with legacy format (have scale_min but no delay_list)
        let mut stmt = conn.prepare(
            "SELECT id, parameters FROM analyses
             WHERE json_extract(parameters, '$.scale_min') IS NOT NULL
               AND json_extract(parameters, '$.delay_list') IS NULL",
        )?;

        let legacy_analyses: Vec<(String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to query legacy analyses")?;

        let count = legacy_analyses.len();
        log::info!("Found {} analyses with legacy parameters to migrate", count);

        for (id, params_json) in legacy_analyses {
            let migrated = migrate_parameters_json(&params_json)?;

            conn.execute(
                "UPDATE analyses SET parameters = ?1 WHERE id = ?2",
                [&migrated, &id],
            )
            .context(format!("Failed to update analysis {}", id))?;

            log::debug!("Migrated analysis {}", id);
        }

        log::info!("Successfully migrated {} analyses", count);

        Ok(())
    }
}

/// Convert legacy parameters JSON to new format
fn migrate_parameters_json(params_json: &str) -> Result<String> {
    let mut params: serde_json::Value =
        serde_json::from_str(params_json).context("Failed to parse parameters JSON")?;

    if let Some(obj) = params.as_object_mut() {
        // Extract scale_min and scale_max
        let scale_min = obj.get("scale_min").and_then(|v| v.as_f64()).unwrap_or(1.0);
        let scale_max = obj
            .get("scale_max")
            .and_then(|v| v.as_f64())
            .unwrap_or(20.0);

        // Generate delay_list from range
        let start = scale_min.round() as i32;
        let end = scale_max.round() as i32;
        let delay_list: Vec<i32> = (start..=end).collect();

        // Add delay_list and remove legacy fields
        obj.insert("delay_list".to_string(), serde_json::to_value(&delay_list)?);
        obj.remove("scale_min");
        obj.remove("scale_max");
    }

    serde_json::to_string(&params).context("Failed to serialize migrated parameters")
}

/// Migration: Add msgpack_lz4 BLOB column for pre-serialized DDA results
///
/// Stores LZ4-compressed MessagePack binary directly in SQLite, avoiding:
/// - JSON parsing (~1 second for 47MB)
/// - MessagePack serialization (~400ms)
/// - LZ4 compression (~600ms)
///
/// On read, we just return the blob directly - instant access.
pub struct AddMsgpackBlobColumn;

impl Migration for AddMsgpackBlobColumn {
    fn version(&self) -> &'static str {
        "20260130000001"
    }

    fn description(&self) -> &'static str {
        "Add msgpack_lz4 BLOB column for pre-serialized DDA results"
    }

    fn up(&self, conn: &Connection) -> Result<()> {
        conn.execute("ALTER TABLE analyses ADD COLUMN msgpack_lz4 BLOB", [])
            .context("Failed to add msgpack_lz4 column")?;

        log::info!("Added msgpack_lz4 column for fast DDA result loading");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrate_parameters_json() {
        let legacy = r#"{"scale_min":1.0,"scale_max":5.0,"variants":["single_timeseries"],"window_length":125,"window_step":10,"selected_channels":["Ch1"]}"#;

        let migrated = migrate_parameters_json(legacy).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&migrated).unwrap();

        assert!(parsed.get("delay_list").is_some());
        assert!(parsed.get("scale_min").is_none());
        assert!(parsed.get("scale_max").is_none());

        let delay_list = parsed["delay_list"].as_array().unwrap();
        assert_eq!(delay_list.len(), 5);
        assert_eq!(delay_list[0], 1);
        assert_eq!(delay_list[4], 5);
    }

    #[test]
    fn test_migrate_parameters_defaults() {
        // Missing scale_min/scale_max should use defaults
        let legacy = r#"{"variants":["single_timeseries"],"window_length":125}"#;

        let migrated = migrate_parameters_json(legacy).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&migrated).unwrap();

        let delay_list = parsed["delay_list"].as_array().unwrap();
        assert_eq!(delay_list.len(), 20); // Default: 1..=20
    }
}
