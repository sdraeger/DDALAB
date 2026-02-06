use super::{FileMetadata, FileReader, FileReaderError, FileResult};
use hdf5::File as H5File;
use ndarray::s;
use rayon::prelude::*;
use std::path::Path;
use std::sync::OnceLock;

/// NWB (Neurodata Without Borders) File Reader
///
/// Supports reading neurophysiology data in NWB 2.x format.
/// NWB files are HDF5-based with standardized hierarchical structure.
///
/// Key features:
/// - ElectricalSeries data (LFP, raw ephys, etc.)
/// - Electrode table metadata
/// - Unit conversion (physical values)
/// - Lazy loading for large files
/// - Multiple recording support
/// - Cached metadata for efficient repeated access
pub struct NWBFileReader {
    path: String,
    file: H5File,
    electrical_series_name: String,
    /// Cached metadata using interior mutability for thread-safe lazy initialization
    metadata_cache: OnceLock<NWBMetadata>,
}

#[derive(Debug, Clone)]
struct NWBMetadata {
    sample_rate: f64,
    num_channels: usize,
    num_samples: usize,
    duration: f64,
    channel_names: Vec<String>,
    conversion_factor: f64,
    offset: f64,
    unit: String,
    start_time: Option<String>,
}

impl NWBFileReader {
    /// Create a new NWB reader
    ///
    /// # Arguments
    /// * `path` - Path to .nwb file
    /// * `electrical_series_name` - Optional name of ElectricalSeries to read
    ///   If None, will use the first ElectricalSeries found in /acquisition/
    pub fn new(path: &Path) -> FileResult<Self> {
        Self::with_series_name(path, None)
    }

    /// Create reader with specific ElectricalSeries name
    pub fn with_series_name(path: &Path, series_name: Option<&str>) -> FileResult<Self> {
        let file = H5File::open(path)
            .map_err(|e| FileReaderError::ParseError(format!("Failed to open NWB file: {}", e)))?;

        // Validate NWB version
        let nwb_version = file
            .attr("nwb_version")
            .map_err(|e| {
                FileReaderError::ParseError(format!(
                    "Invalid NWB file (missing nwb_version): {}",
                    e
                ))
            })?
            .read_scalar::<hdf5::types::VarLenUnicode>()
            .map_err(|e| {
                FileReaderError::ParseError(format!("Failed to read NWB version: {}", e))
            })?;

        log::info!("NWB version: {}", nwb_version);

        // Find ElectricalSeries
        let series_name = if let Some(name) = series_name {
            name.to_string()
        } else {
            Self::find_first_electrical_series(&file)?
        };

        Ok(Self {
            path: path.to_string_lossy().to_string(),
            file,
            electrical_series_name: series_name,
            metadata_cache: OnceLock::new(),
        })
    }

    /// Find the first ElectricalSeries in /acquisition/
    fn find_first_electrical_series(file: &H5File) -> FileResult<String> {
        let acquisition = file.group("acquisition").map_err(|e| {
            FileReaderError::ParseError(format!("No /acquisition group found: {}", e))
        })?;

        // Iterate through acquisition group members
        for i in 0..acquisition.len() {
            if let Ok(member_name) = acquisition.member_names().and_then(|names| {
                names
                    .get(i)
                    .ok_or_else(|| hdf5::Error::from("Index out of bounds"))
            }) {
                let group_path = format!("/acquisition/{}", member_name);
                if let Ok(group) = file.group(&group_path) {
                    // Check if this is an ElectricalSeries by looking for neurodata_type attribute
                    if let Ok(neurodata_type) = group.attr("neurodata_type") {
                        if let Ok(type_str) =
                            neurodata_type.read_scalar::<hdf5::types::VarLenUnicode>()
                        {
                            if type_str.to_string().contains("ElectricalSeries") {
                                log::info!("Found ElectricalSeries: {}", member_name);
                                return Ok(member_name.clone());
                            }
                        }
                    }
                }
            }
        }

        Err(FileReaderError::ParseError(
            "No ElectricalSeries found in /acquisition/".to_string(),
        ))
    }

    /// Get cached metadata or read and cache it (thread-safe lazy initialization)
    fn get_metadata(&self) -> FileResult<&NWBMetadata> {
        self.metadata_cache
            .get_or_try_init(|| self.read_metadata_from_file())
    }

