# File Writers Module

This module provides a modular, extensible architecture for writing various neurophysiology file formats from DDALAB's universal IntermediateData format.

## Overview

All file writers implement the `FileWriter` trait and accept the universal `IntermediateData` format, which enables:
- Converting processed data to various standard formats
- Exporting analysis results for use in other tools
- Creating archival copies in different formats
- Round-trip conversion workflows (read → process → write)

## Supported File Formats

### Default (Always Available)

| Format | Extension | Description | Status |\
|--------|-----------|-------------|--------|
| CSV | `.csv` | Comma-separated values | ✅ Implemented |
| ASCII | `.txt`, `.ascii` | Space-separated text for DDA | ✅ Implemented |
| EDF/EDF+ | `.edf` | European Data Format (clinical EEG standard) | ✅ Implemented |
| XDF | `.xdf` | Lab Streaming Layer recordings | ✅ Implemented |

### Optional (Feature Flags)

| Format | Extension | Feature Flag | Dependency | Status |
|--------|-----------|--------------|------------|--------|
| **NWB** | `.nwb` | `nwb-support` | `hdf5 = "0.8"` | ✅ Basic Implementation |

## Architecture

### FileWriter Trait

```rust
pub trait FileWriter: Send + Sync {
    fn write(&self, data: &IntermediateData, output_path: &Path, config: &WriterConfig) -> FileWriterResult<()>;
    fn format_name(&self) -> &str;
    fn default_extension(&self) -> &str;
    fn validate_data(&self, data: &IntermediateData) -> FileWriterResult<()>;
}
```

### WriterConfig

```rust
pub struct WriterConfig {
    pub include_labels: bool,
    pub include_metadata: bool,
    pub precision: usize,
    pub selected_channels: Option<Vec<String>>,
    pub custom_options: std::collections::HashMap<String, String>,
}
```

### FileWriterFactory

The factory pattern automatically selects the appropriate writer based on file extension:

```rust
let writer = FileWriterFactory::create_writer(Path::new("output.edf"))?;
writer.write(&intermediate_data, Path::new("output.edf"), &WriterConfig::default())?;
```

Or use the convenience method:

```rust
FileWriterFactory::write_file(&intermediate_data, Path::new("output.edf"), None)?;
```

## Writer Implementations

### CSV Writer

**Location:** `csv_writer.rs`

**Purpose:** Export data to comma-separated values format for analysis in spreadsheet tools.

**Format:**
- First row: Channel labels
- Subsequent rows: Sample values (one row per time point, one column per channel)
- Precision: Configurable (default 6 decimal places)

**Usage:**
```rust
let writer = CSVWriter::new();
let config = WriterConfig::default();
writer.write(&data, Path::new("output.csv"), &config)?;
```

**Use Cases:**
- Import into MATLAB, Python, R
- Spreadsheet analysis (Excel, Google Sheets)
- Database import

### ASCII Writer

**Location:** `ascii_writer.rs`

**Purpose:** Export data to space-separated ASCII format suitable for DDA analysis.

