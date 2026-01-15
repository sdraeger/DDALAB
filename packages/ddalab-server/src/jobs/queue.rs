use super::types::{DDAJob, JobProgressEvent, JobStatus};
use super::worker::run_dda_analysis;
use anyhow::Result;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, RwLock, Semaphore};
use tracing::{error, info, warn};
use uuid::Uuid;

/// Configuration for the job queue
#[derive(Debug, Clone)]
pub struct JobQueueConfig {
    /// Maximum number of concurrent jobs
    pub max_concurrent_jobs: usize,
    /// Channel capacity for progress notifications
    pub notification_capacity: usize,
}

impl Default for JobQueueConfig {
    fn default() -> Self {
        Self {
            max_concurrent_jobs: 2,
            notification_capacity: 1000,
        }
    }
}

/// Async job queue with configurable parallelism
pub struct JobQueue {
    /// All jobs indexed by ID
    jobs: Arc<RwLock<HashMap<Uuid, DDAJob>>>,
    /// Semaphore to limit concurrent jobs
    semaphore: Arc<Semaphore>,
    /// Channel to submit new jobs
    submit_tx: mpsc::Sender<DDAJob>,
    /// Broadcast channel for progress updates
    progress_tx: broadcast::Sender<JobProgressEvent>,
    /// Set of jobs that should be cancelled
    cancel_requests: Arc<RwLock<std::collections::HashSet<Uuid>>>,
    /// Configuration
    config: JobQueueConfig,
}

impl JobQueue {
    /// Create a new job queue with the given configuration
    pub fn new(config: JobQueueConfig) -> Self {
        let (submit_tx, submit_rx) = mpsc::channel::<DDAJob>(100);
        let (progress_tx, _) = broadcast::channel(config.notification_capacity);

        let queue = Self {
            jobs: Arc::new(RwLock::new(HashMap::new())),
            semaphore: Arc::new(Semaphore::new(config.max_concurrent_jobs)),
            submit_tx,
            progress_tx,
            cancel_requests: Arc::new(RwLock::new(std::collections::HashSet::new())),
            config,
        };

        // Start the dispatcher task
        queue.start_dispatcher(submit_rx);

        queue
    }

