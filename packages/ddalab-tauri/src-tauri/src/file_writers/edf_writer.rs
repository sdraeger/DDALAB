/// EDF (European Data Format) File Writer
///
/// Writes IntermediateData to EDF format.
/// Specification: https://www.edfplus.info/specs/edf.html
use super::{FileWriter, FileWriterError, FileWriterResult, WriterConfig};
use crate::intermediate_format::IntermediateData;
use chrono::{DateTime, Datelike, Timelike, Utc};
use rayon::prelude::*;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

/// Minimum samples to use parallel processing (avoid overhead for small files)
const PARALLEL_THRESHOLD: usize = 10_000;

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

    /// Compute min/max bounds for each channel (parallelized for large datasets)
    fn compute_channel_bounds(data: &IntermediateData) -> Vec<(f64, f64)> {
        let use_parallel = data.num_samples() >= PARALLEL_THRESHOLD;

        if use_parallel {
            // Parallel computation for large datasets
            data.channels
                .par_iter()
                .map(|channel| {
                    if channel.samples.is_empty() {
                        return (-32768.0, 32767.0);
                    }

                    let (min, max) = channel
                        .samples
                        .par_iter()
                        .fold(
                            || (f64::INFINITY, f64::NEG_INFINITY),
                            |(min, max), &val| (min.min(val), max.max(val)),
                        )
                        .reduce(
                            || (f64::INFINITY, f64::NEG_INFINITY),
                            |(min1, max1), (min2, max2)| (min1.min(min2), max1.max(max2)),
                        );

                    let range = (max - min).abs();
                    let margin = range * 0.1;
                    (min - margin, max + margin)
                })
                .collect()
        } else {
            // Sequential for small datasets
            data.channels
                .iter()
                .map(|channel| {
                    if channel.samples.is_empty() {
                        return (-32768.0, 32767.0);
                    }

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
                })
                .collect()
        }
    }

    fn write_signal_headers<W: Write>(
        writer: &mut W,
        data: &IntermediateData,
        num_samples_per_record: usize,
    ) -> FileWriterResult<Vec<(f64, f64, i64, i64)>> {
        // Pre-compute channel bounds in parallel
        let channel_bounds = Self::compute_channel_bounds(data);

        let digital_min: i64 = -32768;
        let digital_max: i64 = 32767;

        // Build calibration params from pre-computed bounds
        let calibration_params: Vec<(f64, f64, i64, i64)> = channel_bounds
            .iter()
            .map(|&(physical_min, physical_max)| {
                (physical_min, physical_max, digital_min, digital_max)
            })
            .collect();

        // Write signal headers (sequential I/O)
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

        for &(physical_min, _, _, _) in &calibration_params {
            Self::write_fixed_string(writer, &format!("{:.6}", physical_min), 8)?;
        }

        for &(_, physical_max, _, _) in &calibration_params {
            Self::write_fixed_string(writer, &format!("{:.6}", physical_max), 8)?;
        }

        for _ in &data.channels {
            Self::write_fixed_string(writer, &digital_min.to_string(), 8)?;
        }

        for _ in &data.channels {
            Self::write_fixed_string(writer, &digital_max.to_string(), 8)?;
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

    /// Pre-compute all digital values for a channel (parallelized)
    fn compute_channel_digital_values(
        samples: &[f64],
        physical_min: f64,
        physical_max: f64,
        digital_min: i64,
        digital_max: i64,
        total_output_samples: usize,
    ) -> Vec<i16> {
        let gain = (physical_max - physical_min) / (digital_max - digital_min) as f64;
        let offset = physical_max - gain * digital_max as f64;

        let mut result = Vec::with_capacity(total_output_samples);

        // Convert all samples
        for sample_idx in 0..total_output_samples {
            let digital_value = if sample_idx < samples.len() {
                let physical_value = samples[sample_idx];
                let raw_digital = ((physical_value - offset) / gain).round() as i64;
                raw_digital.clamp(digital_min, digital_max) as i16
            } else {
                0i16 // Padding for incomplete records
            };
            result.push(digital_value);
        }

        result
    }

    fn write_data_records<W: Write>(
        writer: &mut W,
        data: &IntermediateData,
        num_samples_per_record: usize,
        num_data_records: usize,
        calibration_params: &[(f64, f64, i64, i64)],
    ) -> FileWriterResult<()> {
        let total_output_samples = num_data_records * num_samples_per_record;
        let use_parallel = data.num_samples() >= PARALLEL_THRESHOLD;

        // Pre-compute all digital values for all channels
        let channel_digital_values: Vec<Vec<i16>> = if use_parallel {
            // Parallel computation for large datasets
            data.channels
                .par_iter()
                .zip(calibration_params.par_iter())
                .map(
                    |(channel, &(physical_min, physical_max, digital_min, digital_max))| {
                        Self::compute_channel_digital_values(
                            &channel.samples,
                            physical_min,
                            physical_max,
                            digital_min,
                            digital_max,
                            total_output_samples,
                        )
                    },
                )
                .collect()
        } else {
            // Sequential for small datasets
            data.channels
                .iter()
                .zip(calibration_params.iter())
                .map(
                    |(channel, &(physical_min, physical_max, digital_min, digital_max))| {
                        Self::compute_channel_digital_values(
                            &channel.samples,
                            physical_min,
                            physical_max,
                            digital_min,
                            digital_max,
                            total_output_samples,
                        )
                    },
                )
                .collect()
        };

        // Write data records sequentially (I/O must be sequential)
        for record_idx in 0..num_data_records {
            let start_sample = record_idx * num_samples_per_record;

            for (ch_idx, _) in data.channels.iter().enumerate() {
                for sample_offset in 0..num_samples_per_record {
                    let sample_idx = start_sample + sample_offset;
                    let digital_value = channel_digital_values[ch_idx][sample_idx];
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
