use wasm_bindgen::prelude::*;
use rustfft::{FftPlanner, num_complex::Complex};
use std::f64::consts::PI;

#[cfg(feature = "console_error_panic_hook")]
pub fn set_panic_hook() {
    console_error_panic_hook::set_once();
}

// ============================================================================
// SIGNAL PROCESSING - Filters
// ============================================================================

/// Apply a highpass filter using a simple IIR Butterworth-style filter
/// cutoff_freq: cutoff frequency in Hz
/// sample_rate: sample rate of the data in Hz
#[wasm_bindgen]
pub fn filter_highpass(data: &[f64], cutoff_freq: f64, sample_rate: f64) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if data.is_empty() || cutoff_freq <= 0.0 || sample_rate <= 0.0 {
        return data.to_vec();
    }

    // First-order IIR highpass coefficients
    let rc = 1.0 / (2.0 * PI * cutoff_freq);
    let dt = 1.0 / sample_rate;
    let a = rc / (rc + dt);

    let mut output = Vec::with_capacity(data.len());
    output.push(data[0]);

    for i in 1..data.len() {
        let y = a * (output[i - 1] + data[i] - data[i - 1]);
        output.push(y);
    }

    output
}

/// Apply a lowpass filter using a simple IIR filter
/// cutoff_freq: cutoff frequency in Hz
/// sample_rate: sample rate of the data in Hz
#[wasm_bindgen]
pub fn filter_lowpass(data: &[f64], cutoff_freq: f64, sample_rate: f64) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if data.is_empty() || cutoff_freq <= 0.0 || sample_rate <= 0.0 {
        return data.to_vec();
    }

    // First-order IIR lowpass
    let rc = 1.0 / (2.0 * PI * cutoff_freq);
    let dt = 1.0 / sample_rate;
    let alpha = dt / (rc + dt);

    let mut output = Vec::with_capacity(data.len());
    output.push(data[0]);

    for i in 1..data.len() {
        let y = output[i - 1] + alpha * (data[i] - output[i - 1]);
        output.push(y);
    }

    output
}

/// Apply a bandpass filter (combination of highpass and lowpass)
/// low_cutoff: lower cutoff frequency in Hz
/// high_cutoff: upper cutoff frequency in Hz
/// sample_rate: sample rate of the data in Hz
#[wasm_bindgen]
pub fn filter_bandpass(data: &[f64], low_cutoff: f64, high_cutoff: f64, sample_rate: f64) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if data.is_empty() {
        return data.to_vec();
    }

    // Apply highpass first, then lowpass
    let highpassed = filter_highpass(data, low_cutoff, sample_rate);
    filter_lowpass(&highpassed, high_cutoff, sample_rate)
}

/// Apply a notch filter to remove specific frequency (e.g., 50Hz or 60Hz line noise)
/// notch_freq: frequency to remove in Hz
/// sample_rate: sample rate of the data in Hz
/// q_factor: quality factor (higher = narrower notch, typically 30-50)
#[wasm_bindgen]
pub fn filter_notch(data: &[f64], notch_freq: f64, sample_rate: f64, q_factor: f64) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if data.is_empty() || notch_freq <= 0.0 || sample_rate <= 0.0 {
        return data.to_vec();
    }

    // Second-order IIR notch filter (biquad)
    let omega = 2.0 * PI * notch_freq / sample_rate;
    let cos_omega = omega.cos();
    let sin_omega = omega.sin();
    let alpha = sin_omega / (2.0 * q_factor);

    // Biquad coefficients for notch filter
    let b0 = 1.0;
    let b1 = -2.0 * cos_omega;
    let b2 = 1.0;
    let a0 = 1.0 + alpha;
    let a1 = -2.0 * cos_omega;
    let a2 = 1.0 - alpha;

    // Normalize coefficients
    let b0 = b0 / a0;
    let b1 = b1 / a0;
    let b2 = b2 / a0;
    let a1 = a1 / a0;
    let a2 = a2 / a0;

    let mut output = Vec::with_capacity(data.len());

    // Initialize with zeros for filter state
    let mut x1 = 0.0;
    let mut x2 = 0.0;
    let mut y1 = 0.0;
    let mut y2 = 0.0;

    for &x in data {
        let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        output.push(y);

        // Update state
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
    }

    output
}

/// Apply multiple notch filters (e.g., 50Hz + harmonics)
/// notch_freqs: array of frequencies to remove
/// sample_rate: sample rate in Hz
#[wasm_bindgen]
pub fn filter_notch_multi(data: &[f64], notch_freqs: &[f64], sample_rate: f64) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let mut result = data.to_vec();
    for &freq in notch_freqs {
        result = filter_notch(&result, freq, sample_rate, 35.0);
    }
    result
}

// ============================================================================
// SIGNAL PROCESSING - FFT
// ============================================================================

/// Compute FFT magnitude spectrum
/// Returns: [freq0_mag, freq1_mag, ...] - only positive frequencies (first half)
/// The returned magnitudes are normalized
#[wasm_bindgen]
pub fn compute_fft_magnitude(data: &[f64]) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if data.is_empty() {
        return vec![];
    }

    // Pad to next power of 2 for efficiency
    let n = data.len().next_power_of_two();

    let mut planner = FftPlanner::<f64>::new();
    let fft = planner.plan_fft_forward(n);

    // Prepare complex input (zero-padded if necessary)
    let mut buffer: Vec<Complex<f64>> = data
        .iter()
        .map(|&x| Complex::new(x, 0.0))
        .collect();
    buffer.resize(n, Complex::new(0.0, 0.0));

    // Apply Hann window to reduce spectral leakage
    for (i, sample) in buffer.iter_mut().enumerate().take(data.len()) {
        let window = 0.5 * (1.0 - (2.0 * PI * i as f64 / (data.len() - 1) as f64).cos());
        sample.re *= window;
    }

    // Compute FFT
    fft.process(&mut buffer);

    // Return magnitude of positive frequencies only (first half)
    let half = n / 2;
    let scale = 2.0 / n as f64;

    buffer[..half]
        .iter()
        .map(|c| c.norm() * scale)
        .collect()
}

/// Compute power spectral density (PSD)
/// Returns: [psd0, psd1, ...] - power at each frequency bin
#[wasm_bindgen]
pub fn compute_psd(data: &[f64], sample_rate: f64) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let magnitudes = compute_fft_magnitude(data);
    let n = data.len().next_power_of_two();
    let freq_resolution = sample_rate / n as f64;

    // Convert magnitude to power spectral density
    magnitudes
        .iter()
        .map(|&mag| mag * mag / freq_resolution)
        .collect()
}

/// Get frequency bins for FFT result
/// Returns: [freq0, freq1, ...] in Hz
#[wasm_bindgen]
pub fn get_fft_frequencies(data_length: usize, sample_rate: f64) -> Vec<f64> {
    let n = data_length.next_power_of_two();
    let half = n / 2;
    let freq_resolution = sample_rate / n as f64;

    (0..half)
        .map(|i| i as f64 * freq_resolution)
        .collect()
}

// ============================================================================
// SIGNAL PROCESSING - Normalization
// ============================================================================

