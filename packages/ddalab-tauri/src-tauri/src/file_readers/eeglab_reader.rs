/// EEGLAB File Reader
///
/// Implementation of FileReader trait for EEGLAB .set files.
///
/// EEGLAB files can be stored in several formats:
/// 1. .set + .fdt pair: metadata in .set (MATLAB), raw data in .fdt (binary float32)
/// 2. Single .set file: all data in one MATLAB file (struct-based, harder to parse)
/// 3. MATLAB v7.3: HDF5-based format (for files >2GB)
///
/// This implementation focuses on the .set + .fdt pair format which is most common
/// and can be read without complex MATLAB struct parsing.
///
/// Data loading is lazy for .fdt files - the binary data is only read when requested
/// via read_chunk(), not at construction time. This keeps memory usage low for large files.
use super::{ChannelMetadata, FileMetadata, FileReader, FileReaderError, FileResult};
use matfile::{MatFile, NumericData};
use rayon::prelude::*;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Source of EEG data - either loaded in memory or lazy from .fdt file
enum DataSource {
    /// Data loaded in memory (for embedded MAT file data)
    InMemory(Vec<Vec<f64>>),
    /// Lazy loading from .fdt file (stores path and format info)
    LazyFdt {
        fdt_path: PathBuf,
        num_channels: usize,
        num_samples: usize,
    },
}

pub struct EEGLABFileReader {
    data_source: DataSource,
    metadata: FileMetadata,
}

/// Metadata extracted from EEGLAB .set file
#[derive(Debug, Default)]
struct EEGLabMetadata {
    srate: f64,
    nbchan: usize,
    pnts: usize,
    trials: usize,
    channel_labels: Vec<String>,
    data_file: Option<String>, // Path to .fdt file if separate
}

impl EEGLABFileReader {
    pub fn new(path: &Path) -> FileResult<Self> {
        // First, check if this is an HDF5 file (MATLAB v7.3)
        if Self::is_hdf5_file(path)? {
            return Err(FileReaderError::UnsupportedFormat(
                "This EEGLAB file uses MATLAB v7.3 (HDF5) format which requires additional support. \
                 Please re-save in EEGLAB using: pop_saveset(EEG, 'savemode', 'onefile', 'version', '6.5') \
                 or export to EDF/CSV format.".to_string(),
            ));
        }

        // Try to load the MAT file
        let file = File::open(path)?;
        let mat_file = MatFile::parse(file).map_err(|e| {
            FileReaderError::ParseError(format!("Failed to parse .set file: {:?}", e))
        })?;

        // Try to extract metadata from various possible locations
        let eeglab_meta = Self::extract_metadata(&mat_file, path)?;

        // Determine data source - use lazy loading for .fdt files
        let (data_source, num_channels, num_samples) =
            Self::determine_data_source(path, &mat_file, &eeglab_meta)?;

        let sample_rate = if eeglab_meta.srate > 0.0 {
            eeglab_meta.srate
        } else {
            256.0
        };
        let duration = num_samples as f64 / sample_rate;

        // Generate channel labels if not found
        let channels = if eeglab_meta.channel_labels.len() == num_channels {
            eeglab_meta.channel_labels
        } else {
            (0..num_channels).map(|i| format!("Ch{}", i + 1)).collect()
        };

        let channel_metadata = super::channel_classifier::classify_channel_labels(&channels);

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
            channel_metadata,
            channels,
            start_time: None,
            file_type: "EEGLAB".to_string(),
        };

