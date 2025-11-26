// Task types and traits for the task management system

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;
use thiserror::Error;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Error)]
pub enum TaskError {
    #[error("Task not found: {0}")]
    NotFound(String),

    #[error("Task already cancelled: {0}")]
    AlreadyCancelled(String),

    #[error("Task already completed: {0}")]
    AlreadyCompleted(String),

    #[error("Failed to spawn task: {0}")]
    SpawnError(String),

    #[error("Task execution error: {0}")]
    ExecutionError(String),

    #[error("Task join error: {0}")]
    JoinError(String),
}

pub type TaskResult<T> = Result<T, TaskError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Pending,
    Running,
    Completed,
    Cancelled,
    Failed,
}

impl std::fmt::Display for TaskState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskState::Pending => write!(f, "pending"),
            TaskState::Running => write!(f, "running"),
            TaskState::Completed => write!(f, "completed"),
            TaskState::Cancelled => write!(f, "cancelled"),
            TaskState::Failed => write!(f, "failed"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskType {
    Streaming,
    Analysis,
    FileProcessing,
    Export,
    Import,
    NSGJob,
    Migration,
    Other,
}

impl std::fmt::Display for TaskType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskType::Streaming => write!(f, "streaming"),
            TaskType::Analysis => write!(f, "analysis"),
            TaskType::FileProcessing => write!(f, "file_processing"),
            TaskType::Export => write!(f, "export"),
            TaskType::Import => write!(f, "import"),
            TaskType::NSGJob => write!(f, "nsg_job"),
            TaskType::Migration => write!(f, "migration"),
            TaskType::Other => write!(f, "other"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgress {
    pub current: u64,
    pub total: Option<u64>,
    pub message: Option<String>,
    pub percentage: Option<f64>,
}

impl TaskProgress {
    pub fn new(current: u64, total: Option<u64>) -> Self {
        let percentage = total.map(|t| {
            if t > 0 {
                (current as f64 / t as f64) * 100.0
            } else {
                0.0
            }
        });
        Self {
            current,
            total,
            message: None,
            percentage,
        }
    }

    pub fn with_message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }

    pub fn indeterminate(message: impl Into<String>) -> Self {
        Self {
            current: 0,
            total: None,
            message: Some(message.into()),
            percentage: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInfo {
    pub id: String,
    pub name: String,
    pub task_type: TaskType,
    pub state: TaskState,
    pub progress: Option<TaskProgress>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error: Option<String>,
}

impl TaskInfo {
    pub fn new(id: impl Into<String>, name: impl Into<String>, task_type: TaskType) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            task_type,
            state: TaskState::Pending,
            progress: None,
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
            error: None,
        }
    }

    pub fn is_active(&self) -> bool {
        matches!(self.state, TaskState::Pending | TaskState::Running)
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self.state,
            TaskState::Completed | TaskState::Cancelled | TaskState::Failed
        )
    }
}

pub struct TaskHandle {
    pub id: String,
    pub cancel_token: CancellationToken,
    pub join_handle: Option<JoinHandle<()>>,
}

impl TaskHandle {
    pub fn new(id: impl Into<String>, cancel_token: CancellationToken) -> Self {
        Self {
            id: id.into(),
            cancel_token,
            join_handle: None,
        }
    }

    pub fn with_join_handle(mut self, handle: JoinHandle<()>) -> Self {
        self.join_handle = Some(handle);
        self
    }

    pub fn cancel(&self) {
        self.cancel_token.cancel();
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel_token.is_cancelled()
    }
}

pub trait CancellableTask: Send + 'static {
    type Output: Send + 'static;

    fn execute(
        self,
        cancel_token: CancellationToken,
    ) -> Pin<Box<dyn Future<Output = Result<Self::Output, TaskError>> + Send>>;
}
