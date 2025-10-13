/// ASCII/TSV File Reader
///
/// Implementation of FileReader trait for ASCII/TSV files.

use std::path::Path;
use crate::text_reader::TextFileReader as CoreTextReader;
use super::{FileReader, FileMetadata, FileResult, FileReaderError};

pub struct ASCIIFileReader {
    reader: CoreTextReader,
    path: String,
}

impl ASCIIFileReader {
    pub fn new(path: &Path) -> FileResult<Self> {
        let reader = CoreTextReader::from_ascii(path)
            .map_err(|e| FileReaderError::ParseError(format!("Failed to parse ASCII: {}", e)))?;

        Ok(Self {
            reader,
            path: path.to_string_lossy().to_string(),
        })
    }
}

impl FileReader for ASCIIFileReader {
    fn metadata(&self) -> FileResult<FileMetadata> {
        let info = &self.reader.info;

        // ASCII files don't have encoded sample rate, assume 1 Hz for generic time series
        let sample_rate = 1.0;
        let duration = info.num_samples as f64 / sample_rate;

        Ok(FileMetadata {
            file_path: self.path.clone(),
            file_name: Path::new(&self.path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string(),
            file_size: std::fs::metadata(&self.path)?.len(),
            sample_rate,
            num_channels: info.num_channels,
            num_samples: info.num_samples,
            duration,
            channels: info.channel_labels.clone(),
            start_time: None,
            file_type: "ASCII".to_string(),
        })
    }

    fn read_chunk(
        &self,
        start_sample: usize,
        num_samples: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let all_channels = &self.reader.info.channel_labels;

        // Determine which channels to read
        let channel_indices: Vec<usize> = if let Some(selected) = channels {
            selected
                .iter()
                .filter_map(|ch| all_channels.iter().position(|c| c == ch))
                .collect()
        } else {
            (0..all_channels.len()).collect()
        };

        // Extract selected channels from the data matrix
        let mut result = Vec::with_capacity(channel_indices.len());

        for &ch_idx in &channel_indices {
            if ch_idx >= self.reader.data.len() {
                continue;
            }

            let channel_data = &self.reader.data[ch_idx];
            let end_sample = (start_sample + num_samples).min(channel_data.len());

            if start_sample < channel_data.len() {
                result.push(channel_data[start_sample..end_sample].to_vec());
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
        "ASCII"
    }
}
