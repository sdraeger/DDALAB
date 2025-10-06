# Refactoring Guide: Using dda-rs in embedded_api.rs

## Overview

The `dda-rs` crate has been created to provide a clean interface to the `run_DDA_ASCII` binary. This document shows how to refactor `embedded_api.rs` to use it.

## Current vs. New Approach

### Current (embedded_api.rs)
```rust
// Lines 764-1180: All DDA logic mixed into embedded_api.rs
pub async fn run_dda_analysis(
    State(state): State<Arc<ApiState>>,
    Json(request): Json<DDARequest>,
) -> Result<Json<DDAResult>, StatusCode> {
    // 400+ lines of binary execution, parsing, formatting...
}
```

### New (with dda-rs)
```rust
use dda_rs::{DDARunner, DDARequest as DDAReq, DDAResult as DDARes};

pub async fn run_dda_analysis(
    State(state): State<Arc<ApiState>>,
    Json(request): Json<DDARequest>,
) -> Result<Json<DDAResult>, StatusCode> {
    // Create runner
    let runner = DDARunner::new(&dda_binary_path)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Convert request to dda-rs format
    let dda_request = convert_request(&request);

    // Run analysis (handles binary execution and parsing)
    let dda_result = runner.run(&dda_request, end_bound).await
        .map_err(|e| {
            log::error!("DDA analysis failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Convert dda-rs result to API format
    let api_result = format_result_for_api(dda_result, &state, &request);

    // Store and return
    store_result(&state, &api_result);
    Ok(Json(api_result))
}
```

## Migration Steps

### 1. Add dda-rs dependency

Already done in `Cargo.toml`:
```toml
dda-rs = { path = "../../dda-rs" }
```

### 2. Import dda-rs types

```rust
use dda_rs::{
    DDARunner,
    DDARequest as DDAReq,
    DDAResult as DDARes,
    WindowParameters as DDAWindow,
    ScaleParameters as DDAScale,
    TimeRange as DDATimeRange,
    PreprocessingOptions as DDAPreprocessing,
    AlgorithmSelection as DDAAlgorithm,
};
```

### 3. Keep API types in embedded_api.rs

The API-facing types remain in `embedded_api.rs` for compatibility:
- `DDARequest` (API input)
- `DDAResult` (API output with frontend-specific formatting)
- `DDAParameters`

### 4. Create conversion functions

```rust
fn convert_to_dda_request(api_req: &DDARequest) -> DDAReq {
    DDAReq {
        file_path: api_req.file_path.clone(),
        channels: api_req.channels.clone(),
        time_range: DDATimeRange {
            start: api_req.time_range.start,
            end: api_req.time_range.end,
        },
        preprocessing_options: DDAPreprocessing {
            detrending: api_req.preprocessing_options.detrending.clone(),
            highpass: api_req.preprocessing_options.highpass,
            lowpass: api_req.preprocessing_options.lowpass,
        },
        algorithm_selection: DDAAlgorithm {
            enabled_variants: api_req.algorithm_selection.enabled_variants.clone(),
        },
        window_parameters: DDAWindow {
            window_length: api_req.window_parameters.window_length,
            window_step: api_req.window_parameters.window_step,
        },
        scale_parameters: DDAScale {
            scale_min: api_req.scale_parameters.scale_min,
            scale_max: api_req.scale_parameters.scale_max,
            scale_num: api_req.scale_parameters.scale_num,
        },
    }
}

fn format_result_for_api(
    dda_result: DDARes,
    state: &ApiState,
    request: &DDARequest,
) -> DDAResult {
    // Extract Q matrix
    let q_matrix = dda_result.q_matrix;
    let num_channels = q_matrix.len();
    let num_timepoints = q_matrix[0].len();

    // Get channel names from file cache (same logic as current)
    let channel_names = get_channel_names(state, request, num_channels);

    // Format for frontend
    let mut dda_matrix = serde_json::Map::new();
    for (i, channel_name) in channel_names.iter().enumerate() {
        dda_matrix.insert(
            channel_name.clone(),
            serde_json::json!(q_matrix[i])
        );
    }

    // Build frontend-compatible result
    DDAResult {
        id: dda_result.id,
        file_path: dda_result.file_path,
        channels: channel_names,
        parameters: DDAParameters {
            variants: request.algorithm_selection.enabled_variants.clone(),
            window_length: dda_result.window_parameters.window_length,
            window_step: dda_result.window_parameters.window_step,
            detrending: request.preprocessing_options.detrending.clone()
                .unwrap_or_else(|| "linear".to_string()),
            scale_min: dda_result.scale_parameters.scale_min,
            scale_max: dda_result.scale_parameters.scale_max,
            scale_num: dda_result.scale_parameters.scale_num,
        },
        results: format_results_json(&q_matrix, num_timepoints, &dda_matrix),
        plot_data: Some(format_plot_data(&q_matrix, num_timepoints)),
        q_matrix: Some(q_matrix),
        created_at: dda_result.created_at,
        status: "completed".to_string(),
    }
}
```

### 5. Remove from embedded_api.rs

After refactoring, you can remove these functions:
- `parse_dda_output` (now in `dda-rs/parser.rs`)
- Binary execution logic (now in `dda-rs/runner.rs`)
- Lines 906-1040 in current `run_dda_analysis`

## Benefits

1. **Separation of Concerns**: DDA binary interface is isolated
2. **Reusability**: dda-rs can be used in other projects
3. **Testability**: Binary interface can be tested independently
4. **Maintainability**: Smaller, focused modules
5. **Type Safety**: Strong types for DDA operations

## Testing

```rust
#[tokio::test]
async fn test_dda_analysis_with_runner() {
    let runner = DDARunner::new("/path/to/run_DDA_ASCII").unwrap();
    let request = /* build request */;
    let result = runner.run(&request, 10000).await.unwrap();
    assert!(!result.q_matrix.is_empty());
}
```

## Next Steps

1. Implement conversion functions
2. Refactor `run_dda_analysis` to use `DDARunner`
3. Test with existing EDF files
4. Remove old binary execution code
5. Update tests to use dda-rs
