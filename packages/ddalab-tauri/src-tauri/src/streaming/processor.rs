// Streaming DDA processor with parallel computation using Rayon
//
// Processes incoming data chunks with sliding window DDA analysis,
// utilizing all available CPU cores for maximum throughput.

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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

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
/// Processes data chunks in sliding windows using Rayon for parallelization
pub struct StreamingDDAProcessor {
    config: StreamingDDAConfig,
    dda_runner: Arc<DDARunner>,
    thread_pool: rayon::ThreadPool,

    // Accumulator for buffering samples across chunks
    sample_buffer: Arc<parking_lot::Mutex<Vec<Vec<f32>>>>,
    current_offset: Arc<AtomicU64>,

    // Temporary directory for DDA input files
    temp_dir: PathBuf,

    // Channel metadata
    channel_names: Vec<String>,
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

        // Create thread pool for parallel processing
        let thread_pool = rayon::ThreadPoolBuilder::new()
            .num_threads(num_cpus::get())
            .thread_name(|i| format!("dda-stream-worker-{}", i))
            .build()
            .map_err(|e| {
                StreamError::DDAProcessing(format!("Failed to create thread pool: {}", e))
            })?;

        let temp_dir = std::env::temp_dir().join("ddalab_streaming");
        std::fs::create_dir_all(&temp_dir).map_err(|e| StreamError::Io(e))?;

        Ok(Self {
            config,
            dda_runner: Arc::new(dda_runner),
            thread_pool,
            sample_buffer: Arc::new(parking_lot::Mutex::new(Vec::new())),
            current_offset: Arc::new(AtomicU64::new(0)),
            temp_dir,
            channel_names,
            sample_rate,
        })
    }

    /// Process a single data chunk
    ///
    /// Adds the chunk to the internal buffer and processes any complete windows
    pub fn process_chunk(&self, chunk: &DataChunk) -> StreamResult<Vec<StreamingDDAResult>> {
        // Add chunk samples to buffer
        let mut buffer = self.sample_buffer.lock();

        // Initialize buffer with correct number of channels if empty
        if buffer.is_empty() {
            *buffer = vec![Vec::new(); chunk.num_channels()];
        }

        // Append samples from chunk
        for (ch_idx, channel_samples) in chunk.samples.iter().enumerate() {
            if ch_idx < buffer.len() {
                buffer[ch_idx].extend(channel_samples);
            }
        }

        let total_samples = buffer[0].len();
        drop(buffer); // Release lock

        // Calculate how many windows we can process
        let stride = (self.config.window_size as f64 * (1.0 - self.config.window_overlap)) as usize;
        let stride = stride.max(1); // Ensure at least 1 sample stride

        let windows = self.create_windows_from_buffer()?;

        if windows.is_empty() {
            return Ok(Vec::new());
        }

        // Process windows in parallel using Rayon
        log::info!("Processing {} windows in parallel", windows.len());

        let results: Vec<StreamingDDAResult> = self.thread_pool.install(|| {
            windows
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

        // Clean up processed samples from buffer (keep overlap for next window)
        let mut buffer = self.sample_buffer.lock();
        let samples_to_keep = self.config.window_size - stride;

        if total_samples > samples_to_keep {
            for channel in buffer.iter_mut() {
                *channel = channel.split_off(channel.len().saturating_sub(samples_to_keep));
            }

            // Update offset
            let samples_processed = total_samples - samples_to_keep;
            self.current_offset
                .fetch_add(samples_processed as u64, Ordering::Relaxed);
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

    /// Create windows from the current buffer
    fn create_windows_from_buffer(&self) -> StreamResult<Vec<WindowData>> {
        let buffer = self.sample_buffer.lock();
        let total_samples = buffer.first().map(|ch| ch.len()).unwrap_or(0);

        if total_samples < self.config.window_size {
            return Ok(Vec::new()); // Not enough data yet
        }

        let stride = (self.config.window_size as f64 * (1.0 - self.config.window_overlap)) as usize;
        let stride = stride.max(1);

        let mut windows = Vec::new();
        let current_offset = self.current_offset.load(Ordering::Relaxed) as usize;

        let mut start = 0;
        while start + self.config.window_size <= total_samples {
            // Extract window samples
            let window_samples: Vec<Vec<f32>> = buffer
                .iter()
                .map(|channel| channel[start..start + self.config.window_size].to_vec())
                .collect();

            windows.push(WindowData {
                samples: window_samples,
                start_idx: current_offset + start,
                timestamp: chrono::Utc::now().timestamp() as f64,
            });

            start += stride;
        }

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
        };

        // Run DDA using oneshot channel to avoid block_on() deadlock in Rayon thread pool
        // We spawn a task on the tokio runtime and use blocking_recv to wait for the result
        let dda_runner = Arc::clone(&self.dda_runner);
        let channel_names = self.channel_names.clone();

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

        // Compute variant summaries
        let mut variant_summaries = HashMap::new();
        let mut q_matrices = if self.config.include_q_matrices {
            Some(HashMap::new())
        } else {
            None
        };

        if let Some(variants) = dda_result.variant_results.as_ref() {
            for variant in variants {
                let summary = compute_variant_summary(variant);
                variant_summaries.insert(variant.variant_id.clone(), summary);

                if let Some(ref mut matrices) = q_matrices {
                    matrices.insert(variant.variant_id.clone(), variant.q_matrix.clone());
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
    }

    /// Get current buffer status
    pub fn get_buffer_status(&self) -> BufferStatus {
        let buffer = self.sample_buffer.lock();
        let num_samples = buffer.first().map(|ch| ch.len()).unwrap_or(0);

        BufferStatus {
            num_samples_buffered: num_samples,
            window_size: self.config.window_size,
            can_process: num_samples >= self.config.window_size,
            current_offset: self.current_offset.load(Ordering::Relaxed),
        }
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
