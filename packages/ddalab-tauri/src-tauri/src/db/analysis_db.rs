use crate::models::AnalysisResult;
use anyhow::{Context, Result};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

#[derive(Debug)]
pub struct AnalysisDatabase {
    /// Using parking_lot::Mutex instead of std::sync::Mutex.
    /// parking_lot::Mutex doesn't poison on panic, avoiding cascading failures.
    /// Note: RwLock can't be used because rusqlite::Connection doesn't implement Sync.
    conn: Mutex<Connection>,
}

impl AnalysisDatabase {
    pub fn new<P: AsRef<Path>>(db_path: P) -> Result<Self> {
        let conn = Connection::open(db_path).context("Failed to open analysis database")?;

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
        let conn = self.conn.lock();

        // Create table with all columns
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS analyses (
                id TEXT PRIMARY KEY,
                file_path TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                variant_name TEXT NOT NULL,
                variant_display_name TEXT NOT NULL,
                parameters TEXT NOT NULL,
                chunk_position REAL,
                plot_data TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                name TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_analyses_file_path ON analyses(file_path);
            CREATE INDEX IF NOT EXISTS idx_analyses_timestamp ON analyses(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at DESC);

            -- Composite indexes for common query patterns
            CREATE INDEX IF NOT EXISTS idx_analyses_file_path_created_at ON analyses(file_path, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_analyses_variant_name ON analyses(variant_name);
            CREATE INDEX IF NOT EXISTS idx_analyses_file_path_variant ON analyses(file_path, variant_name);",
        )
        .context("Failed to create analyses table")?;

        // Migration: Add name column if it doesn't exist (for existing databases)
        let result = conn.execute("ALTER TABLE analyses ADD COLUMN name TEXT", []);
        match result {
            Ok(_) => log::info!("✅ Added 'name' column to analyses table"),
            Err(e) => {
                // Column might already exist, which is fine
                let err_msg = e.to_string();
                if !err_msg.contains("duplicate column name") {
                    log::warn!("Migration warning (likely harmless): {}", err_msg);
                }
            }
        }

        Ok(())
    }

    pub fn save_analysis(&self, analysis: &AnalysisResult) -> Result<()> {
        let parameters_json = serde_json::to_string(&analysis.parameters)?;
        let plot_data_json = analysis
            .plot_data
            .as_ref()
            .map(|d| serde_json::to_string(d))
            .transpose()?;
        let now = chrono::Utc::now().to_rfc3339();

        self.conn
            .lock()
            .execute(
                "INSERT OR REPLACE INTO analyses
             (id, file_path, timestamp, variant_name, variant_display_name, parameters,
              chunk_position, plot_data, name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                     COALESCE((SELECT created_at FROM analyses WHERE id = ?1), ?10), ?10)",
                params![
                    analysis.id,
                    analysis.file_path,
                    analysis.timestamp,
                    analysis.variant_name,
                    analysis.variant_display_name,
                    parameters_json,
                    analysis.chunk_position,
                    plot_data_json,
                    analysis.name,
                    now,
                ],
            )
            .context("Failed to save analysis")?;

        Ok(())
    }

    pub fn get_analysis(&self, id: &str) -> Result<Option<AnalysisResult>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, file_path, timestamp, variant_name, variant_display_name,
                    parameters, chunk_position, plot_data, name
             FROM analyses WHERE id = ?1",
        )?;

        let result = stmt
            .query_row(params![id], |row| {
                let parameters_json: String = row.get(5)?;
                let plot_data_json: Option<String> = row.get(7)?;

                Ok(AnalysisResult {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    timestamp: row.get(2)?,
                    variant_name: row.get(3)?,
                    variant_display_name: row.get(4)?,
                    parameters: serde_json::from_str(&parameters_json)
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
                    chunk_position: row.get(6)?,
                    plot_data: plot_data_json
                        .map(|s| serde_json::from_str(&s))
                        .transpose()
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
                    name: row.get(8)?,
                })
            })
            .optional()
            .context("Failed to get analysis")?;