/// Z-score normalize data (subtract mean, divide by std)
#[wasm_bindgen]
pub fn zscore_normalize(data: &[f64]) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if data.is_empty() {
        return vec![];
    }

    let stats = compute_channel_stats(data);

    if stats.std < 1e-10 {
        // If std is essentially zero, return zeros
        return vec![0.0; data.len()];
    }

    data.iter()
        .map(|&x| (x - stats.mean) / stats.std)
        .collect()
}

/// Z-score normalize multiple channels
/// Returns flattened array with same layout as input
#[wasm_bindgen]
pub fn zscore_normalize_channels(
    data: &[f64],
    num_channels: usize,
    points_per_channel: usize,
) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if num_channels == 0 || points_per_channel == 0 {
        return vec![];
    }

    let mut result = Vec::with_capacity(data.len());

    for ch in 0..num_channels {
        let start = ch * points_per_channel;
        let end = start + points_per_channel;
        if end <= data.len() {
            let normalized = zscore_normalize(&data[start..end]);
            result.extend(normalized);
        }
    }

    result
}

// ============================================================================
// STATISTICAL COMPUTATIONS
// ============================================================================

/// Compute percentile value from sorted data
fn percentile_sorted(sorted_data: &[f64], percentile: f64) -> f64 {
    if sorted_data.is_empty() {
        return 0.0;
    }

    let idx = (percentile / 100.0 * (sorted_data.len() - 1) as f64).round() as usize;
    sorted_data[idx.min(sorted_data.len() - 1)]
}

/// Compute multiple percentiles for a channel
/// percentiles: array of percentile values (0-100)
/// Returns: array of values at each percentile
#[wasm_bindgen]
pub fn compute_percentiles(data: &[f64], percentiles: &[f64]) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if data.is_empty() || percentiles.is_empty() {
        return vec![];
    }

    // Sort data (filter out NaN/Inf)
    let mut sorted: Vec<f64> = data.iter()
        .copied()
        .filter(|x| x.is_finite())
        .collect();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    if sorted.is_empty() {
        return vec![0.0; percentiles.len()];
    }

    percentiles
        .iter()
        .map(|&p| percentile_sorted(&sorted, p.clamp(0.0, 100.0)))
        .collect()
}

/// Compute IQR (interquartile range) for auto-scaling
/// Returns: [q1, median, q3, iqr]
#[wasm_bindgen]
pub fn compute_iqr(data: &[f64]) -> Vec<f64> {
    let quartiles = compute_percentiles(data, &[25.0, 50.0, 75.0]);
    if quartiles.len() < 3 {
        return vec![0.0, 0.0, 0.0, 0.0];
    }
    let iqr = quartiles[2] - quartiles[0];
    vec![quartiles[0], quartiles[1], quartiles[2], iqr]
}

/// Detect artifacts using threshold-based detection
/// Returns indices of artifact samples
/// threshold_std: number of standard deviations from mean to consider artifact
#[wasm_bindgen]
pub fn detect_artifacts(data: &[f64], threshold_std: f64) -> Vec<u32> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if data.is_empty() {
        return vec![];
    }

    let stats = compute_channel_stats(data);
    let threshold = stats.std * threshold_std;

    let mut artifacts = Vec::new();
    for (i, &value) in data.iter().enumerate() {
        if (value - stats.mean).abs() > threshold {
            artifacts.push(i as u32);
        }
    }

    artifacts
}

/// Detect artifacts with gradient-based detection (sudden jumps)
/// Returns indices where gradient exceeds threshold
#[wasm_bindgen]
pub fn detect_artifacts_gradient(data: &[f64], threshold: f64) -> Vec<u32> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if data.len() < 2 {
        return vec![];
    }

    let mut artifacts = Vec::new();
    for i in 1..data.len() {
        let gradient = (data[i] - data[i - 1]).abs();
        if gradient > threshold {
            artifacts.push(i as u32);
        }
    }

    artifacts
}

// ============================================================================
// MATRIX OPERATIONS
// ============================================================================

/// Transform 2D matrix data for heatmap visualization
/// Applies min-max normalization to [0, 1] range
/// data: flattened row-major matrix
/// rows, cols: matrix dimensions
#[wasm_bindgen]
pub fn normalize_heatmap(data: &[f64], rows: usize, cols: usize) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if data.is_empty() || rows == 0 || cols == 0 {
        return vec![];
    }

    // Find min and max (ignoring NaN/Inf)
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;

    for &val in data {
        if val.is_finite() {
            min = min.min(val);
            max = max.max(val);
        }
    }

    let range = max - min;
    if range < 1e-10 {
        return vec![0.5; data.len()];
    }

    data.iter()
        .map(|&val| {
            if val.is_finite() {
                (val - min) / range
            } else {
                0.0
            }
        })
        .collect()
}

/// Apply colormap to normalized [0, 1] data
/// Returns: [r0, g0, b0, r1, g1, b1, ...] values in 0-255 range
/// colormap: 0 = viridis, 1 = plasma, 2 = inferno, 3 = magma, 4 = coolwarm
#[wasm_bindgen]
pub fn apply_colormap(data: &[f64], colormap: u8) -> Vec<u8> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let mut result = Vec::with_capacity(data.len() * 3);

    for &val in data {
        let t = val.clamp(0.0, 1.0);
        let (r, g, b) = match colormap {
            0 => colormap_viridis(t),
            1 => colormap_plasma(t),
            2 => colormap_inferno(t),
            3 => colormap_magma(t),
            4 => colormap_coolwarm(t),
            _ => colormap_viridis(t),
        };
        result.push(r);
        result.push(g);
        result.push(b);
    }

    result
}

// Colormap implementations (simplified approximations)
fn colormap_viridis(t: f64) -> (u8, u8, u8) {
    let r = (0.267 + t * (0.329 + t * (1.452 - t * 1.046))).clamp(0.0, 1.0);
    let g = t.powf(0.5);
    let b = (0.329 + t * (1.452 - t * 1.781)).clamp(0.0, 1.0);
    ((r * 255.0) as u8, (g * 255.0) as u8, (b * 255.0) as u8)
}

fn colormap_plasma(t: f64) -> (u8, u8, u8) {
    let r = (0.050 + t * 2.5).min(1.0);
    let g = (t * t * 0.8).min(1.0);
    let b = (0.533 - t * 0.533 + t * t * 0.5).clamp(0.0, 1.0);
    ((r * 255.0) as u8, (g * 255.0) as u8, (b * 255.0) as u8)
}

fn colormap_inferno(t: f64) -> (u8, u8, u8) {
    let r = (t * 2.0).min(1.0);
    let g = (t * t * 1.5).min(1.0);
    let b = (0.2 + t * 0.6 - t * t * 0.8).clamp(0.0, 1.0);
    ((r * 255.0) as u8, (g * 255.0) as u8, (b * 255.0) as u8)
}

fn colormap_magma(t: f64) -> (u8, u8, u8) {
    let r = (t * 1.8).min(1.0);
    let g = (t * t * 1.2).min(1.0);
    let b = (0.4 + t * 0.6).min(1.0);
    ((r * 255.0) as u8, (g * 255.0) as u8, (b * 255.0) as u8)
}

