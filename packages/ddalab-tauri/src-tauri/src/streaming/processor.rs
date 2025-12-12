// Streaming DDA processor with parallel computation using Rayon
//
// Processes incoming data chunks with sliding window DDA analysis,
// utilizing all available CPU cores for maximum throughput.
//
// Uses ringbuffer for memory-efficient sliding window storage.

use crate::streaming::source::DataChunk;
use crate::streaming::types::{StreamError, StreamResult};
use dda_rs::{
    AlgorithmSelection, DDARequest, DDARunner, DelayParameters, ModelParameters,
    PreprocessingOptions, TimeRange, WindowParameters,
};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

/// Resource limits for streaming processor to prevent DoS
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamingResourceLimits {
    /// Maximum buffer size in samples per channel (prevents OOM)
    pub max_buffer_samples: usize,
    /// Maximum number of threads in thread pool
    pub max_threads: usize,
    /// Maximum windows to process in single batch
    pub max_windows_per_batch: usize,
}

impl Default for StreamingResourceLimits {
    fn default() -> Self {
        Self {
            max_buffer_samples: 1_000_000,       // ~4MB per channel at f32
            max_threads: num_cpus::get().min(8), // Cap at 8 threads
            max_windows_per_batch: 100,
        }
    }
}

/// Memory-efficient ringbuffer for streaming samples
/// Avoids repeated allocations by using fixed-size circular buffer
#[derive(Debug)]
pub struct ChannelRingBuffer {
    /// Fixed-size buffer for each channel
    buffers: Vec<Vec<f32>>,
    /// Write position (wraps around)
    write_pos: usize,
    /// Number of valid samples (up to capacity)
    count: usize,
    /// Buffer capacity per channel
    capacity: usize,
}

impl ChannelRingBuffer {
    pub fn new(num_channels: usize, capacity: usize) -> Self {
        let buffers = (0..num_channels).map(|_| vec![0.0f32; capacity]).collect();
        Self {
            buffers,
            write_pos: 0,
            count: 0,
            capacity,
        }
    }

    /// Push samples for all channels (assumes samples[ch].len() is same for all channels)
    pub fn push_samples(&mut self, samples: &[Vec<f32>]) -> Result<(), &'static str> {
        if samples.is_empty() || samples[0].is_empty() {
            return Ok(());
        }

        let num_new = samples[0].len();

        // Check if we'd overflow buffer
        if num_new > self.capacity {
            return Err("Samples exceed buffer capacity");
        }

        for (ch_idx, channel_samples) in samples.iter().enumerate() {
            if ch_idx >= self.buffers.len() {
                continue;
            }

            for &sample in channel_samples {
                self.buffers[ch_idx][self.write_pos] = sample;
                self.write_pos = (self.write_pos + 1) % self.capacity;
            }
        }

        // Update count (saturates at capacity)
        self.count = (self.count + num_new).min(self.capacity);
        // Adjust write_pos for multi-sample push
        self.write_pos = (self.write_pos + num_new - samples[0].len()) % self.capacity;
        self.write_pos = (self.write_pos + samples[0].len()) % self.capacity;

        Ok(())
    }

    /// Extract a window of samples starting at given offset from the oldest sample
    ///
    /// Uses parallel extraction across channels for better performance on many-channel data
    pub fn extract_window(&self, start_offset: usize, window_size: usize) -> Option<Vec<Vec<f32>>> {
        if start_offset + window_size > self.count {
            return None;
        }

        // Calculate actual start position in circular buffer
        let buffer_start = if self.count < self.capacity {
            // Buffer not yet full, starts at 0
            start_offset
        } else {
            // Buffer full, oldest sample is at write_pos
            (self.write_pos + start_offset) % self.capacity
        };

        let capacity = self.capacity;

        // Parallelize across channels for better performance
        // Threshold: only parallelize for files with many channels
        const PAR_THRESHOLD: usize = 8;

        let result: Vec<Vec<f32>> = if self.buffers.len() >= PAR_THRESHOLD {
            self.buffers
                .par_iter()
                .map(|buffer| {
                    let mut window = Vec::with_capacity(window_size);
                    for i in 0..window_size {
                        let idx = (buffer_start + i) % capacity;
                        window.push(buffer[idx]);
                    }
                    window
                })
                .collect()
        } else {
            // Sequential for small number of channels
            self.buffers
                .iter()
                .map(|buffer| {
                    let mut window = Vec::with_capacity(window_size);
                    for i in 0..window_size {
                        let idx = (buffer_start + i) % capacity;
                        window.push(buffer[idx]);
                    }
                    window
                })
                .collect()
        };

        Some(result)
    }

    /// Discard oldest samples (after processing windows)
    pub fn discard_oldest(&mut self, num_samples: usize) {
        if num_samples >= self.count {
            self.count = 0;
        } else {
            self.count -= num_samples;
        }
    }

    /// Get number of valid samples
    pub fn len(&self) -> usize {
        self.count
    }

    /// Check if buffer is empty
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// Clear the buffer
    pub fn clear(&mut self) {
        self.count = 0;
        self.write_pos = 0;
    }

    /// Get buffer capacity
    pub fn capacity(&self) -> usize {
        self.capacity
    }
}

