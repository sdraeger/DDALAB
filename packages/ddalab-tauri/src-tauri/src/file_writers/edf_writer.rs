/// EDF (European Data Format) File Writer
///
/// Writes IntermediateData to EDF format.
/// Specification: https://www.edfplus.info/specs/edf.html
use super::{FileWriter, FileWriterError, FileWriterResult, WriterConfig};
use crate::intermediate_format::IntermediateData;
use chrono::{DateTime, Datelike, Timelike, Utc};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

pub struct EDFWriter;

impl EDFWriter {
    pub fn new() -> Self {
        Self
    }

    fn write_fixed_string<W: Write>(writer: &mut W, s: &str, size: usize) -> FileWriterResult<()> {
        let mut buffer = vec![b' '; size];
        let bytes = s.as_bytes();
        let copy_len = bytes.len().min(size);
        buffer[..copy_len].copy_from_slice(&bytes[..copy_len]);
        writer.write_all(&buffer)?;
        Ok(())
    }

    fn write_edf_header<W: Write>(
        writer: &mut W,
        data: &IntermediateData,
        num_samples_per_record: usize,
        record_duration: f64,
    ) -> FileWriterResult<usize> {
        let num_signals = data.num_channels();
        let total_samples = data.num_samples();

        let num_data_records = (total_samples as f64 / num_samples_per_record as f64).ceil() as i64;

        let header_bytes = 256 + num_signals * 256;

        Self::write_fixed_string(writer, "0", 8)?;

        let patient_id = data
            .metadata
            .subject_id
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or("Unknown");
        Self::write_fixed_string(writer, patient_id, 80)?;

        let recording_id = format!(
            "Startdate {} {}",
            data.metadata
                .source_file
                .split('/')
                .last()
                .unwrap_or("unknown"),
            data.metadata.source_format
        );
        Self::write_fixed_string(writer, &recording_id, 80)?;

        let (start_date_str, start_time_str) =
            if let Some(ref start_time) = data.metadata.start_time {
                if let Ok(dt) = DateTime::parse_from_rfc3339(start_time) {
                    let dt_utc = dt.with_timezone(&Utc);
                    let date = format!(
                        "{:02}.{:02}.{:02}",
                        dt_utc.day(),
                        dt_utc.month(),
                        dt_utc.year() % 100
                    );
                    let time = format!(
                        "{:02}.{:02}.{:02}",
                        dt_utc.hour(),
                        dt_utc.minute(),
                        dt_utc.second()
                    );
                    (date, time)
                } else {
                    ("01.01.00".to_string(), "00.00.00".to_string())
                }
            } else {
                ("01.01.00".to_string(), "00.00.00".to_string())
            };

        Self::write_fixed_string(writer, &start_date_str, 8)?;
        Self::write_fixed_string(writer, &start_time_str, 8)?;

        Self::write_fixed_string(writer, &header_bytes.to_string(), 8)?;

        Self::write_fixed_string(writer, "", 44)?;

        Self::write_fixed_string(writer, &num_data_records.to_string(), 8)?;

        Self::write_fixed_string(writer, &format!("{}", record_duration), 8)?;

        Self::write_fixed_string(writer, &num_signals.to_string(), 4)?;

        Ok(num_data_records as usize)
    }

    fn write_signal_headers<W: Write>(
        writer: &mut W,
        data: &IntermediateData,
        num_samples_per_record: usize,
    ) -> FileWriterResult<Vec<(f64, f64, i64, i64)>> {
        let mut calibration_params = Vec::new();

        for channel in &data.channels {
            Self::write_fixed_string(writer, &channel.label, 16)?;
        }

        for _ in &data.channels {
            Self::write_fixed_string(writer, "", 80)?;
        }

        for channel in &data.channels {
            let unit = if channel.unit.is_empty() {
                "µV"
            } else {
                &channel.unit
            };
            Self::write_fixed_string(writer, unit, 8)?;
        }

        for channel in &data.channels {
            let (physical_min, physical_max) = if !channel.samples.is_empty() {
                let min = channel
                    .samples
                    .iter()
                    .cloned()
                    .fold(f64::INFINITY, f64::min);
                let max = channel
                    .samples
                    .iter()
                    .cloned()
                    .fold(f64::NEG_INFINITY, f64::max);

                let range = (max - min).abs();
                let margin = range * 0.1;

                (min - margin, max + margin)
            } else {
                (-32768.0, 32767.0)
            };

            Self::write_fixed_string(writer, &format!("{:.6}", physical_min), 8)?;
            calibration_params.push((physical_min, 0.0, 0, 0));
        }

        for (idx, channel) in data.channels.iter().enumerate() {
            let physical_max = if !channel.samples.is_empty() {
                let min = channel
                    .samples
                    .iter()
                    .cloned()
                    .fold(f64::INFINITY, f64::min);
                let max = channel
                    .samples
                    .iter()
                    .cloned()
                    .fold(f64::NEG_INFINITY, f64::max);
                let range = (max - min).abs();
                let margin = range * 0.1;
                max + margin
            } else {
                32767.0
            };

            Self::write_fixed_string(writer, &format!("{:.6}", physical_max), 8)?;
            calibration_params[idx].1 = physical_max;
        }

        let digital_min: i64 = -32768;
        let digital_max: i64 = 32767;

        for _ in &data.channels {
            Self::write_fixed_string(writer, &digital_min.to_string(), 8)?;
        }

        for (idx, _) in data.channels.iter().enumerate() {
            Self::write_fixed_string(writer, &digital_max.to_string(), 8)?;
            calibration_params[idx].2 = digital_min;
            calibration_params[idx].3 = digital_max;
        }

        for _ in &data.channels {
            Self::write_fixed_string(writer, "", 80)?;
        }

        for _ in &data.channels {
            Self::write_fixed_string(writer, &num_samples_per_record.to_string(), 8)?;
        }

        for _ in &data.channels {
            Self::write_fixed_string(writer, "", 32)?;
        }

        Ok(calibration_params)
    }

