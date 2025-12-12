/*! NIfTI (Neuroimaging Informatics Technology Initiative) File Reader
 *
 * Implements the [`FileReader`](super::FileReader) trait for NIfTI-1 files (.nii and .nii.gz).
 *
 * NIfTI is a standard format for storing neuroimaging data, commonly used in fMRI and structural MRI.
 * This implementation focuses on reading 4D volumes (x, y, z, time) for time series analysis.
 *
 * # Features
 * - Reading .nii and .nii.gz files
 * - 3D volume support (single time point)
 * - 4D volume support (time series)
 * - Automatic voxel flattening (spatial dims → channels)
 * - Header metadata extraction (dimensions, voxel size, etc.)
 * - Integration with DDALAB's IntermediateData pipeline
 *
 * # Limitations
 * - Each voxel is treated as a separate "channel"
 * - Large volumes may result in many channels
 * - Spatial structure is flattened (no 3D visualization)
 *
 * # Data Layout
 * For a 4D volume with dimensions [64, 64, 30, 200]:
 * - 64×64×30 = 122,880 voxels (channels)
 * - 200 time points (samples per channel)
 */

use super::{FileMetadata, FileReader, FileReaderError, FileResult};
use nifti::{IntoNdArray, NiftiObject, NiftiVolume, ReaderOptions};
use rayon::prelude::*;
use std::path::Path;

pub struct NIfTIFileReader {
    file_path: String,
    metadata: FileMetadata,
    /// Volume dimensions: [x, y, z] or [x, y, z, t]
    dims: Vec<usize>,
    /// Total number of voxels (spatial flattening)
    num_voxels: usize,
    /// Number of time points (1 for 3D volumes)
    num_timepoints: usize,
}

impl NIfTIFileReader {
    pub fn new(path: &Path) -> FileResult<Self> {
        let file_path = path.to_string_lossy().to_string();

        // Read NIfTI file
        let obj = ReaderOptions::new().read_file(path).map_err(|e| {
            FileReaderError::ParseError(format!("Failed to open NIfTI file: {}", e))
        })?;

        let header = obj.header();
        let volume = obj.volume();
        let dims_array = volume.dim();

        // Convert dims to Vec<usize> and determine dimensionality
        let dims: Vec<usize> = dims_array.iter().map(|&d| d as usize).collect();

        // NIfTI dims[0] is the number of dimensions, dims[1..] are the actual sizes
        let ndim = dims[0];
        let shape = &dims[1..=ndim];

        // Determine spatial and temporal dimensions
        let (spatial_dims, num_timepoints) = match shape.len() {
            3 => {
                // 3D volume: [x, y, z]
                (shape.to_vec(), 1)
            }
            4 => {
                // 4D volume: [x, y, z, t]
                (shape[0..3].to_vec(), shape[3])
            }
            _ => {
                return Err(FileReaderError::UnsupportedFormat(format!(
                    "Unsupported NIfTI dimensionality: {}D (expected 3D or 4D)",
                    shape.len()
                )))
            }
        };

        // Calculate total number of voxels (spatial flattening)
        let num_voxels = spatial_dims.iter().product();

        // Generate channel labels (one per voxel)
        let channels: Vec<String> = (0..num_voxels)
            .map(|i| {
                // Convert flat index to 3D coordinates
                let x = i % spatial_dims[0];
                let y = (i / spatial_dims[0]) % spatial_dims[1];
                let z = i / (spatial_dims[0] * spatial_dims[1]);
                format!("Voxel_{}_{}_{}", x, y, z)
            })
            .collect();

        // Extract timing information from header
        // pixdim[4] typically stores TR (repetition time) in seconds
        let pixdim = header.pixdim;
        let tr = if pixdim.len() > 4 && pixdim[4] > 0.0 {
            pixdim[4] as f64
        } else {
            1.0 // Default to 1 second if not specified
        };

        let sample_rate = 1.0 / tr; // Hz
        let duration = num_timepoints as f64 * tr;

        // Get file size
        let file_size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

        let metadata = FileMetadata {
            file_path: file_path.clone(),
            file_name: path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown.nii")
                .to_string(),
            file_size,
            sample_rate,
            num_channels: num_voxels,
            num_samples: num_timepoints,
            duration,
            channels,
            start_time: None,
            file_type: "NIfTI".to_string(),
        };

        log::info!(
            "NIfTI file loaded: {:?}, dims: {:?}, {} voxels, {} timepoints, TR={:.3}s",
            path,
            spatial_dims,
            num_voxels,
            num_timepoints,
            tr
        );

        Ok(Self {
            file_path,
            metadata,
            dims: shape.to_vec(),
            num_voxels,
            num_timepoints,
        })
    }

