use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NSGJobStatus {
    Pending,
    Submitted,
    Queue,
    InputStaging,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl NSGJobStatus {
    pub fn is_active(&self) -> bool {
        matches!(
            self,
            NSGJobStatus::Submitted
                | NSGJobStatus::Queue
                | NSGJobStatus::InputStaging
                | NSGJobStatus::Running
        )
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            NSGJobStatus::Completed | NSGJobStatus::Failed | NSGJobStatus::Cancelled
        )
    }
}

impl std::fmt::Display for NSGJobStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NSGJobStatus::Pending => write!(f, "pending"),
            NSGJobStatus::Submitted => write!(f, "submitted"),
            NSGJobStatus::Queue => write!(f, "queue"),
            NSGJobStatus::InputStaging => write!(f, "inputstaging"),
            NSGJobStatus::Running => write!(f, "running"),
            NSGJobStatus::Completed => write!(f, "completed"),
            NSGJobStatus::Failed => write!(f, "failed"),
            NSGJobStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NSGJob {
    pub id: String,
    pub nsg_job_id: Option<String>,
    pub tool: String,
    pub status: NSGJobStatus,
    pub created_at: DateTime<Utc>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub dda_params: serde_json::Value,
    pub input_file_path: String,
    pub output_files: Vec<String>,
    pub error_message: Option<String>,
    pub last_polled: Option<DateTime<Utc>>,
    pub progress: Option<u8>,
}

impl NSGJob {
    pub fn new_from_dda_params(
        tool: String,
        dda_params: serde_json::Value,
        input_file_path: String,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            nsg_job_id: None,
            tool,
            status: NSGJobStatus::Pending,
            created_at: Utc::now(),
            submitted_at: None,
            completed_at: None,
            dda_params,
            input_file_path,
            output_files: Vec::new(),
            error_message: None,
            last_polled: None,
            progress: None,
        }
    }

    pub fn mark_submitted(&mut self, nsg_job_id: String) {
        self.nsg_job_id = Some(nsg_job_id);
        self.status = NSGJobStatus::Submitted;
        self.submitted_at = Some(Utc::now());
    }

    pub fn update_status(&mut self, status: NSGJobStatus) {
        self.status = status.clone();
        self.last_polled = Some(Utc::now());

        if status.is_terminal() {
            self.completed_at = Some(Utc::now());
        }
    }

    pub fn mark_failed(&mut self, error: String) {
        self.status = NSGJobStatus::Failed;
        self.error_message = Some(error);
        self.completed_at = Some(Utc::now());
    }
}

pub struct NSGJobsDatabase {
    conn: Arc<Mutex<Connection>>,
}

