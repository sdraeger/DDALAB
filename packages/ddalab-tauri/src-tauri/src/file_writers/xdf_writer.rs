/// XDF (Extensible Data Format) File Writer
///
/// Writes IntermediateData to XDF format for Lab Streaming Layer.
/// Specification: https://github.com/sccn/xdf/wiki/Specifications
use super::{FileWriter, FileWriterError, FileWriterResult, WriterConfig};
use crate::intermediate_format::IntermediateData;
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use quick_xml::Writer;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

const XDF_MAGIC: &[u8] = b"XDF:";
const CHUNK_FILE_HEADER: u16 = 1;
const CHUNK_STREAM_HEADER: u16 = 2;
const CHUNK_SAMPLES: u16 = 3;
const CHUNK_STREAM_FOOTER: u16 = 6;

pub struct XDFWriter;

impl XDFWriter {
    pub fn new() -> Self {
        Self
    }

    fn write_chunk<W: Write>(
        writer: &mut W,
        tag: u16,
        content: &[u8],
    ) -> FileWriterResult<()> {
        let length = (content.len() + 2) as u32;

        writer.write_all(&length.to_le_bytes())?;

        writer.write_all(&tag.to_le_bytes())?;

        writer.write_all(content)?;

        Ok(())
    }

    fn create_stream_header_xml(
        stream_id: u32,
        data: &IntermediateData,
    ) -> FileWriterResult<Vec<u8>> {
        let mut xml_buffer = Vec::new();
        let mut xml_writer = Writer::new(&mut xml_buffer);

        xml_writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))?;

        let mut info_elem = BytesStart::new("info");
        xml_writer.write_event(Event::Start(info_elem.clone()))?;

        xml_writer.write_event(Event::Start(BytesStart::new("name")))?;
        xml_writer.write_event(Event::Text(BytesText::new(&format!(
            "DDALAB-{}",
            data.metadata.source_format
        ))))?;
        xml_writer.write_event(Event::End(BytesEnd::new("name")))?;

        xml_writer.write_event(Event::Start(BytesStart::new("type")))?;
        xml_writer.write_event(Event::Text(BytesText::new("EEG")))?;
        xml_writer.write_event(Event::End(BytesEnd::new("type")))?;

        xml_writer.write_event(Event::Start(BytesStart::new("channel_count")))?;
        xml_writer.write_event(Event::Text(BytesText::new(&data.num_channels().to_string())))?;
        xml_writer.write_event(Event::End(BytesEnd::new("channel_count")))?;

        xml_writer.write_event(Event::Start(BytesStart::new("nominal_srate")))?;
        xml_writer.write_event(Event::Text(BytesText::new(
            &data.metadata.sample_rate.to_string(),
        )))?;
        xml_writer.write_event(Event::End(BytesEnd::new("nominal_srate")))?;

        xml_writer.write_event(Event::Start(BytesStart::new("channel_format")))?;
        xml_writer.write_event(Event::Text(BytesText::new("float32")))?;
        xml_writer.write_event(Event::End(BytesEnd::new("channel_format")))?;

        xml_writer.write_event(Event::Start(BytesStart::new("source_id")))?;
        xml_writer.write_event(Event::Text(BytesText::new(&format!(
            "ddalab-stream-{}",
            stream_id
        ))))?;
        xml_writer.write_event(Event::End(BytesEnd::new("source_id")))?;

        xml_writer.write_event(Event::Start(BytesStart::new("desc")))?;

        xml_writer.write_event(Event::Start(BytesStart::new("channels")))?;
        for channel in &data.channels {
            xml_writer.write_event(Event::Start(BytesStart::new("channel")))?;

            xml_writer.write_event(Event::Start(BytesStart::new("label")))?;
            xml_writer.write_event(Event::Text(BytesText::new(&channel.label)))?;
            xml_writer.write_event(Event::End(BytesEnd::new("label")))?;

            xml_writer.write_event(Event::Start(BytesStart::new("unit")))?;
            xml_writer.write_event(Event::Text(BytesText::new(&channel.unit)))?;
            xml_writer.write_event(Event::End(BytesEnd::new("unit")))?;

            xml_writer.write_event(Event::Start(BytesStart::new("type")))?;
            xml_writer.write_event(Event::Text(BytesText::new(&channel.channel_type)))?;
            xml_writer.write_event(Event::End(BytesEnd::new("type")))?;

            xml_writer.write_event(Event::End(BytesEnd::new("channel")))?;
        }
        xml_writer.write_event(Event::End(BytesEnd::new("channels")))?;

        xml_writer.write_event(Event::End(BytesEnd::new("desc")))?;

        xml_writer.write_event(Event::End(BytesEnd::new("info")))?;

        Ok(xml_buffer)
    }

    fn write_samples_chunk<W: Write>(
        writer: &mut W,
        stream_id: u32,
        data: &IntermediateData,
        start_sample: usize,
        num_samples: usize,
    ) -> FileWriterResult<()> {
        let mut chunk_content = Vec::new();

        chunk_content.write_all(&stream_id.to_le_bytes())?;

        let num_channels = data.num_channels() as u8;
        chunk_content.write_all(&[num_channels])?;

        let sample_rate = data.metadata.sample_rate;
        let start_time = start_sample as f64 / sample_rate;

        for sample_idx in 0..num_samples {
            for channel in &data.channels {
                let global_idx = start_sample + sample_idx;
                let value = if global_idx < channel.samples.len() {
                    channel.samples[global_idx] as f32
                } else {
                    0.0f32
                };
                chunk_content.write_all(&value.to_le_bytes())?;
            }

            let timestamp = start_time + (sample_idx as f64 / sample_rate);
            chunk_content.write_all(&timestamp.to_le_bytes())?;
        }

        Self::write_chunk(writer, CHUNK_SAMPLES, &chunk_content)?;

        Ok(())
    }
}

