// WebSocket streaming source
//
// Connects to a WebSocket server and receives data chunks in JSON format.
// Expected message format:
// {
//   "samples": [[ch1_sample1, ch1_sample2, ...], [ch2_sample1, ...]],
//   "timestamp": 1234567890.123,
//   "sample_rate": 250.0,
//   "channel_names": ["Fp1", "Fp2"],
//   "sequence": 42  // optional
// }

use super::{DataChunk, DataFormat, SourceMetadata, StreamSource};
use crate::streaming::types::{StreamError, StreamResult};
use async_trait::async_trait;
use futures_util::StreamExt;
use rand::Rng;
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

struct ReconnectState {
    attempt: u32,
    base_ms: u64,
    max_ms: u64,
    multiplier: f64,
}

impl ReconnectState {
    fn new() -> Self {
        Self {
            attempt: 0,
            base_ms: 500,
            max_ms: 30_000,
            multiplier: 2.0,
        }
    }

    fn next_delay(&mut self) -> Duration {
        let delay = (self.base_ms as f64 * self.multiplier.powi(self.attempt as i32))
            .min(self.max_ms as f64);
        let jitter = rand::rng().random_range(0.0..0.3) * delay;
        self.attempt += 1;
        Duration::from_millis((delay + jitter) as u64)
    }

    fn reset(&mut self) {
        self.attempt = 0;
    }
}

pub struct WebSocketStreamSource {
    url: String,
    headers: HashMap<String, String>,
    reconnect: bool,
    is_connected: bool,
    metadata: Option<SourceMetadata>,
}

impl WebSocketStreamSource {
    pub fn new(url: String, headers: HashMap<String, String>, reconnect: bool) -> Self {
        Self {
            url,
            headers,
            reconnect,
            is_connected: false,
            metadata: None,
        }
    }

    fn parse_message(&self, msg: &str) -> StreamResult<DataChunk> {
        serde_json::from_str(msg).map_err(|e| StreamError::Parse(format!("Invalid JSON: {}", e)))
    }
}

#[async_trait]
impl StreamSource for WebSocketStreamSource {
    async fn connect(&mut self) -> StreamResult<()> {
        if self.is_connected {
            return Ok(());
        }

        log::info!("Connecting to WebSocket: {}", self.url);

        // Note: tokio-tungstenite doesn't support custom headers in connect_async
        // For production, consider using a more feature-rich WebSocket client
        let (ws_stream, _) = connect_async(&self.url)
            .await
            .map_err(|e| StreamError::WebSocket(format!("Connection failed: {}", e)))?;

        log::info!("WebSocket connected successfully");

        // We'll establish metadata from the first message
        self.is_connected = true;

        Ok(())
    }

    async fn start(&mut self, sender: mpsc::Sender<DataChunk>) -> StreamResult<()> {
        let mut reconnect_state = ReconnectState::new();

        loop {
            // Connect or reconnect
            if !self.is_connected {
                self.connect().await?;
            }

            let (ws_stream, _) = connect_async(&self.url)
                .await
                .map_err(|e| StreamError::WebSocket(format!("Connection failed: {}", e)))?;

            let (mut _write, mut read) = ws_stream.split();

            log::info!("WebSocket stream started");
            reconnect_state.reset();

            // Read messages
            while let Some(message) = read.next().await {
                match message {
                    Ok(Message::Text(text)) => {
                        // Parse and send chunk
                        match self.parse_message(&text) {
                            Ok(chunk) => {
                                // Update metadata from first chunk if not set
                                if self.metadata.is_none() {
                                    self.metadata = Some(SourceMetadata {
                                        channels: chunk.channel_names.clone(),
                                        sample_rate: chunk.sample_rate,
                                        data_format: DataFormat::Float32,
                                        properties: [("url".to_string(), self.url.clone())]
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
                                log::error!("Failed to parse WebSocket message: {}", e);
                                // Continue receiving other messages
                            }
                        }
                    }
                    Ok(Message::Binary(data)) => {
                        // For binary data, you could implement custom binary protocol
                        log::warn!("Received binary WebSocket message (not yet supported)");
                    }
                    Ok(Message::Close(_)) => {
                        log::info!("WebSocket closed by server");
                        break;
                    }
                    Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {
                        // Handled automatically by the library
                    }
                    Ok(Message::Frame(_)) => {
                        // Raw frames, typically not used
                    }
                    Err(e) => {
                        log::error!("WebSocket error: {}", e);
                        break;
                    }
                }
            }

            // Connection closed
            self.is_connected = false;

            if !self.reconnect {
                log::info!("WebSocket disconnected, reconnect disabled");
                return Ok(());
            }

            let delay = reconnect_state.next_delay();
            log::info!(
                "WebSocket disconnected, reconnecting in {}ms (attempt {})...",
                delay.as_millis(),
                reconnect_state.attempt
            );
            tokio::time::sleep(delay).await;
        }
    }

    async fn stop(&mut self) -> StreamResult<()> {
        log::info!("Stopping WebSocket stream");
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
