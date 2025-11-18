// ZeroMQ streaming source
//
// Connects to ZeroMQ sockets and receives real-time data streams.
// Uses pure Rust implementation (no C dependencies).
//
// Features:
// - SUB (subscribe) pattern for pub/sub messaging
// - PULL pattern for pipeline/work distribution
// - High throughput with low latency
// - Pure Rust implementation (bundled, no external dependencies)
//
// Typical use cases:
// - High-throughput sensor data streaming
// - Distributed data collection systems
// - Real-time analytics pipelines
// - Multi-source data aggregation

use super::{DataChunk, DataFormat, SourceMetadata, StreamSource};
use crate::streaming::types::{StreamError, StreamResult};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::mpsc;
use zeromq::{PullSocket, Socket, SocketRecv, SubSocket};

/// ZeroMQ socket patterns supported for streaming
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ZmqPattern {
    /// Subscribe pattern - receive published messages with topic filtering
    Sub,
    /// Pull pattern - receive pushed messages in round-robin fashion
    Pull,
}

/// ZeroMQ stream source configuration and state
pub struct ZmqStreamSource {
    /// Connection endpoint (e.g., "tcp://localhost:5555")
    endpoint: String,

    /// ZeroMQ socket pattern to use
    pattern: ZmqPattern,

    /// Topic filter for SUB pattern (empty = subscribe to all)
    topic: String,

    /// Expected number of channels in the data
    expected_channels: usize,

    /// Expected sample rate (for metadata)
    expected_sample_rate: f32,

    /// High water mark (max queued messages)
    hwm: i32,

    /// Connection state
    is_connected: bool,

    /// Cached metadata
    metadata: Option<SourceMetadata>,
}

impl ZmqStreamSource {
    /// Create a new ZeroMQ stream source
    ///
    /// # Arguments
    /// * `endpoint` - ZMQ endpoint (e.g., "tcp://127.0.0.1:5555", "ipc:///tmp/data.ipc")
    /// * `pattern` - Socket pattern (Sub or Pull)
    /// * `topic` - Topic filter for SUB pattern (empty string subscribes to all)
    /// * `expected_channels` - Number of channels expected in the stream
    /// * `expected_sample_rate` - Expected sample rate for metadata
    /// * `hwm` - High water mark for message queue (0 = unlimited)
    pub fn new(
        endpoint: String,
        pattern: ZmqPattern,
        topic: Option<String>,
        expected_channels: usize,
        expected_sample_rate: f32,
        hwm: Option<i32>,
    ) -> Self {
        Self {
            endpoint,
            pattern,
            topic: topic.unwrap_or_default(),
            expected_channels,
            expected_sample_rate,
            hwm: hwm.unwrap_or(1000),
            is_connected: false,
            metadata: None,
        }
    }

    /// Parse incoming ZMQ message as JSON data chunk
    fn parse_message(&self, data: &[u8]) -> StreamResult<DataChunk> {
        let chunk: DataChunk = serde_json::from_slice(data).map_err(|e| {
            StreamError::Parse(format!("Failed to parse ZMQ message as JSON: {}", e))
        })?;

        // Validate channel count
        if chunk.num_channels() != self.expected_channels {
            log::warn!(
                "ZMQ message has {} channels but expected {}",
                chunk.num_channels(),
                self.expected_channels
            );
        }

        Ok(chunk)
    }
}

#[async_trait]
impl StreamSource for ZmqStreamSource {
    async fn connect(&mut self) -> StreamResult<()> {
        if self.is_connected {
            return Ok(());
        }

        log::info!(
            "Connecting to ZMQ endpoint: {} (pattern: {:?})",
            self.endpoint,
            self.pattern
        );

        // Test connection by creating socket
        match self.pattern {
            ZmqPattern::Sub => {
                let mut socket = SubSocket::new();
                socket.connect(&self.endpoint).await.map_err(|e| {
                    StreamError::Connection(format!("ZMQ SUB connect error: {}", e))
                })?;

                // Subscribe to topic
                socket
                    .subscribe(&self.topic)
                    .await
                    .map_err(|e| StreamError::Connection(format!("ZMQ subscribe error: {}", e)))?;

                log::info!("ZMQ SUB socket connected");
            }
            ZmqPattern::Pull => {
                let mut socket = PullSocket::new();
                socket.connect(&self.endpoint).await.map_err(|e| {
                    StreamError::Connection(format!("ZMQ PULL connect error: {}", e))
                })?;

                log::info!("ZMQ PULL socket connected");
            }
        }

        // Generate default channel names
        let channel_names = (0..self.expected_channels)
            .map(|i| format!("Ch{}", i + 1))
            .collect();

        let mut properties = HashMap::new();
        properties.insert("endpoint".to_string(), self.endpoint.clone());
        properties.insert("pattern".to_string(), format!("{:?}", self.pattern));
        if !self.topic.is_empty() {
            properties.insert("topic".to_string(), self.topic.clone());
        }

        self.metadata = Some(SourceMetadata {
            channels: channel_names,
            sample_rate: self.expected_sample_rate,
            data_format: DataFormat::Float32,
            properties,
        });

        self.is_connected = true;

        Ok(())
    }

