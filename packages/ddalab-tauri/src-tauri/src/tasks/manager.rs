// Task Manager - centralized management of cancellable async tasks
//
// Features:
// - Unified task registration and tracking
// - Graceful cancellation via CancellationToken
// - Progress reporting and state management
// - Auto-cleanup of old completed tasks
// - Thread-safe access via parking_lot::RwLock

use super::types::{
    TaskError, TaskHandle, TaskInfo, TaskProgress, TaskResult, TaskState, TaskType,
};
use chrono::Utc;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

const MAX_COMPLETED_TASKS: usize = 100;
const CLEANUP_INTERVAL_SECS: u64 = 300; // 5 minutes

pub struct TaskManager {
    tasks: RwLock<HashMap<String, TaskInfo>>,
    handles: RwLock<HashMap<String, TaskHandle>>,
    cleanup_running: RwLock<bool>,
}

impl TaskManager {
    pub fn new() -> Self {
        Self {
            tasks: RwLock::new(HashMap::new()),
            handles: RwLock::new(HashMap::new()),
            cleanup_running: RwLock::new(false),
        }
    }

    pub fn register_task(
        &self,
        name: impl Into<String>,
        task_type: TaskType,
    ) -> (String, CancellationToken) {
        let id = uuid::Uuid::new_v4().to_string();
        let cancel_token = CancellationToken::new();

        let task_info = TaskInfo::new(id.clone(), name, task_type);
        let handle = TaskHandle::new(id.clone(), cancel_token.clone());

        {
            let mut tasks = self.tasks.write();
            tasks.insert(id.clone(), task_info);
        }

        {
            let mut handles = self.handles.write();
            handles.insert(id.clone(), handle);
        }

        log::debug!("📋 Task registered: {}", id);
        (id, cancel_token)
    }

    pub fn register_task_with_id(
        &self,
        id: impl Into<String>,
        name: impl Into<String>,
        task_type: TaskType,
    ) -> CancellationToken {
        let id = id.into();
        let cancel_token = CancellationToken::new();

        let task_info = TaskInfo::new(id.clone(), name, task_type);
        let handle = TaskHandle::new(id.clone(), cancel_token.clone());

        {
            let mut tasks = self.tasks.write();
            tasks.insert(id.clone(), task_info);
        }

        {
            let mut handles = self.handles.write();
            handles.insert(id.clone(), handle);
        }

        log::debug!("📋 Task registered with ID: {}", id);
        cancel_token
    }

    pub fn spawn<F, Fut>(&self, name: impl Into<String>, task_type: TaskType, f: F) -> String
    where
        F: FnOnce(CancellationToken) -> Fut + Send + 'static,
        Fut: Future<Output = Result<(), TaskError>> + Send + 'static,
    {
        let (task_id, cancel_token) = self.register_task(name, task_type);

        self.mark_started(&task_id);

        let task_id_clone = task_id.clone();

        let join_handle = tokio::spawn(async move {
            let token_clone = cancel_token.clone();
            let result = f(cancel_token).await;

            // Note: We can't update tasks here since we moved self into Arc
            // The caller should handle completion via mark_completed/mark_failed
            match result {
                Ok(()) => {
                    if token_clone.is_cancelled() {
                        log::info!("📋 Task {} was cancelled", task_id_clone);
                    } else {
                        log::info!("📋 Task {} completed successfully", task_id_clone);
                    }
                }
                Err(e) => {
                    log::error!("📋 Task {} failed: {}", task_id_clone, e);
                }
            }
        });

        // Store the join handle
        if let Some(handle) = self.handles.write().get_mut(&task_id) {
            handle.join_handle = Some(join_handle);
        }

        task_id
    }

    pub fn spawn_blocking<F, T>(&self, name: impl Into<String>, task_type: TaskType, f: F) -> String
    where
        F: FnOnce(CancellationToken) -> T + Send + 'static,
        T: Send + 'static,
    {
        let (task_id, cancel_token) = self.register_task(name, task_type);

        self.mark_started(&task_id);

        let task_id_clone = task_id.clone();

        let join_handle = tokio::task::spawn_blocking(move || {
            let token_clone = cancel_token.clone();
            f(cancel_token);

            if token_clone.is_cancelled() {
                log::info!("📋 Blocking task {} was cancelled", task_id_clone);
            } else {
                log::info!("📋 Blocking task {} completed", task_id_clone);
            }
        });

        // Convert JoinHandle<()> for storage
        let task_id_for_storage = task_id.clone();
        let async_handle = tokio::spawn(async move {
            let _ = join_handle.await;
        });

        if let Some(handle) = self.handles.write().get_mut(&task_id_for_storage) {
            handle.join_handle = Some(async_handle);
        }

        task_id
    }

    pub fn get_cancellation_token(&self, task_id: &str) -> Option<CancellationToken> {
        self.handles
            .read()
            .get(task_id)
            .map(|h| h.cancel_token.clone())
    }