        Ok(result)
    }

    /// Get analyses for a file with pagination support.
    /// Use offset for cursor-based pagination to avoid loading all results.
    pub fn get_analyses_by_file(
        &self,
        file_path: &str,
        limit: usize,
    ) -> Result<Vec<AnalysisResult>> {
        self.get_analyses_by_file_paginated(file_path, limit, 0)
    }

    /// Get analyses for a file with full pagination support (limit + offset).
    /// NOTE: Does NOT load plot_data for performance - use get_analysis() for full data.
    pub fn get_analyses_by_file_paginated(
        &self,
        file_path: &str,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<AnalysisResult>> {
        let start_time = std::time::Instant::now();
        let conn = self.conn.lock();

        // PERFORMANCE FIX: Don't fetch plot_data for list views - it can be 10MB+ per row
        // Use get_analysis() to fetch full data when user clicks a specific analysis
        let mut stmt = conn.prepare(
            "SELECT id, file_path, timestamp, variant_name, variant_display_name,
                    parameters, chunk_position, name
             FROM analyses
             WHERE file_path = ?1
             ORDER BY timestamp DESC
             LIMIT ?2 OFFSET ?3",
        )?;

        let analyses = stmt
            .query_map(params![file_path, limit, offset], |row| {
                let parameters_json: String = row.get(5)?;

                Ok(AnalysisResult {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    timestamp: row.get(2)?,
                    variant_name: row.get(3)?,
                    variant_display_name: row.get(4)?,
                    parameters: serde_json::from_str(&parameters_json)
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
                    chunk_position: row.get(6)?,
                    plot_data: None, // Don't load plot_data for list view - too large
                    name: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to get analyses by file")?;

        let elapsed = start_time.elapsed();
        log::info!(
            "✅ get_analyses_by_file_paginated fetched {} analyses in {:.2}ms (no plot_data)",
            analyses.len(),
            elapsed.as_millis()
        );

        Ok(analyses)
    }

    /// Get total count of analyses for a file (useful for pagination UI).
    pub fn count_analyses_by_file(&self, file_path: &str) -> Result<usize> {
        let conn = self.conn.lock();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM analyses WHERE file_path = ?1",
            params![file_path],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }

    /// Get recent analyses WITHOUT plot_data for fast listing
    /// Use get_analysis_by_id() to fetch full data when needed
    pub fn get_recent_analyses(&self, limit: usize) -> Result<Vec<AnalysisResult>> {
        let start_time = std::time::Instant::now();
        let conn = self.conn.lock();

        // CRITICAL FIX: Don't fetch plot_data for list view - it's massive!
        // Only fetch plot_data when user clicks to view a specific analysis
        let mut stmt = conn.prepare(
            "SELECT id, file_path, timestamp, variant_name, variant_display_name,
                    parameters, chunk_position, name
             FROM analyses
             ORDER BY created_at DESC
             LIMIT ?1",
        )?;

        let analyses = stmt
            .query_map(params![limit], |row| {
                let parameters_json: String = row.get(5)?;

                Ok(AnalysisResult {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    timestamp: row.get(2)?,
                    variant_name: row.get(3)?,
                    variant_display_name: row.get(4)?,
                    parameters: serde_json::from_str(&parameters_json)
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
                    chunk_position: row.get(6)?,
                    plot_data: None, // Don't load plot_data for list view
                    name: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to get recent analyses")?;

        let elapsed = start_time.elapsed();
        log::info!(
            "✅ get_recent_analyses fetched {} analyses in {:.2}ms (no plot_data)",
            analyses.len(),
            elapsed.as_millis()
        );

        Ok(analyses)
    }

    pub fn delete_analysis(&self, id: &str) -> Result<()> {
        self.conn
            .lock()
            .execute("DELETE FROM analyses WHERE id = ?1", params![id])
            .context("Failed to delete analysis")?;
        Ok(())
    }

    pub fn rename_analysis(&self, id: &str, new_name: &str) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn
            .lock()
            .execute(
                "UPDATE analyses SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![new_name, now, id],
            )
            .context("Failed to rename analysis")?;
        Ok(())
    }

    pub fn clear_all(&self) -> Result<()> {
        self.conn
            .lock()
            .execute("DELETE FROM analyses", [])
            .context("Failed to clear analyses")?;
        Ok(())
    }

    pub fn get_file_paths(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock();
        let mut stmt =
            conn.prepare("SELECT DISTINCT file_path FROM analyses ORDER BY file_path")?;

        let paths = stmt
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to get file paths")?;

        Ok(paths)
    }
}
