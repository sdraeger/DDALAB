use crate::api::models::ChunkData;
use crate::db::overview_cache_db::{OverviewCacheDatabase, OverviewCacheMetadata, OverviewSegment};
use crate::edf::EDFReader;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// Segment size for progressive generation (samples per segment)
const SEGMENT_SIZE: usize = 100_000;

/// Progressive overview generator with cancellation support
#[derive(Clone)]
pub struct ProgressiveOverviewGenerator {
    cache_db: Arc<OverviewCacheDatabase>,
}

impl ProgressiveOverviewGenerator {
    pub fn new(cache_db: Arc<OverviewCacheDatabase>) -> Self {
        Self { cache_db }
    }

    /// Generate or resume overview generation for an EDF file
    pub async fn generate_overview(
        &self,
        file_path: &str,
        max_points: usize,
        selected_channels: Option<Vec<String>>,
        cancel_flag: Option<Arc<AtomicBool>>,
    ) -> Result<ChunkData, String> {
        let path = Path::new(file_path);

        // Get file metadata for cache validation
        let file_metadata = std::fs::metadata(path)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?;
        let file_size = file_metadata.len();
        let file_modified_time = file_metadata
            .modified()
            .map_err(|e| format!("Failed to get file modified time: {}", e))?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| format!("Failed to convert modified time: {}", e))?
            .as_secs() as i64;

        // Open EDF file to get metadata
        let edf = EDFReader::new(path)
            .map_err(|e| format!("Failed to open EDF file: {}", e))?;

        // Determine channels to process
        let (channels_to_read, channel_labels) = self.determine_channels(&edf, selected_channels)?;

        if channels_to_read.is_empty() {
            return Err("No valid channels found".to_string());
        }

        let sample_rate = edf.signal_headers[channels_to_read[0]]
            .sample_frequency(edf.header.duration_of_data_record);
        let duration = edf.header.num_data_records as f64 * edf.header.duration_of_data_record;
        let total_samples = (duration * sample_rate) as usize;

        log::info!(
            "[PROGRESSIVE OVERVIEW] File: '{}', duration={:.2}s, total_samples={}, max_points={}",
            file_path,
            duration,
            total_samples,
            max_points
        );

        // Run ALL database and file I/O in ONE single blocking task to avoid deadlock
        let generator = self.clone();
        let file_path_str = file_path.to_string();
        let path_clone = path.to_path_buf();
        let channels_clone = channels_to_read.to_vec();
        let labels_clone = channel_labels.clone();