/// Configuration for streaming DDA processing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamingDDAConfig {
    /// Number of samples per DDA window
    pub window_size: usize,

    /// Overlap between consecutive windows (0.0 to 1.0)
    /// e.g., 0.5 = 50% overlap
    pub window_overlap: f64,

    /// DDA algorithm parameters
    pub window_parameters: WindowParameters,

    /// Delay parameters for DDA
    pub delay_parameters: DelayParameters,

    /// Algorithm selection (which variants to compute)
    pub algorithm_selection: AlgorithmSelection,

    /// Model parameters (expert mode)
    pub model_parameters: Option<ModelParameters>,

    /// Whether to include full Q matrices in results (can be large)
    pub include_q_matrices: bool,

    /// Channels to process (None = all channels)
    pub selected_channels: Option<Vec<usize>>,

    /// Resource limits to prevent DoS
    #[serde(default)]
    pub resource_limits: StreamingResourceLimits,
}

impl Default for StreamingDDAConfig {
    fn default() -> Self {
        Self {
            window_size: 1000,
            window_overlap: 0.5,
            window_parameters: WindowParameters {
                window_length: 100,
                window_step: 10,
                ct_window_length: None,
                ct_window_step: None,
            },
            delay_parameters: DelayParameters {
                delays: vec![7, 10],
            },
            algorithm_selection: AlgorithmSelection {
                enabled_variants: vec!["ST".to_string()],
                select_mask: Some("1 0 0 0".to_string()),
            },
            model_parameters: None,
            include_q_matrices: false,
            selected_channels: None,
            resource_limits: StreamingResourceLimits::default(),
        }
    }
}

/// Result from streaming DDA processing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamingDDAResult {
    /// Unique identifier for this result
    pub id: String,

    /// Unix timestamp when this window was processed
    pub timestamp: f64,

    /// Sample index where this window starts
    pub window_start: usize,

    /// Sample index where this window ends
    pub window_end: usize,

    /// Number of samples in this window
    pub num_samples: usize,

    /// Summary statistics for each variant (lightweight)
    pub variant_summaries: HashMap<String, VariantSummary>,

    /// Full Q matrices (optional, can be large)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub q_matrices: Option<HashMap<String, Vec<Vec<f64>>>>,

    /// Processing time in milliseconds
    pub processing_time_ms: f64,
}

/// Summary statistics for a variant (lightweight alternative to full Q matrix)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariantSummary {
    pub variant_id: String,
    pub variant_name: String,

    /// Mean Q value across all channels
    pub mean: f64,

    /// Standard deviation of Q values
    pub std_dev: f64,

    /// Minimum Q value
    pub min: f64,

    /// Maximum Q value
    pub max: f64,

    /// Number of channels
    pub num_channels: usize,

    /// Number of time points
    pub num_timepoints: usize,
}

/// Streaming DDA processor
///
/// Processes data chunks in sliding windows using Rayon for parallelization.
/// Uses ringbuffer for memory-efficient sample storage with configurable limits.
pub struct StreamingDDAProcessor {
    /// Configuration wrapped in Arc to avoid cloning on each window
    config: Arc<StreamingDDAConfig>,
    dda_runner: Arc<DDARunner>,
    thread_pool: rayon::ThreadPool,

    /// Ringbuffer for memory-efficient sample storage (replaces Vec<Vec<f32>>)
    sample_buffer: Arc<parking_lot::Mutex<ChannelRingBuffer>>,
    current_offset: Arc<AtomicU64>,

    /// Counter for rejected samples due to buffer overflow
    rejected_samples: Arc<AtomicUsize>,

    // Temporary directory for DDA input files
    temp_dir: PathBuf,

    // Channel metadata wrapped in Arc to avoid cloning
    channel_names: Arc<Vec<String>>,
    sample_rate: f32,
}

