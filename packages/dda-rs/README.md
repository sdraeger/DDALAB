# dda-rs

Rust interface for the `run_DDA_ASCII` binary (Cosmopolitan Libc APE format).

## Overview

This crate provides a clean, type-safe Rust interface to execute the DDA (Delay Differential Analysis) binary and parse its output. It handles all the complexities of:

- Cross-platform APE binary execution (Windows/macOS/Linux)
- Command-line argument construction
- Output file parsing and matrix transformation
- Error handling and logging

## Features

- **Type-safe API**: Strongly-typed request and response structures
- **Cross-platform**: Handles APE binary execution on Unix (sh wrapper) and Windows (direct exe)
- **Async execution**: Built on Tokio for non-blocking DDA analysis
- **Automatic parsing**: Processes raw DDA output into usable matrices
- **Error handling**: Comprehensive error types with descriptive messages

## Usage

```rust
use dda_rs::{DDARunner, DDARequest, WindowParameters, ScaleParameters, TimeRange, PreprocessingOptions, AlgorithmSelection};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Create runner with path to run_DDA_ASCII binary
    let runner = DDARunner::new("/path/to/run_DDA_ASCII")?;

    // Build analysis request
    let request = DDARequest {
        file_path: "/path/to/data.edf".to_string(),
        channels: Some(vec![0, 1]),  // 0-based channel indices
        time_range: TimeRange { start: 0.0, end: 100.0 },
        preprocessing_options: PreprocessingOptions {
            detrending: Some("linear".to_string()),
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec!["standard".to_string()],
        },
        window_parameters: WindowParameters {
            window_length: 1024,
            window_step: 512,
        },
        scale_parameters: ScaleParameters {
            scale_min: 1.0,
            scale_max: 10.0,
            scale_num: 10,
        },
    };

    // Run analysis
    let result = runner.run(&request, 10000).await?;

    // Access results
    println!("Analysis ID: {}", result.id);
    println!("Q matrix shape: {} × {}", result.q_matrix.len(), result.q_matrix[0].len());

    Ok(())
}
```

## Architecture

### Components

- **`types.rs`**: Request/response structures and parameter types
- **`runner.rs`**: DDA binary execution logic
- **`parser.rs`**: Output file parsing and matrix transformation
- **`error.rs`**: Error types and result aliases

### Binary Execution

The crate automatically handles the APE (Actually Portable Executable) format:
- **Unix (macOS/Linux)**: Runs through `sh` wrapper to handle polyglot format
- **Windows**: Executes `.exe` directly

### Output Processing

The parser implements the same transformation as dda-py:
1. Skip first 2 columns
2. Take every 4th column from the remaining data
3. Transpose to get [channels/scales × timepoints] format

## License

MIT
