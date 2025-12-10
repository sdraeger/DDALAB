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

export interface HeatmapStats {
  min: number;
  max: number;
  mean: number;
  std: number;
  count: number;
  scaleMin: number;
  scaleMax: number;
}

export interface HeatmapTransformResult {
  data: number[][];
  stats: HeatmapStats;
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
// HEATMAP OPTIMIZATION - DDA Results
// ============================================================================

/**
 * Transform DDA matrix data with log10 and compute statistics in a single pass.
 * This is the most efficient function for DDA heatmap rendering.
 *
 * @param rawChannelData - Array of raw channel data arrays from DDA matrix
 * @param floorValue - Minimum value before log10 (default 0.001)
 * @returns Transformed data and global statistics for color range calculation
 */
export function transformHeatmapWithStats(
  rawChannelData: number[][],
  floorValue: number = 0.001,
): HeatmapTransformResult {
  if (rawChannelData.length === 0) {
    return {
      data: [],
      stats: {
        min: 0,
        max: 0,
        mean: 0,
        std: 0,
        count: 0,
        scaleMin: 0,
        scaleMax: 1,
      },
    };
  }

  const numChannels = rawChannelData.length;
  const pointsPerChannel = rawChannelData[0].length;

  if (!wasmFunctions) {
    return transformHeatmapWithStatsJS(rawChannelData, floorValue);
  }

  // Flatten data for WASM (row-major: ch0_s0, ch0_s1, ..., ch1_s0, ...)
  const flatData = new Float64Array(numChannels * pointsPerChannel);
  for (let ch = 0; ch < numChannels; ch++) {
    flatData.set(rawChannelData[ch], ch * pointsPerChannel);
  }

  const result = wasmFunctions.transform_heatmap_with_stats(
    flatData,
    numChannels,
    pointsPerChannel,
    floorValue,
  );

  // Extract transformed data and stats from result
  // Result format: [transformed_data..., min, max, mean, std, scale_min, scale_max]
  const dataLength = numChannels * pointsPerChannel;
  const transformedFlat = result.slice(0, dataLength);

  // Split back into channels
  const data: number[][] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const start = ch * pointsPerChannel;
    const end = start + pointsPerChannel;
    data.push(Array.from(transformedFlat.slice(start, end)));
  }

  // Extract stats (last 6 values)
  const stats: HeatmapStats = {
    min: result[dataLength],
    max: result[dataLength + 1],
    mean: result[dataLength + 2],
    std: result[dataLength + 3],
    scaleMin: result[dataLength + 4],
    scaleMax: result[dataLength + 5],
    count: dataLength,
  };

  return { data, stats };
}

/**
 * Normalize and apply colormap to heatmap data in a single pass.
 * Returns RGB values ready for canvas rendering.
 *
 * @param data - Log-transformed heatmap data (flattened or 2D)
 * @param colorMin - Minimum value for normalization
 * @param colorMax - Maximum value for normalization
 * @param colormap - Colormap name
 * @returns Uint8Array of RGB values [r0, g0, b0, r1, g1, b1, ...]
 */
export function normalizeAndColormap(
  data: number[] | number[][],
  colorMin: number,
  colorMax: number,
  colormap: Colormap,
): Uint8Array {
  // Flatten 2D data if needed
  const flatData = Array.isArray(data[0])
    ? (data as number[][]).flat()
    : (data as number[]);

  const colormapIndex = {
    viridis: 0,
    plasma: 1,
    inferno: 2,
    magma: 3,
    coolwarm: 4,
  }[colormap];

  if (!wasmFunctions) {
    return normalizeAndColormapJS(flatData, colorMin, colorMax, colormap);
  }

  const float64Data = new Float64Array(flatData);
  return wasmFunctions.normalize_and_colormap(
    float64Data,
    colorMin,
    colorMax,
    colormapIndex,
  );
}

/**
 * Compute log10-transformed statistics for heatmap data.
 * Use this when you only need stats without the transformed data.
 */
