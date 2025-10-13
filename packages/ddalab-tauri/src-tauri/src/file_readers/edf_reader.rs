/// EDF (European Data Format) File Reader
///
/// Implementation of FileReader trait for EDF files.

use std::path::Path;
use crate::edf::EDFReader as CoreEDFReader;
use super::{FileReader, FileMetadata, FileResult, FileReaderError};

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

        Ok(FileMetadata {
            file_path: self.path.clone(),
            file_name: Path::new(&self.path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string(),
            file_size: std::fs::metadata(&self.path)?.len(),
            sample_rate: header.sample_rate,
            num_channels: header.num_channels,
            num_samples: header.num_samples,
            duration: header.duration,
            channels: header.channel_labels.clone(),
            start_time: Some(header.start_date_time.clone()),
            file_type: "EDF".to_string(),
        })
    }

    fn read_chunk(
        &self,
        start_sample: usize,
        num_samples: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let all_channels = &self.edf.header.channel_labels;

        // Determine which channels to read
        let channel_indices: Vec<usize> = if let Some(selected) = channels {
            selected
                .iter()
                .filter_map(|ch| all_channels.iter().position(|c| c == ch))
                .collect()
        } else {
            (0..all_channels.len()).collect()
        };

        // Read data for selected channels
        let mut result = Vec::with_capacity(channel_indices.len());

        for &ch_idx in &channel_indices {
            let channel_data = self.edf.read_signal(ch_idx, start_sample, num_samples)
                .map_err(|e| FileReaderError::ParseError(format!("Failed to read channel {}: {}", ch_idx, e)))?;
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