fn colormap_coolwarm(t: f64) -> (u8, u8, u8) {
    // Blue to white to red
    let r = if t < 0.5 { t * 2.0 } else { 1.0 };
    let g = if t < 0.5 { t * 2.0 } else { 2.0 - t * 2.0 };
    let b = if t < 0.5 { 1.0 } else { 2.0 - t * 2.0 };
    ((r * 255.0) as u8, (g.max(0.0) * 255.0) as u8, (b.max(0.0) * 255.0) as u8)
}

/// Compute correlation matrix for multiple channels
/// Returns flattened correlation matrix (symmetric)
#[wasm_bindgen]
pub fn compute_correlation_matrix(
    data: &[f64],
    num_channels: usize,
    points_per_channel: usize,
) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if num_channels == 0 || points_per_channel == 0 {
        return vec![];
    }

    // Compute means and stds for each channel
    let mut means = Vec::with_capacity(num_channels);
    let mut stds = Vec::with_capacity(num_channels);

    for ch in 0..num_channels {
        let start = ch * points_per_channel;
        let end = start + points_per_channel;
        let stats = compute_channel_stats(&data[start..end]);
        means.push(stats.mean);
        stds.push(stats.std);
    }

    // Compute correlation matrix
    let mut corr = vec![0.0; num_channels * num_channels];

    for i in 0..num_channels {
        for j in i..num_channels {
            if i == j {
                corr[i * num_channels + j] = 1.0;
            } else {
                // Compute Pearson correlation
                let mut sum = 0.0;
                let start_i = i * points_per_channel;
                let start_j = j * points_per_channel;

                for k in 0..points_per_channel {
                    let xi = data[start_i + k] - means[i];
                    let xj = data[start_j + k] - means[j];
                    sum += xi * xj;
                }

                let r = if stds[i] > 1e-10 && stds[j] > 1e-10 {
                    sum / ((points_per_channel - 1) as f64 * stds[i] * stds[j])
                } else {
                    0.0
                };

                corr[i * num_channels + j] = r;
                corr[j * num_channels + i] = r; // Symmetric
            }
        }
    }

    corr
}

// ============================================================================
// DATA COMPRESSION
// ============================================================================

/// Decompress LZ4-compressed data
/// Returns decompressed bytes
#[wasm_bindgen]
pub fn decompress_lz4(compressed: &[u8]) -> Vec<u8> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    lz4_flex::decompress_size_prepended(compressed).unwrap_or_default()
}

/// Compress data with LZ4
/// Returns compressed bytes with prepended size
#[wasm_bindgen]
pub fn compress_lz4(data: &[u8]) -> Vec<u8> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    lz4_flex::compress_prepend_size(data)
}

/// Parse binary f64 array from bytes (little-endian)
#[wasm_bindgen]
pub fn parse_f64_array(bytes: &[u8]) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let num_floats = bytes.len() / 8;
    let mut result = Vec::with_capacity(num_floats);

    for i in 0..num_floats {
        let offset = i * 8;
        if offset + 8 <= bytes.len() {
            let arr: [u8; 8] = bytes[offset..offset + 8].try_into().unwrap();
            result.push(f64::from_le_bytes(arr));
        }
    }

    result
}

/// Parse binary f32 array from bytes (little-endian) and convert to f64
#[wasm_bindgen]
pub fn parse_f32_array(bytes: &[u8]) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let num_floats = bytes.len() / 4;
    let mut result = Vec::with_capacity(num_floats);

    for i in 0..num_floats {
        let offset = i * 4;
        if offset + 4 <= bytes.len() {
            let arr: [u8; 4] = bytes[offset..offset + 4].try_into().unwrap();
            result.push(f32::from_le_bytes(arr) as f64);
        }
    }

    result
}

/// Statistics result for a channel
#[wasm_bindgen]
pub struct ChannelStats {
    pub min: f64,
    pub max: f64,
    pub mean: f64,
    pub std: f64,
    pub count: u32,
}

#[wasm_bindgen]
impl ChannelStats {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            min: f64::INFINITY,
            max: f64::NEG_INFINITY,
            mean: 0.0,
            std: 0.0,
            count: 0,
        }
    }
}

impl Default for ChannelStats {
    fn default() -> Self {
        Self::new()
    }
}

/// Compute channel statistics (min, max, mean, std) in a single pass
/// Uses Welford's online algorithm for numerically stable variance
#[wasm_bindgen]
pub fn compute_channel_stats(data: &[f64]) -> ChannelStats {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if data.is_empty() {
        return ChannelStats::new();
    }

    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    let mut mean = 0.0;
    let mut m2 = 0.0; // Sum of squares of differences from the current mean
    let mut count = 0u32;

    for &value in data {
        if !value.is_finite() {
            continue;
        }

        count += 1;
        min = min.min(value);
        max = max.max(value);

        // Welford's online algorithm
        let delta = value - mean;
        mean += delta / count as f64;
        let delta2 = value - mean;
        m2 += delta * delta2;
    }

    let variance = if count > 1 {
        m2 / (count - 1) as f64
    } else {
        0.0
    };

    ChannelStats {
        min,
        max,
        mean,
        std: variance.sqrt(),
        count,
    }
}

/// LTTB (Largest Triangle Three Buckets) downsampling algorithm
/// Preserves visual shape of the data while reducing point count
///
/// Reference: Sveinn Steinarsson's thesis
/// "Downsampling Time Series for Visual Representation"
#[wasm_bindgen]
pub fn decimate_lttb(data: &[f64], target_points: usize) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let len = data.len();

    // If target is >= data length or data is very small, return as-is
    if target_points >= len || len <= 2 {
        return data.to_vec();
    }

    // Edge case: if target is too small, at least return first and last
    if target_points < 2 {
        if len > 0 {
            return vec![data[0], data[len - 1]];
        }
        return vec![];
    }

    let mut result = Vec::with_capacity(target_points);

    // Always include first point
    result.push(data[0]);

    // Bucket size (excluding first and last points)
    let bucket_size = (len - 2) as f64 / (target_points - 2) as f64;

    let mut a_index = 0usize; // Index of the previously selected point

    for i in 0..(target_points - 2) {
        // Calculate bucket boundaries
        let bucket_start = ((i as f64 * bucket_size) + 1.0).floor() as usize;
        let bucket_end = (((i + 1) as f64 * bucket_size) + 1.0).floor() as usize;
        let bucket_end = bucket_end.min(len - 1);

        // Calculate average point for the next bucket (for triangle area calculation)
        let next_bucket_start = bucket_end;
        let next_bucket_end = (((i + 2) as f64 * bucket_size) + 1.0).floor() as usize;
        let next_bucket_end = next_bucket_end.min(len);

        let (avg_x, avg_y) = if next_bucket_start < next_bucket_end {
            let sum_x: f64 = (next_bucket_start..next_bucket_end)
                .map(|j| j as f64)
                .sum();
            let sum_y: f64 = data[next_bucket_start..next_bucket_end].iter().sum();
            let count = (next_bucket_end - next_bucket_start) as f64;
            (sum_x / count, sum_y / count)
        } else {
            // Fallback for edge cases
            ((len - 1) as f64, data[len - 1])
        };

        // Find the point in current bucket with maximum triangle area
        let mut max_area = -1.0f64;
        let mut max_area_index = bucket_start;

        let point_a_x = a_index as f64;
        let point_a_y = data[a_index];

        for j in bucket_start..bucket_end {
            // Calculate triangle area using the shoelace formula
            // Area = 0.5 * |x_a(y_b - y_c) + x_b(y_c - y_a) + x_c(y_a - y_b)|
            let area = ((point_a_x - avg_x) * (data[j] - point_a_y)
                - (point_a_x - j as f64) * (avg_y - point_a_y))
                .abs();

            if area > max_area {
                max_area = area;
                max_area_index = j;
            }
        }

        result.push(data[max_area_index]);
        a_index = max_area_index;
    }

    // Always include last point
    result.push(data[len - 1]);

    result
}