export function computeHeatmapStats(
  data: number[],
  floorValue: number = 0.001,
): HeatmapStats {
  if (!wasmFunctions) {
    return computeHeatmapStatsJS(data, floorValue);
  }

  const float64Data = new Float64Array(data);
  const stats = wasmFunctions.compute_heatmap_stats(float64Data, floorValue);

  const result: HeatmapStats = {
    min: stats.min,
    max: stats.max,
    mean: stats.mean,
    std: stats.std,
    count: stats.count,
    scaleMin: stats.scale_min,
    scaleMax: stats.scale_max,
  };

  // Clean up WASM memory
  stats.free();

  return result;
}

/**
 * Transform data with log10 (without statistics).
 * Use transformHeatmapWithStats when you need both.
 */
export function transformHeatmapLog10(
  data: number[],
  floorValue: number = 0.001,
): number[] {
  if (!wasmFunctions) {
    return transformHeatmapLog10JS(data, floorValue);
  }

  const float64Data = new Float64Array(data);
  const result = wasmFunctions.transform_heatmap_log10(float64Data, floorValue);
  return Array.from(result);
}

// JS Fallback implementations for heatmap functions

function transformHeatmapWithStatsJS(
  rawChannelData: number[][],
  floorValue: number,
): HeatmapTransformResult {
  const data: number[][] = [];
  let min = Infinity;
  let max = -Infinity;
  let mean = 0;
  let m2 = 0;
  let count = 0;

  const log10 = Math.log10;
  const floor = floorValue > 0 ? floorValue : 0.001;

  for (const channelData of rawChannelData) {
    const transformed: number[] = new Array(channelData.length);

    for (let i = 0; i < channelData.length; i++) {
      const raw = channelData[i];
      const logVal = Number.isFinite(raw)
        ? log10(Math.max(raw, floor))
        : 0;

      transformed[i] = logVal;

      if (Number.isFinite(raw)) {
        count++;
        min = Math.min(min, logVal);
        max = Math.max(max, logVal);

        // Welford's online algorithm
        const delta = logVal - mean;
        mean += delta / count;
        const delta2 = logVal - mean;
        m2 += delta * delta2;
      }
    }

    data.push(transformed);
  }

  const variance = count > 1 ? m2 / (count - 1) : 0;
  const std = Math.sqrt(variance);
  const scaleMin = mean - 3 * std;
  const scaleMax = mean + 3 * std;

  return {
    data,
    stats: { min, max, mean, std, count, scaleMin, scaleMax },
  };
}

