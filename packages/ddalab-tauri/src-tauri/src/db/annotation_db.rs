use anyhow::{Context, Result};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Annotation {
    pub id: String,
    pub position: f64,
    pub label: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub visible_in_plots: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileAnnotations {
    #[serde(default)]
    pub global_annotations: Vec<Annotation>,
    #[serde(default)]
    pub channel_annotations: HashMap<String, Vec<Annotation>>,
}

pub struct AnnotationDatabase {
    conn: Mutex<Connection>,
}

impl AnnotationDatabase {
    pub fn new<P: AsRef<Path>>(db_path: P) -> Result<Self> {
        let conn = Connection::open(db_path).context("Failed to open annotation database")?;

        // Enable WAL mode for better concurrency
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -64000;",
        )
        .context("Failed to set SQLite pragmas")?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.create_tables()?;
        Ok(db)
    }

    fn create_tables(&self) -> Result<()> {
        self.conn
            .lock()
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS annotations (
                    id TEXT PRIMARY KEY,
                    file_path TEXT NOT NULL,
                    channel TEXT,
                    position REAL NOT NULL,
                    label TEXT NOT NULL,
                    color TEXT,
                    description TEXT,
                    visible_in_plots TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_annotations_file_path ON annotations(file_path);
                CREATE INDEX IF NOT EXISTS idx_annotations_channel ON annotations(file_path, channel);
                CREATE INDEX IF NOT EXISTS idx_annotations_position ON annotations(file_path, position);",
            )
            .context("Failed to create annotations table")?;

        // Migrate existing tables to add new columns if they don't exist
        self.migrate_schema()?;

        Ok(())
    }

    fn migrate_schema(&self) -> Result<()> {
        let conn = self.conn.lock();

        // Check if visible_in_plots column exists
        let visible_in_plots_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('annotations') WHERE name='visible_in_plots'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0) > 0;

        if !visible_in_plots_exists {
            conn.execute(
                "ALTER TABLE annotations ADD COLUMN visible_in_plots TEXT",
                [],
            )
            .context("Failed to add visible_in_plots column")?;
        }

        // Check if file_hash column exists
        let file_hash_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('annotations') WHERE name='file_hash'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0)
            > 0;

        if !file_hash_exists {
            log::info!("Adding file_hash column to annotations table");
            conn.execute("ALTER TABLE annotations ADD COLUMN file_hash TEXT", [])
                .context("Failed to add file_hash column")?;

            // Create index on file_hash for fast lookups
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_annotations_file_hash ON annotations(file_hash)",
                [],
            )
            .context("Failed to create file_hash index")?;

            log::info!("file_hash column and index added successfully");
        }

        Ok(())
    }

    pub fn save_annotation(
        &self,
        file_path: &str,
        channel: Option<&str>,
        annotation: &Annotation,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let visible_in_plots_json = serde_json::to_string(&annotation.visible_in_plots)
            .context("Failed to serialize visible_in_plots")?;

        // Compute file hash if file exists
        let file_hash = if std::path::Path::new(file_path).exists() {
            match crate::utils::file_hash::compute_file_hash(file_path) {
                Ok(hash) => {
                    log::debug!("Computed file hash for annotation: {}", hash);
                    Some(hash)
                }
                Err(e) => {
                    log::warn!("Failed to compute file hash for {}: {}", file_path, e);
                    None
                }
            }
        } else {
            None
        };

        self.conn.lock().execute(
            "INSERT OR REPLACE INTO annotations
             (id, file_path, channel, position, label, color, description, visible_in_plots, file_hash, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                     COALESCE((SELECT created_at FROM annotations WHERE id = ?1), ?10), ?10)",
            params![
                annotation.id,
                file_path,
                channel,
                annotation.position,
                annotation.label,
                annotation.color,
                annotation.description,
                visible_in_plots_json,
                file_hash,
                now,
            ],
        )
        .context("Failed to save annotation")?;

        Ok(())
    }

    /// Get annotations by file hash (content-based lookup)
    pub fn get_annotations_by_hash(&self, file_hash: &str) -> Result<FileAnnotations> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, channel, position, label, color, description, visible_in_plots
             FROM annotations
             WHERE file_hash = ?1
             ORDER BY position",
        )?;

        let mut global_annotations = Vec::new();
        let mut channel_annotations: HashMap<String, Vec<Annotation>> = HashMap::new();

        let rows = stmt.query_map(params![file_hash], |row| {
            let channel: Option<String> = row.get(1)?;
            let visible_in_plots_json: Option<String> = row.get(6)?;
            let visible_in_plots = visible_in_plots_json
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_else(Vec::new);

            let annotation = Annotation {
                id: row.get(0)?,
                position: row.get(2)?,
                label: row.get(3)?,
                color: row.get(4)?,
                description: row.get(5)?,
                visible_in_plots,
            };
            Ok((channel, annotation))
        })?;

        for row in rows {
            let (channel, annotation) = row?;
            if let Some(ch) = channel {
                channel_annotations
                    .entry(ch)
                    .or_insert_with(Vec::new)
                    .push(annotation);
            } else {
                global_annotations.push(annotation);
            }
        }

        Ok(FileAnnotations {
            global_annotations,
            channel_annotations,
        })
    }

    /// Get annotations with dual lookup: hash-based (preferred) with path fallback
    /// This enables cross-machine compatibility while maintaining backward compatibility
    pub fn get_file_annotations(&self, file_path: &str) -> Result<FileAnnotations> {
        // Try hash-based lookup first if file exists
        if std::path::Path::new(file_path).exists() {
            if let Ok(hash) = crate::utils::file_hash::compute_file_hash(file_path) {
                match self.get_annotations_by_hash(&hash) {
                    Ok(annotations)
                        if !annotations.global_annotations.is_empty()
                            || !annotations.channel_annotations.is_empty() =>
                    {
                        log::debug!(
                            "Found annotations by hash for: {} (hash: {})",
                            file_path,
                            &hash[..16]
                        );
                        return Ok(annotations);
                    }
                    _ => {
                        log::debug!(
                            "No annotations found by hash for: {} (hash: {}), trying path lookup",
                            file_path,
                            &hash[..16]
                        );
                    }
                }
            }
        }

        // Fallback to path-based lookup (for backward compatibility or if hash lookup failed)
        log::debug!("Using path-based annotation lookup for: {}", file_path);
        self.get_annotations_by_path(file_path)
    }

    /// Get annotations by file path (legacy method for backward compatibility)
    fn get_annotations_by_path(&self, file_path: &str) -> Result<FileAnnotations> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, channel, position, label, color, description, visible_in_plots
             FROM annotations
             WHERE file_path = ?1
             ORDER BY position",
        )?;

        let mut global_annotations = Vec::new();
        let mut channel_annotations: HashMap<String, Vec<Annotation>> = HashMap::new();

        let rows = stmt.query_map(params![file_path], |row| {
            let channel: Option<String> = row.get(1)?;
            let visible_in_plots_json: Option<String> = row.get(6)?;
            let visible_in_plots = visible_in_plots_json
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_else(Vec::new);

            let annotation = Annotation {
                id: row.get(0)?,
                position: row.get(2)?,
                label: row.get(3)?,
                color: row.get(4)?,
                description: row.get(5)?,
                visible_in_plots,
            };
            Ok((channel, annotation))
        })?;

        for row in rows {
            let (channel, annotation) = row?;
            if let Some(ch) = channel {
                channel_annotations
                    .entry(ch)
                    .or_insert_with(Vec::new)
                    .push(annotation);
            } else {
                global_annotations.push(annotation);
            }
        }

        Ok(FileAnnotations {
            global_annotations,
            channel_annotations,
        })
    }

    pub fn get_annotation(&self, id: &str) -> Result<Option<Annotation>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, position, label, color, description, visible_in_plots
             FROM annotations
             WHERE id = ?1",
        )?;

        let result = stmt
            .query_row(params![id], |row| {
                let visible_in_plots_json: Option<String> = row.get(5)?;
                let visible_in_plots = visible_in_plots_json
                    .and_then(|json| serde_json::from_str(&json).ok())
                    .unwrap_or_else(Vec::new);

                Ok(Annotation {
                    id: row.get(0)?,
                    position: row.get(1)?,
                    label: row.get(2)?,
                    color: row.get(3)?,
                    description: row.get(4)?,
                    visible_in_plots,
                })
            })
            .optional()
            .context("Failed to get annotation")?;

        Ok(result)
    }

    pub fn delete_annotation(&self, id: &str) -> Result<()> {
        self.conn
            .lock()
            .execute("DELETE FROM annotations WHERE id = ?1", params![id])
            .context("Failed to delete annotation")?;
        Ok(())
    }

    pub fn delete_file_annotations(&self, file_path: &str) -> Result<()> {
        self.conn
            .lock()
            .execute(
                "DELETE FROM annotations WHERE file_path = ?1",
                params![file_path],
            )
            .context("Failed to delete file annotations")?;
        Ok(())
    }

    pub fn clear_all(&self) -> Result<()> {
        self.conn
            .lock()
            .execute("DELETE FROM annotations", [])
            .context("Failed to clear annotations")?;
        Ok(())
    }

    pub fn get_all_file_paths(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock();
        let mut stmt =
            conn.prepare("SELECT DISTINCT file_path FROM annotations ORDER BY file_path")?;

        let paths = stmt
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to get file paths")?;

        Ok(paths)
    }

    /// Update file hash for all annotations of a specific file (for migration)
    pub fn update_file_hash(&self, file_path: &str, file_hash: &str) -> Result<usize> {
        let updated = self
            .conn
            .lock()
            .execute(
                "UPDATE annotations SET file_hash = ?1 WHERE file_path = ?2 AND file_hash IS NULL",
                params![file_hash, file_path],
            )
            .context("Failed to update annotation file hashes")?;

        Ok(updated)
    }

    /// Check if any annotations for a file have a hash (for migration status)
    pub fn has_file_hash(&self, file_path: &str) -> Result<bool> {
        let count: i64 = self
            .conn
            .lock()
            .query_row(
                "SELECT COUNT(*) FROM annotations WHERE file_path = ?1 AND file_hash IS NOT NULL",
                params![file_path],
                |row| row.get(0),
            )
            .context("Failed to check for file hashes")?;

        Ok(count > 0)
    }

    /// Get migration statistics - how many files have and don't have hashes
    /// Returns (files_with_hash, files_without_hash)
    pub fn get_hash_migration_stats(&self) -> Result<(usize, usize)> {
        let conn = self.conn.lock();

        let with_hash: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT file_path) FROM annotations WHERE file_hash IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .context("Failed to count hashed files")?;

        let without_hash: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT file_path) FROM annotations WHERE file_hash IS NULL",
                [],
                |row| row.get(0),
            )
            .context("Failed to count non-hashed files")?;

        Ok((with_hash as usize, without_hash as usize))
    }

    pub fn get_annotations_in_range(
        &self,
        file_path: &str,
        start: f64,
        end: f64,
    ) -> Result<Vec<Annotation>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, position, label, color, description, visible_in_plots
             FROM annotations
             WHERE file_path = ?1 AND position >= ?2 AND position <= ?3
             ORDER BY position",
        )?;

        let annotations = stmt
            .query_map(params![file_path, start, end], |row| {
                let visible_in_plots_json: Option<String> = row.get(5)?;
                let visible_in_plots = visible_in_plots_json
                    .and_then(|json| serde_json::from_str(&json).ok())
                    .unwrap_or_else(Vec::new);

                Ok(Annotation {
                    id: row.get(0)?,
                    position: row.get(1)?,
                    label: row.get(2)?,
                    color: row.get(3)?,
                    description: row.get(4)?,
                    visible_in_plots,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to get annotations in range")?;

        Ok(annotations)
    }
}
