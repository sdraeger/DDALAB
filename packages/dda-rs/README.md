# dda-rs

Rust library for Delay Differential Analysis (DDA). Provides a type-safe interface to execute the `run_DDA_AsciiEdf` binary and parse its output.

The [DDA binary](https://snl.salk.edu/~sfdraeger/dda/) is required. Please download the most recent version from the file server.

[![Crates.io](https://img.shields.io/crates/v/dda-rs.svg)](https://crates.io/crates/dda-rs)
[![Documentation](https://docs.rs/dda-rs/badge.svg)](https://docs.rs/dda-rs)

## Features

- **Type-safe API**: Strongly-typed request/response structures with serde support
- **Spec-generated variants**: Variant metadata auto-generated from the canonical DDA spec
- **Cross-platform**: Handles APE binary execution on Unix (sh wrapper) and Windows
- **Async execution**: Built on Tokio for non-blocking DDA analysis
- **Binary resolution**: Automatic discovery of the DDA binary via env vars and standard paths
- **Output parsing**: Processes raw DDA output into Q matrices

## Installation

```toml
[dependencies]
dda-rs = "0.1.4"
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
```

## Quick Start

```rust
use dda_rs::{
    DDARunner, DDARequest, WindowParameters, DelayParameters,
    TimeRange, PreprocessingOptions, AlgorithmSelection,
    generate_select_mask, format_select_mask,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Create runner with path to the DDA binary
    let runner = DDARunner::new("/path/to/run_DDA_AsciiEdf")?;

    // Generate SELECT mask for ST and SY variants
    let mask = generate_select_mask(&["ST", "SY"]);
    let mask_str = format_select_mask(&mask); // "1 0 0 0 0 1"

    // Build analysis request
    let request = DDARequest {
        file_path: "/path/to/data.edf".to_string(),
        channels: Some(vec![0, 1, 2]),  // 0-based channel indices
        time_range: TimeRange { start: 0.0, end: 100.0 },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec!["ST".to_string(), "SY".to_string()],
            select_mask: Some(mask_str),
        },
        window_parameters: WindowParameters {
            window_length: 1024,
            window_step: 512,
            ct_window_length: None,  // Required for CT/CD/DE variants
            ct_window_step: None,
        },
        delay_parameters: DelayParameters {
            delays: vec![7, 10],  // Tau values passed to -TAU
        },
        ct_channel_pairs: None,   // For CT variant
        cd_channel_pairs: None,   // For CD variant
        model_parameters: None,   // Expert mode: dm, order, nr_tau
        variant_configs: None,
        sampling_rate: None,      // Set if > 1000 Hz
    };

    // Run analysis with sample bounds
    let result = runner.run(
        &request,
        Some(0),      // start_bound (sample index)
        Some(10000),  // end_bound (sample index)
        None,         // edf_channel_names for labeling
    ).await?;

    println!("Analysis ID: {}", result.id);
    println!("Q matrix: {} channels × {} timepoints",
        result.q_matrix.len(),
        result.q_matrix.first().map(|r| r.len()).unwrap_or(0)
    );

    // Access individual variant results
    if let Some(variants) = &result.variant_results {
        for v in variants {
            println!("{}: {} × {}",
                v.variant_name,
                v.q_matrix.len(),
                v.q_matrix.first().map(|r| r.len()).unwrap_or(0)
            );
        }
    }

    Ok(())
}
```

## Variant Metadata

The crate includes spec-generated variant metadata for all DDA analysis types:

| Variant | Position | Stride | Channel Format | Description |
|---------|----------|--------|----------------|-------------|
| ST | 0 | 4 | Individual | Single Timeseries - analyzes channels independently |
| CT | 1 | 4 | Pairs | Cross-Timeseries - symmetric channel pair relationships |
| CD | 2 | 2 | Directed Pairs | Cross-Dynamical - directed causal relationships |
| RESERVED | 3 | 1 | - | Internal (always 0 in production) |
| DE | 4 | 1 | Individual | Delay Embedding - ergodic behavior testing |
| SY | 5 | 1 | Individual | Synchronization - synchronized behavior detection |

```rust
use dda_rs::{ST, CT, CD, DE, SY, VariantMetadata};

// Access variant metadata
println!("ST stride: {}", ST.stride);           // 4
println!("CT requires: {:?}", CT.required_params); // ["-WL_CT", "-WS_CT"]

// Look up by abbreviation
let variant = VariantMetadata::from_abbrev("ST").unwrap();
println!("{}: {}", variant.name, variant.documentation);
```

## Binary Resolution

The DDA binary is resolved in this order:

1. Explicit path passed to `DDARunner::new()`
2. `$DDA_BINARY_PATH` environment variable
3. `$DDA_HOME/bin/run_DDA_AsciiEdf`
4. Default paths: `~/.local/bin`, `~/bin`, `/usr/local/bin`, `/opt/dda/bin`

```rust
use dda_rs::{find_binary, require_binary};

// Find binary (returns Option)
if let Some(path) = find_binary(None) {
    println!("Found binary at: {}", path.display());
}

// Require binary (returns Result)
let path = require_binary(None)?;
```

## Modules

| Module | Description |
|--------|-------------|
| `variants` | Spec-generated variant metadata, SELECT mask utilities |
| `types` | Request/response structures (`DDARequest`, `DDAResult`) |
| `runner` | DDA binary execution logic |
| `parser` | Output file parsing and Q matrix transformation |
| `error` | Error types (`DDAError`) and `Result` alias |
| `network_motifs` | Network motif analysis utilities |
| `profiling` | Performance profiling helpers |

## License

MIT