    /// Start the dispatcher that processes incoming jobs
    fn start_dispatcher(&self, mut submit_rx: mpsc::Receiver<DDAJob>) {
        let jobs = self.jobs.clone();
        let semaphore = self.semaphore.clone();
        let progress_tx = self.progress_tx.clone();
        let cancel_requests = self.cancel_requests.clone();

        tokio::spawn(async move {
            while let Some(job) = submit_rx.recv().await {
                let job_id = job.id;
                info!("Job {} received by dispatcher", job_id);

                // Store job in pending state
                {
                    let mut jobs_guard = jobs.write().await;
                    jobs_guard.insert(job_id, job.clone());
                }

                // Clone references for the task
                let jobs_clone = jobs.clone();
                let semaphore_clone = semaphore.clone();
                let progress_tx_clone = progress_tx.clone();
                let cancel_requests_clone = cancel_requests.clone();

                // Spawn task to process this job
                tokio::spawn(async move {
                    // Acquire semaphore permit (blocks if at capacity)
                    let _permit = match semaphore_clone.acquire().await {
                        Ok(p) => p,
                        Err(e) => {
                            log::warn!("Job {} failed to acquire semaphore: {}", job_id, e);
                            return;
                        }
                    };
                    info!("Job {} acquired semaphore, starting execution", job_id);

                    // Update status to running
                    {
                        let mut jobs_guard = jobs_clone.write().await;
                        if let Some(job) = jobs_guard.get_mut(&job_id) {
                            job.status = JobStatus::Running;
                            job.started_at = Some(Utc::now());
                        }
                    }

                    // Send running notification
                    let _ = progress_tx_clone.send(JobProgressEvent {
                        job_id,
                        status: JobStatus::Running,
                        progress: 0,
                        message: Some("Starting DDA analysis...".to_string()),
                    });

                    // Get a copy of the job for execution
                    let job_copy = {
                        let jobs_guard = jobs_clone.read().await;
                        jobs_guard.get(&job_id).cloned()
                    };

                    if let Some(job) = job_copy {
                        // Run the analysis with progress callback
                        let jobs_for_callback = jobs_clone.clone();
                        let progress_tx_for_callback = progress_tx_clone.clone();
                        let cancel_requests_for_callback = cancel_requests_clone.clone();

                        let result = run_dda_analysis(&job, |progress, message| {
                            // Check for cancellation
                            let should_cancel = {
                                let cancel_guard = cancel_requests_for_callback.blocking_read();
                                cancel_guard.contains(&job_id)
                            };

                            if should_cancel {
                                return false; // Signal cancellation
                            }

                            // Update progress in job
                            {
                                let mut jobs_guard = jobs_for_callback.blocking_write();
                                if let Some(job) = jobs_guard.get_mut(&job_id) {
                                    job.progress = progress;
                                    job.message = message.clone();
                                }
                            }

                            // Send progress notification
                            let _ = progress_tx_for_callback.send(JobProgressEvent {
                                job_id,
                                status: JobStatus::Running,
                                progress,
                                message,
                            });

                            true // Continue execution
                        })
                        .await;

                        // Update final status
                        let mut jobs_guard = jobs_clone.write().await;
                        if let Some(job) = jobs_guard.get_mut(&job_id) {
                            job.completed_at = Some(Utc::now());

                            match result {
                                Ok(output_path) => {
                                    job.status = JobStatus::Completed;
                                    job.progress = 100;
                                    job.output_path = Some(output_path);
                                    job.message = Some("Analysis complete".to_string());
                                    info!("Job {} completed successfully", job_id);

                                    let _ = progress_tx_clone.send(JobProgressEvent {
                                        job_id,
                                        status: JobStatus::Completed,
                                        progress: 100,
                                        message: Some("Analysis complete".to_string()),
                                    });
                                }
                                Err(e) => {
                                    let error_msg = e.to_string();
                                    if error_msg.contains("cancelled") {
                                        job.status = JobStatus::Cancelled;
                                        job.message = Some("Job cancelled by user".to_string());
                                        info!("Job {} cancelled", job_id);

                                        let _ = progress_tx_clone.send(JobProgressEvent {
                                            job_id,
                                            status: JobStatus::Cancelled,
                                            progress: job.progress,
                                            message: Some("Job cancelled by user".to_string()),
                                        });
                                    } else {
                                        job.status = JobStatus::Failed;
                                        job.error = Some(error_msg.clone());
                                        job.message = Some(format!("Failed: {}", error_msg));
                                        error!("Job {} failed: {}", job_id, error_msg);

                                        let _ = progress_tx_clone.send(JobProgressEvent {
                                            job_id,
                                            status: JobStatus::Failed,
                                            progress: job.progress,
                                            message: Some(format!("Failed: {}", error_msg)),
                                        });
                                    }
                                }
                            }
                        }

                        // Clean up cancel request if any
                        {
                            let mut cancel_guard = cancel_requests_clone.write().await;
                            cancel_guard.remove(&job_id);
                        }
                    }

                    // Permit is released when _permit goes out of scope
                });
            }
        });
    }

    /// Submit a new job to the queue
    pub async fn submit(&self, job: DDAJob) -> Result<Uuid> {
        let job_id = job.id;

        // Store job immediately
        {
            let mut jobs = self.jobs.write().await;
            jobs.insert(job_id, job.clone());
        }

        // Send to dispatcher
        self.submit_tx
            .send(job)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to submit job: {}", e))?;

        info!("Job {} submitted to queue", job_id);
        Ok(job_id)
    }