    async fn start(&mut self, sender: mpsc::Sender<DataChunk>) -> StreamResult<()> {
        if !self.is_connected {
            self.connect().await?;
        }

        let endpoint = self.endpoint.clone();
        let pattern = self.pattern.clone();
        let topic = self.topic.clone();
        let expected_channels = self.expected_channels;

        log::info!("Starting ZMQ stream");

        // Run ZMQ receive loop
        match pattern {
            ZmqPattern::Sub => {
                let mut socket = SubSocket::new();
                socket.connect(&endpoint).await.map_err(|e| {
                    StreamError::Connection(format!("ZMQ SUB connect error: {}", e))
                })?;

                socket
                    .subscribe(&topic)
                    .await
                    .map_err(|e| StreamError::Connection(format!("ZMQ subscribe error: {}", e)))?;

                log::info!("ZMQ SUB socket connected, receiving messages...");

                let mut message_count = 0u64;
                let mut error_count = 0u64;

                loop {
                    // Receive message
                    let msg = match socket.recv().await {
                        Ok(m) => m,
                        Err(e) => {
                            error_count += 1;
                            log::error!("ZMQ receive error: {}", e);
                            if error_count > 100 {
                                return Err(StreamError::Connection(format!(
                                    "Too many ZMQ errors ({})",
                                    error_count
                                )));
                            }
                            continue;
                        }
                    };

                    // Parse message as JSON
                    // ZMQ message is Vec<Bytes>, extract the data
                    let frames = msg.into_vec();
                    let data = frames.first().unwrap();
                    let chunk: DataChunk = match serde_json::from_slice(data) {
                        Ok(c) => c,
                        Err(e) => {
                            error_count += 1;
                            log::warn!("Failed to parse ZMQ message: {}", e);
                            continue;
                        }
                    };

                    // Validate channel count
                    if chunk.num_channels() != expected_channels {
                        log::warn!(
                            "Message has {} channels but expected {}",
                            chunk.num_channels(),
                            expected_channels
                        );
                    }

                    message_count += 1;
                    if message_count % 1000 == 0 {
                        log::debug!("Received {} ZMQ messages", message_count);
                    }

                    // Send to processing pipeline
                    if sender.send(chunk).await.is_err() {
                        log::info!("ZMQ stream receiver closed, stopping");
                        break;
                    }

                    // Reset error count on successful receive
                    if error_count > 0 {
                        error_count = 0;
                    }
                }

                log::info!(
                    "ZMQ SUB stream stopped (received {} messages)",
                    message_count
                );
            }
            ZmqPattern::Pull => {
                let mut socket = PullSocket::new();
                socket.connect(&endpoint).await.map_err(|e| {
                    StreamError::Connection(format!("ZMQ PULL connect error: {}", e))
                })?;

                log::info!("ZMQ PULL socket connected, receiving messages...");

                let mut message_count = 0u64;
                let mut error_count = 0u64;

                loop {
                    // Receive message
                    let msg = match socket.recv().await {
                        Ok(m) => m,
                        Err(e) => {
                            error_count += 1;
                            log::error!("ZMQ receive error: {}", e);
                            if error_count > 100 {
                                return Err(StreamError::Connection(format!(
                                    "Too many ZMQ errors ({})",
                                    error_count
                                )));
                            }
                            continue;
                        }
                    };

                    // Parse message as JSON
                    // ZMQ message is Vec<Bytes>, extract the data
                    let frames = msg.into_vec();
                    let data = frames.first().unwrap();
                    let chunk: DataChunk = match serde_json::from_slice(data) {
                        Ok(c) => c,
                        Err(e) => {
                            error_count += 1;
                            log::warn!("Failed to parse ZMQ message: {}", e);
                            continue;
                        }
                    };

                    // Validate channel count
                    if chunk.num_channels() != expected_channels {
                        log::warn!(
                            "Message has {} channels but expected {}",
                            chunk.num_channels(),
                            expected_channels
                        );
                    }

                    message_count += 1;
                    if message_count % 1000 == 0 {
                        log::debug!("Received {} ZMQ messages", message_count);
                    }

                    // Send to processing pipeline
                    if sender.send(chunk).await.is_err() {
                        log::info!("ZMQ stream receiver closed, stopping");
                        break;
                    }

                    // Reset error count on successful receive
                    if error_count > 0 {
                        error_count = 0;
                    }
                }

                log::info!(
                    "ZMQ PULL stream stopped (received {} messages)",
                    message_count
                );
            }
        }

        Ok(())
    }

    async fn stop(&mut self) -> StreamResult<()> {
        log::info!("Stopping ZMQ stream");
        self.is_connected = false;
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