function normalizeAndColormapJS(
  data: number[],
  colorMin: number,
  colorMax: number,
  colormap: Colormap,
): Uint8Array {
  const result = new Uint8Array(data.length * 3);
  const range = colorMax - colorMin;
  const normFactor = Math.abs(range) > 1e-10 ? 1 / range : 0;

  for (let i = 0; i < data.length; i++) {
    const normalized = (data[i] - colorMin) * normFactor;
    const clamped = Math.max(0, Math.min(1, normalized));

    let r: number, g: number, b: number;

    switch (colormap) {
      case "viridis":
        r = 0.267 + clamped * (0.329 + clamped * (1.452 - clamped * 1.046));
        g = Math.pow(clamped, 0.5);
        b = 0.329 + clamped * (1.452 - clamped * 1.781);
        break;
      case "plasma":
        r = Math.min(0.05 + clamped * 2.5, 1);
        g = Math.min(clamped * clamped * 0.8, 1);
        b = Math.max(0, Math.min(0.533 - clamped * 0.533 + clamped * clamped * 0.5, 1));
        break;
      case "inferno":
        r = Math.min(clamped * 2, 1);
        g = Math.min(clamped * clamped * 1.5, 1);
        b = Math.max(0, Math.min(0.2 + clamped * 0.6 - clamped * clamped * 0.8, 1));
        break;
      case "magma":
        r = Math.min(clamped * 1.8, 1);
        g = Math.min(clamped * clamped * 1.2, 1);
        b = Math.min(0.4 + clamped * 0.6, 1);
        break;
      case "coolwarm":
        r = clamped < 0.5 ? clamped * 2 : 1;
        g = clamped < 0.5 ? clamped * 2 : 2 - clamped * 2;
        b = clamped < 0.5 ? 1 : 2 - clamped * 2;
        break;
      default:
        r = g = b = clamped;
    }

    result[i * 3] = Math.round(Math.max(0, Math.min(1, r)) * 255);
    result[i * 3 + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
    result[i * 3 + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255);
  }

  return result;
}

function computeHeatmapStatsJS(data: number[], floorValue: number): HeatmapStats {
  const floor = floorValue > 0 ? floorValue : 0.001;
  let min = Infinity;
  let max = -Infinity;
  let mean = 0;
  let m2 = 0;
  let count = 0;

  for (const value of data) {
    if (!Number.isFinite(value)) continue;

    const logVal = Math.log10(Math.max(value, floor));
    count++;
    min = Math.min(min, logVal);
    max = Math.max(max, logVal);

    const delta = logVal - mean;
    mean += delta / count;
    const delta2 = logVal - mean;
    m2 += delta * delta2;
  }

  const variance = count > 1 ? m2 / (count - 1) : 0;
  const std = Math.sqrt(variance);

  return {
    min,
    max,
    mean,
    std,
    count,
    scaleMin: mean - 3 * std,
    scaleMax: mean + 3 * std,
  };
}

function transformHeatmapLog10JS(data: number[], floorValue: number): number[] {
  const floor = floorValue > 0 ? floorValue : 0.001;
  return data.map((v) =>
    Number.isFinite(v) ? Math.log10(Math.max(v, floor)) : 0,
  );
}

// ============================================================================
// OVERVIEW PLOT OPTIMIZATION
// ============================================================================

export interface ChannelRange {
  min: number;
  max: number;
  range: number;
}

export interface NormalizedOverviewData {
  normalizedMins: number[][];
  normalizedMaxs: number[][];
  channelRanges: ChannelRange[];
}

/**
 * Compute min, max, and range for all channels in a single batch operation.
 * Optimized for OverviewPlot channel normalization.
 */
export function computeChannelRangesBatch(data: number[][]): ChannelRange[] {
  if (data.length === 0) return [];

  const numChannels = data.length;
  const pointsPerChannel = data[0].length;

  if (!wasmFunctions) {
    return data.map((channelData) => {
      let min = Infinity;
      let max = -Infinity;
      for (const v of channelData) {
        if (Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (!Number.isFinite(min)) min = 0;
      if (!Number.isFinite(max)) max = 1;
      const range = Math.abs(max - min) < 1e-10 ? 1 : max - min;
      return { min, max, range };
    });
  }

  const flatData = new Float64Array(numChannels * pointsPerChannel);
  for (let ch = 0; ch < numChannels; ch++) {
    flatData.set(data[ch], ch * pointsPerChannel);
  }

  const result = wasmFunctions.compute_channel_ranges_batch(
    flatData,
    numChannels,
    pointsPerChannel,
  );

  const ranges: ChannelRange[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const offset = ch * 3;
    ranges.push({
      min: result[offset],
      max: result[offset + 1],
      range: result[offset + 2],
    });
  }

  return ranges;
}

/**
 * Normalize overview min-max data for all channels and extract min/max series.
 * Combines range calculation, normalization, and min/max extraction in one WASM call.
 *
 * @param data - Raw overview data where each channel has alternating min/max pairs
 * @returns Normalized mins, maxs, and channel ranges
 */
export function normalizeOverviewData(data: number[][]): NormalizedOverviewData {
  if (data.length === 0) {
    return { normalizedMins: [], normalizedMaxs: [], channelRanges: [] };
  }

  const numChannels = data.length;
  const pointsPerChannel = data[0].length;
  const pairsPerChannel = Math.floor(pointsPerChannel / 2);

  if (!wasmFunctions) {
    const channelRanges: ChannelRange[] = [];
    const normalizedMins: number[][] = [];
    const normalizedMaxs: number[][] = [];

    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = data[ch];
      let min = Infinity;
      let max = -Infinity;

      for (const v of channelData) {
        if (Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }

      if (!Number.isFinite(min)) min = 0;
      if (!Number.isFinite(max)) max = 1;
      const range = Math.abs(max - min) < 1e-10 ? 1 : max - min;
      channelRanges.push({ min, max, range });

      const mins: number[] = [];
      const maxs: number[] = [];
      for (let i = 0; i < channelData.length; i += 2) {
        const minVal = channelData[i];
        const maxVal = channelData[i + 1];
        mins.push(Number.isFinite(minVal) ? (minVal - min) / range : 0.5);
        maxs.push(Number.isFinite(maxVal) ? (maxVal - min) / range : 0.5);
      }
      normalizedMins.push(mins);
      normalizedMaxs.push(maxs);
    }

    return { normalizedMins, normalizedMaxs, channelRanges };
  }

  const flatData = new Float64Array(numChannels * pointsPerChannel);
  for (let ch = 0; ch < numChannels; ch++) {
    flatData.set(data[ch], ch * pointsPerChannel);
  }

  const result = wasmFunctions.normalize_overview_data(
    flatData,
    numChannels,
    pairsPerChannel,
  );

  const normalizedMins: number[][] = [];
  const normalizedMaxs: number[][] = [];
  const channelRanges: ChannelRange[] = [];

  let offset = 0;
  for (let ch = 0; ch < numChannels; ch++) {
    normalizedMins.push(Array.from(result.slice(offset, offset + pairsPerChannel)));
    offset += pairsPerChannel;
  }

  for (let ch = 0; ch < numChannels; ch++) {
    normalizedMaxs.push(Array.from(result.slice(offset, offset + pairsPerChannel)));
    offset += pairsPerChannel;
  }

  for (let ch = 0; ch < numChannels; ch++) {
    channelRanges.push({
      min: result[offset],
      max: result[offset + 1],
      range: result[offset + 2],
    });
    offset += 3;
  }

  return { normalizedMins, normalizedMaxs, channelRanges };
}

/**
 * Prepare canvas coordinates for overview plot rendering.
 * Pre-calculates all x,y pixel positions for vertical bars.
 *
 * @returns Array of [x, yBottom, yTop] coordinates for each point
 */
export function prepareOverviewCoordinates(
  xData: number[],
  minData: number[],
  maxData: number[],
  plotLeft: number,
  plotTop: number,
  plotWidth: number,
  plotHeight: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  step: number,
): Float64Array {
  if (!wasmFunctions) {
    const len = Math.min(xData.length, minData.length, maxData.length);
    const numPoints = Math.ceil(len / step);
    const result = new Float64Array(numPoints * 3);
    const xRange = xMax - xMin;
    const yRange = yMax - yMin;

    if (Math.abs(xRange) < 1e-10 || Math.abs(yRange) < 1e-10) {
      return new Float64Array(0);
    }

    let resultIdx = 0;
    for (let i = 0; i < len; i += step) {
      const xVal = xData[i];
      const yMinVal = minData[i];
      const yMaxVal = maxData[i];

      if (Number.isFinite(xVal) && Number.isFinite(yMinVal) && Number.isFinite(yMaxVal)) {
        const x = plotLeft + ((xVal - xMin) / xRange) * plotWidth;
        const yBottom = plotTop + plotHeight - ((yMinVal - yMin) / yRange) * plotHeight;
        const yTop = plotTop + plotHeight - ((yMaxVal - yMin) / yRange) * plotHeight;

        if (Number.isFinite(x) && Number.isFinite(yBottom) && Number.isFinite(yTop)) {
          result[resultIdx++] = x;
          result[resultIdx++] = yBottom;
          result[resultIdx++] = yTop;
        }
      }
    }

    return result.slice(0, resultIdx);
  }

  const float64X = new Float64Array(xData);
  const float64Min = new Float64Array(minData);
  const float64Max = new Float64Array(maxData);

  return wasmFunctions.prepare_overview_coordinates(
    float64X,
    float64Min,
    float64Max,
    plotLeft,
    plotTop,
    plotWidth,
    plotHeight,
    xMin,
    xMax,
    yMin,
    yMax,
    step,
  );
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

// ============================================================================
// FUZZY SEARCH
// ============================================================================

/**
 * Calculate Levenshtein distance between two strings
 * Returns the minimum number of single-character edits needed
 */
export function levenshteinDistance(a: string, b: string): number {
  if (!wasmFunctions) {
    return levenshteinDistanceJS(a, b);
  }

  return wasmFunctions.levenshtein_distance(a, b);
}

/**
 * Calculate trigram similarity between two strings (Sørensen-Dice coefficient)
 * Returns 0.0 to 1.0, where 1.0 is identical
 */
export function trigramSimilarity(a: string, b: string): number {
  if (!wasmFunctions) {
    return trigramSimilarityJS(a, b);
  }

  return wasmFunctions.trigram_similarity(a, b);
}

/**
 * Batch Levenshtein distance calculation for multiple targets
 * More efficient than calling levenshteinDistance in a loop
 */
export function levenshteinBatch(query: string, targets: string[]): number[] {
  if (!wasmFunctions) {
    return targets.map((t) => levenshteinDistanceJS(query, t));
  }

  // Join targets with null character for WASM
  const joinedTargets = targets.join("\0");
  const result = wasmFunctions.levenshtein_batch(query, joinedTargets);
  return Array.from(result);
}

/**
 * Batch trigram similarity calculation for multiple targets
 * More efficient than calling trigramSimilarity in a loop
 */
export function trigramSimilarityBatch(
  query: string,
  targets: string[],
): number[] {
  if (!wasmFunctions) {
    return targets.map((t) => trigramSimilarityJS(query, t));
  }

  // Join targets with null character for WASM
  const joinedTargets = targets.join("\0");
  const result = wasmFunctions.trigram_similarity_batch(query, joinedTargets);
  return Array.from(result);
}

/**
 * Async batch Levenshtein distance using worker pool when WASM unavailable
 * Use this for large target lists (>500) when WASM is not available
 */
export async function levenshteinBatchAsync(
  query: string,
  targets: string[],
): Promise<number[]> {
  if (wasmFunctions) {
    const joinedTargets = targets.join("\0");
    const result = wasmFunctions.levenshtein_batch(query, joinedTargets);
    return Array.from(result);
  }

  // Use worker pool for parallelized fallback
  const { levenshteinBatchParallel } = await import(
    "@/hooks/useFuzzySearchPool"
  );
  return levenshteinBatchParallel(query, targets);
}

/**
 * Async batch trigram similarity using worker pool when WASM unavailable
 * Use this for large target lists (>500) when WASM is not available
 */
export async function trigramSimilarityBatchAsync(
  query: string,
  targets: string[],
): Promise<number[]> {
  if (wasmFunctions) {
    const joinedTargets = targets.join("\0");
    const result = wasmFunctions.trigram_similarity_batch(query, joinedTargets);
    return Array.from(result);
  }

  // Use worker pool for parallelized fallback
  const { trigramBatchParallel } = await import("@/hooks/useFuzzySearchPool");
  return trigramBatchParallel(query, targets);
}

// JS Fallback implementations for fuzzy search

function levenshteinDistanceJS(a: string, b: string): number {
  // Optimization: if length difference is too large, skip calculation
  if (Math.abs(a.length - b.length) > 3) {
    return 999;
  }

  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower.length === 0) return bLower.length;
  if (bLower.length === 0) return aLower.length;

  // Use two rows instead of full matrix for O(n) space
  let prevRow: number[] = Array.from(
    { length: aLower.length + 1 },
    (_, i) => i,
  );
  let currRow: number[] = new Array(aLower.length + 1).fill(0);

  for (let i = 0; i < bLower.length; i++) {
    currRow[0] = i + 1;

    for (let j = 0; j < aLower.length; j++) {
      const cost = aLower[j] === bLower[i] ? 0 : 1;
      currRow[j + 1] = Math.min(
        prevRow[j + 1] + 1, // deletion
        currRow[j] + 1, // insertion
        prevRow[j] + cost, // substitution
      );
    }

    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[aLower.length];
}

function trigramSimilarityJS(a: string, b: string): number {
  const generateTrigrams = (str: string): Set<string> => {
    const trigrams = new Set<string>();
    const normalized = str.toLowerCase();
    const padded = `  ${normalized}  `;

    for (let i = 0; i < padded.length - 2; i++) {
      trigrams.add(padded.slice(i, i + 3));
    }

    return trigrams;
  };

  const trigramsA = generateTrigrams(a);
  const trigramsB = generateTrigrams(b);

  if (trigramsA.size === 0 || trigramsB.size === 0) {
    return 0;
  }

  const intersection = new Set([...trigramsA].filter((x) => trigramsB.has(x)));

  // Sørensen-Dice coefficient
  return (2 * intersection.size) / (trigramsA.size + trigramsB.size);
}

// ============================================================================
// PREPROCESSING - Smoothing and Outlier Removal
// ============================================================================

export type OutlierRemovalMethod = "clip" | "nan" | "interpolate";

/**
 * Apply moving average smoothing
 * Uses WASM for ~3-5x performance improvement
 */
export function movingAverage(data: number[], windowSize: number): number[] {
  if (!wasmFunctions) {
    return movingAverageJS(data, windowSize);
  }

  const float64Data = new Float64Array(data);
  const result = wasmFunctions.moving_average(float64Data, windowSize);
  return Array.from(result);
}

/**
 * Apply moving average to multiple channels at once
 */
export function movingAverageChannels(
  data: number[][],
  windowSize: number,
): number[][] {
  if (data.length === 0) return [];

  const pointsPerChannel = data[0].length;
  const numChannels = data.length;

  if (!wasmFunctions) {
    return data.map((channelData) => movingAverageJS(channelData, windowSize));
  }

  // Flatten data for WASM
  const flatData = new Float64Array(numChannels * pointsPerChannel);
  for (let ch = 0; ch < numChannels; ch++) {
    flatData.set(data[ch], ch * pointsPerChannel);
  }

  const flatResult = wasmFunctions.moving_average_channels(
    flatData,
    numChannels,
    pointsPerChannel,
    windowSize,
  );

  // Split results back into channels
  const results: number[][] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const start = ch * pointsPerChannel;
    const end = start + pointsPerChannel;
    results.push(Array.from(flatResult.slice(start, end)));
  }

  return results;
}

/**
 * Apply Savitzky-Golay polynomial smoothing
 * Preserves features better than moving average
 * Uses WASM for ~5-7x performance improvement
 */
export function savitzkyGolay(
  data: number[],
  windowSize: number,
  polynomialOrder: number,
): number[] {
  if (!wasmFunctions) {
    return savitzkyGolayJS(data, windowSize, polynomialOrder);
  }

  const float64Data = new Float64Array(data);
  const result = wasmFunctions.savitzky_golay(
    float64Data,
    windowSize,
    polynomialOrder,
  );
  return Array.from(result);
}

/**
 * Remove outliers using z-score threshold
 * @param method 0 = clip, 1 = replace with NaN, 2 = interpolate
 */
export function removeOutliers(
  data: number[],
  method: OutlierRemovalMethod,
  threshold: number,
): number[] {
  const methodCode = { clip: 0, nan: 1, interpolate: 2 }[method];

  if (!wasmFunctions) {
    return removeOutliersJS(data, method, threshold);
  }

  const float64Data = new Float64Array(data);
  const result = wasmFunctions.remove_outliers(
    float64Data,
    methodCode,
    threshold,
  );
  return Array.from(result);
}

// JS Fallback implementations for preprocessing

function movingAverageJS(data: number[], windowSize: number): number[] {
  const halfWindow = Math.floor(windowSize / 2);
  const result = new Array(data.length);

  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(data.length, i + halfWindow + 1);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += data[j];
    }
    result[i] = sum / (end - start);
  }

  return result;
}

function savitzkyGolayJS(
  data: number[],
  windowSize: number,
  polynomialOrder: number,
): number[] {
  // Ensure window size is odd
  if (windowSize % 2 === 0) windowSize++;

  // Clamp polynomial order
  if (polynomialOrder >= windowSize) {
    polynomialOrder = windowSize - 1;
  }

  // Pre-computed coefficients for common configurations
  const coefficients: Record<string, Record<number, number[]>> = {
    "5": {
      2: [-3, 12, 17, 12, -3],
      3: [-2, 3, 6, 7, 6, 3, -2],
    },
    "7": {
      2: [-2, 3, 6, 7, 6, 3, -2],
      3: [-3, 12, 17, 12, -3],
    },
    "9": {
      2: [-21, 14, 39, 54, 59, 54, 39, 14, -21],
      4: [15, -55, 30, 135, 179, 135, 30, -55, 15],
    },
    "11": {
      2: [-36, 9, 44, 69, 84, 89, 84, 69, 44, 9, -36],
      4: [18, -45, -10, 60, 120, 143, 120, 60, -10, -45, 18],
    },
  };

  const key = windowSize.toString();
  let coefs: number[];
  if (coefficients[key] && coefficients[key][polynomialOrder]) {
    coefs = coefficients[key][polynomialOrder];
    const sum = coefs.reduce((a, b) => a + b, 0);
    coefs = coefs.map((c) => c / sum);
  } else {
    // Fallback: moving average
    coefs = new Array(windowSize).fill(1 / windowSize);
  }

  const halfWindow = Math.floor(windowSize / 2);
  const result: number[] = [];

  for (let i = 0; i < data.length; i++) {
    let sum = 0;
    let weightSum = 0;

    for (let j = -halfWindow; j <= halfWindow; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < data.length) {
        const coefIdx = j + halfWindow;
        sum += data[idx] * coefs[coefIdx];
        weightSum += coefs[coefIdx];
      }
    }

    result.push(weightSum > 0 ? sum / weightSum : data[i]);
  }

  return result;
}

