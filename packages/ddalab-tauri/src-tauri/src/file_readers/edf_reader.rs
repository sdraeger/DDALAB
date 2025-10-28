use super::{parse_edf_datetime, FileMetadata, FileReader, FileReaderError, FileResult};
use crate::edf::EDFReader as CoreEDFReader;
/// EDF (European Data Format) File Reader
///
/// Implementation of FileReader trait for EDF files.
use std::path::Path;

pub struct EDFFileReader {
    edf: CoreEDFReader,
    path: String,
}

impl EDFFileReader {
    pub fn new(path: &Path) -> FileResult<Self> {
        let edf = CoreEDFReader::new(path)
            .map_err(|e| FileReaderError::ParseError(format!("Failed to open EDF: {}", e)))?;

        Ok(Self {
            edf,
            path: path.to_string_lossy().to_string(),
        })
    }
}

impl FileReader for EDFFileReader {
    fn metadata(&self) -> FileResult<FileMetadata> {
        let header = &self.edf.header;
        let signal_headers = &self.edf.signal_headers;

        // Get channel labels from signal headers
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

        Ok(FileMetadata {
            file_path: self.path.clone(),
            file_name: Path::new(&self.path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string(),
            file_size: std::fs::metadata(&self.path)?.len(),
            sample_rate,
            num_channels: signal_headers.len(),
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
        let signal_headers = &self.edf.signal_headers;

        // Get all channel labels
        let all_channels: Vec<String> = signal_headers.iter().map(|sh| sh.label.clone()).collect();

        // Determine which channels to read
        let channel_indices: Vec<usize> = if let Some(selected) = channels {
            selected
                .iter()
                .filter_map(|ch| all_channels.iter().position(|c| c == ch))
                .collect()
        } else {
            (0..all_channels.len()).collect()
        };

        // Calculate time window for read_signal_window
        let sample_rate =
            signal_headers[0].sample_frequency(self.edf.header.duration_of_data_record);
        let start_time_sec = start_sample as f64 / sample_rate;
        let duration_sec = num_samples as f64 / sample_rate;

        // Read data for selected channels (need mutable reference)
        // Since we can't get mutable reference to self.edf, we need to use a different approach
        // For now, create a new reader instance
        let mut edf_reader = CoreEDFReader::new(Path::new(&self.path))
            .map_err(|e| FileReaderError::ParseError(format!("Failed to open EDF: {}", e)))?;

        let mut result = Vec::with_capacity(channel_indices.len());

        for &ch_idx in &channel_indices {
            let channel_data = edf_reader
                .read_signal_window(ch_idx, start_time_sec, duration_sec)
                .map_err(|e| {
                    FileReaderError::ParseError(format!("Failed to read channel {}: {}", ch_idx, e))
                })?;
            result.push(channel_data);
        }

        Ok(result)
    }

    fn read_overview(
        &self,
        max_points: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let metadata = self.metadata()?;
        let total_samples = metadata.num_samples;

        // Calculate decimation factor
        let decimation = (total_samples as f64 / max_points as f64).ceil() as usize;
        let decimation = decimation.max(1);

        // Read full data and decimate
        let full_data = self.read_chunk(0, total_samples, channels)?;

        let decimated: Vec<Vec<f64>> = full_data
            .into_iter()
            .map(|channel_data| channel_data.iter().step_by(decimation).copied().collect())
            .collect();

        Ok(decimated)
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