/// Min-Max decimation - preserves peaks and troughs
/// Returns pairs of [min, max] for each bucket
/// This is the algorithm used by the Rust backend for overview generation
#[wasm_bindgen]
pub fn decimate_minmax(data: &[f64], target_buckets: usize) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let len = data.len();

    if len == 0 || target_buckets == 0 {
        return vec![];
    }

    // If data fits in target, return as-is
    if len <= target_buckets * 2 {
        return data.to_vec();
    }

    let bucket_size = len / target_buckets;
    let bucket_size = bucket_size.max(1);

    let mut result = Vec::with_capacity(target_buckets * 2);

    for bucket_idx in 0..target_buckets {
        let start = bucket_idx * bucket_size;
        let end = ((bucket_idx + 1) * bucket_size).min(len);

        if start >= end {
            break;
        }

        let bucket = &data[start..end];

        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;
        let mut min_idx = 0;
        let mut max_idx = 0;

        for (i, &val) in bucket.iter().enumerate() {
            if val < min {
                min = val;
                min_idx = i;
            }
            if val > max {
                max = val;
                max_idx = i;
            }
        }

        // Add min and max in order of their appearance
        if min_idx <= max_idx {
            result.push(min);
            result.push(max);
        } else {
            result.push(max);
            result.push(min);
        }
    }

    result
}

/// Simple average decimation - fastest but loses detail
/// Good for very large datasets where performance matters more than precision
#[wasm_bindgen]
pub fn decimate_average(data: &[f64], target_points: usize) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let len = data.len();

    if len == 0 || target_points == 0 {
        return vec![];
    }

    if len <= target_points {
        return data.to_vec();
    }

    let bucket_size = len / target_points;
    let bucket_size = bucket_size.max(1);

    let mut result = Vec::with_capacity(target_points);

    for bucket_idx in 0..target_points {
        let start = bucket_idx * bucket_size;
        let end = if bucket_idx == target_points - 1 {
            len // Last bucket gets remaining points
        } else {
            ((bucket_idx + 1) * bucket_size).min(len)
        };

        if start >= end {
            break;
        }

        let sum: f64 = data[start..end].iter().sum();
        let count = (end - start) as f64;
        result.push(sum / count);
    }

    result
}

/// Decimate multiple channels at once (batch operation)
/// Returns flattened array: [ch0_point0, ch0_point1, ..., ch1_point0, ...]
/// Each channel is decimated to target_points using LTTB
#[wasm_bindgen]
pub fn decimate_channels_lttb(
    data: &[f64],
    num_channels: usize,
    points_per_channel: usize,
    target_points: usize,
) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if num_channels == 0 || points_per_channel == 0 {
        return vec![];
    }

    let expected_len = num_channels * points_per_channel;
    if data.len() < expected_len {
        return vec![];
    }

    let mut result = Vec::with_capacity(num_channels * target_points);

    for ch in 0..num_channels {
        let start = ch * points_per_channel;
        let end = start + points_per_channel;
        let channel_data = &data[start..end];

        let decimated = decimate_lttb(channel_data, target_points);
        result.extend(decimated);
    }

    result
}

/// Compute statistics for multiple channels at once
/// Returns flattened stats: [min0, max0, mean0, std0, min1, max1, mean1, std1, ...]
#[wasm_bindgen]
pub fn compute_multi_channel_stats(
    data: &[f64],
    num_channels: usize,
    points_per_channel: usize,
) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if num_channels == 0 || points_per_channel == 0 {
        return vec![];
    }

    let expected_len = num_channels * points_per_channel;
    if data.len() < expected_len {
        return vec![];
    }

    let mut result = Vec::with_capacity(num_channels * 4);

    for ch in 0..num_channels {
        let start = ch * points_per_channel;
        let end = start + points_per_channel;
        let stats = compute_channel_stats(&data[start..end]);
        result.push(stats.min);
        result.push(stats.max);
        result.push(stats.mean);
        result.push(stats.std);
    }

    result
}

// ============================================================================
// FUZZY SEARCH - String Matching
// ============================================================================

/// Calculate Levenshtein distance between two strings
/// Returns the minimum number of single-character edits needed
#[wasm_bindgen]
pub fn levenshtein_distance(a: &str, b: &str) -> u32 {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    // Early optimization: if length difference is too large, return early
    let len_diff = (a.len() as i32 - b.len() as i32).unsigned_abs();
    if len_diff > 3 {
        return 999;
    }

    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    let a_len = a_chars.len();
    let b_len = b_chars.len();

    if a_len == 0 {
        return b_len as u32;
    }
    if b_len == 0 {
        return a_len as u32;
    }

    // Use two rows instead of full matrix for O(n) space
    let mut prev_row: Vec<u32> = (0..=a_len as u32).collect();
    let mut curr_row: Vec<u32> = vec![0; a_len + 1];

    for (i, b_char) in b_chars.iter().enumerate() {
        curr_row[0] = (i + 1) as u32;

        for (j, a_char) in a_chars.iter().enumerate() {
            let cost = if a_char == b_char { 0 } else { 1 };

            curr_row[j + 1] = (prev_row[j + 1] + 1) // deletion
                .min(curr_row[j] + 1) // insertion
                .min(prev_row[j] + cost); // substitution
        }

        std::mem::swap(&mut prev_row, &mut curr_row);
    }

    prev_row[a_len]
}

/// Generate trigrams from a string and return as a flat array of char codes
/// Each trigram is 3 consecutive characters, returned as indices into the string
/// Returns: flattened trigram data [char0, char1, char2, char0, char1, char2, ...]
#[wasm_bindgen]
pub fn generate_trigrams(text: &str) -> Vec<u32> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let normalized: String = text.to_lowercase();
    let padded = format!("  {}  ", normalized);
    let chars: Vec<char> = padded.chars().collect();

    if chars.len() < 3 {
        return vec![];
    }

    let mut result = Vec::with_capacity((chars.len() - 2) * 3);

    for i in 0..(chars.len() - 2) {
        result.push(chars[i] as u32);
        result.push(chars[i + 1] as u32);
        result.push(chars[i + 2] as u32);
    }

    result
}

