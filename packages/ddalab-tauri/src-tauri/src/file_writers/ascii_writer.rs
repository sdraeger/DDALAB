/// ASCII File Writer
///
/// Writes IntermediateData to space-separated ASCII format suitable for DDA analysis.
/// Format: Header comments with metadata, then space-separated data rows.
use super::{FileWriter, FileWriterError, FileWriterResult, WriterConfig};
use crate::intermediate_format::IntermediateData;
use std::path::Path;

pub struct ASCIIWriter;

impl ASCIIWriter {
    pub fn new() -> Self {
        Self
    }
}

impl FileWriter for ASCIIWriter {
    fn write(
        &self,
        data: &IntermediateData,
        output_path: &Path,
        config: &WriterConfig,
    ) -> FileWriterResult<()> {
        self.validate_data(data)?;

        let selected_channels = config.selected_channels.as_ref().map(|v| v.as_slice());

        data.to_ascii(output_path, selected_channels)
            .map_err(|e| FileWriterError::WriteError(e))
    }

    fn format_name(&self) -> &str {
        "ASCII"
    }

    fn default_extension(&self) -> &str {
        "txt"
    }
}

impl Default for ASCIIWriter {
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
    fn test_ascii_writer() {
        let temp_dir = TempDir::new().unwrap();
        let output_path = temp_dir.path().join("test.txt");

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

        let writer = ASCIIWriter::new();
        let config = WriterConfig::default();

        assert!(writer.write(&data, &output_path, &config).is_ok());
        assert!(output_path.exists());

        let content = std::fs::read_to_string(&output_path).unwrap();
        assert!(content.contains("# Channels: Fp1"));
        assert!(content.contains("1.000000"));
    }
}
