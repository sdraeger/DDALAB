/// File Writers Module
///
/// This module provides a modular, extensible architecture for writing various
/// neurophysiology file formats from DDALAB's universal IntermediateData format.
///
/// Data Pipeline:
/// IntermediateData → FileWriter → File Format (EDF, CSV, XDF, etc.)
use crate::intermediate_format::IntermediateData;
use std::path::Path;

pub mod ascii_writer;
pub mod bids_writer;
pub mod csv_writer;
pub mod edf_writer;
#[cfg(feature = "nwb-support")]
pub mod nwb_writer;
pub mod xdf_writer;

pub use ascii_writer::ASCIIWriter;
pub use bids_writer::BIDSWriter;
pub use csv_writer::CSVWriter;
pub use edf_writer::EDFWriter;
#[cfg(feature = "nwb-support")]
pub use nwb_writer::NWBWriter;
pub use xdf_writer::XDFWriter;

/// Result type alias for file writer operations
pub type FileWriterResult<T> = Result<T, FileWriterError>;

/// Error types for file writing operations
#[derive(Debug)]
pub enum FileWriterError {
    IoError(std::io::Error),
    FormatError(String),
    UnsupportedFormat(String),
    InvalidData(String),
    WriteError(String),
}

impl std::fmt::Display for FileWriterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FileWriterError::IoError(e) => write!(f, "IO error: {}", e),
            FileWriterError::FormatError(msg) => write!(f, "Format error: {}", msg),
            FileWriterError::UnsupportedFormat(msg) => write!(f, "Unsupported format: {}", msg),
            FileWriterError::InvalidData(msg) => write!(f, "Invalid data: {}", msg),
            FileWriterError::WriteError(msg) => write!(f, "Write error: {}", msg),
        }
    }
}

impl std::error::Error for FileWriterError {}

impl From<std::io::Error> for FileWriterError {
    fn from(err: std::io::Error) -> Self {
        FileWriterError::IoError(err)
    }
}

impl From<String> for FileWriterError {
    fn from(err: String) -> Self {
        FileWriterError::WriteError(err)
    }
}

/// Configuration options for file writers
#[derive(Debug, Clone)]
pub struct WriterConfig {
    /// Whether to include channel labels in the output
    pub include_labels: bool,

    /// Whether to include metadata as comments/headers
    pub include_metadata: bool,

    /// Precision for floating point values (decimal places)
    pub precision: usize,

    /// Channel selection (None = all channels)
    pub selected_channels: Option<Vec<String>>,

    /// Format-specific options
    pub custom_options: std::collections::HashMap<String, String>,
}

impl Default for WriterConfig {
    fn default() -> Self {
        Self {
            include_labels: true,
            include_metadata: true,
            precision: 6,
            selected_channels: None,
            custom_options: std::collections::HashMap::new(),
        }
    }
}

/// Trait that all file writers must implement
///
/// This provides a unified interface for writing different file formats.
/// Each format (EDF, CSV, XDF, etc.) implements this trait.
pub trait FileWriter: Send + Sync {
    /// Write IntermediateData to a file
    ///
    /// # Arguments
    /// * `data` - The IntermediateData to write
    /// * `output_path` - Path where the file should be written
    /// * `config` - Configuration options for writing
    ///
    /// # Returns
    /// Result indicating success or failure
    fn write(
        &self,
        data: &IntermediateData,
        output_path: &Path,
        config: &WriterConfig,
    ) -> FileWriterResult<()>;

    /// Get the file format name (e.g., "EDF", "CSV", "XDF")
    fn format_name(&self) -> &str;

    /// Get the default file extension for this format
    fn default_extension(&self) -> &str;

    /// Validate that the data can be written in this format
    /// Returns Ok(()) if valid, Err with explanation if invalid
    fn validate_data(&self, data: &IntermediateData) -> FileWriterResult<()> {
        if data.channels.is_empty() {
            return Err(FileWriterError::InvalidData(
                "No channels in data".to_string(),
            ));
        }

        if data.num_samples() == 0 {
            return Err(FileWriterError::InvalidData(
                "No samples in data".to_string(),
            ));
        }

        Ok(())
    }
}

/// Factory for creating file writers based on file extension or format name
pub struct FileWriterFactory;