    fn write_data_records<W: Write>(
        writer: &mut W,
        data: &IntermediateData,
        num_samples_per_record: usize,
        num_data_records: usize,
        calibration_params: &[(f64, f64, i64, i64)],
    ) -> FileWriterResult<()> {
        let total_samples = data.num_samples();

        for record_idx in 0..num_data_records {
            let start_sample = record_idx * num_samples_per_record;
            let end_sample = (start_sample + num_samples_per_record).min(total_samples);
            let samples_in_record = end_sample - start_sample;

            for (ch_idx, channel) in data.channels.iter().enumerate() {
                let (physical_min, physical_max, digital_min, digital_max) =
                    calibration_params[ch_idx];

                let gain = (physical_max - physical_min) / (digital_max - digital_min) as f64;
                let offset = physical_max - gain * digital_max as f64;

                for sample_idx in 0..num_samples_per_record {
                    let global_sample_idx = start_sample + sample_idx;

                    let digital_value = if global_sample_idx < channel.samples.len() {
                        let physical_value = channel.samples[global_sample_idx];

                        let raw_digital = ((physical_value - offset) / gain).round() as i64;

                        raw_digital.clamp(digital_min, digital_max) as i16
                    } else {
                        0i16
                    };

                    let bytes = digital_value.to_le_bytes();
                    writer.write_all(&bytes)?;
                }
            }
        }

        Ok(())
    }
}

impl FileWriter for EDFWriter {
    fn write(
        &self,
        data: &IntermediateData,
        output_path: &Path,
        _config: &WriterConfig,
    ) -> FileWriterResult<()> {
        self.validate_data(data)?;

        if data.metadata.sample_rate <= 0.0 {
            return Err(FileWriterError::InvalidData(
                "Sample rate must be positive".to_string(),
            ));
        }

        let file = File::create(output_path)?;
        let mut writer = BufWriter::new(file);

        let record_duration = 1.0;
        let num_samples_per_record = (data.metadata.sample_rate * record_duration) as usize;

        let num_data_records =
            Self::write_edf_header(&mut writer, data, num_samples_per_record, record_duration)?;

        let calibration_params =
            Self::write_signal_headers(&mut writer, data, num_samples_per_record)?;

        Self::write_data_records(
            &mut writer,
            data,
            num_samples_per_record,
            num_data_records,
            &calibration_params,
        )?;

        writer.flush()?;

        Ok(())
    }

    fn format_name(&self) -> &str {
        "EDF"
    }

    fn default_extension(&self) -> &str {
        "edf"
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

        let first_len = data.channels[0].samples.len();
        for channel in &data.channels {
            if channel.samples.len() != first_len {
                return Err(FileWriterError::InvalidData(
                    "All channels must have the same number of samples for EDF format".to_string(),
                ));
            }
        }

        Ok(())
    }
}

impl Default for EDFWriter {
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
    fn test_edf_writer() {
        let temp_dir = TempDir::new().unwrap();
        let output_path = temp_dir.path().join("test.edf");

        let metadata = DataMetadata {
            source_file: "test.csv".to_string(),
            source_format: "CSV".to_string(),
            sample_rate: 256.0,
            duration: 0.01,
            start_time: Some("2024-01-01T12:00:00Z".to_string()),
            subject_id: Some("S001".to_string()),
            custom_metadata: HashMap::new(),
        };

        let mut data = IntermediateData::new(metadata);
        data.add_channel(ChannelData {
            label: "Fp1".to_string(),
            channel_type: "EEG".to_string(),
            unit: "µV".to_string(),
            samples: vec![10.0, 20.0, 30.0],
            sample_rate: None,
        });

        data.add_channel(ChannelData {
            label: "Fp2".to_string(),
            channel_type: "EEG".to_string(),
            unit: "µV".to_string(),
            samples: vec![15.0, 25.0, 35.0],
            sample_rate: None,
        });

        let writer = EDFWriter::new();
        let config = WriterConfig::default();

        assert!(writer.write(&data, &output_path, &config).is_ok());
        assert!(output_path.exists());

        let file_size = std::fs::metadata(&output_path).unwrap().len();
        assert!(file_size > 0);
    }

    #[test]
    fn test_edf_writer_rejects_mismatched_lengths() {
        let temp_dir = TempDir::new().unwrap();
        let output_path = temp_dir.path().join("test.edf");

        let metadata = DataMetadata {
            source_file: "test.csv".to_string(),
            source_format: "CSV".to_string(),
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
            samples: vec![10.0, 20.0, 30.0],
            sample_rate: None,
        });

        data.add_channel(ChannelData {
            label: "Fp2".to_string(),
            channel_type: "EEG".to_string(),
            unit: "µV".to_string(),
            samples: vec![15.0, 25.0],
            sample_rate: None,
        });

        let writer = EDFWriter::new();
        let config = WriterConfig::default();

        assert!(writer.write(&data, &output_path, &config).is_err());
    }
}
