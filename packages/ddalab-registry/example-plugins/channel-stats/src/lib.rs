//! Channel Statistics Plugin
//!
//! A minimal DDALAB plugin that computes per-channel statistics:
//! mean, std, min, max, and kurtosis.
//!
//! Build: cargo build --target wasm32-unknown-unknown --release

use serde::{Deserialize, Serialize};

// ============================================================================
// Host imports
// ============================================================================

extern "C" {
    fn host_log(ptr: *const u8, len: u32);
    fn host_emit_progress(percent: u32);
}

fn log(msg: &str) {
    unsafe { host_log(msg.as_ptr(), msg.len() as u32) };
}

fn emit_progress(pct: u32) {
    unsafe { host_emit_progress(pct) };
}

// ============================================================================
// Guest exports: memory management
// ============================================================================

#[no_mangle]
pub extern "C" fn plugin_malloc(size: u32) -> *mut u8 {
    let layout = std::alloc::Layout::from_size_align(size as usize, 1).unwrap();
    unsafe { std::alloc::alloc(layout) }
}

#[no_mangle]
pub extern "C" fn plugin_free(ptr: *mut u8, size: u32) {
    let layout = std::alloc::Layout::from_size_align(size as usize, 1).unwrap();
    unsafe { std::alloc::dealloc(ptr, layout) };
}

// ============================================================================
// Manifest
// ============================================================================

static MANIFEST: &str = r#"{
    "id": "channel-stats",
    "name": "Channel Statistics",
    "version": "0.1.0",
    "description": "Computes basic statistics (mean, std, min, max, kurtosis) for each channel",
    "author": "DDALAB Team",
    "license": "MIT",
    "permissions": ["ReadChannelData", "WriteResults"],
    "category": "analysis",
    "entryPoint": "plugin.wasm",
    "minDdalabVersion": null
}"#;

/// Return a length-prefixed manifest JSON.
#[no_mangle]
pub extern "C" fn plugin_get_manifest() -> *const u8 {
    let bytes = MANIFEST.as_bytes();
    let len = bytes.len() as u32;

    // Allocate: 4 bytes length prefix + data
    let total = 4 + bytes.len();
    let layout = std::alloc::Layout::from_size_align(total, 1).unwrap();
    let ptr = unsafe { std::alloc::alloc(layout) };

    // Write length prefix (little-endian u32)
    unsafe {
        (ptr as *mut [u8; 4]).write(len.to_le_bytes());
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr.add(4), bytes.len());
    }

    ptr
}

// ============================================================================
// Data types (match IntermediateData from host)
// ============================================================================

#[derive(Deserialize)]
struct IntermediateData {
    metadata: DataMetadata,
    channels: Vec<ChannelData>,
}

#[derive(Deserialize)]
struct DataMetadata {
    #[serde(default)]
    filename: Option<String>,
}

#[derive(Deserialize)]
struct ChannelData {
    label: String,
    #[serde(default)]
    samples: Vec<f64>,
    #[serde(default)]
    sample_rate: f64,
}

// ============================================================================
// Output types
// ============================================================================

#[derive(Serialize)]
struct PluginResult {
    channels: Vec<ChannelStats>,
}

#[derive(Serialize)]
struct ChannelStats {
    label: String,
    count: usize,
    mean: f64,
    std: f64,
    min: f64,
    max: f64,
    kurtosis: f64,
}

// ============================================================================
// Statistics computation
// ============================================================================

fn compute_stats(label: &str, samples: &[f64]) -> ChannelStats {
    let n = samples.len();
    if n == 0 {
        return ChannelStats {
            label: label.to_string(),
            count: 0,
            mean: 0.0,
            std: 0.0,
            min: 0.0,
            max: 0.0,
            kurtosis: 0.0,
        };
    }

    let mean = samples.iter().sum::<f64>() / n as f64;

    let variance = samples.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n as f64;
    let std = variance.sqrt();

    let min = samples.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = samples.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

    // Excess kurtosis
    let kurtosis = if std > 0.0 {
        let m4 = samples.iter().map(|x| ((x - mean) / std).powi(4)).sum::<f64>() / n as f64;
        m4 - 3.0
    } else {
        0.0
    };

    ChannelStats {
        label: label.to_string(),
        count: n,
        mean,
        std,
        min,
        max,
        kurtosis,
    }
}

// ============================================================================
// Plugin entry point
// ============================================================================

/// Main plugin entry point.
/// Receives a pointer to JSON-encoded IntermediateData and its length.
/// Returns a pointer to a length-prefixed JSON result.
#[no_mangle]
pub extern "C" fn plugin_run(input_ptr: *const u8, input_len: u32) -> *const u8 {
    // Read input from host memory
    let input_slice = unsafe { std::slice::from_raw_parts(input_ptr, input_len as usize) };
    let input_str = match std::str::from_utf8(input_slice) {
        Ok(s) => s,
        Err(_) => return std::ptr::null(),
    };

    let data: IntermediateData = match serde_json::from_str(input_str) {
        Ok(d) => d,
        Err(e) => {
            log(&format!("Failed to parse input: {}", e));
            return std::ptr::null();
        }
    };

    log(&format!(
        "Processing {} channels from {}",
        data.channels.len(),
        data.metadata.filename.as_deref().unwrap_or("unknown")
    ));

    emit_progress(10);

    let total = data.channels.len();
    let mut channel_stats = Vec::with_capacity(total);

    for (i, ch) in data.channels.iter().enumerate() {
        channel_stats.push(compute_stats(&ch.label, &ch.samples));
        let pct = 10 + ((i + 1) * 80 / total.max(1));
        emit_progress(pct as u32);
    }

    let result = PluginResult {
        channels: channel_stats,
    };

    let result_json = match serde_json::to_string(&result) {
        Ok(j) => j,
        Err(e) => {
            log(&format!("Failed to serialize result: {}", e));
            return std::ptr::null();
        }
    };

    emit_progress(100);

    // Return length-prefixed result
    let bytes = result_json.as_bytes();
    let len = bytes.len() as u32;
    let total_size = 4 + bytes.len();
    let layout = std::alloc::Layout::from_size_align(total_size, 1).unwrap();
    let ptr = unsafe { std::alloc::alloc(layout) };

    unsafe {
        (ptr as *mut [u8; 4]).write(len.to_le_bytes());
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr.add(4), bytes.len());
    }

    ptr
}