impl StreamingDDAProcessor {
    /// Create a new streaming DDA processor
    pub fn new(
        config: StreamingDDAConfig,
        dda_binary_path: PathBuf,
        channel_names: Vec<String>,
        sample_rate: f32,
    ) -> StreamResult<Self> {
        let dda_runner = DDARunner::new(&dda_binary_path).map_err(|e| {
            StreamError::DDAProcessing(format!("Failed to create DDA runner: {}", e))
        })?;

        // Create thread pool with resource-limited thread count
        let num_threads = config.resource_limits.max_threads;
        let thread_pool = rayon::ThreadPoolBuilder::new()
            .num_threads(num_threads)
            .thread_name(|i| format!("dda-stream-worker-{}", i))
            .build()
            .map_err(|e| {
                StreamError::DDAProcessing(format!("Failed to create thread pool: {}", e))
            })?;

        let temp_dir = std::env::temp_dir().join("ddalab_streaming");
        std::fs::create_dir_all(&temp_dir).map_err(|e| StreamError::Io(e))?;

        // Create ringbuffer with resource-limited capacity
        let num_channels = channel_names.len();
        let buffer_capacity = config.resource_limits.max_buffer_samples;
        let ring_buffer = ChannelRingBuffer::new(num_channels, buffer_capacity);

        log::info!(
            "📊 StreamingDDAProcessor created: {} channels, buffer capacity={}, threads={}",
            num_channels,
            buffer_capacity,
            num_threads
        );

        Ok(Self {
            config: Arc::new(config),
            dda_runner: Arc::new(dda_runner),
            thread_pool,
            sample_buffer: Arc::new(parking_lot::Mutex::new(ring_buffer)),
            current_offset: Arc::new(AtomicU64::new(0)),
            rejected_samples: Arc::new(AtomicUsize::new(0)),
            temp_dir,
            channel_names: Arc::new(channel_names),
            sample_rate,
        })
    }

    /// Process a single data chunk
    ///
    /// Adds the chunk to the internal ringbuffer and processes any complete windows.
    /// Rejects data if buffer would overflow (DoS protection).
    pub fn process_chunk(&self, chunk: &DataChunk) -> StreamResult<Vec<StreamingDDAResult>> {
        // Add chunk samples to ringbuffer
        let mut buffer = self.sample_buffer.lock();

        // Try to push samples to ringbuffer
        if let Err(e) = buffer.push_samples(&chunk.samples) {
            let rejected = self.rejected_samples.fetch_add(1, Ordering::Relaxed);
            if rejected % 100 == 0 {
                log::warn!(
                    "Ringbuffer overflow: {} (total rejected: {})",
                    e,
                    rejected + 1
                );
            }
            return Ok(Vec::new()); // Gracefully drop data instead of crashing
        }

        let total_samples = buffer.len();
        drop(buffer); // Release lock

        // Calculate how many windows we can process
        let stride = (self.config.window_size as f64 * (1.0 - self.config.window_overlap)) as usize;
        let stride = stride.max(1);

        let windows = self.create_windows_from_buffer()?;

        if windows.is_empty() {
            return Ok(Vec::new());
        }

        // Limit windows per batch (DoS protection)
        let max_windows = self.config.resource_limits.max_windows_per_batch;
        let windows_to_process = if windows.len() > max_windows {
            log::warn!(
                "Limiting windows from {} to {} (max_windows_per_batch)",
                windows.len(),
                max_windows
            );
            &windows[..max_windows]
        } else {
            &windows[..]
        };

        log::info!(
            "Processing {} windows in parallel",
            windows_to_process.len()
        );

        let results: Vec<StreamingDDAResult> = self.thread_pool.install(|| {
            windows_to_process
                .par_iter()
                .filter_map(|window| match self.process_window(window) {
                    Ok(result) => Some(result),
                    Err(e) => {
                        log::error!("Failed to process window: {}", e);
                        None
                    }
                })
                .collect()
        });

        // Discard processed samples from ringbuffer (keep overlap for next window)
        let mut buffer = self.sample_buffer.lock();
        let samples_to_keep = self.config.window_size - stride;
        let samples_to_discard = total_samples.saturating_sub(samples_to_keep);

        if samples_to_discard > 0 {
            buffer.discard_oldest(samples_to_discard);
            self.current_offset
                .fetch_add(samples_to_discard as u64, Ordering::Relaxed);
        }

        Ok(results)
    }

    /// Process multiple chunks in batch (more efficient)
    pub fn process_chunks(&self, chunks: &[DataChunk]) -> StreamResult<Vec<StreamingDDAResult>> {
        let mut all_results = Vec::new();

        for chunk in chunks {
            let results = self.process_chunk(chunk)?;
            all_results.extend(results);
        }

        Ok(all_results)
    }

