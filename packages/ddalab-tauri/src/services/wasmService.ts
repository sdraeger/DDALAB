/**
 * WASM Signal Processing Service
 *
 * Provides high-performance signal processing, statistics computation,
 * matrix operations, and data compression using WebAssembly.
 */

export interface ChannelStats {
  min: number;
  max: number;
  mean: number;
  std: number;
  count: number;
}

export interface IQRResult {
  q1: number;
  median: number;
  q3: number;
  iqr: number;
}

export type DecimationMethod = "lttb" | "minmax" | "average";
export type Colormap = "viridis" | "plasma" | "inferno" | "magma" | "coolwarm";

// WASM module state - we use any types here since the module is dynamically loaded
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wasmFunctions: any = null;
let wasmInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the WASM module. Call this once at app startup.
 * Safe to call multiple times - will only initialize once.
 */
export async function initWasm(): Promise<void> {
  if (wasmInitialized) return;

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // Dynamic import the WASM module
      const wasm = await import("../../../ddalab-wasm/pkg/ddalab_wasm");

      // Initialize the WASM module
      await wasm.default();

      wasmFunctions = wasm;
      wasmInitialized = true;
      console.log("[WASM] Signal processing module initialized successfully");
    } catch (error) {
      console.warn("[WASM] Failed to initialize, using JS fallback:", error);
      // Mark as initialized but without WASM functions - will use JS fallbacks
      wasmInitialized = true;
    }
  })();

  return initPromise;
}

/**
 * Check if WASM module is ready (including fallback mode)
 */
export function isWasmReady(): boolean {
  return wasmInitialized;
}

/**
 * Check if actual WASM functions are available (not fallback mode)
 */
export function isWasmAvailable(): boolean {
  return wasmFunctions !== null;
}

// ============================================================================
// DECIMATION
// ============================================================================

/**
 * Compute statistics for a single channel
 */
export function computeChannelStats(data: number[]): ChannelStats {
  if (!wasmFunctions) {
    return computeChannelStatsJS(data);
  }

  const float64Data = new Float64Array(data);
  const stats = wasmFunctions.compute_channel_stats(float64Data);

  const result: ChannelStats = {
    min: stats.min,
    max: stats.max,
    mean: stats.mean,
    std: stats.std,
    count: stats.count,
  };

  // Clean up WASM memory
  stats.free();

  return result;
}

/**
 * Compute statistics for multiple channels at once
 */
export function computeMultiChannelStats(data: number[][]): ChannelStats[] {
  if (data.length === 0) return [];

  const pointsPerChannel = data[0].length;
  const numChannels = data.length;

  if (!wasmFunctions) {
    return data.map((channelData) => computeChannelStatsJS(channelData));
  }

  // Flatten data for WASM
  const flatData = new Float64Array(numChannels * pointsPerChannel);
  for (let ch = 0; ch < numChannels; ch++) {
    flatData.set(data[ch], ch * pointsPerChannel);
  }

  const flatStats = wasmFunctions.compute_multi_channel_stats(
    flatData,
    numChannels,
    pointsPerChannel,
  );

  // Parse flattened results: [min0, max0, mean0, std0, min1, ...]
  const results: ChannelStats[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const offset = ch * 4;
    results.push({
      min: flatStats[offset],
      max: flatStats[offset + 1],
      mean: flatStats[offset + 2],
      std: flatStats[offset + 3],
      count: pointsPerChannel,
    });
  }

  return results;
}

/**
 * Decimate data using the specified method
 */
export function decimateData(
  data: number[],
  targetPoints: number,
  method: DecimationMethod = "lttb",
): number[] {
  if (data.length <= targetPoints) {
    return data;
  }

  if (!wasmFunctions) {
    return decimateLttbJS(data, targetPoints);
  }

  const float64Data = new Float64Array(data);
  let result: Float64Array;

  switch (method) {
    case "lttb":
      result = wasmFunctions.decimate_lttb(float64Data, targetPoints);
      break;
    case "minmax":
      result = wasmFunctions.decimate_minmax(float64Data, targetPoints / 2);
      break;
    case "average":
      result = wasmFunctions.decimate_average(float64Data, targetPoints);
      break;
    default:
      result = wasmFunctions.decimate_lttb(float64Data, targetPoints);
  }

  return Array.from(result);
}

