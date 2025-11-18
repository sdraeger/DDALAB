// LSL stream discovery commands

use serde::{Deserialize, Serialize};
use tokio::task;

/// Information about an available LSL stream
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LslStreamInfo {
    pub name: String,
    pub stream_type: String,
    pub channel_count: i32,
    pub sample_rate: f64,
    pub source_id: String,
    pub hostname: String,
}

/// Discover available LSL streams on the network
#[cfg(feature = "lsl-support")]
#[tauri::command]
pub async fn discover_lsl_streams(
    timeout_seconds: Option<f64>,
) -> Result<Vec<LslStreamInfo>, String> {
    use lsl;

    let timeout = timeout_seconds.unwrap_or(1.0);

    // Run LSL resolution in blocking thread pool
    task::spawn_blocking(move || {
        log::info!("Discovering LSL streams with timeout {}s", timeout);

        let streams = lsl::resolve_streams(timeout);

        let info_list: Vec<LslStreamInfo> = streams
            .iter()
            .map(|stream| LslStreamInfo {
                name: stream.name(),
                stream_type: stream.stream_type(),
                channel_count: stream.channel_count(),
                sample_rate: stream.nominal_srate(),
                source_id: stream.source_id(),
                hostname: stream.hostname(),
            })
            .collect();

        log::info!("Found {} LSL streams", info_list.len());
        Ok(info_list)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Discover LSL streams by type (e.g., "EEG", "Markers")
#[cfg(feature = "lsl-support")]
#[tauri::command]
pub async fn discover_lsl_streams_by_type(
    stream_type: String,
    timeout_seconds: Option<f64>,
) -> Result<Vec<LslStreamInfo>, String> {
    use lsl;

    let timeout = timeout_seconds.unwrap_or(1.0);

    task::spawn_blocking(move || {
        log::info!(
            "Discovering LSL streams of type '{}' with timeout {}s",
            stream_type,
            timeout
        );

        let streams = lsl::resolve_byprop("type", &stream_type, 0, timeout);

        let info_list: Vec<LslStreamInfo> = streams
            .iter()
            .map(|stream| LslStreamInfo {
                name: stream.name(),
                stream_type: stream.stream_type(),
                channel_count: stream.channel_count(),
                sample_rate: stream.nominal_srate(),
                source_id: stream.source_id(),
                hostname: stream.hostname(),
            })
            .collect();

        log::info!(
            "Found {} LSL streams of type '{}'",
            info_list.len(),
            stream_type
        );
        Ok(info_list)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Stub for when LSL support is not compiled in
#[cfg(not(feature = "lsl-support"))]
#[tauri::command]
pub async fn discover_lsl_streams(
    _timeout_seconds: Option<f64>,
) -> Result<Vec<LslStreamInfo>, String> {
    Err("LSL support not compiled in this build".to_string())
}

/// Stub for when LSL support is not compiled in
#[cfg(not(feature = "lsl-support"))]
#[tauri::command]
pub async fn discover_lsl_streams_by_type(
    _stream_type: String,
    _timeout_seconds: Option<f64>,
) -> Result<Vec<LslStreamInfo>, String> {
    Err("LSL support not compiled in this build".to_string())
}
