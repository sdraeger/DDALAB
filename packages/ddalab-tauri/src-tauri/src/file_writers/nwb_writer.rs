/// NWB (Neurodata Without Borders) File Writer
///
/// Writes IntermediateData to NWB 2.x format (HDF5-based).
/// Specification: https://nwb-schema.readthedocs.io/
///
/// NOTE: This is a basic implementation that creates minimal NWB files.
/// For full NWB compliance, consider using pynwb or other dedicated tools.
#[cfg(feature = "nwb-support")]
use super::{FileWriter, FileWriterError, FileWriterResult, WriterConfig};
#[cfg(feature = "nwb-support")]
use crate::intermediate_format::IntermediateData;
#[cfg(feature = "nwb-support")]
use hdf5::{File as H5File, Result as H5Result};
#[cfg(feature = "nwb-support")]
use std::path::Path;

#[cfg(feature = "nwb-support")]
pub struct NWBWriter;

#[cfg(feature = "nwb-support")]
impl NWBWriter {
    pub fn new() -> Self {
        Self
    }

    fn create_nwb_structure(
        file: &H5File,
        data: &IntermediateData,
    ) -> FileWriterResult<()> {
        file.new_attr_builder()
            .with_data(&["NWB-2.5.0"])
            .create("nwb_version")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to write nwb_version: {}", e)))?;

        file.new_attr_builder()
            .with_data(&[chrono::Utc::now().to_rfc3339()])
            .create("file_create_date")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to write file_create_date: {}", e)))?;

        let general = file
            .create_group("general")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to create /general: {}", e)))?;

        general
            .new_attr_builder()
            .with_data(&["DDALAB-generated NWB file"])
            .create("experimenter")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to write experimenter: {}", e)))?;

        let acquisition = file
            .create_group("acquisition")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to create /acquisition: {}", e)))?;

        let electrical_series = acquisition
            .create_group("ElectricalSeries")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to create ElectricalSeries: {}", e)))?;

        electrical_series
            .new_attr_builder()
            .with_data(&["ElectricalSeries"])
            .create("neurodata_type")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to write neurodata_type: {}", e)))?;

        electrical_series
            .new_attr_builder()
            .with_data(&["Voltage recordings"])
            .create("description")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to write description: {}", e)))?;

        let num_samples = data.num_samples();
        let num_channels = data.num_channels();

        let mut samples_array = vec![vec![0.0f64; num_samples]; num_channels];
        for (ch_idx, channel) in data.channels.iter().enumerate() {
            samples_array[ch_idx] = channel.samples.clone();
        }

        let flat_samples: Vec<f64> = samples_array
            .iter()
            .flat_map(|ch| ch.iter().cloned())
            .collect();

        let dataset = electrical_series
            .new_dataset::<f64>()
            .shape([num_samples, num_channels])
            .create("data")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to create data dataset: {}", e)))?;

        dataset
            .write(&flat_samples)
            .map_err(|e| FileWriterError::WriteError(format!("Failed to write data: {}", e)))?;

        dataset
            .new_attr_builder()
            .with_data(&[1.0f64])
            .create("conversion")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to write conversion: {}", e)))?;

        dataset
            .new_attr_builder()
            .with_data(&[0.0f64])
            .create("offset")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to write offset: {}", e)))?;

        let unit = if !data.channels.is_empty() {
            &data.channels[0].unit
        } else {
            "µV"
        };

        dataset
            .new_attr_builder()
            .with_data(&[unit])
            .create("unit")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to write unit: {}", e)))?;

        let rate_dataset = electrical_series
            .new_dataset::<f64>()
            .create("starting_time_rate")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to create starting_time_rate: {}", e)))?;

        rate_dataset
            .write_scalar(&data.metadata.sample_rate)
            .map_err(|e| FileWriterError::WriteError(format!("Failed to write sample rate: {}", e)))?;

        let starting_time_dataset = electrical_series
            .new_dataset::<f64>()
            .create("starting_time")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to create starting_time: {}", e)))?;

        starting_time_dataset
            .write_scalar(&0.0f64)
            .map_err(|e| FileWriterError::WriteError(format!("Failed to write starting_time: {}", e)))?;

        let channel_labels: Vec<String> = data.channels.iter().map(|ch| ch.label.clone()).collect();
        let electrodes = electrical_series
            .new_dataset_builder()
            .with_data(&channel_labels)
            .create("electrodes")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to create electrodes: {}", e)))?;

        electrodes
            .new_attr_builder()
            .with_data(&["Channel labels"])
            .create("description")
            .map_err(|e| FileWriterError::WriteError(format!("Failed to write electrodes description: {}", e)))?;

        Ok(())
    }
}

#[cfg(feature = "nwb-support")]
impl FileWriter for NWBWriter {
    fn write(
        &self,
        data: &IntermediateData,
        output_path: &Path,
        _config: &WriterConfig,
    ) -> FileWriterResult<()> {
        self.validate_data(data)?;

        let file = H5File::create(output_path)
            .map_err(|e| FileWriterError::IoError(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Failed to create HDF5 file: {}", e)
            )))?;

        Self::create_nwb_structure(&file, data)?;

        Ok(())
    }

    fn format_name(&self) -> &str {
        "NWB"
    }

    fn default_extension(&self) -> &str {
        "nwb"
    }
}

#[cfg(feature = "nwb-support")]
impl Default for NWBWriter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(not(feature = "nwb-support"))]
pub struct NWBWriter;

#[cfg(not(feature = "nwb-support"))]
impl NWBWriter {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(not(feature = "nwb-support"))]
impl super::FileWriter for NWBWriter {
    fn write(
        &self,
        _data: &crate::intermediate_format::IntermediateData,
        _output_path: &std::path::Path,
        _config: &super::WriterConfig,
    ) -> super::FileWriterResult<()> {
        Err(super::FileWriterError::UnsupportedFormat(
            "NWB support not enabled. Rebuild with --features nwb-support".to_string()
        ))
    }

    fn format_name(&self) -> &str {
        "NWB"
    }

    fn default_extension(&self) -> &str {
        "nwb"
    }
}

#[cfg(test)]
#[cfg(feature = "nwb-support")]
mod tests {
    use super::*;
    use crate::intermediate_format::{ChannelData, DataMetadata};
    use std::collections::HashMap;
    use tempfile::TempDir;

    #[test]
    fn test_nwb_writer() {
        let temp_dir = TempDir::new().unwrap();
        let output_path = temp_dir.path().join("test.nwb");

        let metadata = DataMetadata {
            source_file: "test.edf".to_string(),
            source_format: "EDF".to_string(),
            sample_rate: 256.0,
            duration: 0.01,
            start_time: None,
            subject_id: None,
            custom_metadata: HashMap::new(),
        };

        let mut data = IntermediateData::new(metadata);
        data.add_channel(ChannelData {
            label: "Fp1".to_string(),
            channel_type: "EEG".to_string(),
            unit: "µV".to_string(),
            samples: vec![1.0, 2.0, 3.0],
            sample_rate: None,
        });

        let writer = NWBWriter::new();
        let config = WriterConfig::default();

        assert!(writer.write(&data, &output_path, &config).is_ok());
        assert!(output_path.exists());
    }
}
