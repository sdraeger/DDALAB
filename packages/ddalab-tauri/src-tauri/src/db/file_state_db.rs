use parking_lot::Mutex;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileViewState {
    pub file_path: String,
    pub chunk_start: f64,
    pub chunk_size: i64,
    pub selected_channels: Vec<String>,
    pub updated_at: String,
}

pub struct FileStateDatabase {
    conn: Mutex<Connection>,
}

impl FileStateDatabase {
    pub fn new<P: AsRef<Path>>(db_path: P) -> Result<Self> {
        let conn = Connection::open(db_path)?;

        // Enable WAL mode for better concurrency
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;

        // Create file_view_state table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS file_view_state (
                file_path TEXT PRIMARY KEY,
                chunk_start REAL NOT NULL,
                chunk_size INTEGER NOT NULL,
                selected_channels TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // Create index for faster lookups
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_file_view_state_updated
             ON file_view_state(updated_at DESC)",
            [],
        )?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Save or update file viewing state
    pub fn save_file_state(&self, state: &FileViewState) -> Result<()> {
        let channels_json = serde_json::to_string(&state.selected_channels)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        self.conn.lock().execute(
            "INSERT OR REPLACE INTO file_view_state
             (file_path, chunk_start, chunk_size, selected_channels, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                &state.file_path,
                state.chunk_start,
                state.chunk_size,
                channels_json,
                &state.updated_at
            ],
        )?;

        Ok(())
    }

    /// Get file viewing state by file path
    pub fn get_file_state(&self, file_path: &str) -> Result<Option<FileViewState>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT file_path, chunk_start, chunk_size, selected_channels, updated_at
             FROM file_view_state
             WHERE file_path = ?1",
        )?;

        let mut rows = stmt.query(params![file_path])?;

        if let Some(row) = rows.next()? {
            let channels_json: String = row.get(3)?;
            let selected_channels: Vec<String> = serde_json::from_str(&channels_json)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

            Ok(Some(FileViewState {
                file_path: row.get(0)?,
                chunk_start: row.get(1)?,
                chunk_size: row.get(2)?,
                selected_channels,
                updated_at: row.get(4)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// Delete file viewing state
    pub fn delete_file_state(&self, file_path: &str) -> Result<()> {
        self.conn.lock().execute(
            "DELETE FROM file_view_state WHERE file_path = ?1",
            params![file_path],
        )?;
        Ok(())
    }

    /// Get all file states ordered by most recent
    pub fn get_all_file_states(&self) -> Result<Vec<FileViewState>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT file_path, chunk_start, chunk_size, selected_channels, updated_at
             FROM file_view_state
             ORDER BY updated_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            let channels_json: String = row.get(3)?;
            let selected_channels: Vec<String> = serde_json::from_str(&channels_json)
                .map_err(|e| rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e)))?;

            Ok(FileViewState {
                file_path: row.get(0)?,
                chunk_start: row.get(1)?,
                chunk_size: row.get(2)?,
                selected_channels,
                updated_at: row.get(4)?,
            })
        })?;

        let mut states = Vec::new();
        for state in rows {
            states.push(state?);
        }
        Ok(states)
    }
}
