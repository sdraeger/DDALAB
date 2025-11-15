// Pluggable data source system for streaming
//
// This module defines the `StreamSource` trait which enables extension with new
// data source types without modifying existing code. New sources can be added by:
// 1. Implementing the StreamSource trait
// 2. Adding a variant to StreamSourceConfig
// 3. Registering in the factory function
//
// Current implementations:
// - WebSocket: Real-time WebSocket connections
// - TCP: Raw TCP socket streams
// - UDP: UDP datagram streams
// - Serial: Serial port connections (e.g., Arduino, embedded devices)
// - File: File-based simulation of real-time streams
// - LSL: Lab Streaming Layer for neuroscience data

mod file;
#[cfg(feature = "lsl-support")]
mod lsl;
mod tcp;
mod udp;
mod websocket;
mod zmq;

#[cfg(target_family = "unix")]
mod serial;

use crate::streaming::types::StreamResult;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::mpsc;

pub use file::FileStreamSource;
#[cfg(feature = "lsl-support")]
pub use lsl::LslStreamSource;
pub use tcp::TcpStreamSource;
pub use udp::UdpStreamSource;
pub use websocket::WebSocketStreamSource;
pub use zmq::{ZmqPattern, ZmqStreamSource};

#[cfg(target_family = "unix")]
pub use serial::SerialStreamSource;

/// Configuration for different stream source types
///
/// This enum uses serde's tag attribute to enable clean JSON serialization
/// and easy extension with new source types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum StreamSourceConfig {
    /// WebSocket connection
    #[serde(rename = "websocket")]
    WebSocket {
        url: String,
        #[serde(default)]
        headers: HashMap<String, String>,
        #[serde(default)]
        reconnect: bool,
    },

    /// TCP socket connection
    #[serde(rename = "tcp")]
    TcpSocket {
        host: String,
        port: u16,
        #[serde(default)]
        reconnect: bool,
    },

    /// UDP socket (bind to receive datagrams)
    #[serde(rename = "udp")]
    UdpSocket {
        bind_addr: String,
        #[serde(default)]
        buffer_size: Option<usize>,
    },

    /// Serial port connection (e.g., /dev/ttyUSB0 on Linux, COM3 on Windows)
    #[cfg(target_family = "unix")]
    #[serde(rename = "serial")]
    SerialPort {
        port: String,
        baud_rate: u32,
        #[serde(default)]
        data_bits: Option<u8>,
        #[serde(default)]
        stop_bits: Option<u8>,
    },

    /// File-based stream (simulates real-time by reading file in chunks)
    #[serde(rename = "file")]
    FileStream {
        path: String,
        chunk_size: usize,
        /// Delay between chunks in milliseconds (simulates real-time)
        rate_limit_ms: Option<u64>,
        /// Loop the file when EOF is reached
        #[serde(default)]
        loop_playback: bool,
    },

    /// Lab Streaming Layer (LSL) stream
    #[cfg(feature = "lsl-support")]
    #[serde(rename = "lsl")]
    LslStream {
        /// Stream name to resolve (None for any)
        #[serde(default)]
        stream_name: Option<String>,
        /// Stream type (e.g., "EEG", "Markers", "Gaze")
        #[serde(default)]
        stream_type: Option<String>,
        /// Source ID (unique identifier)
        #[serde(default)]
        source_id: Option<String>,
        /// Resolution timeout in seconds
        #[serde(default)]
        resolve_timeout: Option<f64>,
        /// Chunk size for pulling samples
        #[serde(default)]
        chunk_size: Option<usize>,
        /// Use LSL timestamps vs local timestamps
        #[serde(default)]
        use_lsl_timestamps: Option<bool>,
    },

    /// ZeroMQ stream (bundled with static libzmq)
    #[serde(rename = "zmq")]
    ZeroMq {
        /// ZMQ endpoint (e.g., "tcp://127.0.0.1:5555", "ipc:///tmp/data.ipc")
        endpoint: String,
        /// Socket pattern (sub or pull)
        pattern: ZmqPattern,
        /// Topic filter for SUB pattern (empty = all topics)
        #[serde(default)]
        topic: Option<String>,
        /// Expected number of channels
        expected_channels: usize,
        /// Expected sample rate (Hz)
        expected_sample_rate: f32,
        /// High water mark (max queued messages, 0 = unlimited)
        #[serde(default)]
        hwm: Option<i32>,
    },
}

/// A chunk of data from a streaming source
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataChunk {
    /// Multi-channel samples: samples[channel_idx][sample_idx]
    pub samples: Vec<Vec<f32>>,

    /// Unix timestamp when this chunk was received/generated
    pub timestamp: f64,

    /// Sample rate in Hz
    pub sample_rate: f32,

    /// Channel labels (e.g., ["Fp1", "Fp2", "F3", "F4"])
    pub channel_names: Vec<String>,

    /// Sequence number for detecting packet loss
    #[serde(default)]
    pub sequence: Option<u64>,
}

impl DataChunk {
    /// Get the number of samples in this chunk
    pub fn num_samples(&self) -> usize {
        self.samples.first().map(|ch| ch.len()).unwrap_or(0)
    }

    /// Get the number of channels
    pub fn num_channels(&self) -> usize {
        self.samples.len()
    }