    /// Create windows from the current ringbuffer
    ///
    /// Uses parallel extraction when many windows need to be created
    fn create_windows_from_buffer(&self) -> StreamResult<Vec<WindowData>> {
        let buffer = self.sample_buffer.lock();
        let total_samples = buffer.len();

        if total_samples < self.config.window_size {
            return Ok(Vec::new()); // Not enough data yet
        }

        let stride = (self.config.window_size as f64 * (1.0 - self.config.window_overlap)) as usize;
        let stride = stride.max(1);
        let window_size = self.config.window_size;

        // Pre-calculate number of windows and their start positions
        let num_windows = (total_samples - window_size) / stride + 1;
        let current_offset = self.current_offset.load(Ordering::Relaxed) as usize;

        // Generate window start positions
        let window_starts: Vec<usize> = (0..num_windows).map(|i| i * stride).collect();

        // Extract windows in parallel for better performance when many windows
        // Threshold: parallelize only when we have enough windows to benefit
        const PAR_THRESHOLD: usize = 4;

        let windows: Vec<WindowData> = if num_windows >= PAR_THRESHOLD {
            let timestamp = chrono::Utc::now().timestamp() as f64;
            window_starts
                .into_par_iter()
                .filter_map(|start| {
                    buffer
                        .extract_window(start, window_size)
                        .map(|samples| WindowData {
                            samples,
                            start_idx: current_offset + start,
                            timestamp,
                        })
                })
                .collect()
        } else {
            // Sequential for small number of windows (avoid parallel overhead)
            let timestamp = chrono::Utc::now().timestamp() as f64;
            window_starts
                .into_iter()
                .filter_map(|start| {
                    buffer
                        .extract_window(start, window_size)
                        .map(|samples| WindowData {
                            samples,
                            start_idx: current_offset + start,
                            timestamp,
                        })
                })
                .collect()
        };

        Ok(windows)
    }

    /// Process a single window with DDA
    fn process_window(&self, window: &WindowData) -> StreamResult<StreamingDDAResult> {
        let start_time = std::time::Instant::now();

        // Write window data to temporary file
        let temp_file = self
            .temp_dir
            .join(format!("stream_window_{}.ascii", window.start_idx));
        self.write_window_to_file(window, &temp_file)?;

        // If selected_channels is None, explicitly create a list of all channel indices
        let channels = self
            .config
            .selected_channels
            .clone()
            .or_else(|| Some((0..window.samples.len()).collect()));

        // Build DDA request
        let request = DDARequest {
            file_path: temp_file.to_str().unwrap().to_string(),
            channels,
            time_range: TimeRange {
                start: 0.0,
                end: window.samples[0].len() as f64 / self.sample_rate as f64,
            },
            preprocessing_options: PreprocessingOptions {
                highpass: None,
                lowpass: None,
            },
            algorithm_selection: self.config.algorithm_selection.clone(),
            window_parameters: self.config.window_parameters.clone(),
            delay_parameters: self.config.delay_parameters.clone(),
            ct_channel_pairs: None,
            cd_channel_pairs: None,
            model_parameters: self.config.model_parameters.clone(),
            variant_configs: None,
            sampling_rate: Some(self.sample_rate as f64),
        };

        // Run DDA using oneshot channel to avoid block_on() deadlock in Rayon thread pool
        // We spawn a task on the tokio runtime and use blocking_recv to wait for the result
        let dda_runner = Arc::clone(&self.dda_runner);
        let channel_names = Arc::clone(&self.channel_names);

        let dda_result = if let Ok(handle) = tokio::runtime::Handle::try_current() {
            // Use oneshot channel to safely bridge async and sync contexts
            let (tx, rx) = tokio::sync::oneshot::channel();

            handle.spawn(async move {
                let result = dda_runner
                    .run(&request, None, None, Some(&channel_names))
                    .await
                    .ok();
                let _ = tx.send(result);
            });

            // blocking_recv is safe here - we're in a Rayon worker thread, not blocking tokio
            rx.blocking_recv().ok().flatten()
        } else {
            // No runtime available - create a minimal one just for this call
            // This is a fallback for edge cases
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .ok()
                .and_then(|rt| {
                    rt.block_on(async {
                        dda_runner
                            .run(&request, None, None, Some(&channel_names))
                            .await
                            .ok()
                    })
                })
        }
        .ok_or_else(|| StreamError::DDAProcessing("DDA execution failed".to_string()))?;

        // Clean up temp file
        let _ = std::fs::remove_file(&temp_file);

        // Compute variant summaries and move Q matrices (avoiding clones)
        let mut variant_summaries = HashMap::new();
        let mut q_matrices = if self.config.include_q_matrices {
            Some(HashMap::new())
        } else {
            None
        };

        // Consume variants to avoid cloning large Q matrices
        if let Some(variants) = dda_result.variant_results {
            for variant in variants {
                // Compute summary using reference before consuming
                let summary = compute_variant_summary(&variant);
                let variant_id = variant.variant_id.clone();
                variant_summaries.insert(variant_id.clone(), summary);

                // Move Q matrix instead of cloning (avoids large allocation)
                if let Some(ref mut matrices) = q_matrices {
                    matrices.insert(variant_id, variant.q_matrix);
                }
            }
        }

        let processing_time = start_time.elapsed().as_secs_f64() * 1000.0;

        Ok(StreamingDDAResult {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: window.timestamp,
            window_start: window.start_idx,
            window_end: window.start_idx + window.samples[0].len(),
            num_samples: window.samples[0].len(),
            variant_summaries,
            q_matrices,
            processing_time_ms: processing_time,
        })
    }