function removeOutliersJS(
  data: number[],
  method: OutlierRemovalMethod,
  threshold: number,
): number[] {
  // Calculate mean and std
  let sum = 0;
  let count = 0;
  for (const val of data) {
    if (Number.isFinite(val)) {
      sum += val;
      count++;
    }
  }
  const mean = count > 0 ? sum / count : 0;

  let varianceSum = 0;
  for (const val of data) {
    if (Number.isFinite(val)) {
      varianceSum += (val - mean) ** 2;
    }
  }
  const std = count > 1 ? Math.sqrt(varianceSum / (count - 1)) : 0;

  const lowerBound = mean - threshold * std;
  const upperBound = mean + threshold * std;

  if (method === "clip") {
    return data.map((val) => Math.max(lowerBound, Math.min(upperBound, val)));
  } else if (method === "nan") {
    return data.map((val) =>
      val < lowerBound || val > upperBound ? NaN : val,
    );
  } else {
    // interpolate
    const result = [...data];
    for (let i = 0; i < result.length; i++) {
      if (result[i] < lowerBound || result[i] > upperBound) {
        let prev = i - 1;
        while (
          prev >= 0 &&
          (result[prev] < lowerBound || result[prev] > upperBound)
        )
          prev--;
        let next = i + 1;
        while (
          next < result.length &&
          (result[next] < lowerBound || result[next] > upperBound)
        )
          next++;

        if (prev >= 0 && next < result.length) {
          const alpha = (i - prev) / (next - prev);
          result[i] = result[prev] + alpha * (result[next] - result[prev]);
        } else if (prev >= 0) {
          result[i] = result[prev];
        } else if (next < result.length) {
          result[i] = result[next];
        }
      }
    }
    return result;
  }
}
