// Tauri commands for streaming data functionality
//
// Provides frontend interface for:
// - Starting/stopping streams
// - Configuring stream sources and DDA parameters
// - Retrieving streaming data and results
// - Monitoring stream status and statistics

use ddalab_tauri::streaming::{
    controller::{StreamController, StreamControllerConfig, StreamEvent},
    processor::{StreamingDDAConfig, StreamingDDAResult},
    source::{DataChunk, StreamSourceConfig},
    types::{StreamState, StreamStats},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

/// Global state for managing active stream controllers
pub struct StreamingState {
    controllers: Mutex<HashMap<String, Arc<Mutex<StreamController>>>>,
    dda_binary_path: PathBuf,
}

impl StreamingState {
    pub fn new(dda_binary_path: PathBuf) -> Self {
        Self {
            controllers: Mutex::new(HashMap::new()),
            dda_binary_path,
        }
    }

    pub async fn add_controller(&self, id: String, controller: StreamController) {
        self.controllers
            .lock()
            .await
            .insert(id, Arc::new(Mutex::new(controller)));
    }

    pub async fn get_controller(&self, id: &str) -> Option<Arc<Mutex<StreamController>>> {
        self.controllers.lock().await.get(id).cloned()
    }

    pub async fn remove_controller(&self, id: &str) -> Option<Arc<Mutex<StreamController>>> {
        self.controllers.lock().await.remove(id)
    }

    pub async fn list_controllers(&self) -> Vec<String> {
        self.controllers.lock().await.keys().cloned().collect()
    }
}

/// Response containing stream ID
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamIdResponse {
    pub stream_id: String,
}

/// Request to start a new stream
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartStreamRequest {
    pub source_config: StreamSourceConfig,
    pub dda_config: StreamingDDAConfig,
    #[serde(default = "default_data_buffer_capacity")]
    pub data_buffer_capacity: usize,
    #[serde(default = "default_result_buffer_capacity")]
    pub result_buffer_capacity: usize,
    #[serde(default = "default_processing_batch_size")]
    pub processing_batch_size: usize,
    #[serde(default = "default_processing_interval_ms")]
    pub processing_interval_ms: u64,
}

fn default_data_buffer_capacity() -> usize {
    1000
}
fn default_result_buffer_capacity() -> usize {
    500
}
fn default_processing_batch_size() -> usize {
    10
}
fn default_processing_interval_ms() -> u64 {
    100
}

/// Start a new streaming session
#[tauri::command]
pub async fn start_stream(
    app: AppHandle,
    state: State<'_, Arc<StreamingState>>,
    request: StartStreamRequest,
) -> Result<StreamIdResponse, String> {
    log::info!("Starting new stream");

    let stream_id = uuid::Uuid::new_v4().to_string();

    let config = StreamControllerConfig {
        stream_id: stream_id.clone(),
        source_config: request.source_config,
        dda_config: request.dda_config,
        dda_binary_path: state.dda_binary_path.clone(),
        data_buffer_capacity: request.data_buffer_capacity,
        result_buffer_capacity: request.result_buffer_capacity,
        processing_batch_size: request.processing_batch_size,
        processing_interval_ms: request.processing_interval_ms,
    };

    let mut controller = StreamController::new(config)
        .map_err(|e| format!("Failed to create stream controller: {}", e))?;

    // Set up event callback to emit Tauri events
    let app_clone = app.clone();
    let stream_id_clone = stream_id.clone();
    controller.set_event_callback(move |event| {
        let payload = match event {
            StreamEvent::StateChanged { stream_id, state } => {
                serde_json::json!({
                    "type": "state_changed",
                    "stream_id": stream_id,
                    "state": state,
                })
            }
            StreamEvent::DataReceived {
                stream_id,
                chunks_count,
            } => {
                serde_json::json!({
                    "type": "data_received",
                    "stream_id": stream_id,
                    "chunks_count": chunks_count,
                })
            }
            StreamEvent::ResultsReady {
                stream_id,
                results_count,
            } => {
                serde_json::json!({
                    "type": "results_ready",
                    "stream_id": stream_id,
                    "results_count": results_count,
                })
            }
            StreamEvent::Error { stream_id, error } => {
                serde_json::json!({
                    "type": "error",
                    "stream_id": stream_id,
                    "error": error,
                })
            }
            StreamEvent::StatsUpdate { stream_id, stats } => {
                serde_json::json!({
                    "type": "stats_update",
                    "stream_id": stream_id,
                    "stats": stats,
                })
            }
        };

        app_clone.emit("stream-event", payload).ok();
    });

    // Start the stream
    controller
        .start()
        .await
        .map_err(|e| format!("Failed to start stream: {}", e))?;

    state.add_controller(stream_id.clone(), controller).await;

    log::info!("Stream started successfully: {}", stream_id);

    Ok(StreamIdResponse { stream_id })
}

/// Stop a streaming session
#[tauri::command]
pub async fn stop_stream(
    state: State<'_, Arc<StreamingState>>,
    stream_id: String,
) -> Result<(), String> {
    log::info!("Stopping stream: {}", stream_id);

    let controller = state
        .get_controller(&stream_id)
        .await
        .ok_or_else(|| format!("Stream not found: {}", stream_id))?;

    controller
        .lock()
        .await
        .stop()
        .await
        .map_err(|e| format!("Failed to stop stream: {}", e))?;

    // Remove from state
    state.remove_controller(&stream_id).await;

    log::info!("Stream stopped: {}", stream_id);

    Ok(())
}

/// Pause a streaming session
#[tauri::command]
pub async fn pause_stream(
    state: State<'_, Arc<StreamingState>>,
    stream_id: String,
) -> Result<(), String> {
    let controller = state
        .get_controller(&stream_id)
        .await
        .ok_or_else(|| format!("Stream not found: {}", stream_id))?;

    controller
        .lock()
        .await
        .pause()
        .await
        .map_err(|e| format!("Failed to pause stream: {}", e))?;

    Ok(())
}

/// Resume a paused streaming session
#[tauri::command]
pub async fn resume_stream(
    state: State<'_, Arc<StreamingState>>,
    stream_id: String,
) -> Result<(), String> {
    let controller = state
        .get_controller(&stream_id)
        .await
        .ok_or_else(|| format!("Stream not found: {}", stream_id))?;

    controller
        .lock()
        .await
        .resume()
        .await
        .map_err(|e| format!("Failed to resume stream: {}", e))?;

    Ok(())
}

/// Get latest data chunks from a stream
#[tauri::command]
pub async fn get_stream_data(
    state: State<'_, Arc<StreamingState>>,
    stream_id: String,
    count: usize,
) -> Result<Vec<DataChunk>, String> {
    let controller = state
        .get_controller(&stream_id)
        .await
        .ok_or_else(|| format!("Stream not found: {}", stream_id))?;

    let data = controller.lock().await.get_latest_data(count);
    Ok(data)
}

/// Get latest DDA results from a stream
#[tauri::command]
pub async fn get_stream_results(
    state: State<'_, Arc<StreamingState>>,
    stream_id: String,
    count: usize,
) -> Result<Vec<StreamingDDAResult>, String> {
    let controller = state
        .get_controller(&stream_id)
        .await
        .ok_or_else(|| format!("Stream not found: {}", stream_id))?;

    let results = controller.lock().await.get_latest_results(count);
    Ok(results)
}

/// Get current state of a stream
#[tauri::command]
pub async fn get_stream_state(
    state: State<'_, Arc<StreamingState>>,
    stream_id: String,
) -> Result<StreamState, String> {
    let controller = state
        .get_controller(&stream_id)
        .await
        .ok_or_else(|| format!("Stream not found: {}", stream_id))?;

    let stream_state = controller.lock().await.get_state();
    Ok(stream_state)
}

/// Get statistics for a stream
#[tauri::command]
pub async fn get_stream_stats(
    state: State<'_, Arc<StreamingState>>,
    stream_id: String,
) -> Result<StreamStats, String> {
    let controller = state
        .get_controller(&stream_id)
        .await
        .ok_or_else(|| format!("Stream not found: {}", stream_id))?;

    let stats = controller.lock().await.get_stats();
    Ok(stats)
}

/// List all active streams
#[tauri::command]
pub async fn list_streams(state: State<'_, Arc<StreamingState>>) -> Result<Vec<String>, String> {
    Ok(state.list_controllers().await)
}

/// Clear buffers for a stream
#[tauri::command]
pub async fn clear_stream_buffers(
    state: State<'_, Arc<StreamingState>>,
    stream_id: String,
) -> Result<(), String> {
    let controller = state
        .get_controller(&stream_id)
        .await
        .ok_or_else(|| format!("Stream not found: {}", stream_id))?;

    controller.lock().await.clear_buffers();

    Ok(())
}
