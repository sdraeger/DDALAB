// Task management module for cancellable long-running operations
//
// Provides a unified interface for:
// - Task registration with unique IDs
// - Graceful cancellation via CancellationToken
// - Progress tracking and state management
// - Auto-cleanup of completed tasks

mod manager;
mod types;

pub use manager::TaskManager;
pub use types::{
    CancellableTask, TaskError, TaskHandle, TaskInfo, TaskProgress, TaskResult, TaskState, TaskType,
};

// Re-export CancellationToken for convenience
pub use tokio_util::sync::CancellationToken;