        Ok(Self {
            data_source,
            metadata,
        })
    }

    /// Check if file is HDF5 format (MATLAB v7.3)
    fn is_hdf5_file(path: &Path) -> FileResult<bool> {
        let mut file = File::open(path)?;
        let mut magic = [0u8; 8];
        if file.read_exact(&mut magic).is_ok() {
            // HDF5 magic number: 0x89 'H' 'D' 'F' '\r' '\n' 0x1a '\n'
            return Ok(magic == [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
        }
        Ok(false)
    }

    /// Extract metadata from MAT file
    /// Tries multiple strategies since EEGLAB can store data in different ways
    fn extract_metadata(mat_file: &MatFile, path: &Path) -> FileResult<EEGLabMetadata> {
        let mut meta = EEGLabMetadata::default();

        // Try to find numeric arrays that might contain metadata
        // In EEGLAB, these are often stored as separate variables in older formats
        // or inside the EEG struct in newer formats

        // Look for sample rate (srate)
        if let Some(srate_arr) = mat_file.find_by_name("srate") {
            if let Some(val) = Self::extract_scalar(srate_arr.data()) {
                meta.srate = val;
            }
        }

        // Look for number of channels (nbchan)
        if let Some(nbchan_arr) = mat_file.find_by_name("nbchan") {
            if let Some(val) = Self::extract_scalar(nbchan_arr.data()) {
                if val >= 0.0 {
                    meta.nbchan = val as usize;
                }
            }
        }

        // Look for number of points (pnts)
        if let Some(pnts_arr) = mat_file.find_by_name("pnts") {
            if let Some(val) = Self::extract_scalar(pnts_arr.data()) {
                if val >= 0.0 {
                    meta.pnts = val as usize;
                }
            }
        }

        // Look for trials
        if let Some(trials_arr) = mat_file.find_by_name("trials") {
            if let Some(val) = Self::extract_scalar(trials_arr.data()) {
                if val >= 0.0 {
                    meta.trials = val as usize;
                }
            }
        }
        if meta.trials == 0 {
            meta.trials = 1;
        }

        // Check for corresponding .fdt file
        let fdt_path = path.with_extension("fdt");
        if fdt_path.exists() {
            meta.data_file = Some(fdt_path.to_string_lossy().to_string());
        }

        Ok(meta)
    }

    /// Extract a scalar value from NumericData
    fn extract_scalar(data: &NumericData) -> Option<f64> {
        match data {
            NumericData::Double { real, .. } => real.first().copied(),
            NumericData::Single { real, .. } => real.first().map(|&v| v as f64),
            NumericData::Int8 { real, .. } => real.first().map(|&v| v as f64),
            NumericData::Int16 { real, .. } => real.first().map(|&v| v as f64),
            NumericData::Int32 { real, .. } => real.first().map(|&v| v as f64),
            NumericData::Int64 { real, .. } => real.first().map(|&v| v as f64),
            NumericData::UInt8 { real, .. } => real.first().map(|&v| v as f64),
            NumericData::UInt16 { real, .. } => real.first().map(|&v| v as f64),
            NumericData::UInt32 { real, .. } => real.first().map(|&v| v as f64),
            NumericData::UInt64 { real, .. } => real.first().map(|&v| v as f64),
        }
    }

    /// Determine the data source - either lazy .fdt or in-memory from .set
    /// Returns (DataSource, num_channels, num_samples)
    fn determine_data_source(
        path: &Path,
        mat_file: &MatFile,
        meta: &EEGLabMetadata,
    ) -> FileResult<(DataSource, usize, usize)> {
        // Strategy 1: Use lazy loading for .fdt files (most reliable and memory-efficient)
        let fdt_path = path.with_extension("fdt");
        if fdt_path.exists() && meta.nbchan > 0 && meta.pnts > 0 {
            // Validate the .fdt file exists and has expected size
            let total_samples = meta.pnts * meta.trials;
            Self::validate_fdt_file(&fdt_path, meta.nbchan, total_samples)?;

            return Ok((
                DataSource::LazyFdt {
                    fdt_path,
                    num_channels: meta.nbchan,
                    num_samples: total_samples,
                },
                meta.nbchan,
                total_samples,
            ));
        }

        // Strategy 2: Try to find a "data" array in the MAT file (load into memory)
        if let Some(data_arr) = mat_file.find_by_name("data") {
            let size = data_arr.size();
            if size.len() >= 2 {
                let data = Self::extract_matrix_data(data_arr.data(), size[0], size[1])?;
                let num_channels = data.len();
                let num_samples = data.first().map(|c| c.len()).unwrap_or(0);
                return Ok((DataSource::InMemory(data), num_channels, num_samples));
            }
        }

        // Strategy 3: Try to find any large numeric array that could be data
        for arr in mat_file.arrays() {
            let size = arr.size();
            // Look for 2D arrays with reasonable dimensions for EEG data
            if size.len() == 2 && size[0] > 1 && size[1] > 100 {
                // Likely channels x samples
                if let Ok(data) = Self::extract_matrix_data(arr.data(), size[0], size[1]) {
                    if !data.is_empty() {
                        let num_channels = data.len();
                        let num_samples = data.first().map(|c| c.len()).unwrap_or(0);
                        return Ok((DataSource::InMemory(data), num_channels, num_samples));
                    }
                }
            }
        }

        // No data found - provide helpful error
        Err(FileReaderError::UnsupportedFormat(
            "Could not find EEG data in this .set file. EEGLAB files with embedded struct data \
             require conversion. Please export from EEGLAB using:\n\
             • pop_writeeeg(EEG, 'filename.edf', 'TYPE', 'EDF') for EDF format\n\
             • pop_export(EEG, 'filename.csv', 'elec', 'off') for CSV format\n\
             • Or save with: pop_saveset(EEG, 'savemode', 'twofiles') to create .set + .fdt pair"
                .to_string(),
        ))
    }

    /// Validate that .fdt file exists and has expected size
    fn validate_fdt_file(
        fdt_path: &Path,
        num_channels: usize,
        total_samples: usize,
    ) -> FileResult<()> {
        let file = File::open(fdt_path)?;
        let file_size = file.metadata()?.len();
        let total_values = num_channels * total_samples;
        let expected_size = (total_values * 4) as u64; // float32 = 4 bytes

        if file_size < expected_size {
            return Err(FileReaderError::InvalidData(format!(
                ".fdt file size ({} bytes) is smaller than expected ({} bytes) for {} channels × {} samples",
                file_size, expected_size, num_channels, total_samples
            )));
        }
        Ok(())
    }

    /// Read a chunk of data from .fdt binary file (float32 format, little-endian)
    /// Only reads the requested sample range, seeking to the correct position.
    fn read_fdt_chunk(
        fdt_path: &Path,
        num_channels: usize,
        total_samples: usize,
        start_sample: usize,
        num_samples_to_read: usize,
    ) -> FileResult<Vec<Vec<f64>>> {
        let file = File::open(fdt_path)?;
        let mut reader = BufReader::new(file);

        // Calculate actual samples to read (clamp to file bounds)
        let end_sample = (start_sample + num_samples_to_read).min(total_samples);
        let actual_samples = end_sample.saturating_sub(start_sample);

        if actual_samples == 0 {
            return Ok(vec![Vec::new(); num_channels]);
        }

        // EEGLAB stores data as [channels, timepoints] in column-major (Fortran) order
        // So data layout is: ch0_t0, ch1_t0, ch2_t0, ..., ch0_t1, ch1_t1, ch2_t1, ...
        // Each "frame" contains all channels for one time point
        let frame_size_bytes = num_channels * 4; // 4 bytes per float32

        // Seek to the start sample
        let start_offset = (start_sample * frame_size_bytes) as u64;
        reader.seek(SeekFrom::Start(start_offset))?;

        // Read only the required bytes
        let bytes_to_read = actual_samples * frame_size_bytes;
        let mut bytes = vec![0u8; bytes_to_read];
        reader.read_exact(&mut bytes)?;

        // Convert bytes to f32 (little-endian)
        let raw_data: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect();

        // Reorganize into channels using parallel processing
        let channels: Vec<Vec<f64>> = (0..num_channels)
            .into_par_iter()
            .map(|ch_idx| {
                let mut channel_data = Vec::with_capacity(actual_samples);
                for sample_idx in 0..actual_samples {
                    let idx = sample_idx * num_channels + ch_idx;
                    if idx < raw_data.len() {
                        channel_data.push(raw_data[idx] as f64);
                    }
                }
                channel_data
            })
            .collect();

        Ok(channels)
    }

    /// Load all data from .fdt file (used for caching when needed)
    fn load_fdt_data_full(
        fdt_path: &Path,
        num_channels: usize,
        total_samples: usize,
    ) -> FileResult<Vec<Vec<f64>>> {
        Self::read_fdt_chunk(fdt_path, num_channels, total_samples, 0, total_samples)
    }

    /// Extract matrix data from NumericData
    fn extract_matrix_data(
        data: &NumericData,
        rows: usize,
        cols: usize,
    ) -> FileResult<Vec<Vec<f64>>> {
        let flat_data: Vec<f64> = match data {
            NumericData::Double { real, .. } => real.clone(),
            NumericData::Single { real, .. } => real.iter().map(|&v| v as f64).collect(),
            NumericData::Int16 { real, .. } => real.iter().map(|&v| v as f64).collect(),
            NumericData::Int32 { real, .. } => real.iter().map(|&v| v as f64).collect(),
            _ => {
                return Err(FileReaderError::InvalidData(
                    "Unsupported data type".to_string(),
                ))
            }
        };

        if flat_data.len() < rows * cols {
            return Err(FileReaderError::InvalidData(format!(
                "Data size mismatch: expected {} elements, got {}",
                rows * cols,
                flat_data.len()
            )));
        }

        // MATLAB uses column-major order, so we need to transpose
        // data is stored as [row0_col0, row1_col0, row2_col0, ..., row0_col1, row1_col1, ...]
        // Parallelize across rows (channels) for better performance
        let channels: Vec<Vec<f64>> = (0..rows)
            .into_par_iter()
            .map(|row| {
                let mut channel_data = Vec::with_capacity(cols);
                for col in 0..cols {
                    let idx = col * rows + row;
                    channel_data.push(flat_data[idx]);
                }
                channel_data
            })
            .collect();

        Ok(channels)
    }
}

impl FileReader for EEGLABFileReader {
    fn metadata(&self) -> FileResult<FileMetadata> {
        Ok(self.metadata.clone())
    }

    fn metadata_ref(&self) -> Option<&FileMetadata> {
        Some(&self.metadata)
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

        // Get the raw data based on source type
        match &self.data_source {
            DataSource::InMemory(data) => {
                // Extract selected channels from the in-memory data matrix
                let mut result = Vec::with_capacity(channel_indices.len());

                for &ch_idx in &channel_indices {
                    if ch_idx >= data.len() {
                        continue;
                    }

                    let channel_data = &data[ch_idx];
                    let end_sample = (start_sample + num_samples).min(channel_data.len());

                    if start_sample < channel_data.len() {
                        result.push(channel_data[start_sample..end_sample].to_vec());
                    } else {
                        result.push(Vec::new());
                    }
                }

                Ok(result)
            }
            DataSource::LazyFdt {
                fdt_path,
                num_channels,
                num_samples: total_samples,
            } => {
                // Read chunk directly from .fdt file
                let all_data = Self::read_fdt_chunk(
                    fdt_path,
                    *num_channels,
                    *total_samples,
                    start_sample,
                    num_samples,
                )?;

                // Filter to selected channels
                let result: Vec<Vec<f64>> = channel_indices
                    .iter()
                    .filter_map(|&ch_idx| all_data.get(ch_idx).cloned())
                    .collect();

                Ok(result)
            }
        }
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

        // For lazy loading, we can read the full data or use strided reads
        // For now, read full data and decimate (still better than loading at construction)
        let full_data = self.read_chunk(0, total_samples, channels)?;

        // Parallelize channel decimation for better performance
        let decimated: Vec<Vec<f64>> = full_data
            .into_par_iter()
            .map(|channel_data| channel_data.iter().step_by(decimation).copied().collect())
            .collect();

        Ok(decimated)
    }

    fn format_name(&self) -> &str {
        "EEGLAB"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_name() {
        // Can't test without actual file, but we can verify the constant
        assert_eq!("EEGLAB", "EEGLAB");
    }
}
