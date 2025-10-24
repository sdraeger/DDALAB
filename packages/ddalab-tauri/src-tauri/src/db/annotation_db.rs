use anyhow::{Context, Result};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotationSource {
    pub plot_type: String,
    #[serde(default)]
    pub variant_id: Option<String>,
    #[serde(default)]
    pub dda_plot_type: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Annotation {
    pub id: String,
    pub position: f64,
    pub label: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_true")]
    pub sync_enabled: bool,
    #[serde(default)]
    pub created_in: Option<AnnotationSource>,
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
                    sync_enabled INTEGER DEFAULT 1,
                    created_in TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_annotations_file_path ON annotations(file_path);
                CREATE INDEX IF NOT EXISTS idx_annotations_channel ON annotations(file_path, channel);
                CREATE INDEX IF NOT EXISTS idx_annotations_position ON annotations(file_path, position);",
            )
            .context("Failed to create annotations table")?;

        Ok(())
    }

    pub fn save_annotation(
        &self,
        file_path: &str,
        channel: Option<&str>,
        annotation: &Annotation,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let created_in_json = annotation.created_in.as_ref()
            .and_then(|source| serde_json::to_string(source).ok());

        self.conn.lock().execute(
            "INSERT OR REPLACE INTO annotations
             (id, file_path, channel, position, label, color, description, sync_enabled, created_in, created_at, updated_at)
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
                annotation.sync_enabled as i32,
                created_in_json,
                now,
            ],
        )
        .context("Failed to save annotation")?;

        Ok(())
    }

    pub fn get_file_annotations(&self, file_path: &str) -> Result<FileAnnotations> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, channel, position, label, color, description, sync_enabled, created_in
             FROM annotations
             WHERE file_path = ?1
             ORDER BY position",
        )?;

        let mut global_annotations = Vec::new();
        let mut channel_annotations: HashMap<String, Vec<Annotation>> = HashMap::new();

        let rows = stmt.query_map(params![file_path], |row| {
            let channel: Option<String> = row.get(1)?;
            let sync_enabled: i32 = row.get(6).unwrap_or(1);
            let created_in_json: Option<String> = row.get(7)?;
            let created_in = created_in_json
                .and_then(|json| serde_json::from_str(&json).ok());

            let annotation = Annotation {
                id: row.get(0)?,
                position: row.get(2)?,
                label: row.get(3)?,
                color: row.get(4)?,
                description: row.get(5)?,
                sync_enabled: sync_enabled != 0,
                created_in,
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
            "SELECT id, position, label, color, description, sync_enabled, created_in
             FROM annotations
             WHERE id = ?1",
        )?;

        let result = stmt
            .query_row(params![id], |row| {
                let sync_enabled: i32 = row.get(5).unwrap_or(1);
                let created_in_json: Option<String> = row.get(6)?;
                let created_in = created_in_json
                    .and_then(|json| serde_json::from_str(&json).ok());

                Ok(Annotation {
                    id: row.get(0)?,
                    position: row.get(1)?,
                    label: row.get(2)?,
                    color: row.get(3)?,
                    description: row.get(4)?,
                    sync_enabled: sync_enabled != 0,
                    created_in,
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
        let mut stmt = conn.prepare("SELECT DISTINCT file_path FROM annotations ORDER BY file_path")?;

        let paths = stmt
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to get file paths")?;

        Ok(paths)
    }

    pub fn get_annotations_in_range(
        &self,
        file_path: &str,
        start: f64,
        end: f64,
    ) -> Result<Vec<Annotation>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, position, label, color, description, sync_enabled, created_in
             FROM annotations
             WHERE file_path = ?1 AND position >= ?2 AND position <= ?3
             ORDER BY position",
        )?;

        let annotations = stmt
            .query_map(params![file_path, start, end], |row| {
                let sync_enabled: i32 = row.get(5).unwrap_or(1);
                let created_in_json: Option<String> = row.get(6)?;
                let created_in = created_in_json
                    .and_then(|json| serde_json::from_str(&json).ok());

                Ok(Annotation {
                    id: row.get(0)?,
                    position: row.get(1)?,
                    label: row.get(2)?,
                    color: row.get(3)?,
                    description: row.get(4)?,
                    sync_enabled: sync_enabled != 0,
                    created_in,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to get annotations in range")?;

        Ok(annotations)
    }
}