impl FileWriterFactory {
    /// Create a file writer for the given output path
    ///
    /// The writer is selected based on the file extension
    pub fn create_writer(path: &Path) -> FileWriterResult<Box<dyn FileWriter>> {
        let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");

        match extension.to_lowercase().as_str() {
            "edf" => Ok(Box::new(EDFWriter::new())),
            "csv" => Ok(Box::new(CSVWriter::new())),
            "txt" | "ascii" => Ok(Box::new(ASCIIWriter::new())),
            "xdf" => Ok(Box::new(XDFWriter::new())),
            #[cfg(feature = "nwb-support")]
            "nwb" => Ok(Box::new(NWBWriter::new())),
            #[cfg(not(feature = "nwb-support"))]
            "nwb" => Err(FileWriterError::UnsupportedFormat(
                "NWB support not enabled. Rebuild with --features nwb-support".to_string(),
            )),
            _ => Err(FileWriterError::UnsupportedFormat(format!(
                "Unsupported file extension for writing: {}",
                extension
            ))),
        }
    }

    /// Create a writer by format name (e.g., "EDF", "CSV")
    pub fn create_writer_by_format(format: &str) -> FileWriterResult<Box<dyn FileWriter>> {
        match format.to_uppercase().as_str() {
            "EDF" => Ok(Box::new(EDFWriter::new())),
            "CSV" => Ok(Box::new(CSVWriter::new())),
            "ASCII" | "TXT" => Ok(Box::new(ASCIIWriter::new())),
            "XDF" => Ok(Box::new(XDFWriter::new())),
            #[cfg(feature = "nwb-support")]
            "NWB" => Ok(Box::new(NWBWriter::new())),
            _ => Err(FileWriterError::UnsupportedFormat(format!(
                "Unsupported format: {}",
                format
            ))),
        }
    }

    /// Get list of supported extensions for writing
    pub fn supported_extensions() -> Vec<&'static str> {
        let mut exts = vec!["edf", "csv", "txt", "ascii", "xdf"];
        #[cfg(feature = "nwb-support")]
        exts.push("nwb");
        exts
    }

    /// Get list of supported format names
    pub fn supported_formats() -> Vec<&'static str> {
        let mut formats = vec!["EDF", "CSV", "ASCII", "XDF"];
        #[cfg(feature = "nwb-support")]
        formats.push("NWB");
        formats
    }

    /// Check if a file extension is supported for writing
    pub fn is_supported(path: &Path) -> bool {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            Self::supported_extensions().contains(&ext.to_lowercase().as_str())
        } else {
            false
        }
    }

    /// Write IntermediateData to a file with auto-detected format
    ///
    /// Convenience method that creates the appropriate writer and writes the data
    pub fn write_file(
        data: &IntermediateData,
        output_path: &Path,
        config: Option<WriterConfig>,
    ) -> FileWriterResult<()> {
        let writer = Self::create_writer(output_path)?;
        let config = config.unwrap_or_default();
        writer.validate_data(data)?;
        writer.write(data, output_path, &config)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supported_extensions() {
        let extensions = FileWriterFactory::supported_extensions();
        assert!(extensions.contains(&"edf"));
        assert!(extensions.contains(&"csv"));
        assert!(extensions.contains(&"ascii"));
        assert!(extensions.contains(&"xdf"));
    }

    #[test]
    fn test_is_supported() {
        assert!(FileWriterFactory::is_supported(Path::new("test.edf")));
        assert!(FileWriterFactory::is_supported(Path::new("test.csv")));
        assert!(FileWriterFactory::is_supported(Path::new("test.xdf")));
        assert!(!FileWriterFactory::is_supported(Path::new("test.xyz")));
    }

    #[test]
    fn test_create_writer() {
        assert!(FileWriterFactory::create_writer(Path::new("test.edf")).is_ok());
        assert!(FileWriterFactory::create_writer(Path::new("test.csv")).is_ok());
        assert!(FileWriterFactory::create_writer(Path::new("test.xyz")).is_err());
    }

    #[test]
    fn test_writer_config_default() {
        let config = WriterConfig::default();
        assert!(config.include_labels);
        assert!(config.include_metadata);
        assert_eq!(config.precision, 6);
        assert!(config.selected_channels.is_none());
    }
}
