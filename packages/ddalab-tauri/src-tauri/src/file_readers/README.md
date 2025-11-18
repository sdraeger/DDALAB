# File Readers Module

This module provides a modular, extensible architecture for reading various neurophysiology file formats in DDALAB.

## Overview

All file readers implement the `FileReader` trait and convert to a universal `IntermediateData` format, which can then be:

- Converted to ASCII/CSV for DDA analysis
- Used directly for visualization
- Exported to other formats

## Supported File Formats

### Default (Always Available)

| Format      | Extension         | Description                                  | Crate                 |
| ----------- | ----------------- | -------------------------------------------- | --------------------- |
| EDF/EDF+    | `.edf`            | European Data Format (clinical EEG standard) | Custom implementation |
| BrainVision | `.vhdr`           | BrainProducts format                         | `bvreader`            |
| EEGLAB      | `.set`            | MATLAB-based EEGLAB format                   | `matfile`             |
| FIF/FIFF    | `.fif`            | Neuromag/Elekta MEG format                   | `fiff`                |
| NIfTI       | `.nii`, `.nii.gz` | Neuroimaging format                          | `nifti`               |
| CSV         | `.csv`            | Comma-separated values                       | Custom                |
| ASCII       | `.txt`, `.ascii`  | Space-separated text                         | Custom                |
| **XDF**     | `.xdf`            | Lab Streaming Layer recordings               | `quick-xml`           |

### Optional (Feature Flags)

| Format  | Extension | Feature Flag  | Dependency     |
| ------- | --------- | ------------- | -------------- |
| **NWB** | `.nwb`    | `nwb-support` | `hdf5 = "0.8"` |

## Architecture

### FileReader Trait

```rust
pub trait FileReader: Send + Sync {
    fn metadata(&self) -> FileResult<FileMetadata>;
    fn read_chunk(&self, start_sample: usize, num_samples: usize, channels: Option<&[String]>) -> FileResult<Vec<Vec<f64>>>;
    fn read_overview(&self, max_points: usize, channels: Option<&[String]>) -> FileResult<Vec<Vec<f64>>>;
    fn format_name(&self) -> &str;
    fn supports_write(&self) -> bool { false }
}
```

### IntermediateData Format

```rust
pub struct IntermediateData {
    pub metadata: DataMetadata,
    pub channels: Vec<ChannelData>,
}

pub struct ChannelData {
    pub label: String,
    pub channel_type: String,
    pub unit: String,
    pub samples: Vec<f64>,
    pub sample_rate: Option<f64>,
}
```

### FileReaderFactory

The factory pattern automatically selects the appropriate reader based on file extension:

```rust
let reader = FileReaderFactory::create_reader(Path::new("data.xdf"))?;
let metadata = reader.metadata()?;
let data = reader.read_chunk(0, 1000, None)?;
```

## New Implementations

### NWB Reader

**Location:** `nwb_reader.rs`

**Purpose:** Read Neurodata Without Borders (NWB 2.x) files - the BRAIN Initiative standard for neurophysiology data.

**Key Features:**

- HDF5-based hierarchical data structure
- Reads ElectricalSeries from `/acquisition/`
- Parses electrode tables from `/general/extracellular_ephys/electrodes`
- Handles unit conversion (data \* conversion + offset)
- Supports both explicit timestamps and calculated timing (starting_time + rate)
- Lazy loading for large datasets
- Multiple ElectricalSeries support

**Usage:**

```rust
// Automatic selection of first ElectricalSeries
let reader = NWBFileReader::new(Path::new("recording.nwb"))?;

// Explicit series selection
let reader = NWBFileReader::with_series_name(Path::new("recording.nwb"), Some("ElectricalSeries"))?;

// List available series
let series_list = reader.list_electrical_series()?;
```

**Why Optional:**
NWB requires the HDF5 C library. Some systems (e.g., macOS with Xcode 26+) have HDF5 versions incompatible with `hdf5-sys 0.8.1` (which supports 1.12.x/1.13.x but not 1.14.x).

**Enable NWB Support:**

```bash
cargo build --features nwb-support
```

### XDF Reader

**Location:** `xdf_reader.rs`

**Purpose:** Read Extensible Data Format (XDF) files from Lab Streaming Layer (LSL) recordings.

**Key Features:**

- Multi-stream recordings (EEG, markers, IMU, etc.)
- Binary format with XML stream descriptors
- Irregular sampling rates per stream
- Precise timestamps for synchronization
- Stream selection (auto-selects first EEG-like stream)
- Chunk-based parsing (FileHeader, StreamHeader, Samples, ClockOffset, etc.)

**XDF Format:**

- Magic string: `"XDF:"`
- Chunk structure: `[length:4bytes][tag:2bytes][content]`
- Chunk types: FileHeader(1), StreamHeader(2), Samples(3), ClockOffset(4), Boundary(5), StreamFooter(6)

**Usage:**

