use crate::intermediate_format::{ChannelData, DataMetadata, IntermediateData};
/// File Readers Module
///
/// This module provides a modular, extensible architecture for reading various
/// EEG/iEEG file formats. New file formats can be added by implementing the
/// FileReader trait.
///
/// Data Pipeline:
/// File Format → FileReader → IntermediateData → ASCII/CSV for DDA or direct use
///
/// For very large files (100GB+), use the lazy_reader module which provides
/// window-based access with LRU caching.
use std::path::Path;

pub mod ascii_reader;
pub mod brainvision_reader;
pub mod channel_classifier;
pub mod csv_reader;
pub mod edf_reader;
pub mod eeglab_reader; // EEGLAB .set files (supports .set+.fdt pairs and some single .set files)
pub mod fif_reader; // FIF/FIFF reader (uses external fiff crate)
pub mod lazy_reader; // Lazy/windowed file reading for large files (100GB+)
pub mod mne_reader; // MNE-Python backed reader (Python subprocess fallback)
pub mod nifti_reader; // NIfTI reader (uses external nifti crate)
#[cfg(feature = "nwb-support")]
pub mod nwb_reader; // NWB (Neurodata Without Borders) reader (HDF5-based)
pub mod python_bridge; // Python subprocess bridge for MNE-Python
pub mod xdf_reader; // XDF (Extensible Data Format) reader (LSL files)

// Re-export readers
pub use ascii_reader::ASCIIFileReader;
pub use brainvision_reader::BrainVisionFileReader;
pub use csv_reader::CSVFileReader;
pub use edf_reader::EDFFileReader;
pub use eeglab_reader::EEGLABFileReader;
pub use fif_reader::FIFFileReader;
pub use mne_reader::MNEFileReader;
pub use nifti_reader::NIfTIFileReader;
#[cfg(feature = "nwb-support")]
pub use nwb_reader::NWBFileReader;
pub use xdf_reader::XDFFileReader;

// Re-export lazy reader types for convenience
pub use lazy_reader::{
    global_cache, init_global_cache, CacheStats, DataWindow, LazyEDFReader, LazyFileReader,
    LazyReaderConfig, LazyReaderFactory, WindowCache, WindowKey, WindowRequest,
};

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

/// Per-channel metadata: type classification and physical unit.
#[derive(Debug, Clone)]
pub struct ChannelMetadata {
    pub channel_type: String,
    pub unit: String,
}

impl Default for ChannelMetadata {
    fn default() -> Self {
        Self {
            channel_type: "Unknown".to_string(),
            unit: "uV".to_string(),
        }
    }
}

/// Common metadata for all file formats
///
/// This struct is designed to be shared via `Arc` to avoid unnecessary cloning
/// of the channel list when metadata is accessed multiple times.
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
    pub channel_metadata: Vec<ChannelMetadata>,
    pub start_time: Option<String>,
    pub file_type: String,
}

impl FileMetadata {
    /// Get channel labels as a slice (avoids cloning)
    #[inline]
    pub fn channel_labels(&self) -> &[String] {
        &self.channels
    }
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
    ///
    /// Note: For performance, prefer `metadata_ref()` when available to avoid cloning.
    fn metadata(&self) -> FileResult<FileMetadata>;

    /// Get a reference to cached metadata without cloning (optional optimization)
    ///
    /// Returns `None` by default. Readers that cache their metadata should override
    /// this to return a reference, avoiding allocation on each call.
    fn metadata_ref(&self) -> Option<&FileMetadata> {
        None
    }

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
    /// Create a file reader for the given path.
    ///
    /// Tries native Rust readers first, then falls back to MNE-Python
    /// via subprocess bridge when a native reader fails or the format
    /// is only supported through Python.
    pub fn create_reader(path: &Path) -> FileResult<Box<dyn FileReader>> {
        match Self::try_native_reader(path) {
            Ok(reader) => Ok(reader),
            Err(native_err) => {
                // Try Python fallback for known MNE-supported extensions or
                // when the native reader fails (e.g. MATLAB v7.3 .set files)
                if let Ok(reader) = Self::try_mne_reader(path) {
                    log::info!("Using MNE-Python fallback for: {}", path.display());
                    return Ok(reader);
                }
                Err(native_err)
            }
        }
    }

    /// Try creating a native Rust reader for the given path.
    fn try_native_reader(path: &Path) -> FileResult<Box<dyn FileReader>> {
        // Handle .nii.gz files specially (double extension)
        let path_str = path.to_string_lossy();
        if path_str.ends_with(".nii.gz") {
            return Ok(Box::new(NIfTIFileReader::new(path)?));
        }

        let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");

        match extension.to_lowercase().as_str() {
            "edf" => Ok(Box::new(EDFFileReader::new(path)?)),
            "csv" => Ok(Box::new(CSVFileReader::new(path)?)),
            "txt" | "ascii" => Ok(Box::new(ASCIIFileReader::new(path)?)),
            "vhdr" => Ok(Box::new(BrainVisionFileReader::new(path)?)),
            "set" => Ok(Box::new(EEGLABFileReader::new(path)?)),
            "fif" => Ok(Box::new(FIFFileReader::new(path)?)),
            "nii" => Ok(Box::new(NIfTIFileReader::new(path)?)),
            #[cfg(feature = "nwb-support")]
            "nwb" => Ok(Box::new(NWBFileReader::new(path)?)),
            #[cfg(not(feature = "nwb-support"))]
            "nwb" => Err(FileReaderError::UnsupportedFormat(
                "NWB support not enabled. Rebuild with --features nwb-support".to_string(),
            )),
            "xdf" => Ok(Box::new(XDFFileReader::new(path)?)),
            _ => Err(FileReaderError::UnsupportedFormat(format!(
                "Unsupported file extension: {}",
                extension
            ))),
        }
    }

