// Lab Streaming Layer (LSL) streaming source
//
// Connects to LSL streams on the network and receives real-time data.
// LSL is widely used in neuroscience research for synchronized multi-modal
// data acquisition with sub-millisecond timing accuracy.
//
// Features:
// - Automatic stream discovery via LSL resolver
// - High-precision time synchronization
// - Support for regular and irregular sampling rates
// - Robust network handling with automatic recovery
//
// Typical use cases:
// - EEG/MEG data acquisition
// - Physiological signals (ECG, EMG, EOG)
// - Behavioral markers and event streams
// - Multi-device synchronization

use super::{DataChunk, DataFormat, SourceMetadata, StreamSource};
use crate::streaming::types::{StreamError, StreamResult};
use async_trait::async_trait;
use lsl::{ChannelFormat, StreamInlet, StreamInfo};
use std::collections::HashMap;
use tokio::sync::mpsc;
use tokio::task;

/// LSL stream source configuration and state
pub struct LslStreamSource {
    /// Stream name to resolve (can be empty for wildcard)
    stream_name: Option<String>,

    /// Stream type to resolve (e.g., "EEG", "Markers", "Gaze")
    stream_type: Option<String>,

    /// Stream source ID (unique identifier)
    source_id: Option<String>,

    /// Maximum time to wait for stream resolution (seconds)
    resolve_timeout: f64,

    /// Chunk size for pulling samples
    chunk_size: usize,

    /// Whether to use LSL timestamps or local timestamps
    use_lsl_timestamps: bool,

    /// Connection state
    is_connected: bool,

    /// Cached metadata
    metadata: Option<SourceMetadata>,

    /// Resolved stream info (available after connect)
    stream_info: Option<StreamInfo>,
}

impl LslStreamSource {
    /// Create a new LSL stream source
    ///
    /// # Arguments
    /// * `stream_name` - Name of the stream to resolve (None for any)
    /// * `stream_type` - Type of the stream (None for any)
    /// * `source_id` - Unique source identifier (None for any)
    /// * `resolve_timeout` - Timeout for stream resolution in seconds
    /// * `chunk_size` - Number of samples to pull per iteration
    /// * `use_lsl_timestamps` - Use LSL synchronized timestamps vs local time
    pub fn new(
        stream_name: Option<String>,
        stream_type: Option<String>,
        source_id: Option<String>,
        resolve_timeout: Option<f64>,
        chunk_size: Option<usize>,
        use_lsl_timestamps: Option<bool>,
    ) -> Self {
        Self {
            stream_name,
            stream_type,
            source_id,
            resolve_timeout: resolve_timeout.unwrap_or(5.0),
            chunk_size: chunk_size.unwrap_or(1000),
            use_lsl_timestamps: use_lsl_timestamps.unwrap_or(true),
            is_connected: false,
            metadata: None,
            stream_info: None,
        }
    }

    /// Resolve an LSL stream based on the configured predicates
    fn resolve_stream(&self) -> StreamResult<StreamInfo> {
        log::info!(
            "Resolving LSL stream: name={:?}, type={:?}, source_id={:?}",
            self.stream_name,
            self.stream_type,
            self.source_id
        );

        // Build predicate string for LSL resolver
        let mut predicates = Vec::new();

        if let Some(ref name) = self.stream_name {
            predicates.push(format!("name='{}'", name));
        }

        if let Some(ref stream_type) = self.stream_type {
            predicates.push(format!("type='{}'", stream_type));
        }

        if let Some(ref source_id) = self.source_id {
            predicates.push(format!("source_id='{}'", source_id));
        }

        let predicate = if predicates.is_empty() {
            String::new()
        } else {
            predicates.join(" and ")
        };

        log::debug!("LSL predicate: '{}'", predicate);

        // Resolve streams
        let streams = if predicate.is_empty() {
            lsl::resolve_streams(self.resolve_timeout)
        } else {
            lsl::resolve_bypred(&predicate, 1, self.resolve_timeout)
        };

        if streams.is_empty() {
            return Err(StreamError::Connection(format!(
                "No LSL stream found matching criteria (timeout: {}s)",
                self.resolve_timeout
            )));
        }

        if streams.len() > 1 {
            log::warn!(
                "Multiple LSL streams found ({}), using first match",
                streams.len()
            );
        }

        let stream_info = streams[0].clone();

        log::info!(
            "Resolved LSL stream: name='{}', type='{}', channels={}, rate={} Hz",
            stream_info.name(),
            stream_info.stream_type(),
            stream_info.channel_count(),
            stream_info.sampling_rate()
        );

        Ok(stream_info)
    }

    /// Extract channel names from LSL stream info
    fn extract_channel_names(stream_info: &StreamInfo) -> Vec<String> {
        let channel_count = stream_info.channel_count();

        // Try to get channel names from XML metadata
        if let Ok(xml) = stream_info.as_xml() {
            if let Some(channels) = Self::parse_channel_names_from_xml(&xml, channel_count) {
                return channels;
            }
        }

        // Fallback: Generate default channel names
        (0..channel_count)
            .map(|i| format!("Ch{}", i + 1))
            .collect()
    }

    /// Parse channel names from LSL XML metadata
    fn parse_channel_names_from_xml(xml: &str, channel_count: i32) -> Option<Vec<String>> {
        // Simple XML parsing - look for <channel><label>NAME</label></channel> patterns
        let mut names = Vec::new();

        for line in xml.lines() {
            if let Some(start) = line.find("<label>") {
                if let Some(end) = line.find("</label>") {
                    let name = line[start + 7..end].trim().to_string();
                    names.push(name);
                }
            }
        }

        if names.len() == channel_count as usize {
            Some(names)
        } else {
            None
        }
    }

