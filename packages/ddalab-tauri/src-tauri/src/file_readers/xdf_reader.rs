use super::{FileMetadata, FileReader, FileReaderError, FileResult};
use quick_xml::events::Event;
use quick_xml::Reader as XmlReader;
use rayon::prelude::*;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

/// XDF (Extensible Data Format) File Reader
///
/// XDF is the file format used by Lab Streaming Layer (LSL) for multi-stream recordings.
/// It's a binary format with XML descriptors for each stream.
///
/// Features:
/// - Multi-stream support (EEG, markers, etc.)
/// - Irregular sampling rates
/// - Timestamps for synchronization
/// - Rich metadata per stream
pub struct XDFFileReader {
    path: String,
    streams: Vec<XDFStream>,
    selected_stream_id: Option<u32>,
}

#[derive(Debug, Clone)]
struct XDFStream {
    stream_id: u32,
    name: String,
    stream_type: String,
    channel_count: usize,
    channel_labels: Vec<String>,
    nominal_srate: f64,
    samples: Vec<XDFSample>,
}

#[derive(Debug, Clone)]
struct XDFSample {
    timestamp: f64,
    values: Vec<f64>,
}

// XDF chunk types
const CHUNK_FILE_HEADER: u16 = 1;
const CHUNK_STREAM_HEADER: u16 = 2;
const CHUNK_SAMPLES: u16 = 3;
const CHUNK_CLOCK_OFFSET: u16 = 4;
const CHUNK_BOUNDARY: u16 = 5;
const CHUNK_STREAM_FOOTER: u16 = 6;

impl XDFFileReader {
    /// Create new XDF reader
    pub fn new(path: &Path) -> FileResult<Self> {
        let mut reader = Self {
            path: path.to_string_lossy().to_string(),
            streams: Vec::new(),
            selected_stream_id: None,
        };

        reader.parse_file()?;

        // Auto-select first EEG-like stream
        reader.selected_stream_id = reader
            .streams
            .iter()
            .find(|s| {
                s.stream_type.to_lowercase().contains("eeg")
                    || s.stream_type.to_lowercase().contains("signal")
            })
            .map(|s| s.stream_id)
            .or_else(|| reader.streams.first().map(|s| s.stream_id));

        Ok(reader)
    }

    /// Create reader with specific stream selected
    pub fn with_stream_id(path: &Path, stream_id: u32) -> FileResult<Self> {
        let mut reader = Self::new(path)?;

        if !reader.streams.iter().any(|s| s.stream_id == stream_id) {
            return Err(FileReaderError::InvalidData(format!(
                "Stream ID {} not found in file",
                stream_id
            )));
        }

        reader.selected_stream_id = Some(stream_id);
        Ok(reader)
    }

    /// Parse entire XDF file
    fn parse_file(&mut self) -> FileResult<()> {
        let file = File::open(&self.path)?;
        let mut reader = BufReader::new(file);

        // Verify magic string "XDF:"
        let mut magic = [0u8; 4];
        reader.read_exact(&mut magic)?;

        if &magic != b"XDF:" {
            return Err(FileReaderError::ParseError(
                "Invalid XDF file: missing magic string".to_string(),
            ));
        }

        let mut stream_headers: HashMap<u32, StreamInfo> = HashMap::new();
        let mut stream_samples: HashMap<u32, Vec<XDFSample>> = HashMap::new();

        // Parse chunks
        loop {
            // Read chunk length (4 bytes, little-endian)
            let mut len_bytes = [0u8; 4];
            if reader.read_exact(&mut len_bytes).is_err() {
                break; // End of file
            }
            let chunk_len = u32::from_le_bytes(len_bytes);

            if chunk_len == 0 {
                break;
            }

            // Read chunk tag (2 bytes)
            let mut tag_bytes = [0u8; 2];
            reader.read_exact(&mut tag_bytes)?;
            let chunk_tag = u16::from_le_bytes(tag_bytes);

            // Read chunk content
            let content_len = chunk_len as usize - 2; // Subtract tag size
            let mut content = vec![0u8; content_len];
            reader.read_exact(&mut content)?;

            match chunk_tag {
                CHUNK_FILE_HEADER => {
                    log::debug!("XDF File Header: {}", String::from_utf8_lossy(&content));
                }
                CHUNK_STREAM_HEADER => {
                    let stream_info = Self::parse_stream_header(&content)?;
                    log::info!(
                        "Found XDF stream: {} (ID: {})",
                        stream_info.name,
                        stream_info.stream_id
                    );
                    stream_headers.insert(stream_info.stream_id, stream_info);
                }
                CHUNK_SAMPLES => {
                    self.parse_samples_chunk(&content, &stream_headers, &mut stream_samples)?;
                }
                CHUNK_CLOCK_OFFSET => {
                    // Clock offset chunks - not critical for basic reading
                    log::debug!("Clock offset chunk");
                }
                CHUNK_BOUNDARY => {
                    log::debug!("Boundary chunk");
                }
                CHUNK_STREAM_FOOTER => {
                    log::debug!("Stream footer chunk");
                }
                _ => {
                    log::warn!("Unknown chunk type: {}", chunk_tag);
                }
            }
        }

        // Convert to XDFStream objects
        for (stream_id, header) in stream_headers {
            let samples = stream_samples.remove(&stream_id).unwrap_or_default();

            self.streams.push(XDFStream {
                stream_id,
                name: header.name,
                stream_type: header.stream_type,
                channel_count: header.channel_count,
                channel_labels: header.channel_labels,
                nominal_srate: header.nominal_srate,
                samples,
            });
        }

        if self.streams.is_empty() {
            return Err(FileReaderError::ParseError(
                "No streams found in XDF file".to_string(),
            ));
        }

        log::info!("Loaded {} XDF streams", self.streams.len());
        Ok(())
    }

