/// BrainVision File Reader
///
/// Implementation of FileReader trait for BrainVision format (.vhdr, .vmrk, .eeg files).

use std::path::Path;
use bvreader::BVReader;
use super::{FileReader, FileMetadata, FileResult, FileReaderError};

pub struct BrainVisionFileReader {
    reader: BVReader,
    path: String,
}

impl BrainVisionFileReader {
    pub fn new(path: &Path) -> FileResult<Self> {
        let reader = BVReader::load(path)
            .map_err(|e| FileReaderError::ParseError(format!("Failed to load BrainVision file: {:?}", e)))?;

        Ok(Self {
            reader,
            path: path.to_string_lossy().to_string(),
        })
    }
}

impl FileReader for BrainVisionFileReader {
    fn metadata(&self) -> FileResult<FileMetadata> {
        let info = &self.reader.info;

        // Get channel labels
        let channels: Vec<String> = info.channel_names
            .iter()
            .map(|s| s.to_string())
            .collect();

        let num_channels = channels.len();
        let num_samples = info.num_points;
        let sample_rate = info.sampling_interval_microseconds as f64 / 1_000_000.0;
        let sample_rate = 1.0 / sample_rate; // Convert interval to rate
        let duration = num_samples as f64 / sample_rate;

        Ok(FileMetadata {
            file_path: self.path.clone(),
            file_name: Path::new(&self.path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string(),
            file_size: std::fs::metadata(&self.path)?.len(),
            sample_rate,
            num_channels,
            num_samples,
            duration,
            channels,
            start_time: None,
            file_type: "BrainVision".to_string(),
        })
    }

    fn read_chunk(
        &self,
        start_sample: usize,
        num_samples: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let all_channels = &self.reader.info.channel_names;

        // Determine which channels to read
        let channel_indices: Vec<usize> = if let Some(selected) = channels {
            selected
                .iter()
                .filter_map(|ch| {
                    all_channels
                        .iter()
                        .position(|c| c == ch)
                })
                .collect()
        } else {
            (0..all_channels.len()).collect()
        };

        let end_sample = start_sample + num_samples;
        let end_sample = end_sample.min(self.reader.info.num_points);

        // Read data for selected channels
        let mut result = Vec::with_capacity(channel_indices.len());

        for &ch_idx in &channel_indices {
            if ch_idx >= self.reader.data.len() {
                result.push(Vec::new());
                continue;
            }

            let channel_data = &self.reader.data[ch_idx];

            if start_sample < channel_data.len() {
                let data_slice = &channel_data[start_sample..end_sample.min(channel_data.len())];
                // Convert f32 to f64
                let data_f64: Vec<f64> = data_slice.iter().map(|&v| v as f64).collect();
                result.push(data_f64);
            } else {
                result.push(Vec::new());
            }
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
            .map(|channel_data| {
                channel_data
                    .iter()
                    .step_by(decimation)
                    .copied()
                    .collect()
            })
            .collect();

        Ok(decimated)
    }

    fn format_name(&self) -> &str {
        "BrainVision"
    }
}