/**
 * Decimate multiple channels at once (more efficient than calling decimateData per channel)
 */
export function decimateChannels(
  data: number[][],
  targetPoints: number,
  method: DecimationMethod = "lttb",
): number[][] {
  if (data.length === 0) return [];

  const pointsPerChannel = data[0].length;
  const numChannels = data.length;

  if (pointsPerChannel <= targetPoints) {
    return data;
  }

  if (!wasmFunctions || method !== "lttb") {
    // Fallback to per-channel processing
    return data.map((channelData) =>
      decimateData(channelData, targetPoints, method),
    );
  }

  // Use batch LTTB decimation
  const flatData = new Float64Array(numChannels * pointsPerChannel);
  for (let ch = 0; ch < numChannels; ch++) {
    flatData.set(data[ch], ch * pointsPerChannel);
  }

  const flatResult = wasmFunctions.decimate_channels_lttb(
    flatData,
    numChannels,
    pointsPerChannel,
    targetPoints,
  );

  // Split results back into channels
  const results: number[][] = [];
  const actualPointsPerChannel = flatResult.length / numChannels;

  for (let ch = 0; ch < numChannels; ch++) {
    const start = ch * actualPointsPerChannel;
    const end = start + actualPointsPerChannel;
    results.push(Array.from(flatResult.slice(start, end)));
  }

  return results;
}

// ============================================================================
// SIGNAL PROCESSING - Filters
// ============================================================================

/**
 * Apply highpass filter
 */
export function filterHighpass(
  data: number[],
  cutoffFreq: number,
  sampleRate: number,
): number[] {
  if (!wasmFunctions) {
    return filterHighpassJS(data, cutoffFreq, sampleRate);
  }

  const float64Data = new Float64Array(data);
  const result = wasmFunctions.filter_highpass(
    float64Data,
    cutoffFreq,
    sampleRate,
  );
  return Array.from(result);
}

/**
 * Apply lowpass filter
 */
export function filterLowpass(
  data: number[],
  cutoffFreq: number,
  sampleRate: number,
): number[] {
  if (!wasmFunctions) {
    return filterLowpassJS(data, cutoffFreq, sampleRate);
  }

  const float64Data = new Float64Array(data);
  const result = wasmFunctions.filter_lowpass(
    float64Data,
    cutoffFreq,
    sampleRate,
  );
  return Array.from(result);
}

/**
 * Apply bandpass filter
 */
export function filterBandpass(
  data: number[],
  lowCutoff: number,
  highCutoff: number,
  sampleRate: number,
): number[] {
  if (!wasmFunctions) {
    const highpassed = filterHighpassJS(data, lowCutoff, sampleRate);
    return filterLowpassJS(highpassed, highCutoff, sampleRate);
  }

  const float64Data = new Float64Array(data);
  const result = wasmFunctions.filter_bandpass(
    float64Data,
    lowCutoff,
    highCutoff,
    sampleRate,
  );
  return Array.from(result);
}

/**
 * Apply notch filter (e.g., to remove 50Hz or 60Hz line noise)
 */
export function filterNotch(
  data: number[],
  notchFreq: number,
  sampleRate: number,
  qFactor: number = 35,
): number[] {
  if (!wasmFunctions) {
    return filterNotchJS(data, notchFreq, sampleRate, qFactor);
  }

  const float64Data = new Float64Array(data);
  const result = wasmFunctions.filter_notch(
    float64Data,
    notchFreq,
    sampleRate,
    qFactor,
  );
  return Array.from(result);
}

/**
 * Apply multiple notch filters (e.g., 50Hz + harmonics)
 */
export function filterNotchMulti(
  data: number[],
  notchFreqs: number[],
  sampleRate: number,
): number[] {
  if (!wasmFunctions) {
    let result = data;
    for (const freq of notchFreqs) {
      result = filterNotchJS(result, freq, sampleRate, 35);
    }
    return result;
  }

  const float64Data = new Float64Array(data);
  const float64Freqs = new Float64Array(notchFreqs);
  const result = wasmFunctions.filter_notch_multi(
    float64Data,
    float64Freqs,
    sampleRate,
  );
  return Array.from(result);
}

