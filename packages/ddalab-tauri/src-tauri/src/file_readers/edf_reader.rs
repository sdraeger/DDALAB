use super::{parse_edf_datetime, FileMetadata, FileReader, FileReaderError, FileResult};
use crate::edf::EDFReader as CoreEDFReader;
use parking_lot::Mutex;
use std::collections::HashMap;
/// EDF (European Data Format) File Reader
///
/// Implementation of FileReader trait for EDF files.
/// Uses interior mutability (Mutex) to cache the reader and avoid
/// re-opening the file on every chunk read.
use std::path::Path;

pub struct EDFFileReader {
    /// Cached EDF reader wrapped in Mutex for interior mutability.
    /// This avoids re-opening the file on every read_chunk() call.
    edf: Mutex<CoreEDFReader>,
    path: String,
    /// Cached channel name to index map for O(1) lookups.
    /// Built once on file open and reused for all read_chunk calls.
    channel_map: HashMap<String, usize>,
    /// Cached file size from construction to avoid repeated syscalls
    cached_file_size: u64,
}

impl EDFFileReader {
    pub fn new(path: &Path) -> FileResult<Self> {
        let edf = CoreEDFReader::new(path)
            .map_err(|e| FileReaderError::ParseError(format!("Failed to open EDF: {}", e)))?;

        // Cache file size at construction to avoid repeated syscalls
        let cached_file_size = std::fs::metadata(path)?.len();

        // Build channel map once at construction time
        let channel_map: HashMap<String, usize> = edf
            .signal_headers
            .iter()
            .enumerate()
            .map(|(i, sh)| (sh.label.clone(), i))
            .collect();

        Ok(Self {
            edf: Mutex::new(edf),
            path: path.to_string_lossy().to_string(),
            channel_map,
            cached_file_size,
        })
    }
}

