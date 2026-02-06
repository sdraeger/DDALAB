// File-based streaming source that simulates real-time data
//
// This source reads data from an EDF file in chunks and streams it at a
// configurable rate, useful for:
// - Testing streaming functionality without external hardware
// - Replaying recorded sessions
// - Demo and development

use super::{DataChunk, DataFormat, SourceMetadata, StreamSource};
use crate::file_readers::{FileMetadata, FileReader, FileReaderFactory};
use crate::streaming::types::{StreamError, StreamResult};
use async_trait::async_trait;
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::time::{sleep, Duration};

pub struct FileStreamSource {
    path: PathBuf,
    chunk_size: usize,
    rate_limit_ms: Option<u64>,
    loop_playback: bool,
    file_metadata: Option<FileMetadata>,
    metadata: Option<SourceMetadata>,
    is_connected: bool,
    current_position: usize,
    reader: Option<Arc<Mutex<Box<dyn FileReader>>>>,
}

impl FileStreamSource {
    pub fn new(
        path: String,
        chunk_size: usize,
        rate_limit_ms: Option<u64>,
        loop_playback: bool,
    ) -> Self {
        Self {
            path: PathBuf::from(path),
            chunk_size,
            rate_limit_ms,
            loop_playback,
            file_metadata: None,
            metadata: None,
            is_connected: false,
            current_position: 0,
            reader: None,
        }
    }

    async fn read_next_chunk(&mut self) -> StreamResult<Option<DataChunk>> {
        let file_metadata = self
            .file_metadata
            .as_ref()
            .ok_or_else(|| StreamError::Connection("File metadata not available".to_string()))?;

        let metadata = self
            .metadata
            .as_ref()
            .ok_or_else(|| StreamError::Connection("Metadata not available".to_string()))?;

        // Check if we've reached the end
        if self.current_position >= file_metadata.num_samples {
            if self.loop_playback {
                self.current_position = 0;
            } else {
                return Ok(None); // EOF
            }
        }

        // Calculate how many samples we can read
        let samples_to_read = std::cmp::min(
            self.chunk_size,
            file_metadata.num_samples - self.current_position,
        );

        if samples_to_read == 0 {
            return Ok(None);
        }

        let reader = self
            .reader
            .as_ref()
            .ok_or_else(|| StreamError::Connection("File reader not initialized".to_string()))?;

        let reader_clone = Arc::clone(reader);
        let start = self.current_position;

        let samples = tokio::task::spawn_blocking(move || -> Result<Vec<Vec<f64>>, String> {
            let reader = reader_clone.lock();
            reader
                .read_chunk(start, samples_to_read, None)
                .map_err(|e| format!("Failed to read chunk: {:?}", e))
        })
        .await
        .map_err(|e| StreamError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?
        .map_err(|e| StreamError::Parse(e))?;

        self.current_position += samples_to_read;

        // Convert f64 to f32 and transpose [channels][samples]
        let samples_f32: Vec<Vec<f32>> = samples
            .iter()
            .map(|channel| channel.iter().map(|&v| v as f32).collect())
            .collect();

        let chunk = DataChunk {
            samples: samples_f32,
            timestamp: chrono::Utc::now().timestamp() as f64
                + (chrono::Utc::now().timestamp_subsec_millis() as f64 / 1000.0),
            sample_rate: file_metadata.sample_rate as f32,
            channel_names: metadata.channels.clone(),
            sequence: Some(self.current_position as u64 / self.chunk_size as u64),
        };

        Ok(Some(chunk))
    }
}

#[async_trait]
impl StreamSource for FileStreamSource {
    async fn connect(&mut self) -> StreamResult<()> {
        if self.is_connected {
            return Ok(());
        }

        let path = self.path.clone();
        let (file_metadata, reader) = tokio::task::spawn_blocking(move || {
            let reader = FileReaderFactory::create_reader(&path)
                .map_err(|e| format!("Failed to open file: {:?}", e))?;
            let metadata = reader
                .metadata()
                .map_err(|e| format!("Failed to get metadata: {:?}", e))?;
            Ok::<(FileMetadata, Box<dyn FileReader>), String>((metadata, reader))
        })
        .await
        .map_err(|e| StreamError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?
        .map_err(|e| StreamError::Connection(e))?;

        self.reader = Some(Arc::new(Mutex::new(reader)));

        // Store metadata
        self.metadata = Some(SourceMetadata {
            channels: file_metadata.channels.clone(),
            sample_rate: file_metadata.sample_rate as f32,
            data_format: DataFormat::Float32, // Our readers convert to f64, we convert to f32
            properties: [
                ("file_path".to_string(), self.path.display().to_string()),
                (
                    "duration_secs".to_string(),
                    file_metadata.duration.to_string(),
                ),
                (
                    "total_samples".to_string(),
                    file_metadata.num_samples.to_string(),
                ),
            ]
            .into_iter()
            .collect(),
        });

        self.file_metadata = Some(file_metadata.clone());
        self.is_connected = true;
        self.current_position = 0;

        log::info!(
            "Connected to file stream: {} ({} channels, {} Hz)",
            self.path.display(),
            file_metadata.num_channels,
            file_metadata.sample_rate
        );

        Ok(())
    }

    async fn start(&mut self, sender: mpsc::Sender<DataChunk>) -> StreamResult<()> {
        if !self.is_connected {
            self.connect().await?;
        }

        log::info!("Starting file stream playback");

        loop {
            // Read next chunk
            match self.read_next_chunk().await {
                Ok(Some(chunk)) => {
                    // Calculate real-time delay based on chunk duration
                    // This ensures smooth, realistic streaming regardless of chunk size
                    let chunk_duration_ms = if let Some(metadata) = &self.file_metadata {
                        let samples_in_chunk = chunk.samples[0].len();
                        let duration_secs = samples_in_chunk as f64 / metadata.sample_rate;
                        (duration_secs * 1000.0) as u64
                    } else {
                        100
                    };

                    // Send chunk
                    if sender.send(chunk).await.is_err() {
                        log::warn!("Stream receiver closed, stopping file stream");
                        return Ok(());
                    }

                    // Rate limiting (simulate real-time streaming)
                    // If rate_limit_ms is None or 0, use auto-calculated duration
                    let delay = match self.rate_limit_ms {
                        Some(ms) if ms > 0 => ms,
                        _ => chunk_duration_ms, // Auto-calculate based on sample rate
                    };
                    sleep(Duration::from_millis(delay)).await;
                }
                Ok(None) => {
                    // EOF reached and no looping
                    log::info!("File stream reached EOF");
                    return Ok(());
                }
                Err(e) => {
                    log::error!("Error reading file chunk: {}", e);
                    return Err(e);
                }
            }
        }
    }

    async fn stop(&mut self) -> StreamResult<()> {
        log::info!("Stopping file stream");
        self.is_connected = false;
        self.current_position = 0;
        self.reader = None;
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