// ============================================================================
// SIGNAL PROCESSING - FFT
// ============================================================================

/**
 * Compute FFT magnitude spectrum
 */
export function computeFftMagnitude(data: number[]): number[] {
  if (!wasmFunctions) {
    return computeFftMagnitudeJS(data);
  }

  const float64Data = new Float64Array(data);
  const result = wasmFunctions.compute_fft_magnitude(float64Data);
  return Array.from(result);
}

/**
 * Compute power spectral density
 */
export function computePsd(data: number[], sampleRate: number): number[] {
  if (!wasmFunctions) {
    const magnitudes = computeFftMagnitudeJS(data);
    const n = Math.pow(2, Math.ceil(Math.log2(data.length)));
    const freqResolution = sampleRate / n;
    return magnitudes.map((mag) => (mag * mag) / freqResolution);
  }

  const float64Data = new Float64Array(data);
  const result = wasmFunctions.compute_psd(float64Data, sampleRate);
  return Array.from(result);
}

/**
 * Get frequency bins for FFT result
 */
export function getFftFrequencies(
  dataLength: number,
  sampleRate: number,
): number[] {
  if (!wasmFunctions) {
    const n = Math.pow(2, Math.ceil(Math.log2(dataLength)));
    const half = n / 2;
    const freqResolution = sampleRate / n;
    return Array.from({ length: half }, (_, i) => i * freqResolution);
  }

  const result = wasmFunctions.get_fft_frequencies(dataLength, sampleRate);
  return Array.from(result);
}

// ============================================================================
// SIGNAL PROCESSING - Normalization
// ============================================================================

/**
 * Z-score normalize data
 */
export function zscoreNormalize(data: number[]): number[] {
  if (!wasmFunctions) {
    return zscoreNormalizeJS(data);
  }

  const float64Data = new Float64Array(data);
  const result = wasmFunctions.zscore_normalize(float64Data);
  return Array.from(result);
}

/**
 * Z-score normalize multiple channels
 */
export function zscoreNormalizeChannels(data: number[][]): number[][] {
  if (data.length === 0) return [];

  const pointsPerChannel = data[0].length;
  const numChannels = data.length;

  if (!wasmFunctions) {
    return data.map((channelData) => zscoreNormalizeJS(channelData));
  }

  const flatData = new Float64Array(numChannels * pointsPerChannel);
  for (let ch = 0; ch < numChannels; ch++) {
    flatData.set(data[ch], ch * pointsPerChannel);
  }

  const flatResult = wasmFunctions.zscore_normalize_channels(
    flatData,
    numChannels,
    pointsPerChannel,
  );

  const results: number[][] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const start = ch * pointsPerChannel;
    const end = start + pointsPerChannel;
    results.push(Array.from(flatResult.slice(start, end)));
  }

  return results;
}

// ============================================================================
// STATISTICAL COMPUTATIONS
// ============================================================================

/**
 * Compute percentiles for data
 */
export function computePercentiles(
  data: number[],
  percentiles: number[],
): number[] {
  if (!wasmFunctions) {
    return computePercentilesJS(data, percentiles);
  }

  const float64Data = new Float64Array(data);
  const float64Percentiles = new Float64Array(percentiles);
  const result = wasmFunctions.compute_percentiles(
    float64Data,
    float64Percentiles,
  );
  return Array.from(result);
}

/**
 * Compute IQR (interquartile range)
 */
export function computeIqr(data: number[]): IQRResult {
  if (!wasmFunctions) {
    const percentiles = computePercentilesJS(data, [25, 50, 75]);
    return {
      q1: percentiles[0],
      median: percentiles[1],
      q3: percentiles[2],
      iqr: percentiles[2] - percentiles[0],
    };
  }

  const float64Data = new Float64Array(data);
  const result = wasmFunctions.compute_iqr(float64Data);
  return {
    q1: result[0],
    median: result[1],
    q3: result[2],
    iqr: result[3],
  };
}

/**
 * Detect artifacts using threshold-based detection
 */
