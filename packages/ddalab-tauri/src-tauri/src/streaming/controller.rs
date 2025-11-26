// Stream controller - orchestrates streaming data flow and DDA processing
//
// The controller manages:
// - Data source lifecycle (connect, start, stop)
// - Data buffering and flow control
// - DDA processing coordination
// - Result buffering
// - Event emission to frontend
// - State management
// - Task cancellation via CancellationToken for graceful shutdown

use crate::streaming::{
    buffer::{CircularBuffer, CircularDataBuffer, OverflowStrategy},
    processor::{StreamingDDAConfig, StreamingDDAProcessor, StreamingDDAResult},
    source::{create_source, DataChunk, StreamSource, StreamSourceConfig},
    time_window_buffer::{TimeWindowBuffer, TimeWindowConfig},
    types::{StreamError, StreamResult, StreamState, StreamStats},
};
use parking_lot::RwLock;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::mpsc;
use tokio::sync::RwLock as TokioRwLock;
use tokio::time::{interval, Duration};
use tokio_util::sync::CancellationToken;

/// Stream controller configuration
pub struct StreamControllerConfig {
    pub stream_id: String,
    pub source_config: StreamSourceConfig,
    pub dda_config: StreamingDDAConfig,
    pub dda_binary_path: PathBuf,
    pub data_buffer_capacity: usize,
    pub result_buffer_capacity: usize,
    pub processing_batch_size: usize,
    pub processing_interval_ms: u64,
}

impl Default for StreamControllerConfig {
    fn default() -> Self {
        Self {
            stream_id: uuid::Uuid::new_v4().to_string(),
            source_config: StreamSourceConfig::FileStream {
                path: String::new(),
                chunk_size: 1000,
                rate_limit_ms: Some(100),
                loop_playback: false,
            },
            dda_config: StreamingDDAConfig::default(),
            dda_binary_path: PathBuf::from("run_DDA_AsciiEdf"),
            data_buffer_capacity: 1000,
            result_buffer_capacity: 500,
            processing_batch_size: 5,   // Smaller batches for lower latency
            processing_interval_ms: 50, // Process more frequently for smoother updates
        }
    }
}

/// Main stream controller
pub struct StreamController {
    pub id: String,
    config: StreamControllerConfig,

    // Components
    source: Arc<TokioRwLock<Box<dyn StreamSource>>>,
    data_buffer: Arc<CircularDataBuffer>,
    result_buffer: Arc<CircularBuffer<StreamingDDAResult>>,
    processor: Option<Arc<StreamingDDAProcessor>>,

    // Time-based windowing for efficient display
    time_window: Arc<TimeWindowBuffer>,

    // State
    state: Arc<RwLock<StreamState>>,
    is_running: Arc<AtomicBool>,
    stop_signal: Arc<AtomicBool>,

    // Cancellation token for graceful async cancellation
    cancel_token: CancellationToken,

    // Statistics
    total_chunks_received: Arc<AtomicU64>,
    total_results_generated: Arc<AtomicU64>,
    start_time: Arc<RwLock<Option<Instant>>>,

    // Event emission callback
    event_callback: Arc<RwLock<Option<Box<dyn Fn(StreamEvent) + Send + Sync>>>>,
}

/// Events emitted by the stream controller
#[derive(Debug, Clone)]
pub enum StreamEvent {
    StateChanged {
        stream_id: String,
        state: StreamState,
    },
    DataReceived {
        stream_id: String,
        chunks_count: usize,
    },
    ResultsReady {
        stream_id: String,
        results_count: usize,
    },
    Error {
        stream_id: String,
        error: String,
    },
    StatsUpdate {
        stream_id: String,
        stats: StreamStats,
    },
}

impl StreamController {
    /// Create a new stream controller
    pub fn new(config: StreamControllerConfig) -> StreamResult<Self> {
        let source = create_source(config.source_config.clone())?;

        let data_buffer = Arc::new(CircularDataBuffer::new(
            config.data_buffer_capacity,
            OverflowStrategy::DropOldest,
        ));

        let result_buffer = Arc::new(CircularBuffer::new(
            config.result_buffer_capacity,
            OverflowStrategy::DropOldest,
        ));

        // Create time window buffer for efficient display (30 second window, max 2000 points)
        let time_window = Arc::new(TimeWindowBuffer::new(TimeWindowConfig {
            window_seconds: 30.0,
            max_display_points: 2000,
            min_sample_interval: 0.001,
        }));

        Ok(Self {
            id: config.stream_id.clone(),
            config,
            source: Arc::new(TokioRwLock::new(source)),
            data_buffer,
            result_buffer,
            processor: None,
            time_window,
            state: Arc::new(RwLock::new(StreamState::Idle)),
            is_running: Arc::new(AtomicBool::new(false)),
            stop_signal: Arc::new(AtomicBool::new(false)),
            cancel_token: CancellationToken::new(),
            total_chunks_received: Arc::new(AtomicU64::new(0)),
            total_results_generated: Arc::new(AtomicU64::new(0)),
            start_time: Arc::new(RwLock::new(None)),
            event_callback: Arc::new(RwLock::new(None)),
        })
    }