    /// Convert LSL channel format to DDALAB DataFormat
    fn lsl_format_to_data_format(format: ChannelFormat) -> DataFormat {
        match format {
            ChannelFormat::Float32 => DataFormat::Float32,
            ChannelFormat::Double64 => DataFormat::Float64,
            ChannelFormat::Int16 => DataFormat::Int16,
            ChannelFormat::Int32 => DataFormat::Int32,
            ChannelFormat::Int8 | ChannelFormat::String => DataFormat::Raw,
            _ => DataFormat::Float32, // Default fallback
        }
    }
}

#[async_trait]
impl StreamSource for LslStreamSource {
    async fn connect(&mut self) -> StreamResult<()> {
        if self.is_connected {
            return Ok(());
        }

        // Resolve stream in blocking task (LSL is synchronous)
        let resolve_timeout = self.resolve_timeout;
        let stream_name = self.stream_name.clone();
        let stream_type = self.stream_type.clone();
        let source_id = self.source_id.clone();

        let stream_info = task::spawn_blocking(move || {
            let source = LslStreamSource::new(
                stream_name,
                stream_type,
                source_id,
                Some(resolve_timeout),
                None,
                None,
            );
            source.resolve_stream()
        })
        .await
        .map_err(|e| StreamError::Connection(format!("Task join error: {}", e)))??;

        // Extract metadata
        let channel_names = Self::extract_channel_names(&stream_info);
        let sample_rate = stream_info.sampling_rate() as f32;
        let data_format = Self::lsl_format_to_data_format(stream_info.channel_format());

        let mut properties = HashMap::new();
        properties.insert("stream_name".to_string(), stream_info.name().to_string());
        properties.insert("stream_type".to_string(), stream_info.stream_type().to_string());
        properties.insert("source_id".to_string(), stream_info.source_id().to_string());
        properties.insert("hostname".to_string(), stream_info.hostname().to_string());
        properties.insert(
            "protocol_version".to_string(),
            stream_info.version().to_string(),
        );
        properties.insert(
            "created_at".to_string(),
            stream_info.created_at().to_string(),
        );

        self.metadata = Some(SourceMetadata {
            channels: channel_names,
            sample_rate,
            data_format,
            properties,
        });

        self.stream_info = Some(stream_info);
        self.is_connected = true;

        log::info!("LSL stream connected successfully");

        Ok(())
    }

    async fn start(&mut self, sender: mpsc::Sender<DataChunk>) -> StreamResult<()> {
        if !self.is_connected {
            self.connect().await?;
        }

        let stream_info = self
            .stream_info
            .as_ref()
            .ok_or_else(|| StreamError::Connection("Stream info not available".to_string()))?
            .clone();

        let metadata = self.metadata.clone().ok_or_else(|| {
            StreamError::Connection("Metadata not available".to_string())
        })?;

        let chunk_size = self.chunk_size;
        let use_lsl_timestamps = self.use_lsl_timestamps;

        // Create inlet and start streaming in blocking task
        task::spawn_blocking(move || {
            // Create inlet with default buffer size and chunk size
            let mut inlet = StreamInlet::new(&stream_info, 360, chunk_size, true)
                .map_err(|e| StreamError::Connection(format!("Failed to create inlet: {:?}", e)))?;

            log::info!("LSL inlet created, starting data stream");

            let channel_count = stream_info.channel_count() as usize;
            let mut sample_buffer = vec![0.0f32; chunk_size * channel_count];
            let mut timestamp_buffer = vec![0.0f64; chunk_size];

            loop {
                // Pull chunk of samples with timestamps
                let samples_pulled = inlet
                    .pull_chunk_f32(&mut sample_buffer, Some(&mut timestamp_buffer))
                    .map_err(|e| StreamError::Io(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        format!("LSL pull error: {:?}", e)
                    )))?;

                if samples_pulled == 0 {
                    // No data available, wait briefly
                    std::thread::sleep(std::time::Duration::from_millis(1));
                    continue;
                }

                // Convert flat buffer to channel-major format: [channels][samples]
                let mut samples = vec![vec![0.0f32; samples_pulled]; channel_count];

                for sample_idx in 0..samples_pulled {
                    for ch_idx in 0..channel_count {
                        samples[ch_idx][sample_idx] =
                            sample_buffer[sample_idx * channel_count + ch_idx];
                    }
                }

                // Use LSL timestamp or local time
                let timestamp = if use_lsl_timestamps && samples_pulled > 0 {
                    timestamp_buffer[samples_pulled - 1] // Use timestamp of last sample
                } else {
                    chrono::Utc::now().timestamp() as f64
                        + (chrono::Utc::now().timestamp_subsec_millis() as f64 / 1000.0)
                };

                let chunk = DataChunk {
                    samples,
                    timestamp,
                    sample_rate: metadata.sample_rate,
                    channel_names: metadata.channels.clone(),
                    sequence: None, // LSL handles ordering internally
                };

                // Send chunk (blocking send on runtime)
                if let Err(_) = sender.blocking_send(chunk) {
                    log::warn!("LSL stream receiver closed, stopping");
                    break;
                }
            }

            Ok::<(), StreamError>(())
        })
        .await
        .map_err(|e| StreamError::Connection(format!("Task join error: {}", e)))??;

        Ok(())
    }

    async fn stop(&mut self) -> StreamResult<()> {
        log::info!("Stopping LSL stream");
        self.is_connected = false;
        self.stream_info = None;
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.is_connected
    }

    fn get_metadata(&self) -> SourceMetadata {
        self.metadata.clone().unwrap_or_else(|| SourceMetadata {
            channels: vec![],
            sample_rate: 0.0,
            data_format: DataFormat::Float32,
            properties: Default::default(),
        })
    }
}
