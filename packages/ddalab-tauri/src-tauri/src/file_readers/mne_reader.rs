use super::{
    python_bridge::{self, PythonEnvironment},
    ChannelMetadata, FileMetadata, FileReader, FileReaderError, FileResult,
};
use rayon::prelude::*;
use std::path::{Path, PathBuf};

/// MNE-Python backed file reader.
///
/// Uses the Python bridge subprocess to read files that can't be handled
/// by native Rust readers (e.g., MATLAB v7.3 HDF5 `.set` files).
pub struct MNEFileReader {
    python_env: PythonEnvironment,
    bridge_script: PathBuf,
    file_path: String,
    metadata: FileMetadata,
}

impl MNEFileReader {
    /// Create a new MNE reader by invoking the bridge for metadata.
    pub fn new(
        path: &Path,
        python_env: PythonEnvironment,
        bridge_script: &Path,
    ) -> FileResult<Self> {
        if !python_env.has_mne {
            return Err(FileReaderError::UnsupportedFormat(
                "MNE-Python not available".to_string(),
            ));
        }

        let file_path = path.to_string_lossy().to_string();

        // Invoke bridge to get metadata
        let request = serde_json::json!({
            "mode": "metadata_only",
            "file_path": file_path,
        });

        let response = python_bridge::invoke_bridge(&python_env, bridge_script, &request)?;

        let meta = response.get("metadata").ok_or_else(|| {
            FileReaderError::ParseError("No metadata in bridge response".to_string())
        })?;

        let channels: Vec<String> = meta
            .get("channels")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        let channel_types: Vec<String> = meta
            .get("channel_types")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        let channel_units: Vec<String> = meta
            .get("channel_units")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        let num_channels = channels.len();
        let channel_metadata: Vec<ChannelMetadata> = (0..num_channels)
            .map(|i| ChannelMetadata {
                channel_type: channel_types
                    .get(i)
                    .cloned()
                    .unwrap_or_else(|| "Unknown".to_string()),
                unit: channel_units
                    .get(i)
                    .cloned()
                    .unwrap_or_else(|| "uV".to_string()),
            })
            .collect();

        let sample_rate = meta
            .get("sample_rate")
            .and_then(|v| v.as_f64())
            .unwrap_or(256.0);
        let num_samples = meta
            .get("num_samples")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize;
        let duration = meta.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let start_time = meta
            .get("start_time")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let file_name = meta
            .get("file_name")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let metadata = FileMetadata {
            file_path: file_path.clone(),
            file_name,
            file_size: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
            sample_rate,
            num_channels,
            num_samples,
            duration,
            channels,
            channel_metadata,
            start_time,
            file_type: "MNE-Python".to_string(),
        };

        Ok(Self {
            python_env,
            bridge_script: bridge_script.to_path_buf(),
            file_path,
            metadata,
        })
    }
}

impl FileReader for MNEFileReader {
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
        let request = serde_json::json!({
            "mode": "read_data",
            "file_path": self.file_path,
            "start_sample": start_sample,
            "num_samples": num_samples,
            "channels": channels,
        });

        let response =
            python_bridge::invoke_bridge(&self.python_env, &self.bridge_script, &request)?;

        let data_file = response
            .get("data_file")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                FileReaderError::ParseError("No data_file in bridge response".to_string())
            })?;

        let n_channels = response
            .get("num_channels")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize;
        let n_samples = response
            .get("num_samples")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize;

        // Read binary float64 data from temp file
        let raw_bytes = std::fs::read(data_file)
            .map_err(|e| FileReaderError::ParseError(format!("Failed to read data file: {}", e)))?;

        // Clean up temp file
        let _ = std::fs::remove_file(data_file);

        let expected_size = n_channels * n_samples * 8;
        if raw_bytes.len() < expected_size {
            return Err(FileReaderError::InvalidData(format!(
                "Data file too small: {} bytes (expected {})",
                raw_bytes.len(),
                expected_size
            )));
        }

        // Parse float64 values (data is channels x samples, C-contiguous)
        let result: Vec<Vec<f64>> = (0..n_channels)
            .into_par_iter()
            .map(|ch| {
                let offset = ch * n_samples * 8;
                (0..n_samples)
                    .map(|s| {
                        let idx = offset + s * 8;
                        f64::from_le_bytes([
                            raw_bytes[idx],
                            raw_bytes[idx + 1],
                            raw_bytes[idx + 2],
                            raw_bytes[idx + 3],
                            raw_bytes[idx + 4],
                            raw_bytes[idx + 5],
                            raw_bytes[idx + 6],
                            raw_bytes[idx + 7],
                        ])
                    })
                    .collect()
            })
            .collect();

        Ok(result)
    }

    fn read_overview(
        &self,
        max_points: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let total_samples = self.metadata.num_samples;
        let decimation = (total_samples as f64 / max_points as f64).ceil() as usize;
        let decimation = decimation.max(1);

        let full_data = self.read_chunk(0, total_samples, channels)?;

        let decimated: Vec<Vec<f64>> = full_data
            .into_par_iter()
            .map(|channel_data| channel_data.iter().step_by(decimation).copied().collect())
            .collect();

        Ok(decimated)
    }

    fn format_name(&self) -> &str {
        "MNE-Python"
    }
}