    /// Write window data to a temporary ASCII file for DDA processing
    fn write_window_to_file(&self, window: &WindowData, path: &PathBuf) -> StreamResult<()> {
        use std::io::Write;

        let mut file = std::fs::File::create(path).map_err(|e| StreamError::Io(e))?;

        // Write samples in column format (each row is a time point, each column is a channel)
        let num_samples = window.samples[0].len();

        for sample_idx in 0..num_samples {
            let values: Vec<String> = window
                .samples
                .iter()
                .map(|channel| channel[sample_idx].to_string())
                .collect();

            writeln!(file, "{}", values.join("\t")).map_err(|e| StreamError::Io(e))?;
        }

        Ok(())
    }

    /// Clear the internal buffer (useful for restarting stream)
    pub fn clear_buffer(&self) {
        let mut buffer = self.sample_buffer.lock();
        buffer.clear();
        self.current_offset.store(0, Ordering::Relaxed);
        self.rejected_samples.store(0, Ordering::Relaxed);
    }

    /// Get current buffer status
    pub fn get_buffer_status(&self) -> BufferStatus {
        let buffer = self.sample_buffer.lock();
        let num_samples = buffer.len();

        BufferStatus {
            num_samples_buffered: num_samples,
            window_size: self.config.window_size,
            can_process: num_samples >= self.config.window_size,
            current_offset: self.current_offset.load(Ordering::Relaxed),
        }
    }

    /// Get number of rejected samples due to buffer overflow
    pub fn get_rejected_samples(&self) -> usize {
        self.rejected_samples.load(Ordering::Relaxed)
    }

    /// Get buffer capacity
    pub fn get_buffer_capacity(&self) -> usize {
        self.sample_buffer.lock().capacity()
    }
}

/// Status of the internal sample buffer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BufferStatus {
    pub num_samples_buffered: usize,
    pub window_size: usize,
    pub can_process: bool,
    pub current_offset: u64,
}

/// Data for a single window to be processed
struct WindowData {
    samples: Vec<Vec<f32>>,
    start_idx: usize,
    timestamp: f64,
}

/// Compute summary statistics for a variant result
fn compute_variant_summary(variant: &dda_rs::VariantResult) -> VariantSummary {
    let mut all_values: Vec<f64> = variant
        .q_matrix
        .par_iter()
        .flat_map(|row| row.par_iter().copied())
        .collect();

    if all_values.is_empty() {
        return VariantSummary {
            variant_id: variant.variant_id.clone(),
            variant_name: variant.variant_name.clone(),
            mean: 0.0,
            std_dev: 0.0,
            min: 0.0,
            max: 0.0,
            num_channels: variant.q_matrix.len(),
            num_timepoints: 0,
        };
    }

    all_values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let len = all_values.len() as f64;
    let mean = all_values.par_iter().sum::<f64>() / len;
    let variance = all_values
        .par_iter()
        .map(|v| (v - mean).powi(2))
        .sum::<f64>()
        / len;
    let std_dev = variance.sqrt();

    VariantSummary {
        variant_id: variant.variant_id.clone(),
        variant_name: variant.variant_name.clone(),
        mean,
        std_dev,
        min: all_values[0],
        max: all_values[all_values.len() - 1],
        num_channels: variant.q_matrix.len(),
        num_timepoints: variant.q_matrix.first().map(|r| r.len()).unwrap_or(0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_window_overlap_calculation() {
        let config = StreamingDDAConfig {
            window_size: 1000,
            window_overlap: 0.5,
            ..Default::default()
        };

        let stride = (config.window_size as f64 * (1.0 - config.window_overlap)) as usize;
        assert_eq!(stride, 500); // 50% overlap = 500 sample stride
    }
}