```rust
// Auto-select first EEG stream
let reader = XDFFileReader::new(Path::new("recording.xdf"))?;

// List available streams
let streams = reader.list_streams(); // Vec<(stream_id, name, type)>

// Select specific stream
let reader = XDFFileReader::with_stream_id(Path::new("recording.xdf"), stream_id)?;
```

**Always Enabled:**
XDF support is enabled by default as it only requires `quick-xml` (pure Rust, no system dependencies).

## Adding a New File Format

1. **Create Reader File**

   ```rust
   // packages/ddalab-tauri/src-tauri/src/file_readers/my_format_reader.rs
   use super::{FileMetadata, FileReader, FileReaderError, FileResult};
   use std::path::Path;

   pub struct MyFormatReader {
       path: String,
       // ... fields
   }

   impl FileReader for MyFormatReader {
       fn metadata(&self) -> FileResult<FileMetadata> { /* ... */ }
       fn read_chunk(&self, ...) -> FileResult<Vec<Vec<f64>>> { /* ... */ }
       fn read_overview(&self, ...) -> FileResult<Vec<Vec<f64>>> { /* ... */ }
       fn format_name(&self) -> &str { "MyFormat" }
   }
   ```

2. **Register in mod.rs**

   ```rust
   pub mod my_format_reader;
   pub use my_format_reader::MyFormatReader;
   ```

3. **Add to Factory**

   ```rust
   match extension.to_lowercase().as_str() {
       // ...
       "myext" => Ok(Box::new(MyFormatReader::new(path)?)),
       // ...
   }
   ```

4. **Add Extension**

   ```rust
   pub fn supported_extensions() -> Vec<&'static str> {
       vec![/* ... */, "myext"]
   }
   ```

5. **Test**

   ```rust
   #[cfg(test)]
   mod tests {
       use super::*;

       #[test]
       fn test_my_format_reader() {
           let reader = MyFormatReader::new(Path::new("test.myext")).unwrap();
           let metadata = reader.metadata().unwrap();
           assert_eq!(metadata.num_channels, 64);
       }
   }
   ```

## Conversion Pipeline

```
File Format → FileReader → IntermediateData → ASCII/CSV → DDA Analysis
                                           ↓
                                    Direct Visualization
                                           ↓
                                    FileWriter → Export Format
```

**See also:** [File Writers Module](../file_writers/README.md) for exporting IntermediateData to various formats.

### Example: Full Pipeline

```rust
use ddalab_tauri::file_readers::{FileReaderFactory, IntermediateData};
use std::path::Path;

// 1. Create reader
let reader = FileReaderFactory::create_reader(Path::new("data.xdf"))?;

// 2. Get metadata
let metadata = reader.metadata()?;
println!("Format: {}, Channels: {}, Duration: {}s",
    metadata.file_type, metadata.num_channels, metadata.duration);

// 3. Convert to intermediate format
let intermediate = FileReaderFactory::to_intermediate_data(&*reader, None)?;

// 4. Export for DDA
intermediate.to_ascii(Path::new("output.txt"), None)?;

// 5. Or get specific chunk for visualization
let chunk = intermediate.get_chunk(0, 1000, Some(&vec!["Fp1".to_string()]))?;
```

## Performance Considerations

### Lazy Loading

All readers support chunked reading to handle large files:

```rust
// Read only 10 seconds at 256 Hz
let chunk = reader.read_chunk(0, 2560, None)?;
```

### Decimation

For overviews/previews, use downsampling:

```rust
// Get ~1000 points for quick visualization
let overview = reader.read_overview(1000, None)?;
```

### Parallel Processing

Readers use `rayon` for parallel channel processing where applicable:

```rust
let decimated: Vec<Vec<f64>> = full_data
    .into_par_iter()
    .map(|ch| ch.iter().step_by(decimation).copied().collect())
    .collect();
```

## Error Handling

```rust
pub enum FileReaderError {
    IoError(std::io::Error),
    ParseError(String),
    UnsupportedFormat(String),
    InvalidData(String),
    MissingFile(String),
}
```

## Testing

Run tests for specific readers:

```bash
cargo test --package ddalab-tauri file_readers::xdf_reader
cargo test --package ddalab-tauri file_readers::nwb_reader --features nwb-support
```

## Future Enhancements

- [x] Write support for EDF/XDF formats (See [file_writers](../file_writers/README.md))
- [ ] Streaming support for real-time LSL data
- [ ] MEG format support (CTF, BTi, KIT)
- [ ] BIDS metadata extraction
- [ ] Annotation/event marker support across all formats
- [ ] Memory-mapped file reading for 100+ GB files

## References

- **NWB:** https://nwb-schema.readthedocs.io/
- **XDF:** https://github.com/sccn/xdf/wiki/Specifications
- **EDF:** https://www.edfplus.info/specs/edf.html
- **LSL:** https://labstreaminglayer.readthedocs.io/
- **BIDS:** https://bids-specification.readthedocs.io/