/// Calculate trigram similarity between two strings using Sørensen-Dice coefficient
/// Returns 0.0 to 1.0, where 1.0 is identical
#[wasm_bindgen]
pub fn trigram_similarity(a: &str, b: &str) -> f64 {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    use std::collections::HashSet;

    let normalized_a: String = a.to_lowercase();
    let normalized_b: String = b.to_lowercase();

    let padded_a = format!("  {}  ", normalized_a);
    let padded_b = format!("  {}  ", normalized_b);

    let chars_a: Vec<char> = padded_a.chars().collect();
    let chars_b: Vec<char> = padded_b.chars().collect();

    if chars_a.len() < 3 || chars_b.len() < 3 {
        return 0.0;
    }

    // Generate trigram sets
    let mut trigrams_a: HashSet<(char, char, char)> = HashSet::new();
    for i in 0..(chars_a.len() - 2) {
        trigrams_a.insert((chars_a[i], chars_a[i + 1], chars_a[i + 2]));
    }

    let mut trigrams_b: HashSet<(char, char, char)> = HashSet::new();
    for i in 0..(chars_b.len() - 2) {
        trigrams_b.insert((chars_b[i], chars_b[i + 1], chars_b[i + 2]));
    }

    if trigrams_a.is_empty() || trigrams_b.is_empty() {
        return 0.0;
    }

    // Calculate intersection
    let intersection_size = trigrams_a.intersection(&trigrams_b).count();

    // Sørensen-Dice coefficient
    (2.0 * intersection_size as f64) / (trigrams_a.len() + trigrams_b.len()) as f64
}

/// Batch Levenshtein distance calculation
/// query: the search query
/// targets: array of target strings joined by null character ('\0')
/// Returns: array of distances for each target
#[wasm_bindgen]
pub fn levenshtein_batch(query: &str, targets: &str) -> Vec<u32> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let query_lower = query.to_lowercase();

    targets
        .split('\0')
        .map(|target| {
            let target_lower = target.to_lowercase();
            levenshtein_distance(&query_lower, &target_lower)
        })
        .collect()
}

/// Batch trigram similarity calculation
/// query: the search query
/// targets: array of target strings joined by null character ('\0')
/// Returns: array of similarities (0.0-1.0) for each target
#[wasm_bindgen]
pub fn trigram_similarity_batch(query: &str, targets: &str) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    targets
        .split('\0')
        .map(|target| trigram_similarity(query, target))
        .collect()
}

// ============================================================================
// PREPROCESSING - Signal Smoothing
// ============================================================================

/// Moving average smoothing filter
/// window_size: number of samples in the moving window (should be odd for symmetric window)
#[wasm_bindgen]
pub fn moving_average(data: &[f64], window_size: usize) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if data.is_empty() || window_size == 0 {
        return data.to_vec();
    }

    let window_size = window_size.max(1);
    let half_window = window_size / 2;
    let len = data.len();
    let mut result = Vec::with_capacity(len);

    for i in 0..len {
        let start = i.saturating_sub(half_window);
        let end = (i + half_window + 1).min(len);
        let count = end - start;

        let sum: f64 = data[start..end].iter().sum();
        result.push(sum / count as f64);
    }

    result
}

/// Savitzky-Golay filter coefficients for common configurations
/// Returns normalized coefficients for the given window size and polynomial order
fn get_savitzky_golay_coefficients(window_size: usize, poly_order: usize) -> Vec<f64> {
    // Pre-computed coefficients for common configurations
    match (window_size, poly_order) {
        (5, 2) => vec![-3.0, 12.0, 17.0, 12.0, -3.0],
        (7, 2) => vec![-2.0, 3.0, 6.0, 7.0, 6.0, 3.0, -2.0],
        (9, 2) => vec![-21.0, 14.0, 39.0, 54.0, 59.0, 54.0, 39.0, 14.0, -21.0],
        (11, 2) => vec![-36.0, 9.0, 44.0, 69.0, 84.0, 89.0, 84.0, 69.0, 44.0, 9.0, -36.0],
        (5, 4) | (7, 4) => vec![5.0, -30.0, 75.0, 131.0, 75.0, -30.0, 5.0],
        (9, 4) => vec![15.0, -55.0, 30.0, 135.0, 179.0, 135.0, 30.0, -55.0, 15.0],
        _ => {
            // Fallback: uniform weights (moving average)
            vec![1.0; window_size]
        }
    }
}

/// Savitzky-Golay smoothing filter (polynomial smoothing)
/// Preserves features better than simple moving average
/// window_size: should be odd (will be adjusted if even)
/// poly_order: polynomial order (typically 2 for quadratic or 4 for quartic)
#[wasm_bindgen]
pub fn savitzky_golay(data: &[f64], window_size: usize, poly_order: usize) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if data.is_empty() || window_size == 0 {
        return data.to_vec();
    }

    // Ensure window size is odd
    let window_size = if window_size % 2 == 0 {
        window_size + 1
    } else {
        window_size
    };

    // Clamp polynomial order
    let poly_order = poly_order.min(window_size - 1);

    let half_window = window_size / 2;
    let coefficients = get_savitzky_golay_coefficients(window_size, poly_order);

    // Normalize coefficients
    let coef_sum: f64 = coefficients.iter().sum();
    let normalized: Vec<f64> = if coef_sum.abs() > 1e-10 {
        coefficients.iter().map(|c| c / coef_sum).collect()
    } else {
        vec![1.0 / window_size as f64; window_size]
    };

    let len = data.len();
    let mut result = Vec::with_capacity(len);

    for i in 0..len {
        let mut sum = 0.0;
        let mut weight_sum = 0.0;

        for (j, &coef) in normalized.iter().enumerate() {
            let idx = i as i64 + j as i64 - half_window as i64;
            if idx >= 0 && idx < len as i64 {
                sum += data[idx as usize] * coef;
                weight_sum += coef;
            }
        }

        // Normalize if near boundaries
        result.push(if weight_sum.abs() > 1e-10 {
            sum / weight_sum
        } else {
            data[i]
        });
    }

    result
}

/// Remove outliers using z-score threshold
/// method: 0 = clip, 1 = replace with NaN, 2 = interpolate
/// threshold: number of standard deviations to consider as outlier
#[wasm_bindgen]
pub fn remove_outliers(data: &[f64], method: u32, threshold: f64) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if data.is_empty() || threshold <= 0.0 {
        return data.to_vec();
    }

    let len = data.len();

    // Calculate mean and standard deviation
    let mean: f64 = data.iter().sum::<f64>() / len as f64;
    let variance: f64 = data.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / len as f64;
    let std_dev = variance.sqrt();

    if std_dev < 1e-10 {
        return data.to_vec();
    }

    let lower_bound = mean - threshold * std_dev;
    let upper_bound = mean + threshold * std_dev;

    match method {
        0 => {
            // Clip: clamp values to bounds
            data.iter()
                .map(|&v| v.clamp(lower_bound, upper_bound))
                .collect()
        }
        1 => {
            // Replace with NaN
            data.iter()
                .map(|&v| {
                    if v < lower_bound || v > upper_bound {
                        f64::NAN
                    } else {
                        v
                    }
                })
                .collect()
        }
        _ => {
            // Interpolate: replace outliers with linear interpolation
            let mut result = data.to_vec();

            for i in 0..len {
                if result[i] < lower_bound || result[i] > upper_bound {
                    // Find previous valid point
                    let mut prev = i as i64 - 1;
                    while prev >= 0
                        && (result[prev as usize] < lower_bound
                            || result[prev as usize] > upper_bound)
                    {
                        prev -= 1;
                    }

                    // Find next valid point
                    let mut next = i + 1;
                    while next < len
                        && (result[next] < lower_bound || result[next] > upper_bound)
                    {
                        next += 1;
                    }

                    // Interpolate
                    if prev >= 0 && next < len {
                        let alpha = (i - prev as usize) as f64 / (next - prev as usize) as f64;
                        result[i] =
                            result[prev as usize] + alpha * (result[next] - result[prev as usize]);
                    } else if prev >= 0 {
                        result[i] = result[prev as usize];
                    } else if next < len {
                        result[i] = result[next];
                    }
                }
            }

            result
        }
    }
}

