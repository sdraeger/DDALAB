use anyhow::{Context, Result};
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileViewState {
    pub file_path: String,
    pub chunk_start: f64,
    pub chunk_size: i64,
    pub selected_channels: Vec<String>,
    pub updated_at: String,
}

/// Metadata for file-specific state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStateMetadata {
    pub first_opened: String,
    pub last_accessed: String,
    pub access_count: i64,
    pub version: String,
}

/// Complete file-specific state with modular structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSpecificState {
    pub file_path: String,
    pub metadata: FileStateMetadata,
    #[serde(flatten)]
    pub modules: HashMap<String, JsonValue>,
}

/// File state registry containing all file states
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStateRegistry {
    pub files: HashMap<String, FileSpecificState>,
    pub active_file_path: Option<String>,
    pub last_active_file_path: Option<String>,
    pub metadata: RegistryMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryMetadata {
    pub version: String,
    pub last_updated: String,
}

impl Default for FileStateRegistry {
    fn default() -> Self {
        Self {
            files: HashMap::new(),
            active_file_path: None,
            last_active_file_path: None,
            metadata: RegistryMetadata {
                version: "1.0.0".to_string(),
                last_updated: chrono::Utc::now().to_rfc3339(),
            },
        }
    }
}

pub struct FileStateDatabase {
    conn: Mutex<Connection>,
}

impl FileStateDatabase {
    pub fn new<P: AsRef<Path>>(db_path: P) -> Result<Self> {
        let conn = Connection::open(db_path)?;

        // Enable WAL mode for better concurrency
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;

        // Create file_view_state table (legacy - kept for backward compatibility)
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

        // Create new modular file state tables
        conn.execute(
            "CREATE TABLE IF NOT EXISTS file_state_modules (
                file_path TEXT NOT NULL,
                module_id TEXT NOT NULL,
                state_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (file_path, module_id)
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS file_state_metadata (
                file_path TEXT PRIMARY KEY,
                first_opened TEXT NOT NULL,
                last_accessed TEXT NOT NULL,
                access_count INTEGER NOT NULL DEFAULT 0,
                version TEXT NOT NULL DEFAULT '1.0.0'
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS file_state_registry (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        // Create indexes
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_file_state_modules_file
             ON file_state_modules(file_path)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_file_state_metadata_accessed
             ON file_state_metadata(last_accessed DESC)",
            [],
        )?;

        let db = Self {
            conn: Mutex::new(conn),
        };

        // Run schema migrations
        db.migrate_schema()?;

        Ok(db)
    }

    fn migrate_schema(&self) -> Result<()> {
        let conn = self.conn.lock();

        // Check if file_hash column exists in file_state_modules
        let file_hash_exists_modules: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('file_state_modules') WHERE name='file_hash'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0)
            > 0;

        if !file_hash_exists_modules {
            log::info!("Adding file_hash column to file_state_modules table");
            conn.execute(
                "ALTER TABLE file_state_modules ADD COLUMN file_hash TEXT",
                [],
            )
            .context("Failed to add file_hash column to file_state_modules")?;

            // Create index on file_hash for fast lookups
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_file_state_modules_hash
                 ON file_state_modules(file_hash, module_id)",
                [],
            )
            .context("Failed to create file_hash index on file_state_modules")?;

            log::info!("file_hash column and index added successfully to file_state_modules");
        }

        // Check if file_hash column exists in file_state_metadata
        let file_hash_exists_metadata: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('file_state_metadata') WHERE name='file_hash'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0)
            > 0;

        if !file_hash_exists_metadata {
            log::info!("Adding file_hash column to file_state_metadata table");
            conn.execute(
                "ALTER TABLE file_state_metadata ADD COLUMN file_hash TEXT",
                [],
            )
            .context("Failed to add file_hash column to file_state_metadata")?;

            // Create index on file_hash
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_file_state_metadata_hash
                 ON file_state_metadata(file_hash)",
                [],
            )
            .context("Failed to create file_hash index on file_state_metadata")?;

            log::info!("file_hash column and index added successfully to file_state_metadata");
        }

        Ok(())
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
            let selected_channels: Vec<String> =
                serde_json::from_str(&channels_json).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        3,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })?;

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

    // === New Modular State Methods ===

    /// Save state for a specific module and file
    pub fn save_module_state(
        &self,
        file_path: &str,
        module_id: &str,
        state: &JsonValue,
    ) -> Result<()> {
        let state_json = serde_json::to_string(state)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        let updated_at = chrono::Utc::now().to_rfc3339();

        self.conn.lock().execute(
            "INSERT OR REPLACE INTO file_state_modules
             (file_path, module_id, state_json, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![file_path, module_id, state_json, updated_at],
        )?;

        Ok(())
    }

    /// Load state for a specific module and file
    pub fn get_module_state(&self, file_path: &str, module_id: &str) -> Result<Option<JsonValue>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT state_json FROM file_state_modules
             WHERE file_path = ?1 AND module_id = ?2",
        )?;

        let mut rows = stmt.query(params![file_path, module_id])?;

        if let Some(row) = rows.next()? {
            let state_json: String = row.get(0)?;
            let state: JsonValue = serde_json::from_str(&state_json)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
            Ok(Some(state))
        } else {
            Ok(None)
        }
    }

    /// Get all modules for a specific file
    pub fn get_file_modules(&self, file_path: &str) -> Result<HashMap<String, JsonValue>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT module_id, state_json FROM file_state_modules
             WHERE file_path = ?1",
        )?;

        let rows = stmt.query_map(params![file_path], |row| {
            let module_id: String = row.get(0)?;
            let state_json: String = row.get(1)?;
            Ok((module_id, state_json))
        })?;

        let mut modules = HashMap::new();
        for row_result in rows {
            let (module_id, state_json) = row_result?;
            let state: JsonValue = serde_json::from_str(&state_json).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?;
            modules.insert(module_id, state);
        }

        Ok(modules)
    }

    /// Clear all modules for a specific file
    pub fn clear_file_modules(&self, file_path: &str) -> Result<()> {
        self.conn.lock().execute(
            "DELETE FROM file_state_modules WHERE file_path = ?1",
            params![file_path],
        )?;
        Ok(())
    }

    /// Update file hash for all modules and metadata of a specific file (for migration)
    pub fn update_file_hash(&self, file_path: &str, file_hash: &str) -> Result<()> {
        let conn = self.conn.lock();

        // Update file_state_metadata
        conn.execute(
            "UPDATE file_state_metadata SET file_hash = ?1 WHERE file_path = ?2",
            params![file_hash, file_path],
        )
        .context("Failed to update file_state_metadata hash")?;

        // Update file_state_modules
        conn.execute(
            "UPDATE file_state_modules SET file_hash = ?1 WHERE file_path = ?2",
            params![file_hash, file_path],
        )
        .context("Failed to update file_state_modules hash")?;

        Ok(())
    }

    /// Update or create file metadata
    pub fn update_file_metadata(&self, file_path: &str) -> Result<()> {
        let conn = self.conn.lock();
        let now = chrono::Utc::now().to_rfc3339();

        // Try to update existing metadata
        let updated = conn.execute(
            "UPDATE file_state_metadata
             SET last_accessed = ?1, access_count = access_count + 1
             WHERE file_path = ?2",
            params![now, file_path],
        )?;

        // If no rows were updated, insert new metadata
        if updated == 0 {
            conn.execute(
                "INSERT INTO file_state_metadata
                 (file_path, first_opened, last_accessed, access_count, version)
                 VALUES (?1, ?2, ?3, 1, '1.0.0')",
                params![file_path, now, now],
            )?;
        }

        Ok(())
    }

    /// Get file metadata
    pub fn get_file_metadata(&self, file_path: &str) -> Result<Option<FileStateMetadata>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT first_opened, last_accessed, access_count, version
             FROM file_state_metadata
             WHERE file_path = ?1",
        )?;

        let mut rows = stmt.query(params![file_path])?;

        if let Some(row) = rows.next()? {
            Ok(Some(FileStateMetadata {
                first_opened: row.get(0)?,
                last_accessed: row.get(1)?,
                access_count: row.get(2)?,
                version: row.get(3)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// Get complete file-specific state (metadata + all modules)
    pub fn get_file_specific_state(&self, file_path: &str) -> Result<Option<FileSpecificState>> {
        let metadata = match self.get_file_metadata(file_path)? {
            Some(m) => m,
            None => return Ok(None),
        };

        let modules = self.get_file_modules(file_path)?;

        Ok(Some(FileSpecificState {
            file_path: file_path.to_string(),
            metadata,
            modules,
        }))
    }

    /// Save the file state registry (full - kept for backward compat)
    pub fn save_registry(&self, registry: &FileStateRegistry) -> Result<()> {
        let registry_json = serde_json::to_string(registry)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        self.conn.lock().execute(
            "INSERT OR REPLACE INTO file_state_registry (key, value) VALUES ('registry', ?1)",
            params![registry_json],
        )?;

        Ok(())
    }

    /// Save only the lightweight registry metadata (active file paths, version)
    /// without re-serializing all file states
    pub fn save_registry_metadata(
        &self,
        active_file_path: Option<&str>,
        last_active_file_path: Option<&str>,
    ) -> Result<()> {
        let metadata = serde_json::json!({
            "activeFilePath": active_file_path,
            "lastActiveFilePath": last_active_file_path,
            "version": "1.0.0",
            "lastUpdated": chrono::Utc::now().to_rfc3339(),
        });
        let metadata_json = serde_json::to_string(&metadata)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        self.conn.lock().execute(
            "INSERT OR REPLACE INTO file_state_registry (key, value) VALUES ('registry_meta', ?1)",
            params![metadata_json],
        )?;

        Ok(())
    }

    /// Load the file state registry
    pub fn get_registry(&self) -> Result<FileStateRegistry> {
        let conn = self.conn.lock();

        // Try loading lightweight metadata first
        let mut stmt =
            conn.prepare("SELECT value FROM file_state_registry WHERE key = 'registry_meta'")?;
        let mut rows = stmt.query(params![])?;

        if let Some(row) = rows.next()? {
            let meta_json: String = row.get(0)?;
            let meta: serde_json::Value = serde_json::from_str(&meta_json)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

            return Ok(FileStateRegistry {
                files: HashMap::new(),
                active_file_path: meta
                    .get("activeFilePath")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                last_active_file_path: meta
                    .get("lastActiveFilePath")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                metadata: RegistryMetadata {
                    version: meta
                        .get("version")
                        .and_then(|v| v.as_str())
                        .unwrap_or("1.0.0")
                        .to_string(),
                    last_updated: meta
                        .get("lastUpdated")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                },
            });
        }

        drop(rows);
        drop(stmt);

        // Fall back to legacy full blob
        let mut stmt2 =
            conn.prepare("SELECT value FROM file_state_registry WHERE key = 'registry'")?;
        let mut rows2 = stmt2.query(params![])?;

        if let Some(row) = rows2.next()? {
            let registry_json: String = row.get(0)?;
            let registry: FileStateRegistry = serde_json::from_str(&registry_json)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
            Ok(registry)
        } else {
            Ok(FileStateRegistry::default())
        }
    }

    /// Get all tracked file paths ordered by most recent access
    pub fn get_tracked_files(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT file_path FROM file_state_metadata
             ORDER BY last_accessed DESC",
        )?;

        let rows = stmt.query_map([], |row| row.get(0))?;

        let mut files = Vec::new();
        for row in rows {
            files.push(row?);
        }
        Ok(files)
    }
}
