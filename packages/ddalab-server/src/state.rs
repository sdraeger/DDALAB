use sqlx::PgPool;
use std::sync::Arc;
use std::time::Instant;

use crate::auth::{AuthState, SessionManager};
use crate::config::ServerConfig;
use crate::jobs::{JobQueue, JobQueueConfig};
use crate::storage::{SharedResultStore, UserStore};
use crate::sync::UserRegistry;

/// Main server state shared across all handlers
pub struct ServerState {
    pub config: ServerConfig,
    pub registry: UserRegistry,
    pub share_store: Arc<dyn SharedResultStore>,
    pub user_store: Arc<dyn UserStore>,
    pub auth_state: Arc<AuthState>,
    pub job_queue: Arc<JobQueue>,
    pub start_time: Instant,
    pub db_pool: PgPool,
}

impl ServerState {
    pub fn new(
        config: ServerConfig,
        share_store: Arc<dyn SharedResultStore>,
        user_store: Arc<dyn UserStore>,
        db_pool: PgPool,
    ) -> Self {
        let session_manager = SessionManager::new(config.session_timeout_seconds);
        let auth_state = Arc::new(AuthState::new(
            session_manager,
            &config.broker_password,
            config.require_auth,
        ));

        // Initialize job queue with config
        let job_queue_config = JobQueueConfig {
            max_concurrent_jobs: config.max_concurrent_jobs,
            notification_capacity: 1000,
        };
        let job_queue = Arc::new(JobQueue::new(job_queue_config));

        Self {
            config,
            registry: UserRegistry::new(),
            share_store,
            user_store,
            auth_state,
            job_queue,
            start_time: Instant::now(),
            db_pool,
        }
    }

    /// Get uptime in seconds
    pub fn uptime_seconds(&self) -> u64 {
        self.start_time.elapsed().as_secs()
    }
}
