/// CSV File Writer
///
/// Writes IntermediateData to comma-separated values format.
/// Format: First row contains channel labels, subsequent rows contain data.
use super::{FileWriter, FileWriterError, FileWriterResult, WriterConfig};
use crate::intermediate_format::IntermediateData;
use std::path::Path;

pub struct CSVWriter;

impl CSVWriter {
    pub fn new() -> Self {
        Self
    }
}

impl FileWriter for CSVWriter {
    fn write(
        &self,
        data: &IntermediateData,
        output_path: &Path,
        config: &WriterConfig,
    ) -> FileWriterResult<()> {
        self.validate_data(data)?;

        let selected_channels = config.selected_channels.as_ref().map(|v| v.as_slice());

        data.to_csv(output_path, selected_channels)
            .map_err(|e| FileWriterError::WriteError(e))
    }

    fn format_name(&self) -> &str {
        "CSV"
    }

    fn default_extension(&self) -> &str {
        "csv"
    }
}

impl Default for CSVWriter {
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
    fn test_csv_writer() {
        let temp_dir = TempDir::new().unwrap();
        let output_path = temp_dir.path().join("test.csv");

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

        let writer = CSVWriter::new();
        let config = WriterConfig::default();

        assert!(writer.write(&data, &output_path, &config).is_ok());
        assert!(output_path.exists());

        let content = std::fs::read_to_string(&output_path).unwrap();
        assert!(content.contains("Fp1"));
        assert!(content.contains("1.000000"));
    }
}