    /// Cancel a job
    pub async fn cancel(&self, job_id: Uuid) -> Result<bool> {
        let mut jobs = self.jobs.write().await;

        if let Some(job) = jobs.get_mut(&job_id) {
            match job.status {
                JobStatus::Pending => {
                    // Can cancel immediately
                    job.status = JobStatus::Cancelled;
                    job.completed_at = Some(Utc::now());
                    job.message = Some("Cancelled before starting".to_string());

                    let _ = self.progress_tx.send(JobProgressEvent {
                        job_id,
                        status: JobStatus::Cancelled,
                        progress: 0,
                        message: Some("Cancelled before starting".to_string()),
                    });

                    info!("Job {} cancelled (was pending)", job_id);
                    Ok(true)
                }
                JobStatus::Running => {
                    // Request cancellation - will be picked up by progress callback
                    {
                        let mut cancel_guard = self.cancel_requests.write().await;
                        cancel_guard.insert(job_id);
                    }
                    info!("Job {} cancel requested (was running)", job_id);
                    Ok(true)
                }
                _ => {
                    warn!("Cannot cancel job {} with status {:?}", job_id, job.status);
                    Ok(false)
                }
            }
        } else {
            Ok(false)
        }
    }

    /// Get job status
    pub async fn get_job(&self, job_id: Uuid) -> Option<DDAJob> {
        let jobs = self.jobs.read().await;
        jobs.get(&job_id).cloned()
    }

    /// Get all jobs for a user
    pub async fn get_user_jobs(&self, user_id: &str) -> Vec<DDAJob> {
        let jobs = self.jobs.read().await;
        jobs.values()
            .filter(|job| job.user_id == user_id)
            .cloned()
            .collect()
    }

    /// Get all jobs
    pub async fn get_all_jobs(&self) -> Vec<DDAJob> {
        let jobs = self.jobs.read().await;
        jobs.values().cloned().collect()
    }

    /// Subscribe to progress updates
    pub fn subscribe(&self) -> broadcast::Receiver<JobProgressEvent> {
        self.progress_tx.subscribe()
    }

    /// Get queue statistics
    pub async fn stats(&self) -> QueueStats {
        let jobs = self.jobs.read().await;
        let mut stats = QueueStats::default();

        for job in jobs.values() {
            match job.status {
                JobStatus::Pending => stats.pending += 1,
                JobStatus::Running => stats.running += 1,
                JobStatus::Completed => stats.completed += 1,
                JobStatus::Failed => stats.failed += 1,
                JobStatus::Cancelled => stats.cancelled += 1,
            }
        }

        stats.max_concurrent = self.config.max_concurrent_jobs;
        stats.available_slots = self.semaphore.available_permits();

        stats
    }
}

/// Queue statistics
#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct QueueStats {
    pub pending: usize,
    pub running: usize,
    pub completed: usize,
    pub failed: usize,
    pub cancelled: usize,
    pub max_concurrent: usize,
    pub available_slots: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs::types::{DDAParameters, FileSource};
    use std::path::PathBuf;

    #[tokio::test]
    async fn test_queue_creation() {
        let config = JobQueueConfig {
            max_concurrent_jobs: 2,
            notification_capacity: 100,
        };
        let queue = JobQueue::new(config);

        let stats = queue.stats().await;
        assert_eq!(stats.max_concurrent, 2);
        assert_eq!(stats.available_slots, 2);
        assert_eq!(stats.pending, 0);
    }

    #[tokio::test]
    async fn test_job_submission() {
        let queue = JobQueue::new(JobQueueConfig::default());

        let job = DDAJob::new(
            "test_user".to_string(),
            FileSource::ServerPath(PathBuf::from("/test/file.edf")),
            "test.edf".to_string(),
            DDAParameters::default(),
            false,
        );

        let job_id = job.id;
        let result = queue.submit(job).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), job_id);

        // Give dispatcher time to process
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

        let retrieved = queue.get_job(job_id).await;
        assert!(retrieved.is_some());
    }
}
