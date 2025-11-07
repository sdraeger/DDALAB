// Common types for the streaming module

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Result type for streaming operations
pub type StreamResult<T> = Result<T, StreamError>;

/// Errors that can occur during streaming operations
#[derive(Debug, Error)]
pub enum StreamError {
    #[error("Connection error: {0}")]
    Connection(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Parse error: {0}")]
    Parse(String),

    #[error("Buffer overflow: {0} items dropped")]
    BufferOverflow(usize),

    #[error("DDA processing error: {0}")]
    DDAProcessing(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),

    #[error("Stream not found: {0}")]
    StreamNotFound(String),

    #[error("Stream already running")]
    AlreadyRunning,

    #[error("WebSocket error: {0}")]
    WebSocket(String),

    #[error("Serial port error: {0}")]
    Serial(String),

    #[error("Network error: {0}")]
    Network(String),

    #[error("Channel closed")]
    ChannelClosed,

    #[error("Timeout: {0}")]
    Timeout(String),
}

/// Current state of a streaming session
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "data")]
pub enum StreamState {
    /// Stream is idle and not connected
    Idle,

    /// Stream is attempting to connect to source
    Connecting,

    /// Stream is actively running
    Running {
        started_at: f64,
        chunks_received: u64,
        results_generated: u64,
    },

    /// Stream is paused but connection maintained
    Paused { paused_at: f64 },

    /// Stream encountered an error
    Error { message: String },

    /// Stream has been stopped
    Stopped,
}

impl Default for StreamState {
    fn default() -> Self {
        Self::Idle
    }
}

/// Statistics about a streaming session
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StreamStats {
    pub total_chunks_received: u64,
    pub total_samples_received: u64,
    pub total_results_generated: u64,
    pub total_dropped_chunks: u64,
    pub current_buffer_size: usize,
    pub peak_buffer_size: usize,
    pub avg_processing_time_ms: f64,
    pub data_rate_samples_per_sec: f64,
}

/// Event emitted to frontend when stream data is updated
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamDataEvent {
    pub stream_id: String,
    pub chunks_processed: usize,
    pub results_count: usize,
    pub timestamp: f64,
    pub stats: StreamStats,
}

/// Event emitted when stream state changes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamStateEvent {
    pub stream_id: String,
    pub state: StreamState,
    pub timestamp: f64,
}