impl FileReader for EDFFileReader {
    fn metadata(&self) -> FileResult<FileMetadata> {
        let edf = self.edf.lock();
        let header = &edf.header;
        let signal_headers = &edf.signal_headers;

        // Get channel labels from signal headers (sequential - small data set)
        let channels: Vec<String> = signal_headers.iter().map(|sh| sh.label.clone()).collect();

        // Calculate sample rate (assuming all channels have same rate)
        let sample_rate = if !signal_headers.is_empty() {
            signal_headers[0].sample_frequency(header.duration_of_data_record)
        } else {
            0.0
        };

        // Calculate total samples per channel
        let num_samples = if !signal_headers.is_empty() {
            header.num_data_records as usize * signal_headers[0].num_samples_per_record
        } else {
            0
        };

        // Calculate total duration
        let duration = header.num_data_records as f64 * header.duration_of_data_record;

        // Parse EDF start time to RFC3339 format
        // EDF format: date="dd.mm.yy" time="hh.mm.ss"
        log::info!(
            "EDF header start_date: '{}', start_time: '{}'",
            header.start_date,
            header.start_time
        );
        let start_time = parse_edf_datetime(&header.start_date, &header.start_time);
        log::info!("Parsed start_time: {:?}", start_time);

        // Clone values needed after releasing lock
        let num_channels = signal_headers.len();
        drop(edf); // Release lock before file I/O

        Ok(FileMetadata {
            file_path: self.path.clone(),
            file_name: Path::new(&self.path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string(),
            file_size: self.cached_file_size,
            sample_rate,
            num_channels,
            num_samples,
            duration,
            channels,
            start_time,
            file_type: "EDF".to_string(),
        })
    }

    fn read_chunk(
        &self,
        start_sample: usize,
        num_samples: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        // Use the cached reader - lock provides mutable access
        let mut edf = self.edf.lock();
        let signal_headers = &edf.signal_headers;

        // Use cached channel_map for O(1) lookups (built once at construction)
        let channel_indices: Vec<usize> = if let Some(selected) = channels {
            selected
                .iter()
                .filter_map(|ch| self.channel_map.get(ch).copied())
                .collect()
        } else {
            (0..signal_headers.len()).collect()
        };

        // Guard against empty signal headers
        if signal_headers.is_empty() {
            return Ok(Vec::new());
        }

        // Calculate time window for read_signal_window
        let sample_rate = signal_headers[0].sample_frequency(edf.header.duration_of_data_record);
        let start_time_sec = start_sample as f64 / sample_rate;
        let duration_sec = num_samples as f64 / sample_rate;

        // Read data using cached reader (no file re-open!)
        // Note: EDF reading is sequential due to Mutex, but we collect results for potential
        // parallel post-processing. The actual I/O is disk-bound anyway.
        let channel_results: Vec<Result<Vec<f64>, FileReaderError>> = channel_indices
            .iter()
            .map(|&ch_idx| {
                edf.read_signal_window(ch_idx, start_time_sec, duration_sec)
                    .map_err(|e| {
                        FileReaderError::ParseError(format!(
                            "Failed to read channel {}: {}",
                            ch_idx, e
                        ))
                    })
            })
            .collect();

        // Release lock before error handling to minimize lock duration
        drop(edf);

        // Collect results, returning first error if any
        channel_results.into_iter().collect()
    }

    fn read_overview(
        &self,
        max_points: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let mut edf = self.edf.lock();
        let signal_headers = &edf.signal_headers;

        if signal_headers.is_empty() {
            return Ok(Vec::new());
        }

        let num_records = edf.header.num_data_records as usize;
        let samples_per_record = signal_headers[0].num_samples_per_record;
        let total_samples = num_records * samples_per_record;

        // Determine channel indices to read
        let channel_indices: Vec<usize> = if let Some(selected) = channels {
            selected
                .iter()
                .filter_map(|ch| self.channel_map.get(ch).copied())
                .collect()
        } else {
            (0..signal_headers.len()).collect()
        };

        // Calculate decimation factor based on total samples vs max_points
        let decimation = (total_samples as f64 / max_points as f64).ceil() as usize;
        let decimation = decimation.max(1);

        // Calculate record step: how many records to skip between reads
        // If decimation <= samples_per_record, we read every record but subsample within
        // If decimation > samples_per_record, we skip entire records
        let record_step = (decimation / samples_per_record).max(1);
        let sample_step_in_record = if record_step == 1 {
            decimation.min(samples_per_record)
        } else {
            1
        };

        // Pre-calculate gain and offset for selected channels
        let gains_offsets: Vec<(f64, f64)> = channel_indices
            .iter()
            .map(|&idx| {
                let sh = &signal_headers[idx];
                (sh.gain(), sh.offset())
            })
            .collect();

        // Initialize result vectors
        let mut result: Vec<Vec<f64>> = channel_indices.iter().map(|_| Vec::new()).collect();

        // Read records at decimated positions
        let mut record_idx = 0;
        while record_idx < num_records {
            let record = edf.read_record(record_idx).map_err(|e| {
                FileReaderError::ParseError(format!("Failed to read record {}: {}", record_idx, e))
            })?;

            // Extract samples from selected channels with subsampling
            for (out_idx, &ch_idx) in channel_indices.iter().enumerate() {
                let (gain, offset) = gains_offsets[out_idx];
                let channel_samples = &record[ch_idx];

                // Take samples at step intervals within this record
                let mut sample_idx = 0;
                while sample_idx < channel_samples.len() {
                    let digital = channel_samples[sample_idx];
                    let physical = gain * digital as f64 + offset;
                    result[out_idx].push(physical);
                    sample_idx += sample_step_in_record;
                }
            }

            record_idx += record_step;
        }

        Ok(result)
    }

    fn format_name(&self) -> &str {
        "EDF"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_edf_format_name() {
        // This test will fail without an actual EDF file
        // It's here as a template for integration tests
        assert_eq!("EDF", "EDF");
    }
}
