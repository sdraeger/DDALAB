use anyhow::{Context, Result};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

/// Stored ICA result - stores results as JSON blob to avoid circular dependencies.
/// The `results` field is a JSON blob that will be deserialized to ICAAnalysisResult
/// by the caller.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ICAStoredResult {
    pub id: String,
    pub name: Option<String>,
    pub file_path: String,
    pub channels: Vec<String>,
    pub created_at: String,
    pub status: String,
    pub results: Value,
}

#[derive(Debug)]
pub struct ICADatabase {
    conn: Mutex<Connection>,
}

impl ICADatabase {
    pub fn new<P: AsRef<Path>>(db_path: P) -> Result<Self> {
        let conn = Connection::open(&db_path).context("Failed to open ICA database")?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -64000;",
        )
        .context("Failed to set SQLite pragmas")?;

        Self::create_tables_static(&conn)?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        Ok(db)
    }

    fn create_tables_static(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS ica_analyses (
                id TEXT PRIMARY KEY,
                name TEXT,
                file_path TEXT NOT NULL,
                channels TEXT NOT NULL,
                created_at TEXT NOT NULL,
                status TEXT NOT NULL,
                results TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_ica_file_path ON ica_analyses(file_path);
            CREATE INDEX IF NOT EXISTS idx_ica_created_at ON ica_analyses(created_at DESC);",
        )
        .context("Failed to create ICA analyses table")?;

        Ok(())
    }

    pub fn save_analysis(&self, result: &ICAStoredResult) -> Result<()> {
        let channels_json = serde_json::to_string(&result.channels)?;
        let results_json = serde_json::to_string(&result.results)?;

        self.conn
            .lock()
            .execute(
                "INSERT OR REPLACE INTO ica_analyses
                 (id, name, file_path, channels, created_at, status, results)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    result.id,
                    result.name,
                    result.file_path,
                    channels_json,
                    result.created_at,
                    result.status,
                    results_json,
                ],
            )
            .context("Failed to save ICA analysis")?;

        Ok(())
    }

    pub fn get_analysis(&self, id: &str) -> Result<Option<ICAStoredResult>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, file_path, channels, created_at, status, results
             FROM ica_analyses WHERE id = ?1",
        )?;

        let result = stmt
            .query_row(params![id], |row| {
                let channels_json: String = row.get(3)?;
                let results_json: String = row.get(6)?;

                Ok(ICAStoredResult {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    file_path: row.get(2)?,
                    channels: serde_json::from_str(&channels_json)
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
                    created_at: row.get(4)?,
                    status: row.get(5)?,
                    results: serde_json::from_str(&results_json)
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
                })
            })
            .optional()
            .context("Failed to get ICA analysis")?;

        Ok(result)
    }

    pub fn get_all_analyses(&self, limit: usize) -> Result<Vec<ICAStoredResult>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, file_path, channels, created_at, status, results
             FROM ica_analyses
             ORDER BY created_at DESC
             LIMIT ?1",
        )?;

        let analyses = stmt
            .query_map(params![limit], |row| {
                let channels_json: String = row.get(3)?;
                let results_json: String = row.get(6)?;

                Ok(ICAStoredResult {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    file_path: row.get(2)?,
                    channels: serde_json::from_str(&channels_json)
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
                    created_at: row.get(4)?,
                    status: row.get(5)?,
                    results: serde_json::from_str(&results_json)
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to get ICA analyses")?;

        Ok(analyses)
    }

    pub fn delete_analysis(&self, id: &str) -> Result<bool> {
        let rows_affected = self
            .conn
            .lock()
            .execute("DELETE FROM ica_analyses WHERE id = ?1", params![id])
            .context("Failed to delete ICA analysis")?;

        Ok(rows_affected > 0)
    }

    pub fn count(&self) -> Result<usize> {
        let conn = self.conn.lock();
        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM ica_analyses", [], |row| row.get(0))?;
        Ok(count as usize)
    }
}
