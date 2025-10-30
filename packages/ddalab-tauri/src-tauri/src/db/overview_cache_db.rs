use anyhow::{Context, Result};
use parking_lot::Mutex;
use rayon::prelude::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverviewCacheMetadata {
    pub id: i64,
    pub file_path: String,
    pub file_size: u64,
    pub file_modified_time: i64, // Unix timestamp
    pub max_points: usize,
    pub channels: Vec<String>, // Serialized as JSON
    pub total_samples: usize,
    pub samples_processed: usize,
    pub completion_percentage: f64,
    pub is_complete: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct OverviewSegment {
    pub cache_id: i64,
    pub channel_index: usize,
    pub segment_start: usize,
    pub segment_end: usize,
    pub data: Vec<f64>,
}

#[derive(Debug)]
pub struct OverviewCacheDatabase {
    conn: Mutex<Connection>,
}

impl OverviewCacheDatabase {
    pub fn new<P: AsRef<Path>>(db_path: P) -> Result<Self> {
        let conn = Connection::open(db_path).context("Failed to open overview cache database")?;

        // Set busy timeout to prevent deadlocks (10 seconds)
        conn.busy_timeout(std::time::Duration::from_secs(10))
            .context("Failed to set busy timeout")?;

        // Enable WAL mode for better concurrency
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -64000;
             PRAGMA temp_store = MEMORY;
             PRAGMA busy_timeout = 10000;",
        )
        .context("Failed to set SQLite pragmas")?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.create_tables()?;
        Ok(db)
    }

    fn create_tables(&self) -> Result<()> {
        let conn = self
            .conn
            .try_lock_for(std::time::Duration::from_secs(5))
            .ok_or_else(|| anyhow::anyhow!("Timeout waiting for database lock in create_tables"))?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS overview_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                file_modified_time INTEGER NOT NULL,
                max_points INTEGER NOT NULL,
                channels TEXT NOT NULL,
                total_samples INTEGER NOT NULL,
                samples_processed INTEGER NOT NULL,
                completion_percentage REAL NOT NULL,
                is_complete INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(file_path, max_points, channels)
            );

            CREATE INDEX IF NOT EXISTS idx_overview_cache_file_path
                ON overview_cache(file_path);
            CREATE INDEX IF NOT EXISTS idx_overview_cache_is_complete
                ON overview_cache(is_complete);

            CREATE TABLE IF NOT EXISTS overview_cache_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cache_id INTEGER NOT NULL,
                channel_index INTEGER NOT NULL,
                segment_start INTEGER NOT NULL,
                segment_end INTEGER NOT NULL,
                data BLOB NOT NULL,
                FOREIGN KEY (cache_id) REFERENCES overview_cache(id) ON DELETE CASCADE,
                UNIQUE(cache_id, channel_index, segment_start)
            );

            CREATE INDEX IF NOT EXISTS idx_overview_cache_data_cache_id
                ON overview_cache_data(cache_id);
            CREATE INDEX IF NOT EXISTS idx_overview_cache_data_channel
                ON overview_cache_data(cache_id, channel_index);",
        )
        .context("Failed to create overview cache tables")?;

        Ok(())
    }

    /// Get or create cache metadata for a file
    pub fn get_or_create_cache_metadata(
        &self,
        file_path: &str,
        file_size: u64,
        file_modified_time: i64,
        max_points: usize,
        channels: &[String],
        total_samples: usize,
    ) -> Result<OverviewCacheMetadata> {
        let channels_json = serde_json::to_string(channels)?;
        let conn = self.conn.lock();

        // Check if cache exists and is valid (file hasn't changed)
        let mut stmt = conn.prepare(
            "SELECT id, file_path, file_size, file_modified_time, max_points, channels,
                    total_samples, samples_processed, completion_percentage, is_complete,
                    created_at, updated_at
             FROM overview_cache
             WHERE file_path = ?1 AND max_points = ?2 AND channels = ?3",
        )?;

        let existing = stmt
            .query_row(params![file_path, max_points, channels_json], |row| {
                Ok(OverviewCacheMetadata {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    file_size: row.get(2)?,
                    file_modified_time: row.get(3)?,
                    max_points: row.get(4)?,
                    channels: serde_json::from_str(&row.get::<_, String>(5)?)
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
                    total_samples: row.get(6)?,
                    samples_processed: row.get(7)?,
                    completion_percentage: row.get(8)?,
                    is_complete: row.get::<_, i32>(9)? != 0,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            })
            .optional()?;

        drop(stmt);

        if let Some(metadata) = existing {
            // Check if file has been modified
            if metadata.file_size == file_size && metadata.file_modified_time == file_modified_time
            {
                log::info!(
                    "[OVERVIEW CACHE] Found existing cache for '{}' ({}% complete)",
                    file_path,
                    metadata.completion_percentage
                );
                return Ok(metadata);
            } else {
                log::info!(
                    "[OVERVIEW CACHE] File '{}' has been modified, invalidating cache",
                    file_path
                );
                // Delete old cache (need to drop lock first to avoid deadlock)
                let cache_id_to_delete = metadata.id;
                drop(conn); // Release lock before calling delete_cache
                self.delete_cache(cache_id_to_delete)?;
                // Re-acquire lock for insertion
                let conn = self.conn.lock();

                // Create new cache entry
                let now = chrono::Utc::now().to_rfc3339();
                conn.execute(
                    "INSERT INTO overview_cache
                     (file_path, file_size, file_modified_time, max_points, channels,
                      total_samples, samples_processed, completion_percentage, is_complete,
                      created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
                    params![
                        file_path,
                        file_size as i64,
                        file_modified_time,
                        max_points as i64,
                        channels_json,
                        total_samples as i64,
                        0,   // samples_processed
                        0.0, // completion_percentage
                        0,   // is_complete
                        &now,
                    ],
                )?;

                let id = conn.last_insert_rowid();
                log::info!("[OVERVIEW CACHE] Created new cache entry with ID {}", id);

                return Ok(OverviewCacheMetadata {
                    id,
                    file_path: file_path.to_string(),
                    file_size,
                    file_modified_time,
                    max_points,
                    channels: channels.to_vec(),
                    total_samples,
                    samples_processed: 0,
                    completion_percentage: 0.0,
                    is_complete: false,
                    created_at: now.clone(),
                    updated_at: now,
                });
            }
        }

        // Create new cache entry (first time, no existing cache)
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO overview_cache
             (file_path, file_size, file_modified_time, max_points, channels,
              total_samples, samples_processed, completion_percentage, is_complete,
              created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            params![
                file_path,
                file_size as i64,
                file_modified_time,
                max_points as i64,
                channels_json,
                total_samples as i64,
                0_i64, // samples_processed
                0.0,   // completion_percentage
                0,     // is_complete
                now,
            ],
        )?;

        let id = conn.last_insert_rowid();

        log::info!(
            "[OVERVIEW CACHE] Created new cache entry for '{}' (ID: {})",
            file_path,
            id
        );

        Ok(OverviewCacheMetadata {
            id,
            file_path: file_path.to_string(),
            file_size,
            file_modified_time,
            max_points,
            channels: channels.to_vec(),
            total_samples,
            samples_processed: 0,
            completion_percentage: 0.0,
            is_complete: false,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// Update cache progress
    pub fn update_progress(
        &self,
        cache_id: i64,
        samples_processed: usize,
        total_samples: usize,
    ) -> Result<()> {
        let completion_percentage = (samples_processed as f64 / total_samples as f64) * 100.0;
        let is_complete = samples_processed >= total_samples;
        let now = chrono::Utc::now().to_rfc3339();

        self.conn.lock().execute(
            "UPDATE overview_cache
             SET samples_processed = ?1,
                 completion_percentage = ?2,
                 is_complete = ?3,
                 updated_at = ?4
             WHERE id = ?5",
            params![
                samples_processed as i64,
                completion_percentage,
                if is_complete { 1 } else { 0 },
                now,
                cache_id,
            ],
        )?;

        log::debug!(
            "[OVERVIEW CACHE] Updated cache ID {} progress: {:.1}%",
            cache_id,
            completion_percentage
        );

        Ok(())
    }

    /// Save segment data
    pub fn save_segment(&self, segment: &OverviewSegment) -> Result<()> {
        // Parallel serialization of f64 vector to bytes
        let data_bytes: Vec<u8> = segment
            .data
            .par_iter()
            .flat_map(|&f| f.to_le_bytes())
            .collect();

        self.conn.lock().execute(
            "INSERT OR REPLACE INTO overview_cache_data
             (cache_id, channel_index, segment_start, segment_end, data)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                segment.cache_id,
                segment.channel_index as i64,
                segment.segment_start as i64,
                segment.segment_end as i64,
                data_bytes,
            ],
        )?;

        Ok(())
    }

    /// Get all segments for a cache entry
    pub fn get_segments(&self, cache_id: i64) -> Result<Vec<OverviewSegment>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT cache_id, channel_index, segment_start, segment_end, data
             FROM overview_cache_data
             WHERE cache_id = ?1
             ORDER BY channel_index, segment_start",
        )?;

        let segments = stmt
            .query_map(params![cache_id], |row| {
                let data_bytes: Vec<u8> = row.get(4)?;
                let data: Vec<f64> = data_bytes
                    .chunks_exact(8)
                    .map(|chunk| {
                        f64::from_le_bytes([
                            chunk[0], chunk[1], chunk[2], chunk[3], chunk[4], chunk[5], chunk[6],
                            chunk[7],
                        ])
                    })
                    .collect();

                Ok(OverviewSegment {
                    cache_id: row.get(0)?,
                    channel_index: row.get::<_, i64>(1)? as usize,
                    segment_start: row.get::<_, i64>(2)? as usize,
                    segment_end: row.get::<_, i64>(3)? as usize,
                    data,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(segments)
    }

    /// Get cache metadata by ID
    pub fn get_cache_metadata(&self, cache_id: i64) -> Result<Option<OverviewCacheMetadata>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, file_path, file_size, file_modified_time, max_points, channels,
                    total_samples, samples_processed, completion_percentage, is_complete,
                    created_at, updated_at
             FROM overview_cache
             WHERE id = ?1",
        )?;

        let metadata = stmt
            .query_row(params![cache_id], |row| {
                Ok(OverviewCacheMetadata {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    file_size: row.get(2)?,
                    file_modified_time: row.get(3)?,
                    max_points: row.get(4)?,
                    channels: serde_json::from_str(&row.get::<_, String>(5)?)
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
                    total_samples: row.get(6)?,
                    samples_processed: row.get(7)?,
                    completion_percentage: row.get(8)?,
                    is_complete: row.get::<_, i32>(9)? != 0,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            })
            .optional()?;

        Ok(metadata)
    }

    /// Delete cache and all associated segments
    pub fn delete_cache(&self, cache_id: i64) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM overview_cache WHERE id = ?1",
            params![cache_id],
        )?;
        log::info!("[OVERVIEW CACHE] Deleted cache ID {}", cache_id);
        Ok(())
    }

    /// Get all incomplete cache entries (for resumption on startup)
    pub fn get_incomplete_caches(&self) -> Result<Vec<OverviewCacheMetadata>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, file_path, file_size, file_modified_time, max_points, channels,
                    total_samples, samples_processed, completion_percentage, is_complete,
                    created_at, updated_at
             FROM overview_cache
             WHERE is_complete = 0
             ORDER BY updated_at DESC",
        )?;

        let caches = stmt
            .query_map([], |row| {
                Ok(OverviewCacheMetadata {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    file_size: row.get(2)?,
                    file_modified_time: row.get(3)?,
                    max_points: row.get(4)?,
                    channels: serde_json::from_str(&row.get::<_, String>(5)?)
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
                    total_samples: row.get(6)?,
                    samples_processed: row.get(7)?,
                    completion_percentage: row.get(8)?,
                    is_complete: row.get::<_, i32>(9)? != 0,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(caches)
    }

    /// Get the last processed segment for a channel
    pub fn get_last_segment_end(
        &self,
        cache_id: i64,
        channel_index: usize,
    ) -> Result<Option<usize>> {
        let conn = self.conn.lock();
        let result: Option<i64> = conn
            .query_row(
                "SELECT MAX(segment_end)
                 FROM overview_cache_data
                 WHERE cache_id = ?1 AND channel_index = ?2",
                params![cache_id, channel_index as i64],
                |row| row.get(0),
            )
            .optional()?;

        Ok(result.map(|v| v as usize))
    }

    /// Query cache metadata by file path and parameters
    /// Returns a JSON value with progress information
    pub fn query_progress(
        &self,
        file_path: &str,
        max_points: usize,
        channels_json: &str,
    ) -> Result<Option<serde_json::Value>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT completion_percentage, is_complete, samples_processed, total_samples
             FROM overview_cache
             WHERE file_path = ?1 AND max_points = ?2 AND (channels = ?3 OR ?3 = '')
             ORDER BY updated_at DESC
             LIMIT 1",
        )?;

        let result = stmt
            .query_row(
                params![file_path, max_points as i64, channels_json],
                |row| {
                    Ok(serde_json::json!({
                        "has_cache": true,
                        "completion_percentage": row.get::<_, f64>(0)?,
                        "is_complete": row.get::<_, i32>(1)? != 0,
                        "samples_processed": row.get::<_, i64>(2)?,
                        "total_samples": row.get::<_, i64>(3)?,
                    }))
                },
            )
            .optional()?;

        Ok(result)
    }
}
