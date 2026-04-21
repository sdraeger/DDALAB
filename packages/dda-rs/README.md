# dda-rs

Pure Rust Delay Differential Analysis (DDA) engine.

`dda-rs` no longer shells out to the legacy `run_DDA_AsciiEdf` binary. All analysis runs through the Rust engine directly.

## Features

- Pure Rust execution for DDA variants and CCD extensions
- Typed request/response API with `serde`
- Built-in variant metadata and SELECT-mask helpers
- Configurable solver backend:
  - `RobustSvd` for the default numerically stable path
  - `NativeCompatSvd` for the native-compatible SVD path

## Installation

```toml
[dependencies]
dda-rs = "0.2.0"
```

## Quick Start

```rust
use dda_rs::{
    run_request_on_matrix, AlgorithmSelection, DDARequest, DelayParameters, PreprocessingOptions,
    TimeRange, WindowParameters,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let request = DDARequest {
        file_path: "synthetic.csv".to_string(),
        channels: Some(vec![0, 1, 2]),
        time_range: TimeRange {
            start: 0.0,
            end: 511.0,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec!["ST".to_string(), "CD".to_string()],
            select_mask: None,
        },
        window_parameters: WindowParameters {
            window_length: 128,
            window_step: 64,
            ct_window_length: None,
            ct_window_step: None,
        },
        delay_parameters: DelayParameters { delays: vec![1, 2] },
        ct_channel_pairs: None,
        cd_channel_pairs: None,
        model_parameters: None,
        model_terms: None,
        variant_configs: None,
        sampling_rate: None,
    };

    let samples = (0..512)
        .map(|t| {
            let x = t as f64 * 0.03;
            vec![x.sin(), (1.7 * x).cos(), (0.5 * x).sin()]
        })
        .collect::<Vec<_>>();

    let result = run_request_on_matrix(&request, &samples, None)?;
    println!("analysis id: {}", result.id);
    Ok(())
}
```

## Solver Backends

The Rust engine exposes two SVD backends through `PureRustOptions::svd_backend`:

- `SvdBackend::RobustSvd`
  - default
  - uses nalgebra SVD
  - preferred for real analysis
- `SvdBackend::NativeCompatSvd`
  - uses the native-compatible SVD kernel ported into Rust
  - useful when comparing against historical native-binary behavior

## Modules

- `engine`: core DDA and CCD execution
- `types`: request/response structures
- `variants`: variant metadata and SELECT-mask utilities
- `network_motifs`: motif analysis helpers
- `profiling`: profiling helpers
- `error`: error types

## License

MIT