export function detectArtifacts(
  data: number[],
  thresholdStd: number,
): number[] {
  if (!wasmFunctions) {
    return detectArtifactsJS(data, thresholdStd);
  }

  const float64Data = new Float64Array(data);
  const result = wasmFunctions.detect_artifacts(float64Data, thresholdStd);
  return Array.from(result);
}

/**
 * Detect artifacts using gradient-based detection
 */
export function detectArtifactsGradient(
  data: number[],
  threshold: number,
): number[] {
  if (!wasmFunctions) {
    return detectArtifactsGradientJS(data, threshold);
  }

  const float64Data = new Float64Array(data);
  const result = wasmFunctions.detect_artifacts_gradient(
    float64Data,
    threshold,
  );
  return Array.from(result);
}

// ============================================================================
// MATRIX OPERATIONS
// ============================================================================

/**
 * Normalize heatmap data to [0, 1] range
 */
export function normalizeHeatmap(
  data: number[],
  rows: number,
  cols: number,
): number[] {
  if (!wasmFunctions) {
    return normalizeHeatmapJS(data);
  }

  const float64Data = new Float64Array(data);
  const result = wasmFunctions.normalize_heatmap(float64Data, rows, cols);
  return Array.from(result);
}

/**
 * Apply colormap to normalized data
 */
export function applyColormap(data: number[], colormap: Colormap): Uint8Array {
  const colormapIndex = {
    viridis: 0,
    plasma: 1,
    inferno: 2,
    magma: 3,
    coolwarm: 4,
  }[colormap];

  if (!wasmFunctions) {
    return applyColormapJS(data, colormap);
  }

  const float64Data = new Float64Array(data);
  return wasmFunctions.apply_colormap(float64Data, colormapIndex);
}

/**
 * Compute correlation matrix for multiple channels
 */
export function computeCorrelationMatrix(data: number[][]): number[][] {
  if (data.length === 0) return [];

  const pointsPerChannel = data[0].length;
  const numChannels = data.length;

  if (!wasmFunctions) {
    return computeCorrelationMatrixJS(data);
  }

  const flatData = new Float64Array(numChannels * pointsPerChannel);
  for (let ch = 0; ch < numChannels; ch++) {
    flatData.set(data[ch], ch * pointsPerChannel);
  }

  const flatResult = wasmFunctions.compute_correlation_matrix(
    flatData,
    numChannels,
    pointsPerChannel,
  );

  // Reshape to 2D matrix
  const matrix: number[][] = [];
  for (let i = 0; i < numChannels; i++) {
    const row: number[] = [];
    for (let j = 0; j < numChannels; j++) {
      row.push(flatResult[i * numChannels + j]);
    }
    matrix.push(row);
  }

  return matrix;
}

// ============================================================================
// DATA COMPRESSION
// ============================================================================

/**
 * Decompress LZ4-compressed data
 */
export function decompressLz4(compressed: Uint8Array): Uint8Array {
  if (!wasmFunctions) {
    throw new Error("LZ4 decompression requires WASM module");
  }

  return wasmFunctions.decompress_lz4(compressed);
}

/**
 * Compress data with LZ4
 */
export function compressLz4(data: Uint8Array): Uint8Array {
  if (!wasmFunctions) {
    throw new Error("LZ4 compression requires WASM module");
  }

  return wasmFunctions.compress_lz4(data);
}

/**
 * Parse binary f64 array from bytes
 */
export function parseF64Array(bytes: Uint8Array): number[] {
  if (!wasmFunctions) {
    return parseF64ArrayJS(bytes);
  }

  const result = wasmFunctions.parse_f64_array(bytes);
  return Array.from(result);
}

/**
 * Parse binary f32 array from bytes
 */
export function parseF32Array(bytes: Uint8Array): number[] {
  if (!wasmFunctions) {
    return parseF32ArrayJS(bytes);
  }

  const result = wasmFunctions.parse_f32_array(bytes);
  return Array.from(result);
}

// ============================================================================
// JS FALLBACK IMPLEMENTATIONS
// ============================================================================