impl FileWriter for XDFWriter {
    fn write(
        &self,
        data: &IntermediateData,
        output_path: &Path,
        _config: &WriterConfig,
    ) -> FileWriterResult<()> {
        self.validate_data(data)?;

        let file = File::create(output_path)?;
        let mut writer = BufWriter::new(file);

        writer.write_all(XDF_MAGIC)?;

        let file_header_xml = b"<?xml version=\"1.0\"?><info><version>1.0</version></info>";
        Self::write_chunk(&mut writer, CHUNK_FILE_HEADER, file_header_xml)?;

        let stream_id: u32 = 1;

        let stream_header_xml = Self::create_stream_header_xml(stream_id, data)?;
        Self::write_chunk(&mut writer, CHUNK_STREAM_HEADER, &stream_header_xml)?;

        let samples_per_chunk = 1000;
        let total_samples = data.num_samples();
        let mut start_sample = 0;

        while start_sample < total_samples {
            let num_samples = samples_per_chunk.min(total_samples - start_sample);

            Self::write_samples_chunk(&mut writer, stream_id, data, start_sample, num_samples)?;

            start_sample += num_samples;
        }

        let stream_footer_xml = format!(
            "<?xml version=\"1.0\"?><info><first_timestamp>{}</first_timestamp><last_timestamp>{}</last_timestamp><sample_count>{}</sample_count></info>",
            0.0,
            total_samples as f64 / data.metadata.sample_rate,
            total_samples
        );
        Self::write_chunk(
            &mut writer,
            CHUNK_STREAM_FOOTER,
            stream_footer_xml.as_bytes(),
        )?;

        writer.flush()?;

        Ok(())
    }

    fn format_name(&self) -> &str {
        "XDF"
    }

    fn default_extension(&self) -> &str {
        "xdf"
    }
}

impl Default for XDFWriter {
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
    fn test_xdf_writer() {
        let temp_dir = TempDir::new().unwrap();
        let output_path = temp_dir.path().join("test.xdf");

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

        let writer = XDFWriter::new();
        let config = WriterConfig::default();

        assert!(writer.write(&data, &output_path, &config).is_ok());
        assert!(output_path.exists());

        let content = std::fs::read(&output_path).unwrap();
        assert!(content.starts_with(b"XDF:"));
    }
}
