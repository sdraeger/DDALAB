use crate::intermediate_format::{ChannelData, DataMetadata, IntermediateData};
/// File Readers Module
///
/// This module provides a modular, extensible architecture for reading various
/// EEG/iEEG file formats. New file formats can be added by implementing the
/// FileReader trait.
///
/// Data Pipeline:
/// File Format → FileReader → IntermediateData → ASCII/CSV for DDA or direct use
use std::path::Path;

pub mod ascii_reader;
pub mod brainvision_reader;
pub mod csv_reader;
pub mod edf_reader;
pub mod eeglab_reader;
pub mod fif_reader; // FIF/FIFF reader (uses external fiff crate)

// Re-export readers
pub use ascii_reader::ASCIIFileReader;
pub use brainvision_reader::BrainVisionFileReader;
pub use csv_reader::CSVFileReader;
pub use edf_reader::EDFFileReader;
pub use eeglab_reader::EEGLABFileReader;
pub use fif_reader::FIFFileReader;

/// Parse EDF datetime from date (dd.mm.yy) and time (hh.mm.ss) strings to RFC3339 format
pub fn parse_edf_datetime(date_str: &str, time_str: &str) -> Option<String> {
    // EDF date format: dd.mm.yy
    // EDF time format: hh.mm.ss
    let date_parts: Vec<&str> = date_str.trim().split('.').collect();
    let time_parts: Vec<&str> = time_str.trim().split('.').collect();

    if date_parts.len() != 3 || time_parts.len() != 3 {
        return None;
    }

    let day: u32 = date_parts[0].parse().ok()?;
    let month: u32 = date_parts[1].parse().ok()?;
    let mut year: i32 = date_parts[2].parse().ok()?;

    // EDF uses 2-digit year: 85-99 = 1985-1999, 00-84 = 2000-2084
    if year >= 85 {
        year += 1900;
    } else {
        year += 2000;
    }

    let hour: u32 = time_parts[0].parse().ok()?;
    let minute: u32 = time_parts[1].parse().ok()?;
    let second: u32 = time_parts[2].parse().ok()?;

    // Create naive datetime and convert to UTC
    use chrono::{NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
    let naive_date = NaiveDate::from_ymd_opt(year, month, day)?;
    let naive_time = NaiveTime::from_hms_opt(hour, minute, second)?;
    let naive_datetime = NaiveDateTime::new(naive_date, naive_time);
    let datetime = Utc.from_utc_datetime(&naive_datetime);

    Some(datetime.to_rfc3339())
}

/// Common metadata for all file formats
#[derive(Debug, Clone)]
pub struct FileMetadata {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub sample_rate: f64,
    pub num_channels: usize,
    pub num_samples: usize,
    pub duration: f64,
    pub channels: Vec<String>,
    pub start_time: Option<String>,
    pub file_type: String,
}

/// Result type alias for file reader operations
pub type FileResult<T> = Result<T, FileReaderError>;

/// Error types for file reading operations
#[derive(Debug)]
pub enum FileReaderError {
    IoError(std::io::Error),
    ParseError(String),
    UnsupportedFormat(String),
    InvalidData(String),
    MissingFile(String),
}

impl std::fmt::Display for FileReaderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FileReaderError::IoError(e) => write!(f, "IO error: {}", e),
            FileReaderError::ParseError(msg) => write!(f, "Parse error: {}", msg),
            FileReaderError::UnsupportedFormat(msg) => write!(f, "Unsupported format: {}", msg),
            FileReaderError::InvalidData(msg) => write!(f, "Invalid data: {}", msg),
            FileReaderError::MissingFile(msg) => write!(f, "Missing file: {}", msg),
        }
    }
}

impl std::error::Error for FileReaderError {}

impl From<std::io::Error> for FileReaderError {
    fn from(err: std::io::Error) -> Self {
        FileReaderError::IoError(err)
    }
}