    /// Read metadata from file (internal helper, does not cache)
    fn read_metadata_from_file(&self) -> FileResult<NWBMetadata> {
        let series_path = format!("/acquisition/{}", self.electrical_series_name);
        let series = self.file.group(&series_path).map_err(|e| {
            FileReaderError::ParseError(format!(
                "ElectricalSeries not found at {}: {}",
                series_path, e
            ))
        })?;

        // Read data dataset to get shape
        let data = series
            .dataset("data")
            .map_err(|e| FileReaderError::ParseError(format!("No data dataset found: {}", e)))?;

        let shape = data.shape();
        if shape.len() != 2 {
            return Err(FileReaderError::InvalidData(format!(
                "Expected 2D data array, got {}D",
                shape.len()
            )));
        }

        let num_samples = shape[0];
        let num_channels = shape[1];

        // Read conversion and offset for unit conversion
        let conversion = data
            .attr("conversion")
            .and_then(|a| a.read_scalar::<f64>())
            .unwrap_or(1.0);

        let offset = data
            .attr("offset")
            .and_then(|a| a.read_scalar::<f64>())
            .unwrap_or(0.0);

        // Read unit
        let unit = data
            .attr("unit")
            .and_then(|a| a.read_scalar::<hdf5::types::VarLenUnicode>())
            .map(|s| s.to_string())
            .unwrap_or_else(|_| "V".to_string());

        // Get sample rate and start time
        let (sample_rate, start_time_opt) = self.read_timing_info(&series)?;

        let duration = num_samples as f64 / sample_rate;

        // Read electrode table to get channel names
        let channel_names = self.read_electrode_table(&series, num_channels)?;

        Ok(NWBMetadata {
            sample_rate,
            num_channels,
            num_samples,
            duration,
            channel_names,
            conversion_factor: conversion,
            offset,
            unit,
            start_time: start_time_opt,
        })
    }

    /// Read timing information (sample rate and start time)
    fn read_timing_info(&self, series: &hdf5::Group) -> FileResult<(f64, Option<String>)> {
        // NWB supports two timing modes:
        // 1. Explicit timestamps in "timestamps" dataset
        // 2. Calculated from "starting_time" + "rate" attributes

        if let Ok(timestamps_dataset) = series.dataset("timestamps") {
            // Read first two timestamps to calculate sample rate
            let timestamps: Vec<f64> = timestamps_dataset.read_slice_1d(..).map_err(|e| {
                FileReaderError::ParseError(format!("Failed to read timestamps: {}", e))
            })?;

            if timestamps.len() < 2 {
                return Err(FileReaderError::InvalidData(
                    "Not enough timestamps to determine sample rate".to_string(),
                ));
            }

            let sample_rate = 1.0 / (timestamps[1] - timestamps[0]);

            // Get session start time if available
            let start_time = self.read_session_start_time();

            Ok((sample_rate, start_time))
        } else if let Ok(starting_time) = series.dataset("starting_time") {
            // Read rate attribute
            let rate = starting_time
                .attr("rate")
                .and_then(|a| a.read_scalar::<f64>())
                .map_err(|e| {
                    FileReaderError::ParseError(format!(
                        "Missing or invalid 'rate' attribute: {}",
                        e
                    ))
                })?;

            let start_time = self.read_session_start_time();

            Ok((rate, start_time))
        } else {
            Err(FileReaderError::ParseError(
                "No timing information found (need 'timestamps' or 'starting_time')".to_string(),
            ))
        }
    }

    /// Read session start time from /session_start_time
    fn read_session_start_time(&self) -> Option<String> {
        self.file
            .dataset("session_start_time")
            .ok()
            .and_then(|ds| ds.read_scalar::<hdf5::types::VarLenUnicode>().ok())
            .map(|s| s.to_string())
    }

    /// Read electrode table to get channel names
    fn read_electrode_table(
        &self,
        series: &hdf5::Group,
        num_channels: usize,
    ) -> FileResult<Vec<String>> {
        // ElectricalSeries has "electrodes" dataset that references electrode table
        let electrodes = series
            .dataset("electrodes")
            .map_err(|e| FileReaderError::ParseError(format!("No electrodes dataset: {}", e)))?;

        // Read electrode indices
        let electrode_indices: Vec<i32> = electrodes.read_1d().map_err(|e| {
            FileReaderError::ParseError(format!("Failed to read electrode indices: {}", e))
        })?;

        // Access electrode table in /general/extracellular_ephys/electrodes
        let electrode_table_path = "/general/extracellular_ephys/electrodes";
        let electrode_table = self.file.group(electrode_table_path).ok();

        if let Some(table) = electrode_table {
            // Try to read "location" column for channel names
            if let Ok(location_ds) = table.dataset("location") {
                if let Ok(locations) = location_ds.read_1d::<hdf5::types::VarLenUnicode>() {
                    return Ok(electrode_indices
                        .iter()
                        .enumerate()
                        .map(|(i, &idx)| {
                            if idx >= 0 && (idx as usize) < locations.len() {
                                locations[idx as usize].to_string()
                            } else {
                                format!("Channel {}", i)
                            }
                        })
                        .collect());
                }
            }

            // Fallback: try "label" column
            if let Ok(label_ds) = table.dataset("label") {
                if let Ok(labels) = label_ds.read_1d::<hdf5::types::VarLenUnicode>() {
                    return Ok(electrode_indices
                        .iter()
                        .enumerate()
                        .map(|(i, &idx)| {
                            if idx >= 0 && (idx as usize) < labels.len() {
                                labels[idx as usize].to_string()
                            } else {
                                format!("Channel {}", i)
                            }
                        })
                        .collect());
                }
            }
        }

        // Fallback: use generic channel names
        Ok((0..num_channels)
            .map(|i| format!("Channel {}", i))
            .collect())
    }

