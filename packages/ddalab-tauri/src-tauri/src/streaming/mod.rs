// Real-time data streaming and DDA processing module
//
// This module provides infrastructure for connecting to various streaming data sources,
// buffering incoming data, processing it with DDA in real-time, and emitting results
// to the frontend for visualization.
//
// Architecture:
// - `source`: Trait-based system for pluggable data sources (WebSocket, TCP, Serial, File, etc.)
// - `buffer`: Lock-free circular buffers for efficient data flow
// - `processor`: Parallel DDA computation using Rayon
// - `controller`: Lifecycle management and coordination
// - `commands`: Tauri command interface for frontend

pub mod buffer;
pub mod controller;
pub mod lsl_bridge;
pub mod processor;
pub mod source;
pub mod time_window_buffer;
pub mod types;

pub use buffer::{CircularDataBuffer, OverflowStrategy};
pub use controller::StreamController;
pub use lsl_bridge::{BridgeState, LslBridgeManager, LslStreamInfo};
pub use processor::StreamingDDAProcessor;
pub use source::{DataChunk, SourceMetadata, StreamSource, StreamSourceConfig};
pub use time_window_buffer::{TimeWindowBuffer, TimeWindowConfig, TimeWindowStats};
pub use types::{StreamError, StreamResult, StreamState};