/// Batch preprocessing: apply moving average to multiple channels
/// data: flattened channel data [ch0_pt0, ch0_pt1, ..., ch1_pt0, ...]
/// num_channels: number of channels
/// points_per_channel: samples per channel
/// window_size: moving average window size
#[wasm_bindgen]
pub fn moving_average_channels(
    data: &[f64],
    num_channels: usize,
    points_per_channel: usize,
    window_size: usize,
) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if num_channels == 0 || points_per_channel == 0 {
        return vec![];
    }

    let expected_len = num_channels * points_per_channel;
    if data.len() < expected_len {
        return vec![];
    }

    let mut result = Vec::with_capacity(expected_len);

    for ch in 0..num_channels {
        let start = ch * points_per_channel;
        let end = start + points_per_channel;
        let smoothed = moving_average(&data[start..end], window_size);
        result.extend(smoothed);
    }

    result
}

// ============================================================================
// HEATMAP OPTIMIZATION - Batch Statistics for DDA Results
// ============================================================================

/// Batch statistics result for heatmap rendering
#[wasm_bindgen]
pub struct HeatmapStats {
    pub min: f64,
    pub max: f64,
    pub mean: f64,
    pub std: f64,
    pub count: u32,
    /// Mean - 3*std (for auto-scaling)
    pub scale_min: f64,
    /// Mean + 3*std (for auto-scaling)
    pub scale_max: f64,
}

/// Compute log10-transformed statistics for heatmap data in a single pass
/// This is optimized for the DDAResults component heatmap rendering.
/// data: flattened DDA Q matrix data [ch0_scale0, ch0_scale1, ..., ch1_scale0, ...]
/// floor_value: minimum value before log10 (default 0.001)
/// Returns: HeatmapStats with log-transformed statistics
#[wasm_bindgen]
pub fn compute_heatmap_stats(data: &[f64], floor_value: f64) -> HeatmapStats {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if data.is_empty() {
        return HeatmapStats {
            min: 0.0,
            max: 0.0,
            mean: 0.0,
            std: 0.0,
            count: 0,
            scale_min: 0.0,
            scale_max: 0.0,
        };
    }

    let floor = if floor_value > 0.0 { floor_value } else { 0.001 };

    // Single-pass Welford's algorithm for numerically stable statistics
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    let mut mean = 0.0;
    let mut m2 = 0.0;
    let mut count = 0u32;

    for &value in data {
        if !value.is_finite() {
            continue;
        }

        // Apply log10 transform with floor
        let log_val = (value.max(floor)).log10();

        count += 1;
        min = min.min(log_val);
        max = max.max(log_val);

        // Welford's online algorithm
        let delta = log_val - mean;
        mean += delta / count as f64;
        let delta2 = log_val - mean;
        m2 += delta * delta2;
    }

    let variance = if count > 1 {
        m2 / (count - 1) as f64
    } else {
        0.0
    };
    let std = variance.sqrt();

    // Compute auto-scale range (mean ± 3*std)
    let scale_min = mean - 3.0 * std;
    let scale_max = mean + 3.0 * std;

    HeatmapStats {
        min,
        max,
        mean,
        std,
        count,
        scale_min,
        scale_max,
    }
}

/// Transform heatmap data with log10 and return with computed statistics
/// This combines transform and statistics in a single pass for efficiency.
/// Returns: flattened log-transformed data
#[wasm_bindgen]
pub fn transform_heatmap_log10(data: &[f64], floor_value: f64) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let floor = if floor_value > 0.0 { floor_value } else { 0.001 };

    data.iter()
        .map(|&v| if v.is_finite() { (v.max(floor)).log10() } else { 0.0 })
        .collect()
}

/// Batch transform and compute statistics for multi-channel heatmap data
/// Processes each channel separately and returns per-channel statistics.
/// data: flattened [ch0_s0, ch0_s1, ..., ch1_s0, ...]
/// num_channels: number of channels
/// points_per_channel: number of scale points per channel
/// floor_value: minimum value before log10
/// Returns: [min0, max0, mean0, std0, scale_min0, scale_max0, min1, ...]
#[wasm_bindgen]
pub fn compute_heatmap_channel_stats(
    data: &[f64],
    num_channels: usize,
    points_per_channel: usize,
    floor_value: f64,
) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if num_channels == 0 || points_per_channel == 0 {
        return vec![];
    }

    let expected_len = num_channels * points_per_channel;
    if data.len() < expected_len {
        return vec![];
    }

    let floor = if floor_value > 0.0 { floor_value } else { 0.001 };
    let mut result = Vec::with_capacity(num_channels * 6); // 6 stats per channel

    for ch in 0..num_channels {
        let start = ch * points_per_channel;
        let end = start + points_per_channel;
        let channel_data = &data[start..end];

        let stats = compute_heatmap_stats(channel_data, floor);
        result.push(stats.min);
        result.push(stats.max);
        result.push(stats.mean);
        result.push(stats.std);
        result.push(stats.scale_min);
        result.push(stats.scale_max);
    }

    result
}

/// Combined transform and statistics computation for multi-channel heatmap data
/// This is the most efficient function for DDA heatmap rendering as it:
/// 1. Transforms all data with log10 in a single pass
/// 2. Computes global statistics across all channels
/// 3. Returns both transformed data and stats
///
/// data: flattened raw DDA matrix [ch0_s0, ch0_s1, ..., ch1_s0, ...]
/// num_channels: number of channels
/// points_per_channel: number of scale points per channel
/// floor_value: minimum value before log10 (default 0.001)
///
/// Returns: Combined result as flattened array:
/// [transformed_data..., global_min, global_max, global_mean, global_std, scale_min, scale_max]
/// The last 6 values are the global statistics for color range calculation
#[wasm_bindgen]
pub fn transform_heatmap_with_stats(
    data: &[f64],
    num_channels: usize,
    points_per_channel: usize,
    floor_value: f64,
) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if num_channels == 0 || points_per_channel == 0 {
        return vec![];
    }

    let expected_len = num_channels * points_per_channel;
    if data.len() < expected_len {
        return vec![];
    }

    let floor = if floor_value > 0.0 { floor_value } else { 0.001 };

    // Allocate result: transformed data + 6 stats values
    let mut result = Vec::with_capacity(expected_len + 6);

    // Single-pass Welford's algorithm for global statistics
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    let mut mean = 0.0;
    let mut m2 = 0.0;
    let mut count = 0u32;

    // Transform and compute stats in a single pass
    for &value in &data[..expected_len] {
        let log_val = if value.is_finite() {
            (value.max(floor)).log10()
        } else {
            0.0
        };

        result.push(log_val);

        if value.is_finite() {
            count += 1;
            min = min.min(log_val);
            max = max.max(log_val);

            // Welford's online algorithm
            let delta = log_val - mean;
            mean += delta / count as f64;
            let delta2 = log_val - mean;
            m2 += delta * delta2;
        }
    }

    let variance = if count > 1 {
        m2 / (count - 1) as f64
    } else {
        0.0
    };
    let std = variance.sqrt();

    // Compute auto-scale range (mean ± 3*std)
    let scale_min = mean - 3.0 * std;
    let scale_max = mean + 3.0 * std;

    // Append stats to result
    result.push(min);
    result.push(max);
    result.push(mean);
    result.push(std);
    result.push(scale_min);
    result.push(scale_max);

    result
}