    /// Set event callback function
    pub fn set_event_callback<F>(&self, callback: F)
    where
        F: Fn(StreamEvent) + Send + Sync + 'static,
    {
        *self.event_callback.write() = Some(Box::new(callback));
    }

    /// Emit an event
    fn emit_event(&self, event: StreamEvent) {
        if let Some(callback) = self.event_callback.read().as_ref() {
            callback(event);
        }
    }

    /// Start the streaming session
    pub async fn start(&mut self) -> StreamResult<()> {
        if self.is_running.load(Ordering::Relaxed) {
            return Err(StreamError::AlreadyRunning);
        }

        log::info!("Starting stream controller: {}", self.id);

        // Create a new cancellation token for this session
        self.cancel_token = CancellationToken::new();

        // Update state
        self.set_state(StreamState::Connecting);

        // Connect to source
        {
            let mut source = self.source.write().await;
            source.connect().await?;
        }

        // Get metadata and initialize processor
        let metadata = {
            let source = self.source.read().await;
            source.get_metadata()
        };

        log::info!(
            "Stream metadata: {} channels @ {} Hz",
            metadata.channels.len(),
            metadata.sample_rate
        );

        // Create DDA processor
        let processor = StreamingDDAProcessor::new(
            self.config.dda_config.clone(),
            self.config.dda_binary_path.clone(),
            metadata.channels.clone(),
            metadata.sample_rate,
        )?;
        self.processor = Some(Arc::new(processor));

        // Start producer (data source)
        self.start_producer().await?;

        // Start consumer (DDA processor)
        self.start_consumer().await;

        // Update state
        self.is_running.store(true, Ordering::Relaxed);
        self.stop_signal.store(false, Ordering::Relaxed);
        *self.start_time.write() = Some(Instant::now());

        self.set_state(StreamState::Running {
            started_at: chrono::Utc::now().timestamp() as f64,
            chunks_received: 0,
            results_generated: 0,
        });

        log::info!("Stream controller started successfully");

        Ok(())
    }

    /// Stop the streaming session
    pub async fn stop(&mut self) -> StreamResult<()> {
        if !self.is_running.load(Ordering::Relaxed) {
            return Ok(());
        }

        log::info!("Stopping stream controller: {}", self.id);

        // Cancel the token - this will immediately interrupt all waiting tasks
        self.cancel_token.cancel();

        // Also signal stop for backward compatibility with AtomicBool checks
        self.stop_signal.store(true, Ordering::Relaxed);

        // Stop source
        {
            let mut source = self.source.write().await;
            source.stop().await?;
        }

        // Update state
        self.is_running.store(false, Ordering::Relaxed);
        self.set_state(StreamState::Stopped);

        log::info!("Stream controller stopped");

        Ok(())
    }

    /// Get the cancellation token for external cancellation support
    pub fn cancellation_token(&self) -> CancellationToken {
        self.cancel_token.clone()
    }

    /// Pause the stream (maintains connection)
    pub async fn pause(&mut self) -> StreamResult<()> {
        self.set_state(StreamState::Paused {
            paused_at: chrono::Utc::now().timestamp() as f64,
        });
        Ok(())
    }

    /// Resume a paused stream
    pub async fn resume(&mut self) -> StreamResult<()> {
        self.set_state(StreamState::Running {
            started_at: self
                .start_time
                .read()
                .as_ref()
                .map(|t| t.elapsed().as_secs() as f64)
                .unwrap_or(0.0),
            chunks_received: self.total_chunks_received.load(Ordering::Relaxed),
            results_generated: self.total_results_generated.load(Ordering::Relaxed),
        });
        Ok(())
    }