/// Trait that all file readers must implement
///
/// This provides a unified interface for reading different EEG file formats.
/// Each format (EDF, BrainVision, EEGLAB, etc.) implements this trait.
pub trait FileReader: Send + Sync {
    /// Get metadata about the file without loading all data
    fn metadata(&self) -> FileResult<FileMetadata>;

    /// Read a chunk of data from the file
    ///
    /// # Arguments
    /// * `start_sample` - Starting sample index
    /// * `num_samples` - Number of samples to read
    /// * `channels` - Optional channel selection (None = all channels)
    ///
    /// # Returns
    /// Vector of vectors, where each inner vector is a channel's data
    fn read_chunk(
        &self,
        start_sample: usize,
        num_samples: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>>;

    /// Read overview/downsampled data for visualization
    ///
    /// # Arguments
    /// * `max_points` - Maximum number of points per channel
    /// * `channels` - Optional channel selection
    ///
    /// # Returns
    /// Downsampled data suitable for overview plots
    fn read_overview(
        &self,
        max_points: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>>;

    /// Get the file format name (e.g., "EDF", "BrainVision", "EEGLAB")
    fn format_name(&self) -> &str;

    /// Check if the file format supports writing
    fn supports_write(&self) -> bool {
        false
    }
}

/// Factory for creating file readers based on file extension
pub struct FileReaderFactory;

impl FileReaderFactory {
    /// Create a file reader for the given path
    pub fn create_reader(path: &Path) -> FileResult<Box<dyn FileReader>> {
        let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");

        match extension.to_lowercase().as_str() {
            "edf" => Ok(Box::new(EDFFileReader::new(path)?)),
            "csv" => Ok(Box::new(CSVFileReader::new(path)?)),
            "txt" | "ascii" => Ok(Box::new(ASCIIFileReader::new(path)?)),
            "vhdr" => Ok(Box::new(BrainVisionFileReader::new(path)?)),
            "set" => Ok(Box::new(EEGLABFileReader::new(path)?)),
            "fif" => Ok(Box::new(FIFFileReader::new(path)?)),
            _ => Err(FileReaderError::UnsupportedFormat(format!(
                "Unsupported file extension: {}",
                extension
            ))),
        }
    }

    /// Get list of supported extensions for reading/analysis
    pub fn supported_extensions() -> Vec<&'static str> {
        vec!["edf", "csv", "txt", "ascii", "vhdr", "set", "fif"]
    }

    /// Get list of recognized but unsupported MEG extensions
    pub fn meg_extensions() -> Vec<&'static str> {
        vec!["ds", "sqd", "meg4", "con", "kit"]
    }