    pub fn mark_started(&self, task_id: &str) {
        if let Some(task) = self.tasks.write().get_mut(task_id) {
            task.state = TaskState::Running;
            task.started_at = Some(Utc::now());
            log::debug!("📋 Task {} started", task_id);
        }
    }

    pub fn mark_completed(&self, task_id: &str) {
        if let Some(task) = self.tasks.write().get_mut(task_id) {
            task.state = TaskState::Completed;
            task.completed_at = Some(Utc::now());
            log::info!("Task {} completed", task_id);
        }
    }

    pub fn mark_cancelled(&self, task_id: &str) {
        if let Some(task) = self.tasks.write().get_mut(task_id) {
            task.state = TaskState::Cancelled;
            task.completed_at = Some(Utc::now());
            log::info!("🚫 Task {} cancelled", task_id);
        }
    }

    pub fn mark_failed(&self, task_id: &str, error: impl Into<String>) {
        if let Some(task) = self.tasks.write().get_mut(task_id) {
            let error_str = error.into();
            task.state = TaskState::Failed;
            task.completed_at = Some(Utc::now());
            task.error = Some(error_str.clone());
            log::error!("Task {} failed: {}", task_id, error_str);
        }
    }

    pub fn update_progress(&self, task_id: &str, progress: TaskProgress) {
        if let Some(task) = self.tasks.write().get_mut(task_id) {
            task.progress = Some(progress);
        }
    }

    pub fn cancel(&self, task_id: &str) -> TaskResult<()> {
        let handles = self.handles.read();
        if let Some(handle) = handles.get(task_id) {
            if handle.is_cancelled() {
                return Err(TaskError::AlreadyCancelled(task_id.to_string()));
            }
            handle.cancel();
            log::info!("🛑 Cancellation requested for task: {}", task_id);

            // Update state
            drop(handles);
            self.mark_cancelled(task_id);
            Ok(())
        } else {
            Err(TaskError::NotFound(task_id.to_string()))
        }
    }

    pub fn cancel_by_type(&self, task_type: TaskType) -> Vec<String> {
        let task_ids: Vec<String> = {
            let tasks = self.tasks.read();
            tasks
                .iter()
                .filter(|(_, info)| info.task_type == task_type && info.is_active())
                .map(|(id, _)| id.clone())
                .collect()
        };

        let mut cancelled = Vec::new();
        for task_id in task_ids {
            if self.cancel(&task_id).is_ok() {
                cancelled.push(task_id);
            }
        }

        log::info!(
            "🛑 Cancelled {} tasks of type {:?}",
            cancelled.len(),
            task_type
        );
        cancelled
    }

    pub fn cancel_all(&self) -> Vec<String> {
        let task_ids: Vec<String> = {
            let tasks = self.tasks.read();
            tasks
                .iter()
                .filter(|(_, info)| info.is_active())
                .map(|(id, _)| id.clone())
                .collect()
        };

        let mut cancelled = Vec::new();
        for task_id in task_ids {
            if self.cancel(&task_id).is_ok() {
                cancelled.push(task_id);
            }
        }

        log::info!("🛑 Cancelled all {} active tasks", cancelled.len());
        cancelled
    }

    pub fn get_task(&self, task_id: &str) -> Option<TaskInfo> {
        self.tasks.read().get(task_id).cloned()
    }

    pub fn get_tasks_by_type(&self, task_type: TaskType) -> Vec<TaskInfo> {
        self.tasks
            .read()
            .values()
            .filter(|info| info.task_type == task_type)
            .cloned()
            .collect()
    }

    pub fn get_active_tasks(&self) -> Vec<TaskInfo> {
        self.tasks
            .read()
            .values()
            .filter(|info| info.is_active())
            .cloned()
            .collect()
    }

    pub fn get_all_tasks(&self) -> Vec<TaskInfo> {
        self.tasks.read().values().cloned().collect()
    }

    pub fn is_task_cancelled(&self, task_id: &str) -> bool {
        self.handles
            .read()
            .get(task_id)
            .map(|h| h.is_cancelled())
            .unwrap_or(false)
    }

    pub fn remove_task(&self, task_id: &str) -> Option<TaskInfo> {
        self.handles.write().remove(task_id);
        let task = self.tasks.write().remove(task_id);
        if task.is_some() {
            log::debug!("📋 Task {} removed", task_id);
        }
        task
    }

    pub fn cleanup_completed_tasks(&self) {
        let terminal_tasks: Vec<(String, chrono::DateTime<Utc>)> = {
            let tasks = self.tasks.read();
            tasks
                .iter()
                .filter(|(_, info)| info.is_terminal())
                .filter_map(|(id, info)| info.completed_at.map(|t| (id.clone(), t)))
                .collect()
        };

        if terminal_tasks.len() <= MAX_COMPLETED_TASKS {
            return;
        }

        // Sort by completion time (oldest first)
        let mut sorted: Vec<_> = terminal_tasks;
        sorted.sort_by(|(_, a), (_, b)| a.cmp(b));

        // Remove oldest tasks
        let to_remove = sorted.len() - MAX_COMPLETED_TASKS;
        for (task_id, _) in sorted.into_iter().take(to_remove) {
            self.remove_task(&task_id);
        }

        log::info!("🧹 Cleaned up {} completed tasks", to_remove);
    }