        tokio::task::spawn_blocking(move || {
            // Get or create cache metadata
            let cache_metadata = generator.cache_db.get_or_create_cache_metadata(
                &file_path_str,
                file_size,
                file_modified_time,
                max_points,
                &labels_clone,
                total_samples,
            )
            .map_err(|e| format!("Failed to get/create cache metadata: {}", e))?;

            // Check if cache is complete
            if cache_metadata.is_complete {
                return generator.retrieve_cached_overview_sync(&cache_metadata, sample_rate, total_samples);
            }

            generator.generate_progressive_sync(
                &cache_metadata,
                &path_clone,
                &channels_clone,
                &labels_clone,
                sample_rate,
                duration,
                total_samples,
                max_points,
                cancel_flag,
            )
        })
        .await
        .map_err(|e| format!("Join error: {}", e))?
    }

    /// Determine which channels to process
    fn determine_channels(
        &self,
        edf: &EDFReader,
        selected_channels: Option<Vec<String>>,
    ) -> Result<(Vec<usize>, Vec<String>), String> {
        let channels_to_read: Vec<usize>;
        let channel_labels: Vec<String>;

        if let Some(ref selected) = selected_channels {
            let filtered_channels: Vec<usize> = selected
                .iter()
                .filter_map(|name| {
                    edf.signal_headers
                        .iter()
                        .position(|h| h.label.trim() == name.trim())
                })
                .collect();

            if filtered_channels.is_empty() {
                let num_fallback_channels = edf.signal_headers.len().min(10);
                log::warn!(
                    "[PROGRESSIVE OVERVIEW] None of the selected channels found, falling back to first {} channels",
                    num_fallback_channels
                );
                channels_to_read = (0..num_fallback_channels).collect();
                channel_labels = edf
                    .signal_headers
                    .iter()
                    .take(num_fallback_channels)
                    .map(|h| h.label.trim().to_string())
                    .collect();
            } else {
                channels_to_read = filtered_channels;
                channel_labels = channels_to_read
                    .iter()
                    .map(|&idx| edf.signal_headers[idx].label.trim().to_string())
                    .collect();
            }
        } else {
            channels_to_read = (0..edf.signal_headers.len()).collect();
            channel_labels = edf
                .signal_headers
                .iter()
                .map(|h| h.label.trim().to_string())
                .collect();
        }

        Ok((channels_to_read, channel_labels))
    }

    /// Generate overview progressively with checkpointing (synchronous, runs in blocking task)
    fn generate_progressive_sync(
        &self,
        cache_metadata: &OverviewCacheMetadata,
        file_path: &Path,
        channels_to_read: &[usize],
        channel_labels: &[String],
        sample_rate: f64,
        duration: f64,
        total_samples: usize,
        max_points: usize,
        cancel_flag: Option<Arc<AtomicBool>>,
    ) -> Result<ChunkData, String> {
        let bucket_size = (total_samples as f64 / max_points as f64).ceil() as usize;
        let bucket_size = bucket_size.max(1);

        // Determine starting point for each channel
        let mut channel_start_positions: Vec<usize> = Vec::new();
        for idx in 0..channels_to_read.len() {
            let last_end = self.cache_db
                .get_last_segment_end(cache_metadata.id, idx)
                .ok()
                .flatten()
                .unwrap_or(0);
            channel_start_positions.push(last_end);
        }

        // Process each channel
        for (channel_idx, &signal_idx) in channels_to_read.iter().enumerate() {
            let start_sample = channel_start_positions[channel_idx];

            if start_sample >= total_samples {
                continue;
            }

            let mut edf = EDFReader::new(file_path)
                .map_err(|e| format!("Failed to open EDF file: {}", e))?;
            let full_data = edf.read_signal_window(signal_idx, 0.0, duration)
                .map_err(|e| format!("Failed to read signal data: {}", e))?;

            // Process in segments
            let mut current_position = start_sample;

            while current_position < total_samples {
                // Check for cancellation
                if let Some(ref flag) = cancel_flag {
                    if flag.load(Ordering::Relaxed) {
                        log::info!("[PROGRESSIVE OVERVIEW] Generation cancelled");
                        return Err("Overview generation cancelled".to_string());
                    }
                }

                let segment_end = (current_position + SEGMENT_SIZE).min(total_samples);

                // Downsample this segment using min-max bucketing
                let mut downsampled_segment = Vec::new();
                let segment_start_bucket = current_position / bucket_size;
                let segment_end_bucket = (segment_end + bucket_size - 1) / bucket_size;

                for bucket_idx in segment_start_bucket..segment_end_bucket {
                    let bucket_start = bucket_idx * bucket_size;
                    let bucket_end = ((bucket_idx + 1) * bucket_size).min(total_samples);

                    // Get data within this bucket that falls in our segment
                    let data_start = bucket_start.max(current_position);
                    let data_end = bucket_end.min(segment_end);

                    if data_start >= data_end {
                        continue;
                    }

                    let bucket_data = &full_data[data_start..data_end];

                    if bucket_data.is_empty() {
                        continue;
                    }

                    let min_val = bucket_data.iter().copied().fold(f64::INFINITY, f64::min);
                    let max_val = bucket_data.iter().copied().fold(f64::NEG_INFINITY, f64::max);

                    downsampled_segment.push(min_val);
                    downsampled_segment.push(max_val);
                }

                // Save segment to database
                let segment = OverviewSegment {
                    cache_id: cache_metadata.id,
                    channel_index: channel_idx,
                    segment_start: current_position,
                    segment_end,
                    data: downsampled_segment,
                };

                self.cache_db
                    .save_segment(&segment)
                    .map_err(|e| format!("Failed to save segment: {}", e))?;

                current_position = segment_end;

                // Update progress in database after each segment
                let samples_processed = channel_idx * total_samples + current_position;
                self.cache_db
                    .update_progress(
                        cache_metadata.id,
                        samples_processed,
                        channels_to_read.len() * total_samples,
                    )
                    .map_err(|e| format!("Failed to update progress: {}", e))?;
            }
        }

        // Retrieve complete overview from cache
        self.retrieve_cached_overview_sync(cache_metadata, sample_rate, total_samples)
    }

    /// Retrieve complete overview from cache (synchronous, runs in blocking task)
    fn retrieve_cached_overview_sync(
        &self,
        cache_metadata: &OverviewCacheMetadata,
        sample_rate: f64,
        total_samples: usize,
    ) -> Result<ChunkData, String> {
        // Get segments from database
        let segments = self.cache_db
            .get_segments(cache_metadata.id)
            .map_err(|e| format!("Failed to retrieve segments: {}", e))?;

        if segments.is_empty() {
            return Err("No segments found in cache".to_string());
        }

        // Group segments by channel
        let num_channels = cache_metadata.channels.len();
        let mut channel_data: Vec<Vec<f64>> = vec![Vec::new(); num_channels];

        for segment in segments {
            if segment.channel_index >= num_channels {
                log::warn!(
                    "[PROGRESSIVE OVERVIEW] Skipping segment with invalid channel_index: {}",
                    segment.channel_index
                );
                continue;
            }
            channel_data[segment.channel_index].extend(segment.data);
        }

        let result_size = channel_data.get(0).map(|v| v.len()).unwrap_or(0);

        Ok(ChunkData {
            data: channel_data,
            channel_labels: cache_metadata.channels.clone(),
            sampling_frequency: sample_rate,
            chunk_size: result_size,
            chunk_start: 0,
            total_samples: Some(total_samples as u64),
        })
    }
}