impl NSGJobsDatabase {
    /// Acquire the database connection lock, returning an error if the lock is poisoned
    fn get_conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|e| anyhow::anyhow!("Database lock poisoned: {}", e))
    }

    pub fn new(db_path: &Path) -> Result<Self> {
        let conn = Connection::open(db_path).context("Failed to open NSG jobs database")?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };

        db.init_schema()?;

        Ok(db)
    }

    fn init_schema(&self) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS nsg_jobs (
                id TEXT PRIMARY KEY,
                nsg_job_id TEXT,
                tool TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                submitted_at TEXT,
                completed_at TEXT,
                dda_params TEXT NOT NULL,
                input_file_path TEXT NOT NULL,
                output_files TEXT NOT NULL,
                error_message TEXT,
                last_polled TEXT,
                progress INTEGER
            )",
            [],
        )
        .context("Failed to create nsg_jobs table")?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_nsg_jobs_status ON nsg_jobs(status)",
            [],
        )
        .context("Failed to create status index")?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_nsg_jobs_nsg_job_id ON nsg_jobs(nsg_job_id)",
            [],
        )
        .context("Failed to create nsg_job_id index")?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_nsg_jobs_created_at ON nsg_jobs(created_at DESC)",
            [],
        )
        .context("Failed to create created_at index")?;

        Ok(())
    }

    pub fn save_job(&self, job: &NSGJob) -> Result<()> {
        let conn = self.get_conn()?;

        let output_files_json =
            serde_json::to_string(&job.output_files).context("Failed to serialize output files")?;

        let dda_params_json =
            serde_json::to_string(&job.dda_params).context("Failed to serialize DDA parameters")?;

        conn.execute(
            "INSERT INTO nsg_jobs (
                id, nsg_job_id, tool, status, created_at, submitted_at, completed_at,
                dda_params, input_file_path, output_files, error_message, last_polled, progress
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                job.id,
                job.nsg_job_id,
                job.tool,
                job.status.to_string(),
                job.created_at.to_rfc3339(),
                job.submitted_at.map(|t| t.to_rfc3339()),
                job.completed_at.map(|t| t.to_rfc3339()),
                dda_params_json,
                job.input_file_path,
                output_files_json,
                job.error_message,
                job.last_polled.map(|t| t.to_rfc3339()),
                job.progress,
            ],
        )
        .context("Failed to insert job into database")?;

        Ok(())
    }

    pub fn update_job(&self, job: &NSGJob) -> Result<()> {
        let conn = self.get_conn()?;

        let output_files_json =
            serde_json::to_string(&job.output_files).context("Failed to serialize output files")?;

        let dda_params_json =
            serde_json::to_string(&job.dda_params).context("Failed to serialize DDA parameters")?;

        conn.execute(
            "UPDATE nsg_jobs SET
                nsg_job_id = ?2,
                tool = ?3,
                status = ?4,
                submitted_at = ?5,
                completed_at = ?6,
                dda_params = ?7,
                input_file_path = ?8,
                output_files = ?9,
                error_message = ?10,
                last_polled = ?11,
                progress = ?12
            WHERE id = ?1",
            params![
                job.id,
                job.nsg_job_id,
                job.tool,
                job.status.to_string(),
                job.submitted_at.map(|t| t.to_rfc3339()),
                job.completed_at.map(|t| t.to_rfc3339()),
                dda_params_json,
                job.input_file_path,
                output_files_json,
                job.error_message,
                job.last_polled.map(|t| t.to_rfc3339()),
                job.progress,
            ],
        )
        .context("Failed to update job in database")?;

        Ok(())
    }

    pub fn get_job(&self, job_id: &str) -> Result<Option<NSGJob>> {
        let conn = self.get_conn()?;

        let job = conn
            .query_row(
                "SELECT id, nsg_job_id, tool, status, created_at, submitted_at, completed_at,
                    dda_params, input_file_path, output_files, error_message, last_polled, progress
             FROM nsg_jobs WHERE id = ?1",
                params![job_id],
                |row| {
                    let status_str: String = row.get(3)?;
                    let status = Self::parse_status(&status_str);

                    let created_at_str: String = row.get(4)?;
                    let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)
                        .map(|dt| dt.with_timezone(&chrono::Utc))
                        .unwrap_or_else(|_| chrono::Utc::now());

                    let submitted_at: Option<String> = row.get(5)?;
                    let submitted_at = submitted_at.and_then(|s| {
                        chrono::DateTime::parse_from_rfc3339(&s)
                            .ok()
                            .map(|dt| dt.with_timezone(&chrono::Utc))
                    });

                    let completed_at: Option<String> = row.get(6)?;
                    let completed_at = completed_at.and_then(|s| {
                        chrono::DateTime::parse_from_rfc3339(&s)
                            .ok()
                            .map(|dt| dt.with_timezone(&chrono::Utc))
                    });

                    let dda_params_json: String = row.get(7)?;
                    let dda_params: serde_json::Value = serde_json::from_str(&dda_params_json)
                        .unwrap_or_else(|_| serde_json::json!({}));

                    let output_files_json: String = row.get(9)?;
                    let output_files: Vec<String> =
                        serde_json::from_str(&output_files_json).unwrap_or_default();

                    let last_polled: Option<String> = row.get(11)?;
                    let last_polled = last_polled.and_then(|s| {
                        chrono::DateTime::parse_from_rfc3339(&s)
                            .ok()
                            .map(|dt| dt.with_timezone(&chrono::Utc))
                    });

                    Ok(NSGJob {
                        id: row.get(0)?,
                        nsg_job_id: row.get(1)?,
                        tool: row.get(2)?,
                        status,
                        created_at,
                        submitted_at,
                        completed_at,
                        dda_params,
                        input_file_path: row.get(8)?,
                        output_files,
                        error_message: row.get(10)?,
                        last_polled,
                        progress: row.get(12)?,
                    })
                },
            )
            .optional()
            .context("Failed to query job from database")?;

        Ok(job)
    }

    pub fn list_jobs(&self) -> Result<Vec<NSGJob>> {
        let conn = self.get_conn()?;

        let mut stmt = conn
            .prepare(
                "SELECT id, nsg_job_id, tool, status, created_at, submitted_at, completed_at,
                    dda_params, input_file_path, output_files, error_message, last_polled, progress
             FROM nsg_jobs
             ORDER BY created_at DESC",
            )
            .context("Failed to prepare list jobs query")?;

        let jobs = stmt
            .query_map([], |row| {
                let status_str: String = row.get(3)?;
                let status = Self::parse_status(&status_str);

                let created_at_str: String = row.get(4)?;
                let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)
                    .map(|dt| dt.with_timezone(&chrono::Utc))
                    .unwrap_or_else(|_| chrono::Utc::now());

                let submitted_at: Option<String> = row.get(5)?;
                let submitted_at = submitted_at.and_then(|s| {
                    chrono::DateTime::parse_from_rfc3339(&s)
                        .ok()
                        .map(|dt| dt.with_timezone(&chrono::Utc))
                });

                let completed_at: Option<String> = row.get(6)?;
                let completed_at = completed_at.and_then(|s| {
                    chrono::DateTime::parse_from_rfc3339(&s)
                        .ok()
                        .map(|dt| dt.with_timezone(&chrono::Utc))
                });

                let dda_params_json: String = row.get(7)?;
                let dda_params: serde_json::Value = serde_json::from_str(&dda_params_json)
                    .unwrap_or_else(|_| serde_json::json!({}));

                let output_files_json: String = row.get(9)?;
                let output_files: Vec<String> =
                    serde_json::from_str(&output_files_json).unwrap_or_default();

                let last_polled: Option<String> = row.get(11)?;
                let last_polled = last_polled.and_then(|s| {
                    chrono::DateTime::parse_from_rfc3339(&s)
                        .ok()
                        .map(|dt| dt.with_timezone(&chrono::Utc))
                });

                Ok(NSGJob {
                    id: row.get(0)?,
                    nsg_job_id: row.get(1)?,
                    tool: row.get(2)?,
                    status,
                    created_at,
                    submitted_at,
                    completed_at,
                    dda_params,
                    input_file_path: row.get(8)?,
                    output_files,
                    error_message: row.get(10)?,
                    last_polled,
                    progress: row.get(12)?,
                })
            })
            .context("Failed to execute list jobs query")?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to collect jobs")?;

        Ok(jobs)
    }

    pub fn get_active_jobs(&self) -> Result<Vec<NSGJob>> {
        let conn = self.get_conn()?;

        let mut stmt = conn
            .prepare(
                "SELECT id, nsg_job_id, tool, status, created_at, submitted_at, completed_at,
                    dda_params, input_file_path, output_files, error_message, last_polled, progress
             FROM nsg_jobs
             WHERE status IN ('submitted', 'queue', 'running')
             ORDER BY created_at ASC",
            )
            .context("Failed to prepare active jobs query")?;

        let jobs = stmt
            .query_map([], |row| {
                let status_str: String = row.get(3)?;
                let status = Self::parse_status(&status_str);

                let created_at_str: String = row.get(4)?;
                let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)
                    .map(|dt| dt.with_timezone(&chrono::Utc))
                    .unwrap_or_else(|_| chrono::Utc::now());

                let submitted_at: Option<String> = row.get(5)?;
                let submitted_at = submitted_at.and_then(|s| {
                    chrono::DateTime::parse_from_rfc3339(&s)
                        .ok()
                        .map(|dt| dt.with_timezone(&chrono::Utc))
                });

                let completed_at: Option<String> = row.get(6)?;
                let completed_at = completed_at.and_then(|s| {
                    chrono::DateTime::parse_from_rfc3339(&s)
                        .ok()
                        .map(|dt| dt.with_timezone(&chrono::Utc))
                });

                let dda_params_json: String = row.get(7)?;
                let dda_params: serde_json::Value = serde_json::from_str(&dda_params_json)
                    .unwrap_or_else(|_| serde_json::json!({}));

                let output_files_json: String = row.get(9)?;
                let output_files: Vec<String> =
                    serde_json::from_str(&output_files_json).unwrap_or_default();

                let last_polled: Option<String> = row.get(11)?;
                let last_polled = last_polled.and_then(|s| {
                    chrono::DateTime::parse_from_rfc3339(&s)
                        .ok()
                        .map(|dt| dt.with_timezone(&chrono::Utc))
                });

                Ok(NSGJob {
                    id: row.get(0)?,
                    nsg_job_id: row.get(1)?,
                    tool: row.get(2)?,
                    status,
                    created_at,
                    submitted_at,
                    completed_at,
                    dda_params,
                    input_file_path: row.get(8)?,
                    output_files,
                    error_message: row.get(10)?,
                    last_polled,
                    progress: row.get(12)?,
                })
            })
            .context("Failed to execute active jobs query")?
            .collect::<Result<Vec<_>, _>>()
            .context("Failed to collect active jobs")?;

        Ok(jobs)
    }

    pub fn delete_job(&self, job_id: &str) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute("DELETE FROM nsg_jobs WHERE id = ?1", params![job_id])
            .context("Failed to delete job from database")?;

        Ok(())
    }

    /// Delete all jobs with a specific status in a single query (avoids N+1 problem)
    /// Returns the number of jobs deleted
    pub fn delete_jobs_by_status(&self, status: &NSGJobStatus) -> Result<usize> {
        let conn = self.get_conn()?;

        let deleted = conn
            .execute(
                "DELETE FROM nsg_jobs WHERE status = ?1",
                params![status.to_string()],
            )
            .context("Failed to delete jobs by status")?;

        Ok(deleted)
    }

    fn parse_status(status_str: &str) -> NSGJobStatus {
        match status_str.to_lowercase().as_str() {
            "pending" => NSGJobStatus::Pending,
            "submitted" => NSGJobStatus::Submitted,
            "queue" => NSGJobStatus::Queue,
            "running" => NSGJobStatus::Running,
            "completed" => NSGJobStatus::Completed,
            "failed" => NSGJobStatus::Failed,
            "cancelled" => NSGJobStatus::Cancelled,
            _ => NSGJobStatus::Pending,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_database_creation() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let db = NSGJobsDatabase::new(&db_path);
        assert!(db.is_ok());
    }

    #[test]
    fn test_save_and_get_job() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let db = NSGJobsDatabase::new(&db_path).unwrap();

        // Create simple test DDA params as JSON
        let dda_params = serde_json::json!({
            "file_path": "/test/file.edf",
            "channels": null,
            "time_range": {
                "start": 0.0,
                "end": 10.0
            },
            "preprocessing_options": {
                "highpass": null,
                "lowpass": null
            },
            "algorithm_selection": {
                "enabled_variants": ["single_timeseries"],
                "select_mask": null
            },
            "window_parameters": {
                "window_length": 1000,
                "window_step": 100,
                "ct_window_length": null,
                "ct_window_step": null
            },
            "scale_parameters": {
                "scale_min": 1,
                "scale_max": 100,
                "scale_num": 50
            },
            "ct_channel_pairs": null
        });

        let job = NSGJob::new_from_dda_params(
            "TEST_TOOL".to_string(),
            dda_params,
            "/test/file.edf".to_string(),
        );

        db.save_job(&job).unwrap();

        let retrieved = db.get_job(&job.id).unwrap();
        assert!(retrieved.is_some());

        let retrieved_job = retrieved.unwrap();
        assert_eq!(retrieved_job.id, job.id);
        assert_eq!(retrieved_job.tool, job.tool);
        assert_eq!(retrieved_job.status, job.status);
    }
}