    pub fn start_auto_cleanup(self: Arc<Self>) {
        {
            let mut running = self.cleanup_running.write();
            if *running {
                return;
            }
            *running = true;
        }

        let manager = self;
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(CLEANUP_INTERVAL_SECS)).await;
                manager.cleanup_completed_tasks();
            }
        });

        log::info!(
            "🧹 Auto-cleanup started (interval: {}s)",
            CLEANUP_INTERVAL_SECS
        );
    }

    pub fn active_count(&self) -> usize {
        self.tasks
            .read()
            .values()
            .filter(|info| info.is_active())
            .count()
    }

    pub fn total_count(&self) -> usize {
        self.tasks.read().len()
    }
}

impl Default for TaskManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_task_registration() {
        let manager = TaskManager::new();
        let (task_id, _token) = manager.register_task("Test Task", TaskType::Other);

        let task = manager.get_task(&task_id).expect("Task should exist");
        assert_eq!(task.name, "Test Task");
        assert_eq!(task.task_type, TaskType::Other);
        assert_eq!(task.state, TaskState::Pending);
    }

    #[test]
    fn test_task_state_transitions() {
        let manager = TaskManager::new();
        let (task_id, _token) = manager.register_task("Test Task", TaskType::Analysis);

        // Start task
        manager.mark_started(&task_id);
        let task = manager.get_task(&task_id).unwrap();
        assert_eq!(task.state, TaskState::Running);
        assert!(task.started_at.is_some());

        // Complete task
        manager.mark_completed(&task_id);
        let task = manager.get_task(&task_id).unwrap();
        assert_eq!(task.state, TaskState::Completed);
        assert!(task.completed_at.is_some());
    }

    #[test]
    fn test_task_cancellation() {
        let manager = TaskManager::new();
        let (task_id, token) = manager.register_task("Test Task", TaskType::Streaming);

        manager.mark_started(&task_id);
        assert!(!token.is_cancelled());

        manager.cancel(&task_id).unwrap();
        assert!(token.is_cancelled());

        let task = manager.get_task(&task_id).unwrap();
        assert_eq!(task.state, TaskState::Cancelled);
    }

    #[test]
    fn test_cancel_by_type() {
        let manager = TaskManager::new();

        manager.register_task("Stream 1", TaskType::Streaming);
        manager.register_task("Stream 2", TaskType::Streaming);
        manager.register_task("Analysis 1", TaskType::Analysis);

        // Start all tasks
        for task in manager.get_all_tasks() {
            manager.mark_started(&task.id);
        }

        // Cancel only streaming tasks
        let cancelled = manager.cancel_by_type(TaskType::Streaming);
        assert_eq!(cancelled.len(), 2);

        // Check analysis task is still running
        let analysis_tasks = manager.get_tasks_by_type(TaskType::Analysis);
        assert_eq!(analysis_tasks.len(), 1);
        assert_eq!(analysis_tasks[0].state, TaskState::Running);
    }

    #[test]
    fn test_progress_update() {
        let manager = TaskManager::new();
        let (task_id, _token) = manager.register_task("File Processing", TaskType::FileProcessing);

        manager.mark_started(&task_id);

        // Update progress
        let progress = TaskProgress::new(50, Some(100)).with_message("Processing chunk 50/100");
        manager.update_progress(&task_id, progress);

        let task = manager.get_task(&task_id).unwrap();
        let prog = task.progress.unwrap();
        assert_eq!(prog.current, 50);
        assert_eq!(prog.total, Some(100));
        assert_eq!(prog.percentage, Some(50.0));
    }

    #[tokio::test]
    async fn test_spawn_task() {
        let manager = TaskManager::new();

        let task_id = manager.spawn("Async Task", TaskType::Other, |cancel_token| async move {
            // Simulate work
            for i in 0..5 {
                if cancel_token.is_cancelled() {
                    return Err(TaskError::ExecutionError("Cancelled".to_string()));
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            Ok(())
        });

        // Give task time to complete
        tokio::time::sleep(Duration::from_millis(100)).await;

        let task = manager.get_task(&task_id);
        assert!(task.is_some());
    }

    #[test]
    fn test_cleanup_completed_tasks() {
        let manager = TaskManager::new();

        // Create more than MAX_COMPLETED_TASKS
        for i in 0..(MAX_COMPLETED_TASKS + 10) {
            let (task_id, _) = manager.register_task(format!("Task {}", i), TaskType::Other);
            manager.mark_started(&task_id);
            manager.mark_completed(&task_id);
        }

        assert!(manager.total_count() > MAX_COMPLETED_TASKS);

        manager.cleanup_completed_tasks();

        assert_eq!(manager.total_count(), MAX_COMPLETED_TASKS);
    }
}
