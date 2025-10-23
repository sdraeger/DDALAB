/// Intermediate Data Format Module
///
/// This module defines a universal intermediate representation for all EEG/MEG/iEEG data.
/// All file readers convert to this format, which can then be:
/// - Converted to ASCII/CSV for DDA analysis
/// - Used directly for visualization
/// - Exported to other formats
///
/// Benefits:
/// - Single source of truth for data representation
/// - Easy to add new file format readers
/// - Decouple file format parsing from analysis/visualization

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::fs::File;
use std::io::{Write, BufWriter};

/// Universal intermediate representation for time-series data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntermediateData {
    /// Metadata about the recording
    pub metadata: DataMetadata,

    /// Channel data: Vec<Channel> where each channel contains samples
    /// Data is stored in physical units (typically microvolts)
    pub channels: Vec<ChannelData>,
}

/// Metadata about the recording
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataMetadata {
    /// Original file path
    pub source_file: String,

    /// File format (EDF, FIF, BrainVision, etc.)
    pub source_format: String,

    /// Sample rate in Hz
    pub sample_rate: f64,

    /// Total duration in seconds
    pub duration: f64,

    /// Recording start time (ISO 8601 format if available)
    pub start_time: Option<String>,

    /// Subject/patient ID (if available)
    pub subject_id: Option<String>,

    /// Additional custom metadata
    pub custom_metadata: std::collections::HashMap<String, String>,
}

/// Data for a single channel
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelData {
    /// Channel label/name (e.g., "Fp1", "MEG 0111")
    pub label: String,

    /// Channel type (EEG, MEG, EOG, ECG, EMG, MISC, etc.)
    pub channel_type: String,

    /// Physical unit (e.g., "µV", "fT", "mV")
    pub unit: String,

    /// Sample data in physical units
    pub samples: Vec<f64>,

    /// Sample rate for this channel (if different from global)
    pub sample_rate: Option<f64>,
}

impl IntermediateData {
    /// Create new intermediate data structure
    pub fn new(metadata: DataMetadata) -> Self {
        Self {
            metadata,
            channels: Vec::new(),
        }
    }

    /// Add a channel to the dataset
    pub fn add_channel(&mut self, channel: ChannelData) {
        self.channels.push(channel);
    }

    /// Get number of channels
    pub fn num_channels(&self) -> usize {
        self.channels.len()
    }

    /// Get number of samples (from first channel, assumes all same length)
    pub fn num_samples(&self) -> usize {
        self.channels.first().map(|c| c.samples.len()).unwrap_or(0)
    }

    /// Get channel by label
    pub fn get_channel(&self, label: &str) -> Option<&ChannelData> {
        self.channels.iter().find(|c| c.label == label)
    }

    /// Get all channel labels
    pub fn channel_labels(&self) -> Vec<String> {
        self.channels.iter().map(|c| c.label.clone()).collect()
    }

    /// Export to ASCII format (space-separated CSV) for DDA analysis
    ///
    /// Format: Each row is a time point, each column is a channel
    /// First row: channel labels (commented with #)
    /// Subsequent rows: data values
    ///
    /// # Arguments
    /// * `output_path` - Path to write ASCII file
    /// * `selected_channels` - Optional list of channel labels to export (None = all)
    pub fn to_ascii(&self, output_path: &Path, selected_channels: Option<&[String]>) -> Result<(), String> {
        let file = File::create(output_path)
            .map_err(|e| format!("Failed to create output file: {}", e))?;
        let mut writer = BufWriter::new(file);

        // Determine which channels to export
        let channels_to_export: Vec<&ChannelData> = if let Some(selected) = selected_channels {
            selected.iter()
                .filter_map(|label| self.get_channel(label))
                .collect()
        } else {
            self.channels.iter().collect()
        };

        if channels_to_export.is_empty() {
            return Err("No channels to export".to_string());
        }

        // Write header with channel labels (commented)
        write!(writer, "# Channels:")
            .map_err(|e| format!("Write error: {}", e))?;
        for channel in &channels_to_export {
            write!(writer, " {}", channel.label)
                .map_err(|e| format!("Write error: {}", e))?;
        }
        writeln!(writer).map_err(|e| format!("Write error: {}", e))?;

        // Write metadata as comments
        writeln!(writer, "# Source: {} ({})", self.metadata.source_file, self.metadata.source_format)
            .map_err(|e| format!("Write error: {}", e))?;
        writeln!(writer, "# Sample rate: {} Hz", self.metadata.sample_rate)
            .map_err(|e| format!("Write error: {}", e))?;
        writeln!(writer, "# Duration: {} s", self.metadata.duration)
            .map_err(|e| format!("Write error: {}", e))?;

        // Write data rows
        let num_samples = channels_to_export[0].samples.len();

        for sample_idx in 0..num_samples {
            for (ch_idx, channel) in channels_to_export.iter().enumerate() {
                if ch_idx > 0 {
                    write!(writer, " ").map_err(|e| format!("Write error: {}", e))?;
                }

                // Get sample value, handle channels with different lengths
                let value = channel.samples.get(sample_idx).unwrap_or(&0.0);
                write!(writer, "{:.6}", value)
                    .map_err(|e| format!("Write error: {}", e))?;
            }
            writeln!(writer).map_err(|e| format!("Write error: {}", e))?;
        }

        writer.flush().map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }

    /// Export to CSV format (comma-separated)
    ///
    /// Similar to ASCII but uses commas instead of spaces
    pub fn to_csv(&self, output_path: &Path, selected_channels: Option<&[String]>) -> Result<(), String> {
        let file = File::create(output_path)
            .map_err(|e| format!("Failed to create output file: {}", e))?;
        let mut writer = BufWriter::new(file);

        // Determine which channels to export
        let channels_to_export: Vec<&ChannelData> = if let Some(selected) = selected_channels {
            selected.iter()
                .filter_map(|label| self.get_channel(label))
                .collect()
        } else {
            self.channels.iter().collect()
        };

        if channels_to_export.is_empty() {
            return Err("No channels to export".to_string());
        }

        // Write header row with channel labels
        for (ch_idx, channel) in channels_to_export.iter().enumerate() {
            if ch_idx > 0 {
                write!(writer, ",").map_err(|e| format!("Write error: {}", e))?;
            }
            write!(writer, "{}", channel.label)
                .map_err(|e| format!("Write error: {}", e))?;
        }
        writeln!(writer).map_err(|e| format!("Write error: {}", e))?;

        // Write data rows
        let num_samples = channels_to_export[0].samples.len();

        for sample_idx in 0..num_samples {
            for (ch_idx, channel) in channels_to_export.iter().enumerate() {
                if ch_idx > 0 {
                    write!(writer, ",").map_err(|e| format!("Write error: {}", e))?;
                }

                let value = channel.samples.get(sample_idx).unwrap_or(&0.0);
                write!(writer, "{:.6}", value)
                    .map_err(|e| format!("Write error: {}", e))?;
            }
            writeln!(writer).map_err(|e| format!("Write error: {}", e))?;
        }

        writer.flush().map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }

    /// Get a chunk of data (subset of samples from selected channels)
    pub fn get_chunk(
        &self,
        start_sample: usize,
        num_samples: usize,
        selected_channels: Option<&[String]>,
    ) -> Vec<Vec<f64>> {
        let channels_to_use: Vec<&ChannelData> = if let Some(selected) = selected_channels {
            selected.iter()
                .filter_map(|label| self.get_channel(label))
                .collect()
        } else {
            self.channels.iter().collect()
        };

        channels_to_use.iter().map(|channel| {
            let end_sample = (start_sample + num_samples).min(channel.samples.len());
            channel.samples[start_sample..end_sample].to_vec()
        }).collect()
    }

    /// Decimate data for overview/preview
    pub fn decimate(&self, max_points_per_channel: usize) -> Self {
        let num_samples = self.num_samples();
        let decimation_factor = (num_samples as f64 / max_points_per_channel as f64).ceil() as usize;
        let decimation_factor = decimation_factor.max(1);

        let decimated_channels: Vec<ChannelData> = self.channels.iter().map(|channel| {
            let decimated_samples: Vec<f64> = channel.samples
                .iter()
                .step_by(decimation_factor)
                .copied()
                .collect();

            ChannelData {
                label: channel.label.clone(),
                channel_type: channel.channel_type.clone(),
                unit: channel.unit.clone(),
                samples: decimated_samples,
                sample_rate: channel.sample_rate,
            }
        }).collect();

        IntermediateData {
            metadata: self.metadata.clone(),
            channels: decimated_channels,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_intermediate_data_creation() {
        let metadata = DataMetadata {
            source_file: "test.edf".to_string(),
            source_format: "EDF".to_string(),
            sample_rate: 256.0,
            duration: 10.0,
            start_time: Some("2024-01-01T00:00:00Z".to_string()),
            subject_id: Some("S001".to_string()),
            custom_metadata: HashMap::new(),
        };

        let mut data = IntermediateData::new(metadata);

        let channel = ChannelData {
            label: "Fp1".to_string(),
            channel_type: "EEG".to_string(),
            unit: "µV".to_string(),
            samples: vec![1.0, 2.0, 3.0, 4.0, 5.0],
            sample_rate: None,
        };

        data.add_channel(channel);

        assert_eq!(data.num_channels(), 1);
        assert_eq!(data.num_samples(), 5);
        assert_eq!(data.channel_labels(), vec!["Fp1"]);
    }

    #[test]
    fn test_channel_selection() {
        let metadata = DataMetadata {
            source_file: "test.edf".to_string(),
            source_format: "EDF".to_string(),
            sample_rate: 256.0,
            duration: 10.0,
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

        data.add_channel(ChannelData {
            label: "Fp2".to_string(),
            channel_type: "EEG".to_string(),
            unit: "µV".to_string(),
            samples: vec![4.0, 5.0, 6.0],
            sample_rate: None,
        });

        let chunk = data.get_chunk(0, 2, Some(&vec!["Fp1".to_string()]));
        assert_eq!(chunk.len(), 1);
        assert_eq!(chunk[0], vec![1.0, 2.0]);
    }
}
