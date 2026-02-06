use crate::api::models::ChunkData;
use crate::db::overview_cache_db::{OverviewCacheDatabase, OverviewCacheMetadata, OverviewSegment};
use crate::edf::EDFReader;
use crate::profiling::ProfileScope;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Segment size for progressive generation (samples per segment)
const SEGMENT_SIZE: usize = 100_000;

/// Number of EDF data records to read per chunk during streaming overview generation.
/// Controls peak memory: only RECORDS_PER_CHUNK * samples_per_record * 8 bytes per channel
/// are held in memory at a time, rather than the entire signal.
const RECORDS_PER_CHUNK: usize = 100;

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
        let file_metadata =
            std::fs::metadata(path).map_err(|e| format!("Failed to get file metadata: {}", e))?;
        let file_size = file_metadata.len();
        let file_modified_time = file_metadata
            .modified()
            .map_err(|e| format!("Failed to get file modified time: {}", e))?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| format!("Failed to convert modified time: {}", e))?
            .as_secs() as i64;

        // Open EDF file to get metadata
        let edf = EDFReader::new(path).map_err(|e| format!("Failed to open EDF file: {}", e))?;

        // Determine channels to process
        let (channels_to_read, channel_labels) =
            self.determine_channels(&edf, selected_channels)?;

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
            let cache_metadata = generator
                .cache_db
                .get_or_create_cache_metadata(
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
                return generator.retrieve_cached_overview_sync(
                    &cache_metadata,
                    sample_rate,
                    total_samples,
                );
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
            // Build HashMap for O(1) lookups instead of O(n) per channel
            let header_map: std::collections::HashMap<&str, usize> = edf
                .signal_headers
                .iter()
                .enumerate()
                .map(|(i, h)| (h.label.trim(), i))
                .collect();

            let filtered_channels: Vec<usize> = selected
                .iter()
                .filter_map(|name| header_map.get(name.trim()).copied())
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

    /// Generate overview progressively with checkpointing (synchronous, runs in blocking task).
    ///
    /// Reads EDF data in chunks of RECORDS_PER_CHUNK records at a time to avoid
    /// loading the entire signal into memory. Bucket min/max accumulators track
    /// partial results across chunk boundaries.
    fn generate_progressive_sync(
        &self,
        cache_metadata: &OverviewCacheMetadata,
        file_path: &Path,
        channels_to_read: &[usize],
        _channel_labels: &[String],
        sample_rate: f64,
        _duration: f64,
        total_samples: usize,
        max_points: usize,
        cancel_flag: Option<Arc<AtomicBool>>,
    ) -> Result<ChunkData, String> {
        let bucket_size = (total_samples as f64 / max_points as f64).ceil() as usize;
        let bucket_size = bucket_size.max(1);
        let num_buckets = (total_samples + bucket_size - 1) / bucket_size;

        let mut channel_start_positions: Vec<usize> = Vec::with_capacity(channels_to_read.len());
        for idx in 0..channels_to_read.len() {
            let last_end = self
                .cache_db
                .get_last_segment_end(cache_metadata.id, idx)
                .ok()
                .flatten()
                .unwrap_or(0);
            channel_start_positions.push(last_end);
        }

        for (channel_idx, &signal_idx) in channels_to_read.iter().enumerate() {
            let _profile_channel =
                ProfileScope::new(format!("overview_channel_processing_ch{}", channel_idx));

            let start_sample = channel_start_positions[channel_idx];

            if start_sample >= total_samples {
                continue;
            }

            let mut edf =
                EDFReader::new(file_path).map_err(|e| format!("Failed to open EDF file: {}", e))?;

            let record_duration = edf.header.duration_of_data_record;
            let num_records = edf.header.num_data_records as usize;
            let mut bucket_min = vec![f64::INFINITY; num_buckets];
            let mut bucket_max = vec![f64::NEG_INFINITY; num_buckets];

            let mut global_sample_offset: usize = 0;
            let mut record_cursor: usize = 0;
            let mut last_fully_emitted_bucket: usize = start_sample / bucket_size;
            let mut pending_segments: Vec<OverviewSegment> = Vec::new();
            let mut segment_start = start_sample;

            while record_cursor < num_records {
                if let Some(ref flag) = cancel_flag {
                    if flag.load(Ordering::Relaxed) {
                        log::info!("[PROGRESSIVE OVERVIEW] Generation cancelled");
                        if !pending_segments.is_empty() {
                            self.cache_db
                                .save_segments_batch(&pending_segments)
                                .map_err(|e| format!("Failed to save segments: {}", e))?;
                        }
                        return Err("Overview generation cancelled".to_string());
                    }
                }

                let records_to_read = RECORDS_PER_CHUNK.min(num_records - record_cursor);
                let chunk_start_time = record_cursor as f64 * record_duration;
                let chunk_duration = records_to_read as f64 * record_duration;

                let chunk_data = edf
                    .read_signal_window(signal_idx, chunk_start_time, chunk_duration)
                    .map_err(|e| format!("Failed to read signal chunk: {}", e))?;

                let chunk_len = chunk_data.len();

                for (i, &val) in chunk_data.iter().enumerate() {
                    let global_idx = global_sample_offset + i;
                    if global_idx < start_sample {
                        continue;
                    }
                    let b = global_idx / bucket_size;
                    if b >= num_buckets {
                        break;
                    }
                    if val < bucket_min[b] {
                        bucket_min[b] = val;
                    }
                    if val > bucket_max[b] {
                        bucket_max[b] = val;
                    }
                }

                global_sample_offset += chunk_len;
                record_cursor += records_to_read;

                let is_final = record_cursor >= num_records;
                let current_position = global_sample_offset.min(total_samples);
                if current_position - segment_start >= SEGMENT_SIZE || is_final {
                    let emit_up_to_bucket = if is_final {
                        num_buckets
                    } else {
                        current_position / bucket_size
                    };

                    let downsampled: Vec<f64> = (last_fully_emitted_bucket..emit_up_to_bucket)
                        .flat_map(|b| {
                            if bucket_min[b] <= bucket_max[b] {
                                vec![bucket_min[b], bucket_max[b]]
                            } else {
                                vec![]
                            }
                        })
                        .collect();

                    if !downsampled.is_empty() {
                        pending_segments.push(OverviewSegment {
                            cache_id: cache_metadata.id,
                            channel_index: channel_idx,
                            segment_start,
                            segment_end: current_position,
                            data: downsampled,
                        });
                    }

                    last_fully_emitted_bucket = emit_up_to_bucket;
                    segment_start = current_position;
                }
            }

            if !pending_segments.is_empty() {
                self.cache_db
                    .save_segments_batch(&pending_segments)
                    .map_err(|e| format!("Failed to save segments: {}", e))?;
            }

            let samples_processed = channel_idx.saturating_add(1).saturating_mul(total_samples);
            let total_work = channels_to_read.len().saturating_mul(total_samples);
            self.cache_db
                .update_progress(cache_metadata.id, samples_processed, total_work)
                .map_err(|e| format!("Failed to update progress: {}", e))?;
        }

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
        let segments = self
            .cache_db
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
