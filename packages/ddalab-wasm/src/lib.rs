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

#[cfg(test)]
mod tests {
    use super::*;

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
