use super::{FileMetadata, FileReader, FileReaderError, FileResult};
use crate::text_reader::TextFileReader as CoreTextReader;
/// ASCII/TSV File Reader
///
/// Implementation of FileReader trait for ASCII/TSV files.
/// Uses streaming reads via CoreTextReader to avoid loading entire files into memory.
use std::collections::HashMap;
use std::path::Path;

pub struct ASCIIFileReader {
    reader: CoreTextReader,
    path: String,
    channel_indices: HashMap<String, usize>,
}

impl ASCIIFileReader {
    pub fn new(path: &Path) -> FileResult<Self> {
        let reader = CoreTextReader::from_ascii(path)
            .map_err(|e| FileReaderError::ParseError(format!("Failed to parse ASCII: {}", e)))?;

        let channel_indices: HashMap<String, usize> = reader
            .info
            .channel_labels
            .iter()
            .enumerate()
            .map(|(i, name)| (name.clone(), i))
            .collect();

        Ok(Self {
            reader,
            path: path.to_string_lossy().to_string(),
            channel_indices,
        })
    }
}

impl FileReader for ASCIIFileReader {
    fn metadata(&self) -> FileResult<FileMetadata> {
        let info = &self.reader.info;

        // ASCII files don't have encoded sample rate metadata
        // Default to 1 Hz - DDA analysis will work but timing will be in samples not seconds
        // For proper timing metadata, use EDF, BrainVision, or XDF formats
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

        // Determine which channels to read using O(1) HashMap lookup
        let channel_indices: Vec<usize> = if let Some(selected) = channels {
            selected
                .iter()
                .filter_map(|ch| self.channel_indices.get(ch).copied())
                .collect()
        } else {
            (0..all_channels.len()).collect()
        };

        if channel_indices.is_empty() {
            return Ok(Vec::new());
        }

        // Use streaming read_window to read only the requested range
        self.reader
            .read_window(start_sample, num_samples, &channel_indices)
            .map_err(|e| FileReaderError::ParseError(e))
    }

    fn read_overview(
        &self,
        max_points: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let all_channels = &self.reader.info.channel_labels;

        // Determine which channels to read using O(1) HashMap lookup
        let channel_indices: Vec<usize> = if let Some(selected) = channels {
            selected
                .iter()
                .filter_map(|ch| self.channel_indices.get(ch).copied())
                .collect()
        } else {
            (0..all_channels.len()).collect()
        };

        if channel_indices.is_empty() {
            return Ok(Vec::new());
        }

        // Use streaming read_overview for memory-efficient decimated reads
        self.reader
            .read_overview(max_points, &channel_indices)
            .map_err(|e| FileReaderError::ParseError(e))
    }

    fn format_name(&self) -> &str {
        "ASCII"
    }
}