    /// Calculate the duration of this chunk in seconds
    pub fn duration_secs(&self) -> f64 {
        self.num_samples() as f64 / self.sample_rate as f64
    }
}

/// Metadata about a streaming data source
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceMetadata {
    /// Channel names
    pub channels: Vec<String>,

    /// Sample rate in Hz
    pub sample_rate: f32,

    /// Data format/encoding
    pub data_format: DataFormat,

    /// Source-specific properties (e.g., device name, connection info)
    #[serde(default)]
    pub properties: HashMap<String, String>,
}

/// Data format/encoding of the source
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DataFormat {
    /// 32-bit floating point
    Float32,
    /// 64-bit floating point
    Float64,
    /// 16-bit signed integer
    Int16,
    /// 24-bit signed integer
    Int24,
    /// 32-bit signed integer
    Int32,
    /// Raw bytes (needs custom parser)
    Raw,
}

/// Trait for all streaming data sources
///
/// Implementers provide a unified interface for connecting to different
/// data sources and streaming data chunks through an async channel.
///
/// # Extension Example
///
/// ```rust,ignore
/// use async_trait::async_trait;
/// use tokio::sync::mpsc;
/// use ddalab_tauri::streaming::{StreamSource, StreamResult, DataChunk, SourceMetadata};
///
/// pub struct MyCustomSource {
///     // ... fields
/// }
///
/// #[async_trait]
/// impl StreamSource for MyCustomSource {
///     async fn connect(&mut self) -> StreamResult<()> {
///         // Connect to your source
///         Ok(())
///     }
///
///     async fn start(&mut self, sender: mpsc::Sender<DataChunk>) -> StreamResult<()> {
///         // Start streaming data
///         loop {
///             let chunk = self.read_chunk().await?;
///             sender.send(chunk).await.ok();
///         }
///     }
///
///     async fn stop(&mut self) -> StreamResult<()> {
///         // Cleanup
///         Ok(())
///     }
///
///     fn is_connected(&self) -> bool {
///         // Return connection status
///         true
///     }
///
///     fn get_metadata(&self) -> SourceMetadata {
///         // Return source metadata
///         SourceMetadata {
///             source_type: "custom".to_string(),
///             connection_info: "...".to_string(),
///         }
///     }
/// }
/// ```
#[async_trait]
pub trait StreamSource: Send + Sync {
    /// Establish connection to the data source
    async fn connect(&mut self) -> StreamResult<()>;

    /// Start streaming data to the provided channel
    ///
    /// This method should run continuously, sending DataChunks as they arrive.
    /// It should only return when stopped or on error.
    async fn start(&mut self, sender: mpsc::Sender<DataChunk>) -> StreamResult<()>;

    /// Stop streaming and close the connection
    async fn stop(&mut self) -> StreamResult<()>;

    /// Check if currently connected
    fn is_connected(&self) -> bool;

    /// Get metadata about this source (channels, sample rate, etc.)
    fn get_metadata(&self) -> SourceMetadata;
}

/// Factory function to create a StreamSource from configuration
///
/// This is where new source types are registered. To add a new source:
/// 1. Implement the StreamSource trait
/// 2. Add a variant to StreamSourceConfig
/// 3. Add a match arm here to construct your source
pub fn create_source(config: StreamSourceConfig) -> StreamResult<Box<dyn StreamSource>> {
    match config {
        StreamSourceConfig::WebSocket {
            url,
            headers,
            reconnect,
        } => Ok(Box::new(WebSocketStreamSource::new(
            url, headers, reconnect,
        ))),

        StreamSourceConfig::TcpSocket {
            host,
            port,
            reconnect,
        } => Ok(Box::new(TcpStreamSource::new(host, port, reconnect))),

        StreamSourceConfig::UdpSocket {
            bind_addr,
            buffer_size,
        } => Ok(Box::new(UdpStreamSource::new(
            bind_addr,
            buffer_size.unwrap_or(8192),
        ))),

        #[cfg(target_family = "unix")]
        StreamSourceConfig::SerialPort {
            port,
            baud_rate,
            data_bits,
            stop_bits,
        } => Ok(Box::new(SerialStreamSource::new(
            port, baud_rate, data_bits, stop_bits,
        ))),

        StreamSourceConfig::FileStream {
            path,
            chunk_size,
            rate_limit_ms,
            loop_playback,
        } => Ok(Box::new(FileStreamSource::new(
            path,
            chunk_size,
            rate_limit_ms,
            loop_playback,
        ))),

        #[cfg(feature = "lsl-support")]
        StreamSourceConfig::LslStream {
            stream_name,
            stream_type,
            source_id,
            resolve_timeout,
            chunk_size,
            use_lsl_timestamps,
        } => Ok(Box::new(LslStreamSource::new(
            stream_name,
            stream_type,
            source_id,
            resolve_timeout,
            chunk_size,
            use_lsl_timestamps,
        ))),

        StreamSourceConfig::ZeroMq {
            endpoint,
            pattern,
            topic,
            expected_channels,
            expected_sample_rate,
            hwm,
        } => Ok(Box::new(ZmqStreamSource::new(
            endpoint,
            pattern,
            topic,
            expected_channels,
            expected_sample_rate,
            hwm,
        ))),
    }
}
