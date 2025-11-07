// TCP socket streaming source
//
// Connects to a TCP server and receives data chunks.
// Messages are expected to be newline-delimited JSON (NDJSON format).

use super::{DataChunk, DataFormat, SourceMetadata, StreamSource};
use crate::streaming::types::{StreamError, StreamResult};
use async_trait::async_trait;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

pub struct TcpStreamSource {
    host: String,
    port: u16,
    reconnect: bool,
    is_connected: bool,
    metadata: Option<SourceMetadata>,
}

impl TcpStreamSource {
    pub fn new(host: String, port: u16, reconnect: bool) -> Self {
        Self {
            host,
            port,
            reconnect,
            is_connected: false,
            metadata: None,
        }
    }

    fn parse_line(&self, line: &str) -> StreamResult<DataChunk> {
        serde_json::from_str(line).map_err(|e| StreamError::Parse(format!("Invalid JSON: {}", e)))
    }
}

#[async_trait]
impl StreamSource for TcpStreamSource {
    async fn connect(&mut self) -> StreamResult<()> {
        if self.is_connected {
            return Ok(());
        }

        log::info!("Connecting to TCP: {}:{}", self.host, self.port);

        let addr = format!("{}:{}", self.host, self.port);
        TcpStream::connect(&addr)
            .await
            .map_err(|e| StreamError::Network(format!("TCP connection failed: {}", e)))?;

        self.is_connected = true;
        log::info!("TCP connected successfully");

        Ok(())
    }

    async fn start(&mut self, sender: mpsc::Sender<DataChunk>) -> StreamResult<()> {
        loop {
            // Connect or reconnect
            if !self.is_connected {
                self.connect().await?;
            }

            let addr = format!("{}:{}", self.host, self.port);
            let stream = match TcpStream::connect(&addr).await {
                Ok(s) => s,
                Err(e) => {
                    log::error!("TCP connection failed: {}", e);
                    if !self.reconnect {
                        return Err(StreamError::Network(format!("Connection failed: {}", e)));
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    continue;
                }
            };

            log::info!("TCP stream started");

            let mut reader = BufReader::new(stream);
            let mut line = String::new();

            // Read newline-delimited JSON
            loop {
                line.clear();

                match reader.read_line(&mut line).await {
                    Ok(0) => {
                        // EOF
                        log::info!("TCP connection closed by server");
                        break;
                    }
                    Ok(_) => {
                        // Parse and send chunk
                        match self.parse_line(line.trim()) {
                            Ok(chunk) => {
                                // Update metadata from first chunk if not set
                                if self.metadata.is_none() {
                                    self.metadata = Some(SourceMetadata {
                                        channels: chunk.channel_names.clone(),
                                        sample_rate: chunk.sample_rate,
                                        data_format: DataFormat::Float32,
                                        properties: [(
                                            "address".to_string(),
                                            format!("{}:{}", self.host, self.port),
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
                                log::error!("Failed to parse TCP message: {}", e);
                                // Continue reading
                            }
                        }
                    }
                    Err(e) => {
                        log::error!("TCP read error: {}", e);
                        break;
                    }
                }
            }

            // Connection closed
            self.is_connected = false;

            if !self.reconnect {
                log::info!("TCP disconnected, reconnect disabled");
                return Ok(());
            }

            log::info!("TCP disconnected, reconnecting in 2 seconds...");
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        }
    }

    async fn stop(&mut self) -> StreamResult<()> {
        log::info!("Stopping TCP stream");
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