/// Normalize values and apply colormap in a single pass
/// This is optimized for heatmap rendering where we need to:
/// 1. Normalize values to [0, 1] based on color range
/// 2. Apply colormap to get RGB values
///
/// data: log-transformed heatmap data
/// color_min, color_max: color range for normalization
/// colormap: 0 = viridis, 1 = plasma, 2 = inferno, 3 = magma, 4 = coolwarm
///
/// Returns: RGB values as [r0, g0, b0, r1, g1, b1, ...] in 0-255 range
#[wasm_bindgen]
pub fn normalize_and_colormap(
    data: &[f64],
    color_min: f64,
    color_max: f64,
    colormap: u8,
) -> Vec<u8> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let range = color_max - color_min;
    let norm_factor = if range.abs() > 1e-10 { 1.0 / range } else { 0.0 };

    let mut result = Vec::with_capacity(data.len() * 3);

    for &value in data {
        // Normalize to [0, 1]
        let normalized = (value - color_min) * norm_factor;
        let clamped = normalized.clamp(0.0, 1.0);

        // Apply colormap
        let (r, g, b) = match colormap {
            0 => colormap_viridis(clamped),
            1 => colormap_plasma(clamped),
            2 => colormap_inferno(clamped),
            3 => colormap_magma(clamped),
            4 => colormap_coolwarm(clamped),
            _ => colormap_viridis(clamped),
        };

        result.push(r);
        result.push(g);
        result.push(b);
    }

    result
}

// ============================================================================
// OVERVIEW PLOT OPTIMIZATION - Batch Channel Range Computation
// ============================================================================

/// Compute min, max, and range for all channels in a single batch operation.
/// This is optimized for OverviewPlot channel normalization.
///
/// data: flattened channel data [ch0_pt0, ch0_pt1, ..., ch1_pt0, ...]
/// num_channels: number of channels
/// points_per_channel: samples per channel
///
/// Returns: [min0, max0, range0, min1, max1, range1, ...]
#[wasm_bindgen]
pub fn compute_channel_ranges_batch(
    data: &[f64],
    num_channels: usize,
    points_per_channel: usize,
) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if num_channels == 0 || points_per_channel == 0 {
        return vec![];
    }

    let expected_len = num_channels * points_per_channel;
    if data.len() < expected_len {
        return vec![];
    }

    let mut result = Vec::with_capacity(num_channels * 3);

    for ch in 0..num_channels {
        let start = ch * points_per_channel;
        let end = start + points_per_channel;
        let channel_data = &data[start..end];

        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;

        for &v in channel_data {
            if v.is_finite() {
                if v < min {
                    min = v;
                }
                if v > max {
                    max = v;
                }
            }
        }

        if !min.is_finite() {
            min = 0.0;
        }
        if !max.is_finite() {
            max = 1.0;
        }

        let range = if (max - min).abs() < 1e-10 { 1.0 } else { max - min };

        result.push(min);
        result.push(max);
        result.push(range);
    }

    result
}

/// Normalize overview min-max data for all channels and extract min/max series.
/// Combines range calculation, normalization, and min/max extraction in a single WASM call.
///
/// data: flattened raw overview data [ch0_minmax0, ch0_minmax1, ..., ch1_minmax0, ...]
///       where each channel has alternating min/max pairs
/// num_channels: number of channels
/// pairs_per_channel: number of min-max pairs per channel (data points / 2)
///
/// Returns: flattened result containing:
/// - normalized_mins: [ch0_min0, ch0_min1, ..., ch1_min0, ...]
/// - normalized_maxs: [ch0_max0, ch0_max1, ..., ch1_max0, ...]
/// - channel_ranges: [min0, max0, range0, min1, max1, range1, ...]
///
/// Total length: (num_channels * pairs_per_channel * 2) + (num_channels * 3)
#[wasm_bindgen]
pub fn normalize_overview_data(
    data: &[f64],
    num_channels: usize,
    pairs_per_channel: usize,
) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if num_channels == 0 || pairs_per_channel == 0 {
        return vec![];
    }

    let points_per_channel = pairs_per_channel * 2;
    let expected_len = num_channels * points_per_channel;
    if data.len() < expected_len {
        return vec![];
    }

    // First pass: compute ranges for each channel
    let mut ranges: Vec<(f64, f64, f64)> = Vec::with_capacity(num_channels);

    for ch in 0..num_channels {
        let start = ch * points_per_channel;
        let end = start + points_per_channel;
        let channel_data = &data[start..end];

        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;

        for &v in channel_data {
            if v.is_finite() {
                if v < min {
                    min = v;
                }
                if v > max {
                    max = v;
                }
            }
        }

        if !min.is_finite() {
            min = 0.0;
        }
        if !max.is_finite() {
            max = 1.0;
        }

        let range = if (max - min).abs() < 1e-10 { 1.0 } else { max - min };
        ranges.push((min, max, range));
    }

    // Allocate result: mins + maxs + ranges
    let result_len = num_channels * pairs_per_channel * 2 + num_channels * 3;
    let mut result = Vec::with_capacity(result_len);

    // Second pass: normalize and extract mins
    for ch in 0..num_channels {
        let start = ch * points_per_channel;
        let (global_min, _, range) = ranges[ch];

        for i in 0..pairs_per_channel {
            let min_val = data[start + i * 2];
            let normalized = if min_val.is_finite() {
                (min_val - global_min) / range
            } else {
                0.5
            };
            result.push(normalized);
        }
    }

    // Third pass: normalize and extract maxs
    for ch in 0..num_channels {
        let start = ch * points_per_channel;
        let (global_min, _, range) = ranges[ch];

        for i in 0..pairs_per_channel {
            let max_val = data[start + i * 2 + 1];
            let normalized = if max_val.is_finite() {
                (max_val - global_min) / range
            } else {
                0.5
            };
            result.push(normalized);
        }
    }

    // Append channel ranges
    for (min, max, range) in ranges {
        result.push(min);
        result.push(max);
        result.push(range);
    }

    result
}