    /// Try creating an MNE-Python backed reader as a fallback.
    fn try_mne_reader(path: &Path) -> FileResult<Box<dyn FileReader>> {
        let env = python_bridge::detect_python().ok_or_else(|| {
            FileReaderError::UnsupportedFormat("Python not available".to_string())
        })?;

        if !env.has_mne {
            return Err(FileReaderError::UnsupportedFormat(
                "MNE-Python not installed".to_string(),
            ));
        }

        let script = python_bridge::locate_bridge_script()?;
        let reader = MNEFileReader::new(path, env, &script)?;
        Ok(Box::new(reader))
    }

    /// Get list of supported extensions for reading/analysis
    pub fn supported_extensions() -> Vec<&'static str> {
        let mut exts = vec![
            "edf", "csv", "txt", "ascii", "vhdr", "set", "fif", "nii", "gz", "xdf",
        ];
        #[cfg(feature = "nwb-support")]
        exts.push("nwb");
        // MNE-Python can handle additional formats if available
        exts.extend(Self::mne_only_extensions());
        exts
    }

    /// Extensions only supported through MNE-Python fallback
    pub fn mne_only_extensions() -> Vec<&'static str> {
        vec!["bdf", "cnt", "mff", "egi", "gdf"]
    }

    /// Get list of extensions that may require conversion (partially supported)
    /// EEGLAB .set files: Works with .set+.fdt pairs; may need conversion for single .set files
    pub fn conversion_required_extensions() -> Vec<&'static str> {
        // Currently empty - EEGLAB now has partial support
        vec![]
    }

    /// Get list of recognized but unsupported MEG extensions
    pub fn meg_extensions() -> Vec<&'static str> {
        vec!["fif", "ds", "sqd", "meg4", "con", "kit"]
    }

    /// Get list of all recognized extensions (supported + conversion required + MEG)
    pub fn all_recognized_extensions() -> Vec<&'static str> {
        let mut exts = Self::supported_extensions();
        exts.extend(Self::conversion_required_extensions());
        exts.extend(Self::meg_extensions());
        exts
    }

    /// Check if a file requires conversion before it can be read
    pub fn requires_conversion(path: &Path) -> bool {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            Self::conversion_required_extensions().contains(&ext.to_lowercase().as_str())
        } else {
            false
        }
    }

    /// Check if a file extension is supported for analysis
    pub fn is_supported(path: &Path) -> bool {
        // Check for .nii.gz files specially
        let path_str = path.to_string_lossy();
        if path_str.ends_with(".nii.gz") {
            return true;
        }

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
        // Try to get metadata reference first to avoid cloning when possible
        // Fall back to owned metadata if reference not available
        let owned_metadata;
        let file_metadata: &FileMetadata = if let Some(meta_ref) = reader.metadata_ref() {
            meta_ref
        } else {
            owned_metadata = reader.metadata()?;
            &owned_metadata
        };

        // Create intermediate metadata - use references where possible
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

        // Determine which channels to read - avoid cloning when reading all channels
        let channels_to_read: std::borrow::Cow<'_, [String]> = match selected_channels {
            Some(c) => std::borrow::Cow::Borrowed(c),
            None => std::borrow::Cow::Borrowed(&file_metadata.channels),
        };

        // Read full data for all selected channels
        let chunk_data =
            reader.read_chunk(0, file_metadata.num_samples, Some(&channels_to_read))?;

        // Build label-to-index map for looking up channel metadata by name
        let label_to_idx: std::collections::HashMap<&str, usize> = file_metadata
            .channels
            .iter()
            .enumerate()
            .map(|(i, name)| (name.as_str(), i))
            .collect();

        // Convert to intermediate format channels
        for (idx, channel_label) in channels_to_read.iter().enumerate() {
            if let Some(samples) = chunk_data.get(idx) {
                let (ch_type, ch_unit) = label_to_idx
                    .get(channel_label.as_str())
                    .and_then(|&meta_idx| file_metadata.channel_metadata.get(meta_idx))
                    .map(|m| (m.channel_type.clone(), m.unit.clone()))
                    .unwrap_or_else(|| ("Unknown".to_string(), "uV".to_string()));

                let channel = ChannelData {
                    label: channel_label.clone(),
                    channel_type: ch_type,
                    unit: ch_unit,
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
        #[cfg(feature = "nwb-support")]
        assert!(extensions.contains(&"nwb"));
        assert!(extensions.contains(&"xdf"));
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
        assert!(FileReaderFactory::is_supported(Path::new("test.fif"))); // FIF is supported (we have a reader)
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