    /// Get list of all recognized extensions (supported + MEG)
    pub fn all_recognized_extensions() -> Vec<&'static str> {
        let mut exts = Self::supported_extensions();
        exts.extend(Self::meg_extensions());
        exts
    }

    /// Check if a file extension is supported for analysis
    pub fn is_supported(path: &Path) -> bool {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            Self::supported_extensions().contains(&ext.to_lowercase().as_str())
        } else {
            false
        }
    }

    /// Check if a file is a MEG format (recognized but not yet supported)
    pub fn is_meg_format(path: &Path) -> bool {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            Self::meg_extensions().contains(&ext.to_lowercase().as_str())
        } else {
            false
        }
    }

    /// Check if a file extension is recognized (supported or MEG)
    pub fn is_recognized(path: &Path) -> bool {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            Self::all_recognized_extensions().contains(&ext.to_lowercase().as_str())
        } else {
            false
        }
    }

    /// Convert a FileReader to IntermediateData format
    ///
    /// This bridges the FileReader trait to the universal intermediate format,
    /// enabling a unified pipeline for all file formats.
    ///
    /// # Arguments
    /// * `reader` - Any type implementing FileReader
    /// * `selected_channels` - Optional channel selection (None = all channels)
    ///
    /// # Returns
    /// IntermediateData structure ready for export or analysis
    pub fn to_intermediate_data(
        reader: &dyn FileReader,
        selected_channels: Option<&[String]>,
    ) -> FileResult<IntermediateData> {
        // Get metadata first
        let file_metadata = reader.metadata()?;

        // Create intermediate metadata
        let mut custom_metadata = std::collections::HashMap::new();
        custom_metadata.insert("file_size".to_string(), file_metadata.file_size.to_string());
        custom_metadata.insert(
            "num_samples".to_string(),
            file_metadata.num_samples.to_string(),
        );

        let intermediate_metadata = DataMetadata {
            source_file: file_metadata.file_path.clone(),
            source_format: file_metadata.file_type.clone(),
            sample_rate: file_metadata.sample_rate,
            duration: file_metadata.duration,
            start_time: file_metadata.start_time.clone(),
            subject_id: None, // Could be extracted from filename if following BIDS
            custom_metadata,
        };

        let mut intermediate_data = IntermediateData::new(intermediate_metadata);

        // Determine which channels to read
        let channels_to_read = selected_channels
            .map(|c| c.to_vec())
            .unwrap_or_else(|| file_metadata.channels.clone());

        // Read full data for all selected channels
        let chunk_data =
            reader.read_chunk(0, file_metadata.num_samples, Some(&channels_to_read))?;

        // Convert to intermediate format channels
        for (idx, channel_label) in channels_to_read.iter().enumerate() {
            if let Some(samples) = chunk_data.get(idx) {
                let channel = ChannelData {
                    label: channel_label.clone(),
                    channel_type: "Unknown".to_string(), // Could be inferred from label or format
                    unit: "µV".to_string(), // Default unit, format-specific readers should override
                    samples: samples.clone(),
                    sample_rate: None, // Use global sample rate unless channel-specific
                };
                intermediate_data.add_channel(channel);
            }
        }

        Ok(intermediate_data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supported_extensions() {
        let extensions = FileReaderFactory::supported_extensions();
        assert!(extensions.contains(&"edf"));
        assert!(extensions.contains(&"csv"));
        assert!(extensions.contains(&"vhdr"));
        assert!(extensions.contains(&"set"));
    }

    #[test]
    fn test_meg_extensions() {
        let extensions = FileReaderFactory::meg_extensions();
        assert!(extensions.contains(&"fif"));
        assert!(extensions.contains(&"ds"));
        assert!(extensions.contains(&"sqd"));
        assert!(extensions.contains(&"meg4"));
    }

    #[test]
    fn test_is_supported() {
        assert!(FileReaderFactory::is_supported(Path::new("test.edf")));
        assert!(FileReaderFactory::is_supported(Path::new("test.vhdr")));
        assert!(!FileReaderFactory::is_supported(Path::new("test.xyz")));
        assert!(!FileReaderFactory::is_supported(Path::new("test.fif")));
    }

    #[test]
    fn test_is_meg_format() {
        assert!(FileReaderFactory::is_meg_format(Path::new("test.fif")));
        assert!(FileReaderFactory::is_meg_format(Path::new("test.ds")));
        assert!(!FileReaderFactory::is_meg_format(Path::new("test.edf")));
        assert!(!FileReaderFactory::is_meg_format(Path::new("test.xyz")));
    }

    #[test]
    fn test_is_recognized() {
        assert!(FileReaderFactory::is_recognized(Path::new("test.edf")));
        assert!(FileReaderFactory::is_recognized(Path::new("test.fif")));
        assert!(FileReaderFactory::is_recognized(Path::new("test.vhdr")));
        assert!(!FileReaderFactory::is_recognized(Path::new("test.xyz")));
    }

    #[test]
    fn test_parse_edf_datetime() {
        // Test with the actual file date: 06.04.16 10.38.36
        let result = parse_edf_datetime("06.04.16", "10.38.36");
        assert!(result.is_some());
        let datetime_str = result.unwrap();
        println!("Parsed datetime: {}", datetime_str);
        assert!(datetime_str.contains("2016-04-06"));
        assert!(datetime_str.contains("10:38:36"));
    }
}