/// Prepare canvas coordinates for overview plot rendering.
/// Pre-calculates all x,y pixel positions for vertical bars.
///
/// x_data: time values for each point
/// min_data: normalized min values for a channel
/// max_data: normalized max values for a channel
/// plot_left, plot_top, plot_width, plot_height: plot area bounds
/// x_min, x_max: time axis range
/// y_min, y_max: y-axis range (typically -0.05 to 1.05 for normalized data)
/// step: sampling step (skip every N points for performance)
///
/// Returns: [x0, y_bottom0, y_top0, x1, y_bottom1, y_top1, ...]
/// Returns empty array for points with invalid coordinates
#[wasm_bindgen]
pub fn prepare_overview_coordinates(
    x_data: &[f64],
    min_data: &[f64],
    max_data: &[f64],
    plot_left: f64,
    plot_top: f64,
    plot_width: f64,
    plot_height: f64,
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    step: usize,
) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let len = x_data.len().min(min_data.len()).min(max_data.len());
    if len == 0 || step == 0 {
        return vec![];
    }

    let x_range = x_max - x_min;
    let y_range = y_max - y_min;

    if x_range.abs() < 1e-10 || y_range.abs() < 1e-10 {
        return vec![];
    }

    let num_points = (len + step - 1) / step;
    let mut result = Vec::with_capacity(num_points * 3);

    let mut i = 0;
    while i < len {
        let x_val = x_data[i];
        let y_min_val = min_data[i];
        let y_max_val = max_data[i];

        if x_val.is_finite() && y_min_val.is_finite() && y_max_val.is_finite() {
            let x = plot_left + ((x_val - x_min) / x_range) * plot_width;
            let y_bottom = plot_top + plot_height - ((y_min_val - y_min) / y_range) * plot_height;
            let y_top = plot_top + plot_height - ((y_max_val - y_min) / y_range) * plot_height;

            if x.is_finite() && y_bottom.is_finite() && y_top.is_finite() {
                result.push(x);
                result.push(y_bottom);
                result.push(y_top);
            }
        }

        i += step;
    }

    result
}

// ============================================================================
// BATCH PREPROCESSING - Multi-channel signal processing
// ============================================================================

/// Apply preprocessing to multiple channels in a single WASM call.
/// This avoids the overhead of multiple JS->WASM boundary crossings.
///
/// data: flattened channel data [ch0_sample0, ch0_sample1, ..., ch1_sample0, ...]
/// num_channels: number of channels
/// samples_per_channel: number of samples per channel
/// highpass_freq: highpass cutoff in Hz (0 or negative to skip)
/// lowpass_freq: lowpass cutoff in Hz (0 or negative to skip)
/// notch_freqs: frequencies to notch out (empty to skip)
/// sample_rate: sample rate in Hz
///
/// Returns: flattened processed data in same format
#[wasm_bindgen]
pub fn preprocess_channels(
    data: &[f64],
    num_channels: usize,
    samples_per_channel: usize,
    highpass_freq: f64,
    lowpass_freq: f64,
    notch_freqs: &[f64],
    sample_rate: f64,
) -> Vec<f64> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if num_channels == 0 || samples_per_channel == 0 || sample_rate <= 0.0 {
        return data.to_vec();
    }

    let expected_len = num_channels * samples_per_channel;
    if data.len() < expected_len {
        return data.to_vec();
    }

    let mut result = Vec::with_capacity(expected_len);

    for ch in 0..num_channels {
        let start = ch * samples_per_channel;
        let end = start + samples_per_channel;
        let mut channel_data: Vec<f64> = data[start..end].to_vec();

        // Apply highpass if specified
        if highpass_freq > 0.0 {
            channel_data = filter_highpass(&channel_data, highpass_freq, sample_rate);
        }

        // Apply lowpass if specified
        if lowpass_freq > 0.0 {
            channel_data = filter_lowpass(&channel_data, lowpass_freq, sample_rate);
        }

        // Apply notch filters if specified
        if !notch_freqs.is_empty() {
            channel_data = filter_notch_multi(&channel_data, notch_freqs, sample_rate);
        }

        result.extend(channel_data);
    }

    result
}

/// Detect artifacts in multiple channels.
/// Returns indices of artifact samples for each channel.
///
/// data: flattened channel data
/// num_channels: number of channels
/// samples_per_channel: samples per channel
/// threshold_std: number of standard deviations for artifact detection
///
/// Returns: flattened result [num_artifacts_ch0, idx0, idx1, ..., num_artifacts_ch1, ...]
#[wasm_bindgen]
pub fn detect_artifacts_batch(
    data: &[f64],
    num_channels: usize,
    samples_per_channel: usize,
    threshold_std: f64,
) -> Vec<u32> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    if num_channels == 0 || samples_per_channel == 0 {
        return vec![];
    }

    let expected_len = num_channels * samples_per_channel;
    if data.len() < expected_len {
        return vec![];
    }

    let threshold = if threshold_std > 0.0 { threshold_std } else { 3.0 };
    let mut result = Vec::new();

    for ch in 0..num_channels {
        let start = ch * samples_per_channel;
        let end = start + samples_per_channel;
        let channel_data = &data[start..end];

        // Calculate mean and std using only finite values
        let finite_values: Vec<f64> = channel_data.iter().copied().filter(|v| v.is_finite()).collect();
        let n = finite_values.len();
        if n == 0 {
            // All values are non-finite, mark all as artifacts
            result.push(samples_per_channel as u32);
            result.extend((0..samples_per_channel).map(|i| i as u32));
            continue;
        }
        let n_f64 = n as f64;
        let mean: f64 = finite_values.iter().sum::<f64>() / n_f64;
        let variance: f64 = finite_values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n_f64;
        let std = variance.sqrt();

        // Find artifacts
        let mut artifacts = Vec::new();
        let upper = mean + threshold * std;
        let lower = mean - threshold * std;

        for (i, &v) in channel_data.iter().enumerate() {
            if !v.is_finite() || v > upper || v < lower {
                artifacts.push(i as u32);
            }
        }

        // Store count followed by indices
        result.push(artifacts.len() as u32);
        result.extend(artifacts);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_channel_ranges_batch() {
        let data = vec![1.0, 5.0, 2.0, 4.0, 3.0, 3.0, 10.0, 20.0, 15.0, 15.0, 12.0, 18.0];
        let result = compute_channel_ranges_batch(&data, 2, 6);
        assert_eq!(result.len(), 6);
        assert_eq!(result[0], 1.0); // ch0 min
        assert_eq!(result[1], 5.0); // ch0 max
        assert_eq!(result[2], 4.0); // ch0 range
        assert_eq!(result[3], 10.0); // ch1 min
        assert_eq!(result[4], 20.0); // ch1 max
        assert_eq!(result[5], 10.0); // ch1 range
    }

    #[test]
    fn test_lttb_basic() {
        let data: Vec<f64> = (0..100).map(|x| (x as f64).sin()).collect();
        let result = decimate_lttb(&data, 10);
        assert_eq!(result.len(), 10);
        assert_eq!(result[0], data[0]); // First point preserved
        assert_eq!(result[9], data[99]); // Last point preserved
    }

    #[test]
    fn test_minmax_basic() {
        let data = vec![1.0, 5.0, 2.0, 8.0, 3.0, 7.0, 4.0, 6.0];
        let result = decimate_minmax(&data, 2);
        assert_eq!(result.len(), 4); // 2 buckets * 2 values each
    }

    #[test]
    fn test_stats() {
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let stats = compute_channel_stats(&data);
        assert_eq!(stats.min, 1.0);
        assert_eq!(stats.max, 5.0);
        assert!((stats.mean - 3.0).abs() < 1e-10);
        assert_eq!(stats.count, 5);
    }

    #[test]
    fn test_empty_data() {
        let data: Vec<f64> = vec![];
        let stats = compute_channel_stats(&data);
        assert_eq!(stats.count, 0);

        let lttb = decimate_lttb(&data, 10);
        assert!(lttb.is_empty());
    }
}
