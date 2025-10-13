/// BrainVision File Reader
///
/// Implementation of FileReader trait for BrainVision format (.vhdr, .vmrk, .eeg files).

use std::path::Path;
use bvreader::bv_reader::BVFile;
use super::{FileReader, FileMetadata, FileResult, FileReaderError};

pub struct BrainVisionFileReader {
    file: BVFile,
    path: String,
}

impl BrainVisionFileReader {
    pub fn new(path: &Path) -> FileResult<Self> {
        let path_str = path.to_str()
            .ok_or_else(|| FileReaderError::ParseError("Invalid path".to_string()))?;

        let mut file = BVFile::from_header(path_str)
            .map_err(|e| FileReaderError::ParseError(format!("Failed to load BrainVision file: {:?}", e)))?;

        // Validate file structure
        file.validate()
            .map_err(|e| FileReaderError::InvalidData(format!("Invalid BrainVision file: {:?}", e)))?;

        // Scale channels to physical units
        file.bv_data.scale_channels(&file.bv_header.channel_info)
            .map_err(|e| FileReaderError::ParseError(format!("Failed to scale channels: {:?}", e)))?;

        Ok(Self {
            file,
            path: path.to_string_lossy().to_string(),
        })
    }
}

impl FileReader for BrainVisionFileReader {
    fn metadata(&self) -> FileResult<FileMetadata> {
        let header = &self.file.bv_header;
        let channel_info = &header.channel_info;

        // Get channel labels
        let channels: Vec<String> = channel_info.iter()
            .map(|ch| ch.label.clone())
            .collect();

        let num_channels = channels.len();
        // Calculate number of samples from the data
        let num_samples = if !self.file.bv_data.data.is_empty() {
            self.file.bv_data.data[0].len()
        } else {
            0
        };
        let sample_rate = 1_000_000.0 / header.sampling_interval as f64; // Convert microseconds to Hz
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
        let channel_info = &self.file.bv_header.channel_info;
        let all_channel_names: Vec<String> = channel_info.iter()
            .map(|ch| ch.label.clone())
            .collect();

        // Determine which channels to read
        let channel_indices: Vec<usize> = if let Some(selected) = channels {
            selected
                .iter()
                .filter_map(|ch| {
                    all_channel_names
                        .iter()
                        .position(|c| c == ch)
                })
                .collect()
        } else {
            (0..all_channel_names.len()).collect()
        };

        let end_sample = start_sample + num_samples;
        // Calculate max samples from data
        let max_samples = if !self.file.bv_data.data.is_empty() {
            self.file.bv_data.data[0].len()
        } else {
            0
        };
        let end_sample = end_sample.min(max_samples);

        // Read data for selected channels
        let mut result = Vec::with_capacity(channel_indices.len());

        for &ch_idx in &channel_indices {
            if ch_idx >= self.file.bv_data.data.len() {
                result.push(Vec::new());
                continue;
            }

            let channel_data = &self.file.bv_data.data[ch_idx];

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