function computeChannelStatsJS(data: number[]): ChannelStats {
  if (data.length === 0) {
    return { min: Infinity, max: -Infinity, mean: 0, std: 0, count: 0 };
  }

  let min = Infinity;
  let max = -Infinity;
  let mean = 0;
  let m2 = 0;
  let count = 0;

  for (const value of data) {
    if (!Number.isFinite(value)) continue;

    count++;
    min = Math.min(min, value);
    max = Math.max(max, value);

    const delta = value - mean;
    mean += delta / count;
    const delta2 = value - mean;
    m2 += delta * delta2;
  }

  const variance = count > 1 ? m2 / (count - 1) : 0;

  return { min, max, mean, std: Math.sqrt(variance), count };
}

function decimateLttbJS(data: number[], targetPoints: number): number[] {
  const len = data.length;

  if (targetPoints >= len || len <= 2) {
    return [...data];
  }

  if (targetPoints < 2) {
    return len > 0 ? [data[0], data[len - 1]] : [];
  }

  const result: number[] = [data[0]];
  const bucketSize = (len - 2) / (targetPoints - 2);

  let aIndex = 0;

  for (let i = 0; i < targetPoints - 2; i++) {
    const bucketStart = Math.floor(i * bucketSize + 1);
    const bucketEnd = Math.min(Math.floor((i + 1) * bucketSize + 1), len - 1);

    const nextBucketStart = bucketEnd;
    const nextBucketEnd = Math.min(Math.floor((i + 2) * bucketSize + 1), len);

    let avgX = 0;
    let avgY = 0;
    if (nextBucketStart < nextBucketEnd) {
      for (let j = nextBucketStart; j < nextBucketEnd; j++) {
        avgX += j;
        avgY += data[j];
      }
      const count = nextBucketEnd - nextBucketStart;
      avgX /= count;
      avgY /= count;
    } else {
      avgX = len - 1;
      avgY = data[len - 1];
    }

    let maxArea = -1;
    let maxAreaIndex = bucketStart;

    const pointAX = aIndex;
    const pointAY = data[aIndex];

    for (let j = bucketStart; j < bucketEnd; j++) {
      const area = Math.abs(
        (pointAX - avgX) * (data[j] - pointAY) -
          (pointAX - j) * (avgY - pointAY),
      );

      if (area > maxArea) {
        maxArea = area;
        maxAreaIndex = j;
      }
    }

    result.push(data[maxAreaIndex]);
    aIndex = maxAreaIndex;
  }

  result.push(data[len - 1]);

  return result;
}

function filterHighpassJS(
  data: number[],
  cutoffFreq: number,
  sampleRate: number,
): number[] {
  if (data.length === 0) return data;

  const rc = 1.0 / (2.0 * Math.PI * cutoffFreq);
  const dt = 1.0 / sampleRate;
  const a = rc / (rc + dt);

  const output: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    output.push(a * (output[i - 1] + data[i] - data[i - 1]));
  }

  return output;
}

function filterLowpassJS(
  data: number[],
  cutoffFreq: number,
  sampleRate: number,
): number[] {
  if (data.length === 0) return data;

  const rc = 1.0 / (2.0 * Math.PI * cutoffFreq);
  const dt = 1.0 / sampleRate;
  const alpha = dt / (rc + dt);

  const output: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    output.push(output[i - 1] + alpha * (data[i] - output[i - 1]));
  }

  return output;
}

function filterNotchJS(
  data: number[],
  notchFreq: number,
  sampleRate: number,
  qFactor: number,
): number[] {
  if (data.length === 0) return data;

  const omega = (2 * Math.PI * notchFreq) / sampleRate;
  const cosOmega = Math.cos(omega);
  const sinOmega = Math.sin(omega);
  const alpha = sinOmega / (2 * qFactor);

  const a0 = 1 + alpha;
  const b0 = 1 / a0;
  const b1 = (-2 * cosOmega) / a0;
  const b2 = 1 / a0;
  const a1 = (-2 * cosOmega) / a0;
  const a2 = (1 - alpha) / a0;

  const output: number[] = [];
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;

  for (const x of data) {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    output.push(y);
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }

  return output;
}

function computeFftMagnitudeJS(data: number[]): number[] {
  // Simple DFT implementation (slow but works as fallback)
  const n = Math.pow(2, Math.ceil(Math.log2(data.length)));
  const half = Math.floor(n / 2);
  const result: number[] = [];

  for (let k = 0; k < half; k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < data.length; t++) {
      const angle = (2 * Math.PI * k * t) / n;
      re += data[t] * Math.cos(angle);
      im -= data[t] * Math.sin(angle);
    }
    result.push((Math.sqrt(re * re + im * im) * 2) / n);
  }

  return result;
}