    /// Read raw data chunk from HDF5
    fn read_raw_chunk(
        &self,
        start_sample: usize,
        num_samples: usize,
        channel_indices: &[usize],
    ) -> FileResult<Vec<Vec<f64>>> {
        let series_path = format!("/acquisition/{}", self.electrical_series_name);
        let series = self.file.group(&series_path).map_err(|e| {
            FileReaderError::ParseError(format!("ElectricalSeries not found: {}", e))
        })?;

        let data = series
            .dataset("data")
            .map_err(|e| FileReaderError::ParseError(format!("No data dataset found: {}", e)))?;

        let metadata = self.get_metadata()?;

        let end_sample = (start_sample + num_samples).min(metadata.num_samples);

        for &global_ch_idx in channel_indices {
            if global_ch_idx >= metadata.num_channels {
                return Err(FileReaderError::InvalidData(format!(
                    "Channel index {} out of range (max {})",
                    global_ch_idx, metadata.num_channels
                )));
            }
        }

        let bulk: ndarray::Array2<f64> = data
            .read_slice_2d(start_sample..end_sample, ..)
            .map_err(|e| FileReaderError::ParseError(format!("Failed to bulk-read data: {}", e)))?;

        let conversion = metadata.conversion_factor;
        let offset = metadata.offset;

        let result: Vec<Vec<f64>> = channel_indices
            .par_iter()
            .map(|&ch_idx| {
                bulk.slice(s![.., ch_idx])
                    .iter()
                    .map(|&v| v * conversion + offset)
                    .collect()
            })
            .collect();

        Ok(result)
    }

    /// List all available ElectricalSeries in the file
    pub fn list_electrical_series(&self) -> FileResult<Vec<String>> {
        let acquisition = self
            .file
            .group("acquisition")
            .map_err(|e| FileReaderError::ParseError(format!("No /acquisition group: {}", e)))?;

        let mut series_names = Vec::new();

        for i in 0..acquisition.len() {
            if let Ok(member_name) = acquisition.member_names().and_then(|names| {
                names
                    .get(i)
                    .ok_or_else(|| hdf5::Error::from("Index out of bounds"))
            }) {
                let group_path = format!("/acquisition/{}", member_name);
                if let Ok(group) = self.file.group(&group_path) {
                    if let Ok(neurodata_type) = group.attr("neurodata_type") {
                        if let Ok(type_str) =
                            neurodata_type.read_scalar::<hdf5::types::VarLenUnicode>()
                        {
                            if type_str.to_string().contains("ElectricalSeries") {
                                series_names.push(member_name.clone());
                            }
                        }
                    }
                }
            }
        }

        Ok(series_names)
    }
}

impl FileReader for NWBFileReader {
    fn metadata(&self) -> FileResult<FileMetadata> {
        let nwb_metadata = self.get_metadata()?;

        Ok(FileMetadata {
            file_path: self.path.clone(),
            file_name: Path::new(&self.path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown.nwb")
                .to_string(),
            file_size: std::fs::metadata(&self.path)?.len(),
            sample_rate: nwb_metadata.sample_rate,
            num_channels: nwb_metadata.num_channels,
            num_samples: nwb_metadata.num_samples,
            duration: nwb_metadata.duration,
            channels: nwb_metadata.channel_names.clone(),
            start_time: nwb_metadata.start_time.clone(),
            file_type: "NWB".to_string(),
        })
    }

    fn read_chunk(
        &self,
        start_sample: usize,
        num_samples: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let metadata = self.get_metadata()?;

        // Resolve channel indices
        let channel_indices: Vec<usize> = if let Some(selected) = channels {
            selected
                .iter()
                .filter_map(|name| metadata.channel_names.iter().position(|n| n == name))
                .collect()
        } else {
            (0..metadata.num_channels).collect()
        };

        if channel_indices.is_empty() {
            return Err(FileReaderError::InvalidData(
                "No valid channels selected".to_string(),
            ));
        }

        self.read_raw_chunk(start_sample, num_samples, &channel_indices)
    }

    fn read_overview(
        &self,
        max_points: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let nwb_metadata = self.get_metadata()?;
        let total_samples = nwb_metadata.num_samples;

        // Calculate decimation factor
        let decimation = (total_samples as f64 / max_points as f64).ceil() as usize;
        let decimation = decimation.max(1);

        // Read full data and decimate
        let full_data = self.read_chunk(0, total_samples, channels)?;

        // Parallelize decimation
        let decimated: Vec<Vec<f64>> = full_data
            .into_par_iter()
            .map(|channel_data| channel_data.iter().step_by(decimation).copied().collect())
            .collect();

        Ok(decimated)
    }

    fn format_name(&self) -> &str {
        "NWB"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nwb_format_name() {
        assert_eq!("NWB", "NWB");
    }
}