    /// Start the data producer task
    async fn start_producer(&self) -> StreamResult<()> {
        let (tx, mut rx) = mpsc::channel::<DataChunk>(100);

        // Spawn source streaming task
        let source = Arc::clone(&self.source);
        let cancel_token_source = self.cancel_token.clone();

        tokio::spawn(async move {
            let mut source = source.write().await;
            // Use select! to allow cancellation during source.start()
            tokio::select! {
                result = source.start(tx) => {
                    if let Err(e) = result {
                        log::error!("Source streaming error: {}", e);
                    }
                }
                _ = cancel_token_source.cancelled() => {
                    log::info!("Source streaming cancelled");
                }
            }
        });

        // Spawn receiver task that adds chunks to buffer
        let data_buffer = Arc::clone(&self.data_buffer);
        let time_window = Arc::clone(&self.time_window);
        let chunks_received = Arc::clone(&self.total_chunks_received);
        let stream_id = self.id.clone();
        let event_callback = Arc::clone(&self.event_callback);
        let cancel_token_receiver = self.cancel_token.clone();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    // Check for cancellation first (biased ensures priority)
                    biased;

                    _ = cancel_token_receiver.cancelled() => {
                        log::info!("Producer receiver cancelled");
                        break;
                    }

                    chunk = rx.recv() => {
                        match chunk {
                            Some(chunk) => {
                                // Add to circular buffer for processing
                                if let Err(_dropped_chunk) = data_buffer.push(chunk.clone()) {
                                    log::warn!("Data buffer full, oldest chunk dropped");
                                }

                                // Add to time window buffer for efficient display
                                time_window.push_data(chunk);

                                chunks_received.fetch_add(1, Ordering::Relaxed);

                                // Emit event periodically
                                if chunks_received.load(Ordering::Relaxed) % 10 == 0 {
                                    if let Some(callback) = event_callback.read().as_ref() {
                                        callback(StreamEvent::DataReceived {
                                            stream_id: stream_id.clone(),
                                            chunks_count: chunks_received.load(Ordering::Relaxed) as usize,
                                        });
                                    }
                                }
                            }
                            None => {
                                log::info!("Producer channel closed");
                                break;
                            }
                        }
                    }
                }
            }
        });

        Ok(())
    }

    /// Start the DDA processing consumer task
    async fn start_consumer(&self) {
        let data_buffer = Arc::clone(&self.data_buffer);
        let result_buffer = Arc::clone(&self.result_buffer);
        let time_window = Arc::clone(&self.time_window);
        let processor = self.processor.as_ref().unwrap().clone();
        let results_generated = Arc::clone(&self.total_results_generated);
        let chunks_received = Arc::clone(&self.total_chunks_received);
        let stream_id = self.id.clone();
        let event_callback = Arc::clone(&self.event_callback);
        let batch_size = self.config.processing_batch_size;
        let interval_ms = self.config.processing_interval_ms;
        let start_time = Arc::clone(&self.start_time);
        let cancel_token = self.cancel_token.clone();

        tokio::spawn(async move {
            let mut tick = interval(Duration::from_millis(interval_ms));
            let mut last_stats_emit = std::time::Instant::now();

            loop {
                // Use select! for responsive cancellation
                tokio::select! {
                    biased;

                    _ = cancel_token.cancelled() => {
                        log::info!("Stream consumer task cancelled");
                        break;
                    }

                    _ = tick.tick() => {
                        // Emit stats every 500ms
                        if last_stats_emit.elapsed().as_millis() >= 500 {
                            if let Some(callback) = event_callback.read().as_ref() {
                                let elapsed_secs = start_time
                                    .read()
                                    .as_ref()
                                    .map(|t| t.elapsed().as_secs_f64())
                                    .unwrap_or(0.0);

                                let total_chunks = chunks_received.load(Ordering::Relaxed);
                                let total_samples = total_chunks * 1000; // Rough estimate
                                let _data_rate = if elapsed_secs > 0.0 {
                                    total_samples as f64 / elapsed_secs
                                } else {
                                    0.0
                                };

                                callback(StreamEvent::StatsUpdate {
                                    stream_id: stream_id.clone(),
                                    stats: StreamStats {
                                        total_chunks_received: total_chunks,
                                        total_samples_received: total_samples,
                                        total_results_generated: results_generated.load(Ordering::Relaxed),
                                        total_dropped_chunks: 0,
                                        current_buffer_size: data_buffer.len(),
                                        peak_buffer_size: 0,
                                        avg_processing_time_ms: 0.0,
                                        uptime_seconds: Some(elapsed_secs),
                                    },
                                });
                            }
                            last_stats_emit = std::time::Instant::now();
                        }

                        // Drain chunks from buffer
                        let chunks = data_buffer.drain(batch_size);

                        if chunks.is_empty() {
                            continue;
                        }

                        log::debug!("Processing {} chunks", chunks.len());

                        // Process with DDA (in blocking task to avoid blocking async executor)
                        let processor_clone = processor.clone();
                        let process_result =
                            tokio::task::spawn_blocking(move || processor_clone.process_chunks(&chunks))
                                .await;

                        match process_result {
                            Ok(Ok(results)) => {
                                let results_count = results.len();

                                // Add results to buffers
                                for result in results {
                                    // Add to circular buffer
                                    result_buffer.push(result.clone()).ok();
                                    // Add to time window buffer for efficient display
                                    time_window.push_result(result);
                                }

                                results_generated.fetch_add(results_count as u64, Ordering::Relaxed);

                                // Emit event
                                if let Some(callback) = event_callback.read().as_ref() {
                                    callback(StreamEvent::ResultsReady {
                                        stream_id: stream_id.clone(),
                                        results_count,
                                    });
                                }

                                log::debug!("Generated {} DDA results", results_count);
                            }
                            Ok(Err(e)) => {
                                log::error!("DDA processing error: {}", e);
                                if let Some(callback) = event_callback.read().as_ref() {
                                    callback(StreamEvent::Error {
                                        stream_id: stream_id.clone(),
                                        error: e.to_string(),
                                    });
                                }
                            }
                            Err(e) => {
                                log::error!("Task join error: {}", e);
                            }
                        }
                    }
                }
            }

            log::info!("Stream consumer task stopped");
        });
    }

    /// Get latest data chunks from buffer (downsampled for display)
    /// This uses the time window buffer which automatically handles:
    /// - Time-based expiration (only last 30 seconds kept)
    /// - Intelligent downsampling (max 2000 points)
    /// - No memory unbounded growth
    pub fn get_latest_data(&self, _count: usize) -> Vec<DataChunk> {
        // Use time window buffer for downsampled, time-bounded data
        self.time_window.get_display_data()
    }

    /// Get latest DDA results from buffer
    pub fn get_latest_results(&self, count: usize) -> Vec<StreamingDDAResult> {
        // Use time window buffer for time-bounded results
        self.time_window.get_results(Some(count))
    }

    /// Get current stream state
    pub fn get_state(&self) -> StreamState {
        self.state.read().clone()
    }

    /// Get current statistics
    pub fn get_stats(&self) -> StreamStats {
        let data_metrics = self.data_buffer.get_metrics();
        let elapsed_secs = self
            .start_time
            .read()
            .as_ref()
            .map(|t| t.elapsed().as_secs_f64())
            .unwrap_or(0.0);

        let total_samples = self.total_chunks_received.load(Ordering::Relaxed) * 1000; // Rough estimate
        let data_rate = if elapsed_secs > 0.0 {
            total_samples as f64 / elapsed_secs
        } else {
            0.0
        };

        StreamStats {
            total_chunks_received: self.total_chunks_received.load(Ordering::Relaxed),
            total_samples_received: total_samples,
            total_results_generated: self.total_results_generated.load(Ordering::Relaxed),
            total_dropped_chunks: data_metrics.total_dropped,
            current_buffer_size: data_metrics.current_size,
            peak_buffer_size: data_metrics.peak_size,
            avg_processing_time_ms: 0.0, // TODO: Track this
            uptime_seconds: Some(elapsed_secs),
        }
    }

    /// Check if stream is currently running
    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::Relaxed)
    }

    /// Clear all buffers
    pub fn clear_buffers(&self) {
        self.data_buffer.clear();
        self.result_buffer.clear();
        if let Some(processor) = &self.processor {
            processor.clear_buffer();
        }
    }

    /// Set state and emit event
    fn set_state(&self, state: StreamState) {
        *self.state.write() = state.clone();
        self.emit_event(StreamEvent::StateChanged {
            stream_id: self.id.clone(),
            state,
        });
    }
}

impl Drop for StreamController {
    fn drop(&mut self) {
        // Ensure stream is stopped on drop - cancel token triggers immediate shutdown
        self.cancel_token.cancel();
        self.stop_signal.store(true, Ordering::Relaxed);
        log::info!("StreamController {} dropped", self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_controller_creation() {
        let config = StreamControllerConfig {
            source_config: StreamSourceConfig::FileStream {
                path: "/tmp/test.edf".to_string(),
                chunk_size: 100,
                rate_limit_ms: Some(10),
                loop_playback: false,
            },
            ..Default::default()
        };

        // Controller creation might fail if file doesn't exist, but structure should be sound
        let result = StreamController::new(config);
        // Just verify it returns a result (may be error if file doesn't exist)
        assert!(result.is_ok() || result.is_err());
    }
}
