//! BrainVision File Writer
//!
//! Writes IntermediateData to BrainVision format (.vhdr + .eeg + .vmrk)
//! Specification: https://www.brainproducts.com/support-resources/brainvision-core-data-format-1-0/

use super::{FileWriter, FileWriterError, FileWriterResult, WriterConfig};
use crate::intermediate_format::IntermediateData;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

pub struct BrainVisionWriter;

impl BrainVisionWriter {
    pub fn new() -> Self {
        Self
    }

    /// Write the header file (.vhdr)
    fn write_header(
        &self,
        path: &Path,
        data: &IntermediateData,
        data_filename: &str,
        marker_filename: &str,
    ) -> FileWriterResult<()> {
        let file = File::create(path)?;
        let mut writer = BufWriter::new(file);

        // Header section
        writeln!(writer, "Brain Vision Data Exchange Header File Version 1.0")?;
        writeln!(writer, "; Data exported from DDALAB")?;
        writeln!(writer)?;

        // Common Infos
        writeln!(writer, "[Common Infos]")?;
        writeln!(writer, "Codepage=UTF-8")?;
        writeln!(writer, "DataFile={}", data_filename)?;
        writeln!(writer, "MarkerFile={}", marker_filename)?;
        writeln!(writer, "DataFormat=BINARY")?;
        writeln!(writer, "DataOrientation=MULTIPLEXED")?;
        writeln!(writer, "NumberOfChannels={}", data.num_channels())?;
        writeln!(
            writer,
            "SamplingInterval={}",
            (1_000_000.0 / data.metadata.sample_rate) as u64
        )?; // in microseconds
        writeln!(writer)?;

        // Binary Infos
        writeln!(writer, "[Binary Infos]")?;
        writeln!(writer, "BinaryFormat=IEEE_FLOAT_32")?;
        writeln!(writer)?;

        // Channel Infos
        writeln!(writer, "[Channel Infos]")?;
        writeln!(
            writer,
            "; Each entry: Ch<n>=<Name>,<Reference>,<Resolution>,<Unit>"
        )?;
        for (i, channel) in data.channels.iter().enumerate() {
            let unit = if channel.unit.is_empty() {
                "µV"
            } else {
                &channel.unit
            };
            // Resolution of 1 since we're storing actual values
            writeln!(writer, "Ch{}={},,,{}", i + 1, channel.label, unit)?;
        }
        writeln!(writer)?;

        writer.flush()?;
        Ok(())
    }

    /// Write the data file (.eeg) - binary IEEE float 32
    fn write_data(&self, path: &Path, data: &IntermediateData) -> FileWriterResult<()> {
        let file = File::create(path)?;
        let mut writer = BufWriter::new(file);

        let num_samples = data.num_samples();

        // Write data in multiplexed format (sample by sample, all channels)
        for sample_idx in 0..num_samples {
            for channel in &data.channels {
                let value = if sample_idx < channel.samples.len() {
                    channel.samples[sample_idx] as f32
                } else {
                    0.0f32
                };
                writer.write_all(&value.to_le_bytes())?;
            }
        }

        writer.flush()?;
        Ok(())
    }

    /// Write the marker file (.vmrk)
    fn write_markers(
        &self,
        path: &Path,
        data_filename: &str,
        _data: &IntermediateData,
    ) -> FileWriterResult<()> {
        let file = File::create(path)?;
        let mut writer = BufWriter::new(file);

        writeln!(writer, "Brain Vision Data Exchange Marker File Version 1.0")?;
        writeln!(writer, "; Data exported from DDALAB")?;
        writeln!(writer)?;

        writeln!(writer, "[Common Infos]")?;
        writeln!(writer, "Codepage=UTF-8")?;
        writeln!(writer, "DataFile={}", data_filename)?;
        writeln!(writer)?;

        writeln!(writer, "[Marker Infos]")?;
        writeln!(
            writer,
            "; Each entry: Mk<n>=<Type>,<Description>,<Position>,<Size>,<Channel>,<Date>"
        )?;
        // Add a "New Segment" marker at the beginning (required by spec)
        writeln!(writer, "Mk1=New Segment,,1,1,0")?;
        writeln!(writer)?;

        writer.flush()?;
        Ok(())
    }
}

impl FileWriter for BrainVisionWriter {
    fn write(
        &self,
        data: &IntermediateData,
        output_path: &Path,
        _config: &WriterConfig,
    ) -> FileWriterResult<()> {
        self.validate_data(data)?;

        // Get base name without extension
        let base_name = output_path
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| FileWriterError::InvalidData("Invalid output path".to_string()))?;

        let parent = output_path.parent().unwrap_or(Path::new("."));

        // Define filenames
        let header_path = parent.join(format!("{}.vhdr", base_name));
        let data_path = parent.join(format!("{}.eeg", base_name));
        let marker_path = parent.join(format!("{}.vmrk", base_name));

        let data_filename = format!("{}.eeg", base_name);
        let marker_filename = format!("{}.vmrk", base_name);

        // Write all three files
        self.write_header(&header_path, data, &data_filename, &marker_filename)?;
        self.write_data(&data_path, data)?;
        self.write_markers(&marker_path, &data_filename, data)?;

        Ok(())
    }

    fn format_name(&self) -> &str {
        "BrainVision"
    }

    fn default_extension(&self) -> &str {
        "vhdr"
    }

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

impl Default for BrainVisionWriter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intermediate_format::{ChannelData, DataMetadata};
    use std::collections::HashMap;
    use tempfile::TempDir;

    #[test]
    fn test_brainvision_writer() {
        let temp_dir = TempDir::new().unwrap();
        let output_path = temp_dir.path().join("test.vhdr");

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
            samples: vec![10.0, 20.0, 30.0, 40.0],
            sample_rate: None,
        });

        data.add_channel(ChannelData {
            label: "Fp2".to_string(),
            channel_type: "EEG".to_string(),
            unit: "µV".to_string(),
            samples: vec![15.0, 25.0, 35.0, 45.0],
            sample_rate: None,
        });

        let writer = BrainVisionWriter::new();
        let config = WriterConfig::default();

        assert!(writer.write(&data, &output_path, &config).is_ok());

        // Verify all three files exist
        assert!(temp_dir.path().join("test.vhdr").exists());
        assert!(temp_dir.path().join("test.eeg").exists());
        assert!(temp_dir.path().join("test.vmrk").exists());

        // Verify data file size (4 samples * 2 channels * 4 bytes per float = 32 bytes)
        let data_size = std::fs::metadata(temp_dir.path().join("test.eeg"))
            .unwrap()
            .len();
        assert_eq!(data_size, 32);
    }
}