function zscoreNormalizeJS(data: number[]): number[] {
  const stats = computeChannelStatsJS(data);
  if (stats.std < 1e-10) return data.map(() => 0);
  return data.map((x) => (x - stats.mean) / stats.std);
}

function computePercentilesJS(data: number[], percentiles: number[]): number[] {
  const sorted = [...data].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return percentiles.map(() => 0);

  return percentiles.map((p) => {
    const idx = Math.round((p / 100) * (sorted.length - 1));
    return sorted[Math.min(idx, sorted.length - 1)];
  });
}

function detectArtifactsJS(data: number[], thresholdStd: number): number[] {
  const stats = computeChannelStatsJS(data);
  const threshold = stats.std * thresholdStd;
  const artifacts: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i] - stats.mean) > threshold) {
      artifacts.push(i);
    }
  }

  return artifacts;
}

function detectArtifactsGradientJS(
  data: number[],
  threshold: number,
): number[] {
  const artifacts: number[] = [];

  for (let i = 1; i < data.length; i++) {
    if (Math.abs(data[i] - data[i - 1]) > threshold) {
      artifacts.push(i);
    }
  }

  return artifacts;
}

function normalizeHeatmapJS(data: number[]): number[] {
  const finite = data.filter(Number.isFinite);
  if (finite.length === 0) return data.map(() => 0.5);

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const range = max - min;

  if (range < 1e-10) return data.map(() => 0.5);

  return data.map((v) => (Number.isFinite(v) ? (v - min) / range : 0));
}

function applyColormapJS(data: number[], colormap: Colormap): Uint8Array {
  const result = new Uint8Array(data.length * 3);

  for (let i = 0; i < data.length; i++) {
    const t = Math.max(0, Math.min(1, data[i]));
    let r: number, g: number, b: number;

    switch (colormap) {
      case "viridis":
        r = 0.267 + t * (0.329 + t * (1.452 - t * 1.046));
        g = Math.pow(t, 0.5);
        b = 0.329 + t * (1.452 - t * 1.781);
        break;
      case "coolwarm":
        r = t < 0.5 ? t * 2 : 1;
        g = t < 0.5 ? t * 2 : 2 - t * 2;
        b = t < 0.5 ? 1 : 2 - t * 2;
        break;
      default:
        r = t;
        g = t;
        b = t;
    }

    result[i * 3] = Math.round(Math.max(0, Math.min(1, r)) * 255);
    result[i * 3 + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
    result[i * 3 + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255);
  }

  return result;
}

function computeCorrelationMatrixJS(data: number[][]): number[][] {
  const numChannels = data.length;
  const stats = data.map((ch) => computeChannelStatsJS(ch));

  const matrix: number[][] = [];
  for (let i = 0; i < numChannels; i++) {
    const row: number[] = [];
    for (let j = 0; j < numChannels; j++) {
      if (i === j) {
        row.push(1);
      } else if (j < i) {
        row.push(matrix[j][i]);
      } else {
        let sum = 0;
        for (let k = 0; k < data[i].length; k++) {
          sum += (data[i][k] - stats[i].mean) * (data[j][k] - stats[j].mean);
        }
        const r =
          stats[i].std > 1e-10 && stats[j].std > 1e-10
            ? sum / ((data[i].length - 1) * stats[i].std * stats[j].std)
            : 0;
        row.push(r);
      }
    }
    matrix.push(row);
  }

  return matrix;
}

function parseF64ArrayJS(bytes: Uint8Array): number[] {
  const result: number[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let i = 0; i < bytes.length; i += 8) {
    if (i + 8 <= bytes.length) {
      result.push(view.getFloat64(i, true));
    }
  }

  return result;
}

function parseF32ArrayJS(bytes: Uint8Array): number[] {
  const result: number[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let i = 0; i < bytes.length; i += 4) {
    if (i + 4 <= bytes.length) {
      result.push(view.getFloat32(i, true));
    }
  }

  return result;
}