**Format:**
- Header comments with metadata (# prefix)
- Channel labels as comment
- Space-separated values
- Source file, format, sample rate, duration in comments

**Usage:**
```rust
let writer = ASCIIWriter::new();
let config = WriterConfig::default();
writer.write(&data, Path::new("output.txt"), &config)?;
```

**Use Cases:**
- DDA analysis input
- Text-based analysis tools
- Version control friendly format
- Human-readable data inspection

### EDF Writer

**Location:** `edf_writer.rs`

**Purpose:** Write data to EDF (European Data Format) - the clinical EEG standard.

**Key Features:**
- Full EDF specification compliance
- Automatic calibration (physical ↔ digital value conversion)
- 16-bit integer storage with gain/offset
- Configurable record duration (default 1s)
- Proper header generation with metadata
- Handles date/time conversion

**Technical Details:**
```rust
// EDF structure
Header (256 bytes) → Signal Headers (256 bytes × N channels) → Data Records

// Calibration formula
digital_value = (physical_value - offset) / gain
physical_value = digital_value × gain + offset

// Where:
gain = (physical_max - physical_min) / (digital_max - digital_min)
offset = physical_max - gain × digital_max
```

**Validation:**
- All channels must have equal length
- Sample rate must be positive
- Automatically computes physical min/max with 10% margin

**Usage:**
```rust
let writer = EDFWriter::new();
let config = WriterConfig::default();
writer.write(&data, Path::new("output.edf"), &config)?;
```

**Use Cases:**
- Clinical EEG analysis
- Archival storage
- Sharing data with hospitals/clinics
- Compatibility with commercial EEG software

### XDF Writer

**Location:** `xdf_writer.rs`

**Purpose:** Write data to XDF format for Lab Streaming Layer compatibility.

**Key Features:**
- Binary format with XML stream descriptors
- Multi-stream support (single stream for now)
- Chunk-based structure
- Proper timestamps
- Float32 sample format
- Stream metadata (name, type, channel info)

**XDF Structure:**
- Magic string: `"XDF:"`
- File header chunk (version info)
- Stream header chunk (XML descriptor)
- Multiple sample chunks (default 1000 samples each)
- Stream footer chunk (statistics)

**Usage:**
```rust
let writer = XDFWriter::new();
let config = WriterConfig::default();
writer.write(&data, Path::new("output.xdf"), &config)?;
```

**Use Cases:**
- Lab Streaming Layer integration
- Real-time experiment replay
- Multi-modal data synchronization
- LSL-compatible tool import

### NWB Writer (Optional)

**Location:** `nwb_writer.rs`

**Purpose:** Write data to Neurodata Without Borders format (BRAIN Initiative standard).

**Key Features:**
- HDF5-based hierarchical structure
- NWB 2.5.0 schema compliance (minimal)
- ElectricalSeries creation in `/acquisition/`
- Electrode labels
- Sample rate and timing information
- Conversion and offset attributes

**Limitations:**
- Basic implementation (minimal NWB compliance)
- Single ElectricalSeries
- No electrode table (only labels)
- No trial/event structures
- For full NWB features, use PyNWB

**Enable NWB Support:**
```bash
cargo build --features nwb-support
```

**Why Optional:**
NWB requires the HDF5 C library. Some systems have incompatible HDF5 versions.

**Usage:**
```rust
let writer = NWBWriter::new();
let config = WriterConfig::default();
writer.write(&data, Path::new("output.nwb"), &config)?;
```

**Use Cases:**
- DANDI archive submission
- BRAIN Initiative data sharing
- Neuroscience data standardization
- Integration with NWB ecosystem

## Adding a New File Format Writer

1. **Create Writer File**
   ```rust
   // packages/ddalab-tauri/src-tauri/src/file_writers/my_format_writer.rs
   use super::{FileWriter, FileWriterError, FileWriterResult, WriterConfig};
   use crate::intermediate_format::IntermediateData;
   use std::path::Path;

   pub struct MyFormatWriter;

   impl MyFormatWriter {
       pub fn new() -> Self { Self }
   }

   impl FileWriter for MyFormatWriter {
       fn write(&self, data: &IntermediateData, output_path: &Path, config: &WriterConfig) -> FileWriterResult<()> {
           // Implementation here
       }

       fn format_name(&self) -> &str { "MyFormat" }
       fn default_extension(&self) -> &str { "myext" }
   }
   ```

2. **Register in mod.rs**
   ```rust
   pub mod my_format_writer;
   pub use my_format_writer::MyFormatWriter;
   ```

3. **Add to Factory**
   ```rust
   match extension.to_lowercase().as_str() {
       // ...
       "myext" => Ok(Box::new(MyFormatWriter::new())),
       // ...
   }
   ```

4. **Test**
   ```rust
   #[cfg(test)]
   mod tests {
       use super::*;

       #[test]
       fn test_my_format_writer() {
           let writer = MyFormatWriter::new();
           // Test implementation
       }
   }
   ```

## Conversion Pipeline

```
Analysis Results → IntermediateData → FileWriter → File Format
                                    ↓
                          Direct Format Selection
```

### Example: Full Pipeline

```rust
use ddalab_tauri::file_writers::{FileWriterFactory, WriterConfig};
use ddalab_tauri::file_readers::FileReaderFactory;
use std::path::Path;

// 1. Read data from any supported format
let reader = FileReaderFactory::create_reader(Path::new("input.xdf"))?;
let intermediate = FileReaderFactory::to_intermediate_data(&*reader, None)?;

// 2. Process data (example: channel selection)
let mut config = WriterConfig::default();
config.selected_channels = Some(vec!["Fp1".to_string(), "Fp2".to_string()]);

// 3. Write to different formats
FileWriterFactory::write_file(&intermediate, Path::new("output.edf"), Some(config.clone()))?;
FileWriterFactory::write_file(&intermediate, Path::new("output.csv"), Some(config.clone()))?;
FileWriterFactory::write_file(&intermediate, Path::new("output.xdf"), Some(config.clone()))?;
```

### Round-Trip Example

```rust
// Read EDF → Convert to XDF
let reader = FileReaderFactory::create_reader(Path::new("recording.edf"))?;
let data = FileReaderFactory::to_intermediate_data(&*reader, None)?;

FileWriterFactory::write_file(&data, Path::new("recording.xdf"), None)?;

// Read XDF → Convert to NWB
let reader = FileReaderFactory::create_reader(Path::new("recording.xdf"))?;
let data = FileReaderFactory::to_intermediate_data(&*reader, None)?;

FileWriterFactory::write_file(&data, Path::new("recording.nwb"), None)?;
```

## Performance Considerations

### Large Files

Writers handle large datasets efficiently:

```rust
// Memory efficient: IntermediateData already loaded
// Writers stream data to disk without duplicating in memory
FileWriterFactory::write_file(&data, Path::new("large_output.edf"), None)?;
```

### Parallel Writing

Write to multiple formats in parallel:

```rust
use rayon::prelude::*;

let formats = vec!["edf", "csv", "xdf"];
formats.par_iter().for_each(|ext| {
    let output = format!("output.{}", ext);
    FileWriterFactory::write_file(&data, Path::new(&output), None).unwrap();
});
```

### Chunked Writing

XDF writer uses chunked writes (1000 samples per chunk) to manage memory:

```rust
// XDF automatically chunks large datasets
// No special configuration needed
let writer = XDFWriter::new();
writer.write(&large_data, Path::new("output.xdf"), &config)?;
```

## Error Handling

```rust
pub enum FileWriterError {
    IoError(std::io::Error),
    FormatError(String),
    UnsupportedFormat(String),
    InvalidData(String),
    WriteError(String),
}
```

### Common Errors

```rust
// Unsupported format
match FileWriterFactory::write_file(&data, Path::new("output.xyz"), None) {
    Err(FileWriterError::UnsupportedFormat(msg)) => println!("Format not supported: {}", msg),
    _ => {}
}

// Invalid data for format
match edf_writer.write(&data_with_mismatched_lengths, &path, &config) {
    Err(FileWriterError::InvalidData(msg)) => println!("Data validation failed: {}", msg),
    _ => {}
}
```

## Testing

Run tests for specific writers:
```bash
cargo test --package ddalab-tauri file_writers::csv_writer
cargo test --package ddalab-tauri file_writers::edf_writer
cargo test --package ddalab-tauri file_writers::xdf_writer
cargo test --package ddalab-tauri file_writers::nwb_writer --features nwb-support
```

Run all writer tests:
```bash
cargo test --package ddalab-tauri file_writers
```

## Future Enhancements

- [ ] BrainVision format writer (.vhdr, .vmrk, .eeg)
- [ ] EEGLAB .set format writer
- [ ] MEG format writers (FIF, CTF)
- [ ] BIDS metadata export
- [ ] Annotation/event marker support
- [ ] Streaming write support (write as data arrives)
- [ ] Compression support (gzip for CSV/ASCII)
- [ ] Multi-file format bundling (e.g., BrainVision triplet)
- [ ] Format validation tools
- [ ] Benchmark suite for write performance

## Format Comparison

| Feature | CSV | ASCII | EDF | XDF | NWB |
|---------|-----|-------|-----|-----|-----|
| Human Readable | ✅ | ✅ | ❌ | ❌ | ❌ |
| Metadata Support | ❌ | Limited | ✅ | ✅ | ✅✅ |
| Clinical Standard | ❌ | ❌ | ✅ | ❌ | ❌ |
| Research Standard | ❌ | ❌ | ❌ | ✅ | ✅✅ |
| Compression | ❌ | ❌ | ✅ | ❌ | ✅ |
| Multi-stream | ❌ | ❌ | ❌ | ✅ | ✅ |
| File Size | Large | Large | Medium | Medium | Medium |
| Write Speed | Fast | Fast | Fast | Medium | Slow |
| Tool Support | ✅✅ | Limited | ✅✅ | ✅ | ✅ |

## References

- **EDF Specification:** https://www.edfplus.info/specs/edf.html
- **XDF Specification:** https://github.com/sccn/xdf/wiki/Specifications
- **NWB Schema:** https://nwb-schema.readthedocs.io/
- **LSL Documentation:** https://labstreaminglayer.readthedocs.io/
- **HDF5 Documentation:** https://portal.hdfgroup.org/display/HDF5/HDF5

---

**Last Updated**: 2025-11-15
**Status**: ✅ Full implementation complete
**Tested Formats**: CSV, ASCII, EDF, XDF (NWB basic)
