// Serial port streaming source (Unix-only)
//
// Connects to a serial port (e.g., /dev/ttyUSB0, /dev/ttyACM0) and receives
// newline-delimited JSON data chunks.
//
// Useful for:
// - Arduino/microcontroller data acquisition
// - Hardware EEG devices with serial output
// - Embedded sensor systems

use super::{DataChunk, DataFormat, SourceMetadata, StreamSource};
use crate::streaming::types::{StreamError, StreamResult};
use async_trait::async_trait;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;
use tokio_serial::SerialPortBuilderExt;

pub struct SerialStreamSource {
    port: String,
    baud_rate: u32,
    data_bits: u8,
    stop_bits: u8,
    is_connected: bool,
    metadata: Option<SourceMetadata>,
}

impl SerialStreamSource {
    pub fn new(port: String, baud_rate: u32, data_bits: Option<u8>, stop_bits: Option<u8>) -> Self {
        Self {
            port,
            baud_rate,
            data_bits: data_bits.unwrap_or(8),
            stop_bits: stop_bits.unwrap_or(1),
            is_connected: false,
            metadata: None,
        }
    }

    fn parse_line(&self, line: &str) -> StreamResult<DataChunk> {
        serde_json::from_str(line).map_err(|e| StreamError::Parse(format!("Invalid JSON: {}", e)))
    }
}

#[async_trait]
impl StreamSource for SerialStreamSource {
    async fn connect(&mut self) -> StreamResult<()> {
        if self.is_connected {
            return Ok(());
        }

        log::info!(
            "Opening serial port: {} at {} baud",
            self.port,
            self.baud_rate
        );

        // Verify port can be opened
        tokio_serial::new(&self.port, self.baud_rate)
            .open_native_async()
            .map_err(|e| StreamError::Serial(format!("Failed to open port: {}", e)))?;

        self.is_connected = true;
        log::info!("Serial port opened successfully");

        Ok(())
    }

    async fn start(&mut self, sender: mpsc::Sender<DataChunk>) -> StreamResult<()> {
        if !self.is_connected {
            self.connect().await?;
        }

        let port = tokio_serial::new(&self.port, self.baud_rate)
            .open_native_async()
            .map_err(|e| StreamError::Serial(format!("Failed to open port: {}", e)))?;

        log::info!("Serial stream started on {}", self.port);

        let mut reader = BufReader::new(port);
        let mut line = String::new();

        // Read newline-delimited JSON
        loop {
            line.clear();

            match reader.read_line(&mut line).await {
                Ok(0) => {
                    // EOF (should not happen with serial port)
                    log::warn!("Serial port closed unexpectedly");
                    break;
                }
                Ok(_) => {
                    let trimmed = line.trim();

                    // Skip empty lines
                    if trimmed.is_empty() {
                        continue;
                    }

                    // Parse and send chunk
                    match self.parse_line(trimmed) {
                        Ok(chunk) => {
                            // Update metadata from first chunk if not set
                            if self.metadata.is_none() {
                                self.metadata = Some(SourceMetadata {
                                    channels: chunk.channel_names.clone(),
                                    sample_rate: chunk.sample_rate,
                                    data_format: DataFormat::Float32,
                                    properties: [
                                        ("port".to_string(), self.port.clone()),
                                        ("baud_rate".to_string(), self.baud_rate.to_string()),
                                    ]
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
                            log::debug!("Failed to parse serial line: {} (line: {})", e, trimmed);
                            // Continue reading - might be debug output or incomplete data
                        }
                    }
                }
                Err(e) => {
                    log::error!("Serial read error: {}", e);
                    return Err(StreamError::Serial(format!("Read failed: {}", e)));
                }
            }
        }

        self.is_connected = false;
        Ok(())
    }

    async fn stop(&mut self) -> StreamResult<()> {
        log::info!("Stopping serial stream");
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