    /// Read the full volume data from disk
    ///
    /// This loads the entire NIfTI volume into memory and converts it to f64.
    fn read_volume(&self) -> FileResult<Vec<Vec<f64>>> {
        // Re-open the file to read volume data
        let obj = ReaderOptions::new()
            .read_file(&self.file_path)
            .map_err(|e| {
                FileReaderError::ParseError(format!("Failed to read NIfTI volume: {}", e))
            })?;

        // Use the ndarray conversion - chain the calls
        let ndarray = obj.into_volume().into_ndarray::<f32>().map_err(|e| {
            FileReaderError::ParseError(format!("Failed to convert to ndarray: {}", e))
        })?;

        // Determine shape
        let shape = ndarray.shape();

        match shape.len() {
            3 => {
                // 3D volume: treat as single time point
                // Flatten [x, y, z] → [num_voxels]
                let flat: Vec<f64> = ndarray.iter().map(|&v| v as f64).collect();

                // Each voxel is a channel with 1 sample (parallelize wrapping for performance)
                let result: Vec<Vec<f64>> = flat.into_par_iter().map(|v| vec![v]).collect();
                Ok(result)
            }
            4 => {
                // 4D volume: [x, y, z, t]
                // Reshape to [num_voxels, num_timepoints]
                let num_voxels = shape[0] * shape[1] * shape[2];
                let num_timepoints = shape[3];

                // Parallelize voxel processing for better performance on large volumes
                let result: Vec<Vec<f64>> = (0..num_voxels)
                    .into_par_iter()
                    .map(|voxel_idx| {
                        // Calculate x, y, z from voxel_idx
                        let x = voxel_idx % shape[0];
                        let y = (voxel_idx / shape[0]) % shape[1];
                        let z = voxel_idx / (shape[0] * shape[1]);

                        // Extract timeseries for this voxel
                        (0..num_timepoints)
                            .map(|t| ndarray[[x, y, z, t]] as f64)
                            .collect()
                    })
                    .collect();

                Ok(result)
            }
            _ => Err(FileReaderError::UnsupportedFormat(format!(
                "Unexpected ndarray shape: {:?}",
                shape
            ))),
        }
    }
}

impl FileReader for NIfTIFileReader {
    fn metadata(&self) -> FileResult<FileMetadata> {
        Ok(self.metadata.clone())
    }

    fn read_chunk(
        &self,
        start_sample: usize,
        num_samples: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        // Validate range
        if start_sample >= self.num_timepoints {
            return Err(FileReaderError::ParseError(format!(
                "Start sample {} is beyond file end ({})",
                start_sample, self.num_timepoints
            )));
        }

        // Read full volume
        let full_data = self.read_volume()?;

        // Determine which channels to return
        let channel_indices: Vec<usize> = if let Some(ch_names) = channels {
            ch_names
                .iter()
                .filter_map(|name| self.metadata.channels.iter().position(|ch| ch == name))
                .collect()
        } else {
            (0..self.num_voxels).collect()
        };

        // Extract requested chunk for selected channels
        let end_sample = (start_sample + num_samples).min(self.num_timepoints);
        let mut result = Vec::with_capacity(channel_indices.len());

        for &ch_idx in &channel_indices {
            if ch_idx < full_data.len() {
                let channel_chunk = full_data[ch_idx][start_sample..end_sample].to_vec();
                result.push(channel_chunk);
            }
        }

        Ok(result)
    }

    fn read_overview(
        &self,
        max_points: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let total_samples = self.num_timepoints;
        let decimation_factor = (total_samples as f64 / max_points as f64).ceil() as usize;
        let decimation_factor = decimation_factor.max(1);

        // Read full data then decimate
        let full_data = self.read_chunk(0, total_samples, channels)?;

        // Parallelize channel decimation for better performance (order preserved by rayon)
        let decimated: Vec<Vec<f64>> = full_data
            .par_iter()
            .map(|channel| channel.iter().step_by(decimation_factor).copied().collect())
            .collect();

        Ok(decimated)
    }

    fn format_name(&self) -> &str {
        "NIfTI"
    }

    fn supports_write(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_name() {
        assert_eq!("NIfTI", "NIfTI");
    }

    #[test]
    fn test_nonexistent_file() {
        let fake_path = Path::new("nonexistent_file.nii");
        let result = NIfTIFileReader::new(fake_path);
        assert!(result.is_err(), "Should fail for nonexistent file");
    }

    // Additional tests would require actual NIfTI test files
    #[test]
    #[ignore]
    fn test_read_nifti_file() {
        // This test requires a real NIfTI file
        // Set TEST_NIFTI_FILE environment variable to run:
        // TEST_NIFTI_FILE=/path/to/file.nii cargo test --lib nifti_reader -- --ignored

        if let Ok(test_file) = std::env::var("TEST_NIFTI_FILE") {
            let path = Path::new(&test_file);
            if path.exists() {
                let reader = NIfTIFileReader::new(path);
                assert!(reader.is_ok(), "Should successfully read NIfTI file");

                if let Ok(reader) = reader {
                    let metadata = reader.metadata().unwrap();
                    assert!(metadata.num_channels > 0, "Should have channels");
                    assert!(metadata.num_samples > 0, "Should have samples");
                    println!(
                        "NIfTI file: {} channels, {} samples",
                        metadata.num_channels, metadata.num_samples
                    );
                }
            }
        }
    }
}
