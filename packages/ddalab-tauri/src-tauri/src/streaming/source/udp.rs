// UDP socket streaming source
//
// Binds to a UDP socket and receives data chunks as datagrams.
// Each datagram should contain a complete JSON-encoded DataChunk.

use super::{DataChunk, DataFormat, SourceMetadata, StreamSource};
use crate::streaming::types::{StreamError, StreamResult};
use async_trait::async_trait;
use tokio::net::UdpSocket;
use tokio::sync::mpsc;

pub struct UdpStreamSource {
    bind_addr: String,
    buffer_size: usize,
    is_connected: bool,
    metadata: Option<SourceMetadata>,
}

impl UdpStreamSource {
    pub fn new(bind_addr: String, buffer_size: usize) -> Self {
        Self {
            bind_addr,
            buffer_size,
            is_connected: false,
            metadata: None,
        }
    }

    fn parse_datagram(&self, data: &[u8]) -> StreamResult<DataChunk> {
        serde_json::from_slice(data)
            .map_err(|e| StreamError::Parse(format!("Invalid JSON datagram: {}", e)))
    }
}

#[async_trait]
impl StreamSource for UdpStreamSource {
    async fn connect(&mut self) -> StreamResult<()> {
        if self.is_connected {
            return Ok(());
        }

        log::info!("Binding UDP socket: {}", self.bind_addr);

        // Bind the socket to verify the address is valid
        UdpSocket::bind(&self.bind_addr)
            .await
            .map_err(|e| StreamError::Network(format!("UDP bind failed: {}", e)))?;

        self.is_connected = true;
        log::info!("UDP socket bound successfully");

        Ok(())
    }

    async fn start(&mut self, sender: mpsc::Sender<DataChunk>) -> StreamResult<()> {
        if !self.is_connected {
            self.connect().await?;
        }

        let socket = UdpSocket::bind(&self.bind_addr)
            .await
            .map_err(|e| StreamError::Network(format!("UDP bind failed: {}", e)))?;

        log::info!("UDP stream started, listening on {}", self.bind_addr);

        let mut buffer = vec![0u8; self.buffer_size];

        loop {
            // Receive datagram
            match socket.recv(&mut buffer).await {
                Ok(len) => {
                    // Parse and send chunk
                    match self.parse_datagram(&buffer[..len]) {
                        Ok(chunk) => {
                            // Update metadata from first chunk if not set
                            if self.metadata.is_none() {
                                self.metadata = Some(SourceMetadata {
                                    channels: chunk.channel_names.clone(),
                                    sample_rate: chunk.sample_rate,
                                    data_format: DataFormat::Float32,
                                    properties: [(
                                        "bind_address".to_string(),
                                        self.bind_addr.clone(),
                                    )]
                                    .into_iter()
                                    .collect(),
                                });
                            }

                            if sender.send(chunk).await.is_err() {
                                log::warn!("Stream receiver closed");
                                return Ok(());
                            }
                        }
                        Err(e) => {
                            log::error!("Failed to parse UDP datagram: {}", e);
                            // Continue receiving other datagrams
                        }
                    }
                }
                Err(e) => {
                    log::error!("UDP receive error: {}", e);
                    return Err(StreamError::Network(format!("UDP receive failed: {}", e)));
                }
            }
        }
    }

    async fn stop(&mut self) -> StreamResult<()> {
        log::info!("Stopping UDP stream");
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
