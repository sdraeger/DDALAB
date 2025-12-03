---
sidebar_position: 3
---

# Rust API

The Rust backend provides high-performance file processing and DDA analysis.

## Crate Overview

```
ddalab_tauri
├── api           # HTTP server and handlers
├── file_readers  # Multi-format file readers
├── file_writers  # Export to various formats
├── streaming     # Real-time data processing
├── ica           # Independent Component Analysis
├── sync          # Multi-device synchronization
└── tasks         # Async task management
```

## File Readers

### FileReaderFactory

Create readers for various file formats.

```rust
use ddalab_tauri::file_readers::FileReaderFactory;
use std::path::Path;

// Create a reader (auto-detects format)
let reader = FileReaderFactory::create_reader(Path::new("data.edf"))?;

// Convert to intermediate format
let data = FileReaderFactory::to_intermediate_data(&*reader, None)?;

// Get supported extensions
let extensions = FileReaderFactory::supported_extensions();
```

### Supported Formats

| Format      | Reader              | Features          |
| ----------- | ------------------- | ----------------- |
| EDF         | `EdfReader`         | Full EDF+ support |
| BrainVision | `BrainVisionReader` | .vhdr/.vmrk/.eeg  |
| XDF         | `XdfReader`         | Multi-stream      |
| EEGLAB      | `EeglabReader`      | .set files        |
| FIF         | `FifReader`         | MEG/EEG           |
| NIfTI       | `NiftiReader`       | 4D volumes        |
| CSV         | `CsvReader`         | Configurable      |

## File Writers

### FileWriterFactory

Export data to various formats.

```rust
use ddalab_tauri::file_writers::{FileWriterFactory, WriterConfig};
use std::path::Path;

// Basic export
FileWriterFactory::write_file(&data, Path::new("output.edf"), None)?;

// With configuration
let mut config = WriterConfig::default();
config.selected_channels = Some(vec!["Fp1".to_string(), "Fp2".to_string()]);
FileWriterFactory::write_file(&data, Path::new("output.csv"), Some(config))?;
```

## Intermediate Format

Universal data representation for all file formats.

```rust
use ddalab_tauri::intermediate_format::{IntermediateData, DataMetadata, ChannelData};

pub struct IntermediateData {
    pub metadata: DataMetadata,
    pub channels: Vec<ChannelData>,
}

pub struct DataMetadata {
    pub file_path: PathBuf,
    pub format: String,
    pub sample_rate: f64,
    pub duration_seconds: f64,
    pub start_time: Option<DateTime<Utc>>,
    pub annotations: Vec<Annotation>,
}

pub struct ChannelData {
    pub name: String,
    pub unit: String,
    pub sample_rate: f64,
    pub physical_min: f64,
    pub physical_max: f64,
    pub data: Vec<f64>,
}
```

## API Handlers

### DDA Handler

```rust
use ddalab_tauri::api::handlers::dda;

// Run DDA analysis
pub async fn run_dda_analysis(
    config: DdaRequest,
) -> Result<DdaResponse, AppError>;

// Get analysis progress
pub async fn get_progress(
    job_id: String,
) -> Result<ProgressResponse, AppError>;

// Cancel analysis
pub async fn cancel_analysis(
    job_id: String,
) -> Result<(), AppError>;
```

### File Handler

```rust
use ddalab_tauri::api::handlers::files;

// Load file
pub async fn load_file(
    path: String,
) -> Result<FileInfoResponse, AppError>;

// Get channel data
pub async fn get_channel_data(
    request: ChannelDataRequest,
) -> Result<ChannelDataResponse, AppError>;
```

## Streaming

Real-time data acquisition and processing.

```rust
use ddalab_tauri::streaming::{StreamSource, StreamConfig};

// Create stream from source
let stream = StreamSource::new(config)?;

// Subscribe to data
let rx = stream.subscribe();
while let Ok(data) = rx.recv() {
    // Process real-time data
}
```

## Error Handling

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum FileError {
    #[error("File not found: {0}")]
    NotFound(PathBuf),

    #[error("Unsupported format: {0}")]
    UnsupportedFormat(String),

    #[error("Parse error: {0}")]
    ParseError(String),
}
```

## Feature Flags

```toml
[features]
default = ["custom-protocol", "devtools"]
lsl-support = ["lsl"]        # Lab Streaming Layer
nwb-support = ["hdf5"]       # NWB file format
```

## Full Documentation

Generate complete Rust documentation:

```bash
cd src-tauri
cargo doc --no-deps --document-private-items --open
```

Or via npm:

```bash
npm run docs:rust
```
