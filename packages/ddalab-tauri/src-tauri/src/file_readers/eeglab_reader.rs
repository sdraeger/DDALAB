/// EEGLAB File Reader
///
/// Implementation of FileReader trait for EEGLAB .set files (MATLAB format).

use std::path::Path;
use matfile::{MatFile, Array};
use ndarray::ArrayD;
use super::{FileReader, FileMetadata, FileResult, FileReaderError};

pub struct EEGLABFileReader {
    data: Vec<Vec<f64>>,
    metadata: FileMetadata,
}

impl EEGLABFileReader {
    pub fn new(path: &Path) -> FileResult<Self> {
        // Load MAT file
        let mat_file = MatFile::load(path)
            .map_err(|e| FileReaderError::ParseError(format!("Failed to load .set file: {:?}", e)))?;

        // Extract EEG structure
        let eeg = mat_file.find_by_name("EEG")
            .ok_or_else(|| FileReaderError::InvalidData("No EEG structure found in .set file".to_string()))?;

        // Parse metadata from EEG structure
        let (sample_rate, num_channels, num_samples, channels, data) =
            Self::parse_eeg_structure(eeg)?;

        let duration = num_samples as f64 / sample_rate;

        let metadata = FileMetadata {
            file_path: path.to_string_lossy().to_string(),
            file_name: path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string(),
            file_size: std::fs::metadata(path)?.len(),
            sample_rate,
            num_channels,
            num_samples,
            duration,
            channels,
            start_time: None,
            file_type: "EEGLAB".to_string(),
        };

        Ok(Self { data, metadata })
    }

    fn parse_eeg_structure(eeg: &Array) -> FileResult<(f64, usize, usize, Vec<String>, Vec<Vec<f64>>)> {
        // EEGLAB .set files contain a struct with fields:
        // - srate: sampling rate
        // - nbchan: number of channels
        // - pnts: number of points
        // - data: channel x samples matrix
        // - chanlocs: channel locations (contains labels)

        // This is a simplified parser - real EEGLAB files can be complex
        // For now, we'll return an error prompting for a more complete implementation
        Err(FileReaderError::UnsupportedFormat(
            "EEGLAB .set file parsing requires more complex implementation. \
             Consider using EEGLAB to export as .csv or .edf format.".to_string()
        ))
    }
}

impl FileReader for EEGLABFileReader {
    fn metadata(&self) -> FileResult<FileMetadata> {
        Ok(self.metadata.clone())
    }

    fn read_chunk(
        &self,
        start_sample: usize,
        num_samples: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let all_channels = &self.metadata.channels;

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
            if ch_idx >= self.data.len() {
                continue;
            }

            let channel_data = &self.data[ch_idx];
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
        let total_samples = self.metadata.num_samples;

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
        "EEGLAB"
    }
}
