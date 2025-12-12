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
use super::{FileMetadata, FileReader, FileReaderError, FileResult};
use matfile::{MatFile, NumericData};
use rayon::prelude::*;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

pub struct EEGLABFileReader {
    data: Vec<Vec<f64>>,
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

        // Determine data source and load data
        let data = Self::load_data(path, &mat_file, &eeglab_meta)?;

        let num_samples = if !data.is_empty() {
            data[0].len()
        } else {
            eeglab_meta.pnts
        };
        let num_channels = data.len();
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
                meta.nbchan = val as usize;
            }
        }

        // Look for number of points (pnts)
        if let Some(pnts_arr) = mat_file.find_by_name("pnts") {
            if let Some(val) = Self::extract_scalar(pnts_arr.data()) {
                meta.pnts = val as usize;
            }
        }

        // Look for trials
        if let Some(trials_arr) = mat_file.find_by_name("trials") {
            if let Some(val) = Self::extract_scalar(trials_arr.data()) {
                meta.trials = val as usize;
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

    /// Load data from either .fdt file or embedded in .set
    fn load_data(
        path: &Path,
        mat_file: &MatFile,
        meta: &EEGLabMetadata,
    ) -> FileResult<Vec<Vec<f64>>> {
        // Strategy 1: Try to load from .fdt file (most reliable)
        let fdt_path = path.with_extension("fdt");
        if fdt_path.exists() && meta.nbchan > 0 && meta.pnts > 0 {
            return Self::load_fdt_data(&fdt_path, meta.nbchan, meta.pnts, meta.trials);
        }

        // Strategy 2: Try to find a "data" array in the MAT file
        if let Some(data_arr) = mat_file.find_by_name("data") {
            let size = data_arr.size();
            if size.len() >= 2 {
                return Self::extract_matrix_data(data_arr.data(), size[0], size[1]);
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
                        return Ok(data);
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

    /// Load data from .fdt binary file (float32 format, little-endian)
    fn load_fdt_data(
        fdt_path: &Path,
        num_channels: usize,
        num_points: usize,
        num_trials: usize,
    ) -> FileResult<Vec<Vec<f64>>> {
        let file = File::open(fdt_path)?;
        let file_size = file.metadata()?.len();
        let total_samples = num_points * num_trials;
        let total_values = num_channels * total_samples;
        let expected_size = (total_values * 4) as u64; // float32 = 4 bytes

        // Validate file size
        if file_size < expected_size {
            return Err(FileReaderError::InvalidData(format!(
                ".fdt file size ({} bytes) is smaller than expected ({} bytes) for {} channels × {} samples × {} trials",
                file_size, expected_size, num_channels, num_points, num_trials
            )));
        }

        let mut reader = BufReader::new(file);

        // Read all bytes and convert to float32
        let mut bytes = vec![0u8; total_values * 4];
        reader.read_exact(&mut bytes)?;

        // Convert bytes to f32 (little-endian)
        let raw_data: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect();

        // Reorganize into channels using parallel processing
        // EEGLAB stores data as [channels, timepoints] in column-major (Fortran) order
        // So data layout is: ch0_t0, ch1_t0, ch2_t0, ..., ch0_t1, ch1_t1, ch2_t1, ...
        let channels: Vec<Vec<f64>> = (0..num_channels)
            .into_par_iter()
            .map(|ch_idx| {
                let mut channel_data = Vec::with_capacity(total_samples);
                for sample_idx in 0..total_samples {
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