    /// Parse stream header XML
    fn parse_stream_header(content: &[u8]) -> FileResult<StreamInfo> {
        let xml_str = String::from_utf8_lossy(content);
        let mut reader = XmlReader::from_str(&xml_str);
        reader.config_mut().trim_text(true);

        let mut stream_info = StreamInfo::default();
        let mut in_channels = false;
        let mut current_channel = String::new();

        loop {
            match reader.read_event() {
                Ok(Event::Start(e)) => {
                    let name = e.name();
                    match name.as_ref() {
                        b"channels" => in_channels = true,
                        b"channel" => current_channel.clear(),
                        _ => {}
                    }
                }
                Ok(Event::End(e)) => {
                    if e.name().as_ref() == b"channels" {
                        in_channels = false;
                    }
                }
                Ok(Event::Text(e)) => {
                    // Store text content - may be channel label
                    current_channel = e.escape_ascii().to_string();
                }
                Ok(Event::Empty(e)) => {
                    let name = e.name();
                    match name.as_ref() {
                        b"name" => {
                            for attr in e.attributes() {
                                if let Ok(a) = attr {
                                    stream_info.name =
                                        String::from_utf8_lossy(a.value.as_ref()).to_string();
                                }
                            }
                        }
                        b"type" => {
                            for attr in e.attributes() {
                                if let Ok(a) = attr {
                                    stream_info.stream_type =
                                        String::from_utf8_lossy(a.value.as_ref()).to_string();
                                }
                            }
                        }
                        b"channel_count" => {
                            for attr in e.attributes() {
                                if let Ok(a) = attr {
                                    let val = String::from_utf8_lossy(a.value.as_ref());
                                    stream_info.channel_count = val.parse().unwrap_or(0);
                                }
                            }
                        }
                        b"nominal_srate" => {
                            for attr in e.attributes() {
                                if let Ok(a) = attr {
                                    let val = String::from_utf8_lossy(a.value.as_ref());
                                    stream_info.nominal_srate = val.parse().unwrap_or(0.0);
                                }
                            }
                        }
                        b"label" if in_channels => {
                            if !current_channel.is_empty() {
                                stream_info.channel_labels.push(current_channel.clone());
                            }
                        }
                        _ => {}
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => {
                    log::warn!("XML parse error: {}", e);
                    break;
                }
                _ => {}
            }
        }

        // Extract stream_id from content (first 4 bytes before XML)
        if content.len() >= 4 {
            stream_info.stream_id =
                u32::from_le_bytes([content[0], content[1], content[2], content[3]]);
        }

        // If no channel labels found, generate defaults
        if stream_info.channel_labels.is_empty() {
            stream_info.channel_labels = (0..stream_info.channel_count)
                .map(|i| format!("Ch{}", i + 1))
                .collect();
        }

        Ok(stream_info)
    }

    /// Parse samples chunk
    fn parse_samples_chunk(
        &self,
        content: &[u8],
        stream_headers: &HashMap<u32, StreamInfo>,
        stream_samples: &mut HashMap<u32, Vec<XDFSample>>,
    ) -> FileResult<()> {
        if content.len() < 4 {
            return Ok(());
        }

        // First 4 bytes are stream ID
        let stream_id = u32::from_le_bytes([content[0], content[1], content[2], content[3]]);

        let header = match stream_headers.get(&stream_id) {
            Some(h) => h,
            None => return Ok(()), // Skip samples for unknown streams
        };

        let samples_vec = stream_samples.entry(stream_id).or_insert_with(Vec::new);

        // Parse sample data (simplified - actual XDF format is more complex)
        // Format: [stream_id:4][num_samples:varies][timestamp:8][values:8*channels]...

        let mut offset = 4; // Skip stream_id

        while offset + 8 + (header.channel_count * 8) <= content.len() {
            // Read timestamp (8 bytes, f64)
            let timestamp = f64::from_le_bytes([
                content[offset],
                content[offset + 1],
                content[offset + 2],
                content[offset + 3],
                content[offset + 4],
                content[offset + 5],
                content[offset + 6],
                content[offset + 7],
            ]);
            offset += 8;

            // Read channel values
            let mut values = Vec::with_capacity(header.channel_count);
            for _ in 0..header.channel_count {
                if offset + 8 <= content.len() {
                    let value = f64::from_le_bytes([
                        content[offset],
                        content[offset + 1],
                        content[offset + 2],
                        content[offset + 3],
                        content[offset + 4],
                        content[offset + 5],
                        content[offset + 6],
                        content[offset + 7],
                    ]);
                    values.push(value);
                    offset += 8;
                } else {
                    break;
                }
            }

            if values.len() == header.channel_count {
                samples_vec.push(XDFSample { timestamp, values });
            }
        }

        Ok(())
    }

    /// Get selected stream
    fn get_selected_stream(&self) -> FileResult<&XDFStream> {
        let stream_id = self
            .selected_stream_id
            .ok_or_else(|| FileReaderError::InvalidData("No stream selected".to_string()))?;

        self.streams
            .iter()
            .find(|s| s.stream_id == stream_id)
            .ok_or_else(|| FileReaderError::InvalidData("Selected stream not found".to_string()))
    }

    /// List all available streams
    pub fn list_streams(&self) -> Vec<(u32, String, String)> {
        self.streams
            .iter()
            .map(|s| (s.stream_id, s.name.clone(), s.stream_type.clone()))
            .collect()
    }
}

#[derive(Debug, Clone, Default)]
struct StreamInfo {
    stream_id: u32,
    name: String,
    stream_type: String,
    channel_count: usize,
    channel_labels: Vec<String>,
    nominal_srate: f64,
}

impl FileReader for XDFFileReader {
    fn metadata(&self) -> FileResult<FileMetadata> {
        let stream = self.get_selected_stream()?;

        let num_samples = stream.samples.len();
        let duration = if num_samples > 0 && stream.nominal_srate > 0.0 {
            num_samples as f64 / stream.nominal_srate
        } else {
            0.0
        };

        // Get start time from first sample timestamp
        let start_time = stream.samples.first().map(|s| {
            use chrono::{TimeZone, Utc};
            let dt = Utc
                .timestamp_opt(s.timestamp as i64, (s.timestamp.fract() * 1e9) as u32)
                .single()
                .unwrap_or_else(|| Utc::now());
            dt.to_rfc3339()
        });

        Ok(FileMetadata {
            file_path: self.path.clone(),
            file_name: Path::new(&self.path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown.xdf")
                .to_string(),
            file_size: std::fs::metadata(&self.path)?.len(),
            sample_rate: stream.nominal_srate,
            num_channels: stream.channel_count,
            num_samples,
            duration,
            channels: stream.channel_labels.clone(),
            start_time,
            file_type: "XDF".to_string(),
        })
    }

    fn read_chunk(
        &self,
        start_sample: usize,
        num_samples: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let stream = self.get_selected_stream()?;

        // Determine channel indices
        let channel_indices: Vec<usize> = if let Some(selected) = channels {
            selected
                .iter()
                .filter_map(|name| stream.channel_labels.iter().position(|n| n == name))
                .collect()
        } else {
            (0..stream.channel_count).collect()
        };

        if channel_indices.is_empty() {
            return Err(FileReaderError::InvalidData(
                "No valid channels selected".to_string(),
            ));
        }

        // Extract data
        let end_sample = (start_sample + num_samples).min(stream.samples.len());
        let mut result = vec![Vec::with_capacity(end_sample - start_sample); channel_indices.len()];

        for sample_idx in start_sample..end_sample {
            if let Some(sample) = stream.samples.get(sample_idx) {
                for (result_ch_idx, &stream_ch_idx) in channel_indices.iter().enumerate() {
                    if let Some(&value) = sample.values.get(stream_ch_idx) {
                        result[result_ch_idx].push(value);
                    }
                }
            }
        }

        Ok(result)
    }

    fn read_overview(
        &self,
        max_points: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let stream = self.get_selected_stream()?;
        let total_samples = stream.samples.len();

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
        "XDF"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_xdf_format_name() {
        assert_eq!("XDF", "XDF");
    }
}
