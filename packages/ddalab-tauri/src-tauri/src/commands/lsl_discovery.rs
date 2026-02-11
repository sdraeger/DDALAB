// LSL stream discovery commands
//
// Uses the Python LSL bridge sidecar for stream discovery,
// avoiding the need for the native lsl crate which has build issues
// on modern toolchains.

use super::streaming_commands::StreamingState;
use std::sync::Arc;
use tauri::State;

// Re-export LslStreamInfo from the lib crate for use in commands
pub use ddalab_tauri::streaming::LslStreamInfo;

#[tauri::command]
pub async fn discover_lsl_streams(
    state: State<'_, Arc<StreamingState>>,
    timeout_seconds: Option<f64>,
) -> Result<Vec<LslStreamInfo>, String> {
    let timeout = timeout_seconds.unwrap_or(1.0);
    let bridge = state.lsl_bridge().await;
    bridge.discover(timeout).await
}

#[tauri::command]
pub async fn discover_lsl_streams_by_type(
    state: State<'_, Arc<StreamingState>>,
    stream_type: String,
    timeout_seconds: Option<f64>,
) -> Result<Vec<LslStreamInfo>, String> {
    let timeout = timeout_seconds.unwrap_or(1.0);
    let bridge = state.lsl_bridge().await;
    bridge.discover_by_type(&stream_type, timeout).await
}
