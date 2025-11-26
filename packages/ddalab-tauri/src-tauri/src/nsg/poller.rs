use super::job_manager::NSGJobManager;
use anyhow::{Context, Result};
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

const DEFAULT_POLL_INTERVAL_SECS: u64 = 300;
const FAST_POLL_INTERVAL_SECS: u64 = 60;
const MAX_POLL_ERRORS: u8 = 5;

pub struct NSGJobPoller {
    job_manager: Arc<NSGJobManager>,
    poll_interval: Duration,
    fast_poll_interval: Duration,
    cancel_token: CancellationToken,
}

impl NSGJobPoller {
    pub fn new(job_manager: Arc<NSGJobManager>) -> Self {
        Self {
            job_manager,
            poll_interval: Duration::from_secs(DEFAULT_POLL_INTERVAL_SECS),
            fast_poll_interval: Duration::from_secs(FAST_POLL_INTERVAL_SECS),
            cancel_token: CancellationToken::new(),
        }
    }

    pub fn with_poll_interval(mut self, seconds: u64) -> Self {
        self.poll_interval = Duration::from_secs(seconds);
        self
    }

    pub fn with_fast_poll_interval(mut self, seconds: u64) -> Self {
        self.fast_poll_interval = Duration::from_secs(seconds);
        self
    }

    /// Get the cancellation token for external use
    pub fn cancellation_token(&self) -> CancellationToken {
        self.cancel_token.clone()
    }

    pub async fn poll_once(&self) -> Result<Vec<String>> {
        let active_jobs = self
            .job_manager
            .get_active_jobs()
            .context("Failed to get active jobs")?;

        if active_jobs.is_empty() {
            log::debug!("🔄 No active NSG jobs to poll");
            return Ok(Vec::new());
        }

        log::info!("🔄 Polling {} active NSG jobs", active_jobs.len());

        let mut updated_jobs = Vec::new();
        let mut error_count = 0;

        for job in active_jobs {
            // Check for cancellation between job updates
            if self.cancel_token.is_cancelled() {
                log::info!("🛑 Polling cancelled mid-iteration");
                break;
            }

            match self.job_manager.update_job_status(&job.id).await {
                Ok(updated_job) => {
                    if updated_job.status != job.status {
                        log::info!(
                            "📊 Job {} status changed: {:?} -> {:?}",
                            updated_job.id,
                            job.status,
                            updated_job.status
                        );
                        updated_jobs.push(updated_job.id.clone());
                    }
                }
                Err(e) => {
                    log::error!("❌ Failed to update job {}: {}", job.id, e);
                    error_count += 1;

                    if error_count >= MAX_POLL_ERRORS {
                        log::error!("❌ Too many polling errors, stopping this round");
                        break;
                    }
                }
            }

            // Use select! for responsive cancellation during sleep
            tokio::select! {
                biased;
                _ = self.cancel_token.cancelled() => {
                    log::info!("🛑 Polling cancelled during job delay");
                    break;
                }
                _ = tokio::time::sleep(Duration::from_millis(500)) => {}
            }
        }

        Ok(updated_jobs)
    }

    pub fn start_polling(self: Arc<Self>) -> tokio::task::JoinHandle<()> {
        let poller = Arc::clone(&self);
        let cancel_token = self.cancel_token.clone();

        tokio::spawn(async move {
            log::info!(
                "🚀 Starting NSG job poller (interval: {}s)",
                poller.poll_interval.as_secs()
            );

            let mut iteration = 0u64;

            loop {
                // Check cancellation at start of each iteration
                if cancel_token.is_cancelled() {
                    break;
                }

                iteration += 1;
                log::debug!("🔄 Polling iteration #{}", iteration);

                match poller.poll_once().await {
                    Ok(updated_jobs) => {
                        if !updated_jobs.is_empty() {
                            log::info!(
                                "✅ Updated {} jobs in iteration #{}",
                                updated_jobs.len(),
                                iteration
                            );
                        }
                    }
                    Err(e) => {
                        log::error!("❌ Polling error in iteration #{}: {}", iteration, e);
                    }
                }

                // Check cancellation after polling
                if cancel_token.is_cancelled() {
                    break;
                }

                let active_jobs_count = poller
                    .job_manager
                    .get_active_jobs()
                    .unwrap_or_default()
                    .len();

                let sleep_duration = if active_jobs_count > 0 {
                    let has_recently_submitted = poller
                        .job_manager
                        .get_active_jobs()
                        .unwrap_or_default()
                        .iter()
                        .any(|j| {
                            j.submitted_at
                                .map(|t| {
                                    chrono::Utc::now().signed_duration_since(t).num_minutes() < 10
                                })
                                .unwrap_or(false)
                        });

                    if has_recently_submitted {
                        poller.fast_poll_interval
                    } else {
                        poller.poll_interval
                    }
                } else {
                    poller.poll_interval
                };

                log::debug!(
                    "💤 Sleeping for {}s until next poll",
                    sleep_duration.as_secs()
                );

                // Use select! for responsive cancellation during sleep
                tokio::select! {
                    biased;
                    _ = cancel_token.cancelled() => {
                        log::info!("🛑 NSG job poller cancelled during sleep");
                        break;
                    }
                    _ = tokio::time::sleep(sleep_duration) => {}
                }
            }

            log::info!("🛑 NSG job poller stopped");
        })
    }

    /// Stop polling - cancels the token immediately
    pub fn stop_polling(&self) {
        self.cancel_token.cancel();
        log::info!("🛑 Stopping NSG job poller");
    }

    /// Check if the poller is still running (not cancelled)
    pub fn is_running(&self) -> bool {
        !self.cancel_token.is_cancelled()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_poller_intervals() {
        let job_manager = Arc::new(
            NSGJobManager::new(
                crate::nsg::models::NSGCredentials {
                    username: "test".to_string(),
                    password: "test".to_string(),
                    app_key: "test".to_string(),
                },
                Arc::new(
                    crate::db::NSGJobsDatabase::new(&std::path::PathBuf::from(":memory:")).unwrap(),
                ),
                std::path::PathBuf::from("/tmp"),
            )
            .unwrap(),
        );

        let poller = NSGJobPoller::new(job_manager)
            .with_poll_interval(120)
            .with_fast_poll_interval(30);

        assert_eq!(poller.poll_interval, Duration::from_secs(120));
        assert_eq!(poller.fast_poll_interval, Duration::from_secs(30));
    }

    #[test]
    fn test_cancellation_token() {
        let job_manager = Arc::new(
            NSGJobManager::new(
                crate::nsg::models::NSGCredentials {
                    username: "test".to_string(),
                    password: "test".to_string(),
                    app_key: "test".to_string(),
                },
                Arc::new(
                    crate::db::NSGJobsDatabase::new(&std::path::PathBuf::from(":memory:")).unwrap(),
                ),
                std::path::PathBuf::from("/tmp"),
            )
            .unwrap(),
        );

        let poller = NSGJobPoller::new(job_manager);
        assert!(poller.is_running());

        poller.stop_polling();
        assert!(!poller.is_running());
    }
}
