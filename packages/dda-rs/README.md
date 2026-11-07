# dda-rs

Pure Rust Delay Differential Analysis (DDA) engine and the `ddalab` command-line tool. The same crate runs in the browser as WebAssembly in the [DDALAB web application](https://ddalab.org/).

All analysis runs through the Rust engine directly; nothing shells out to a native DDA binary.

## Command-line tool

Install it as a Python tool (the wheel carries the `ddalab` executable only) or download an archive and its `.sha256` file from [GitHub Releases](https://github.com/sdraeger/DDALAB/releases):

```bash
uv tool install ddalab
ddalab inspect --file recording.edf
ddalab run --file recording.edf --variants ST --wl 1000 --ws 200 --delays 7 10 --bundle out
```

It reads EDF, BDF, BrainVision and delimited text. `ddalab --help` lists the other commands (`batch`, `variants`, `validate`, `samples`, `info`, `classify` and `predict` for structure selection and classification, `stream` for Lab Streaming Layer, and `mcp` for AI agents).

## Features

- Pure Rust execution for DDA variants and CCD extensions
- Typed request/response API with `serde`
- One variant table (`VARIANTS`) for every name a variant goes by, and SELECT masks
- Optional acceleration of ST, CT, CD, DE, and SY on any graphics card (`gpu`) or through CUDA (`cuda`)

## Rust library

```toml
[dependencies]
dda-rs = "2.8.0"
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

## Any graphics card

The `gpu` feature runs ST, CT, CD, DE, and SY on any graphics card wgpu reaches: Vulkan (AMD, NVIDIA, Intel), Metal (Apple), and DX12. Select it with `--device gpu`, or `gpu:N` for card `N`:

```bash
cargo run --release --features gpu -- run --file data.csv --channels 0 1 --device gpu
```

Each window uploads every used channel's model terms and derivative once. The GPU computes their dot products exactly in integers, and the CPU assembles and solves each flavor's normal equations in f64. A window with missing samples, and a problem whose sums cannot reproduce the CPU's solution to about 1e-9 (ill-conditioned, near-perfect, or truncated by the CPU's SVD), runs on the CPU, and the result's diagnostics count them.

## CUDA

CPU execution remains the default. CUDA runs in Linux builds; elsewhere the `cuda` feature compiles nothing. Build the optional CUDA backend and select a device with:

```bash
cargo run --release --features cuda -- run --file data.csv --channels 0 1 --device cuda
```

`--device cuda:N` selects device `N`. The CUDA build dynamically loads the NVIDIA driver and cuBLAS. Compilation does not require a local CUDA toolkit; execution requires a working NVIDIA CUDA installation. The implementation batches same-shaped `f64` regressions and computes predictions and residual norms on the GPU. Rank-deficient regressions fall back to the CPU SVD solver. Rust-only CCD extensions continue to use their existing CPU implementations.

Library users pick the device, and may follow progress, with `run_request_on_device`:

```rust
use dda_rs::{run_request_on_device, ComputeDevice};

let result = run_request_on_device(&request, &samples, None, ComputeDevice::Cuda(0), None)?;
```

## Modules

- `engine`: core DDA and CCD execution
- `types`: request/response structures
- `variants`: the variant table and SELECT masks
- `blocks`: block-wise runs and their merge
- `document`: result documents and bundles
- `io`: recording readers and references
- `error`: error types

## License

MIT
