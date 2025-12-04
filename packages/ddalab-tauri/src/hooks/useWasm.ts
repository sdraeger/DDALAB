/**
 * React hook for using WASM signal processing
 *
 * Handles initialization and provides type-safe access to WASM functions.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  initWasm,
  isWasmReady,
  isWasmAvailable,
  // Decimation
  computeChannelStats,
  computeMultiChannelStats,
  decimateData,
  decimateChannels,
  // Signal Processing - Filters
  filterHighpass,
  filterLowpass,
  filterBandpass,
  filterNotch,
  filterNotchMulti,
  // Signal Processing - FFT
  computeFftMagnitude,
  computePsd,
  getFftFrequencies,
  // Signal Processing - Normalization
  zscoreNormalize,
  zscoreNormalizeChannels,
  // Statistical Computations
  computePercentiles,
  computeIqr,
  detectArtifacts,
  detectArtifactsGradient,
  // Matrix Operations
  normalizeHeatmap,
  applyColormap,
  computeCorrelationMatrix,
  // Data Compression
  decompressLz4,
  compressLz4,
  parseF64Array,
  parseF32Array,
  // Types
  type ChannelStats,
  type IQRResult,
  type DecimationMethod,
  type Colormap,
} from "@/services/wasmService";

interface UseWasmResult {
  /** Whether WASM module is ready to use */
  isReady: boolean;
  /** Whether WASM is currently loading */
  isLoading: boolean;
  /** Whether actual WASM (not JS fallback) is available */
  isWasmNative: boolean;
  /** Error if initialization failed */
  error: Error | null;

  // Decimation
  computeStats: (data: number[]) => ChannelStats;
  computeMultiStats: (data: number[][]) => ChannelStats[];
  decimate: (
    data: number[],
    targetPoints: number,
    method?: DecimationMethod,
  ) => number[];
  decimateMulti: (
    data: number[][],
    targetPoints: number,
    method?: DecimationMethod,
  ) => number[][];

  // Signal Processing - Filters
  highpass: (
    data: number[],
    cutoffFreq: number,
    sampleRate: number,
  ) => number[];
  lowpass: (data: number[], cutoffFreq: number, sampleRate: number) => number[];
  bandpass: (
    data: number[],
    lowCutoff: number,
    highCutoff: number,
    sampleRate: number,
  ) => number[];
  notch: (
    data: number[],
    notchFreq: number,
    sampleRate: number,
    qFactor?: number,
  ) => number[];
  notchMulti: (
    data: number[],
    notchFreqs: number[],
    sampleRate: number,
  ) => number[];

  // Signal Processing - FFT
  fftMagnitude: (data: number[]) => number[];
  psd: (data: number[], sampleRate: number) => number[];
  fftFrequencies: (dataLength: number, sampleRate: number) => number[];

  // Signal Processing - Normalization
  zscore: (data: number[]) => number[];
  zscoreMulti: (data: number[][]) => number[][];

  // Statistical Computations
  percentiles: (data: number[], percentiles: number[]) => number[];
  iqr: (data: number[]) => IQRResult;
  artifacts: (data: number[], thresholdStd: number) => number[];
  artifactsGradient: (data: number[], threshold: number) => number[];

  // Matrix Operations
  normalizeMatrix: (data: number[], rows: number, cols: number) => number[];
  colormap: (data: number[], colormap: Colormap) => Uint8Array;
  correlationMatrix: (data: number[][]) => number[][];

  // Data Compression
  lz4Decompress: (compressed: Uint8Array) => Uint8Array;
  lz4Compress: (data: Uint8Array) => Uint8Array;
  parseF64: (bytes: Uint8Array) => number[];
  parseF32: (bytes: Uint8Array) => number[];
}

/**
 * Hook to access WASM signal processing functions.
 *
 * Automatically initializes the WASM module on first use.
 * Falls back to JS implementations if WASM is unavailable.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isReady, computeStats, decimate, fftMagnitude } = useWasm();
 *
 *   const handleData = (data: number[]) => {
 *     const stats = computeStats(data);
 *     const decimated = decimate(data, 1000, 'lttb');
 *     const spectrum = fftMagnitude(data);
 *     console.log('Stats:', stats);
 *   };
 *
 *   return <div>{isReady ? 'WASM Ready' : 'Loading...'}</div>;
 * }
 * ```
 */
export function useWasm(): UseWasmResult {
  const [isReady, setIsReady] = useState(isWasmReady());
  const [isLoading, setIsLoading] = useState(!isWasmReady());
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (isWasmReady()) {
      setIsReady(true);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    setIsLoading(true);
    initWasm()
      .then(() => {
        if (!cancelled) {
          setIsReady(true);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[useWasm] Initialization failed:", err);
          setError(err);
          setIsLoading(false);
          // Still mark as ready - fallback JS implementations will be used
          setIsReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Memoize all functions to prevent unnecessary re-renders
  // Decimation
  const computeStats = useCallback(
    (data: number[]) => computeChannelStats(data),
    [],
  );
  const computeMultiStats = useCallback(
    (data: number[][]) => computeMultiChannelStats(data),
    [],
  );
  const decimate = useCallback(
    (data: number[], targetPoints: number, method: DecimationMethod = "lttb") =>
      decimateData(data, targetPoints, method),
    [],
  );
  const decimateMulti = useCallback(
    (
      data: number[][],
      targetPoints: number,
      method: DecimationMethod = "lttb",
    ) => decimateChannels(data, targetPoints, method),
    [],
  );

  // Signal Processing - Filters
  const highpass = useCallback(
    (data: number[], cutoffFreq: number, sampleRate: number) =>
      filterHighpass(data, cutoffFreq, sampleRate),
    [],
  );
  const lowpass = useCallback(
    (data: number[], cutoffFreq: number, sampleRate: number) =>
      filterLowpass(data, cutoffFreq, sampleRate),
    [],
  );
  const bandpass = useCallback(
    (
      data: number[],
      lowCutoff: number,
      highCutoff: number,
      sampleRate: number,
    ) => filterBandpass(data, lowCutoff, highCutoff, sampleRate),
    [],
  );
  const notch = useCallback(
    (
      data: number[],
      notchFreq: number,
      sampleRate: number,
      qFactor: number = 35,
    ) => filterNotch(data, notchFreq, sampleRate, qFactor),
    [],
  );
  const notchMulti = useCallback(
    (data: number[], notchFreqs: number[], sampleRate: number) =>
      filterNotchMulti(data, notchFreqs, sampleRate),
    [],
  );

  // Signal Processing - FFT
  const fftMagnitude = useCallback(
    (data: number[]) => computeFftMagnitude(data),
    [],
  );
  const psd = useCallback(
    (data: number[], sampleRate: number) => computePsd(data, sampleRate),
    [],
  );
  const fftFrequencies = useCallback(
    (dataLength: number, sampleRate: number) =>
      getFftFrequencies(dataLength, sampleRate),
    [],
  );

  // Signal Processing - Normalization
  const zscore = useCallback((data: number[]) => zscoreNormalize(data), []);
  const zscoreMulti = useCallback(
    (data: number[][]) => zscoreNormalizeChannels(data),
    [],
  );

  // Statistical Computations
  const percentiles = useCallback(
    (data: number[], pcts: number[]) => computePercentiles(data, pcts),
    [],
  );
  const iqr = useCallback((data: number[]) => computeIqr(data), []);
  const artifacts = useCallback(
    (data: number[], thresholdStd: number) =>
      detectArtifacts(data, thresholdStd),
    [],
  );
  const artifactsGradient = useCallback(
    (data: number[], threshold: number) =>
      detectArtifactsGradient(data, threshold),
    [],
  );

  // Matrix Operations
  const normalizeMatrix = useCallback(
    (data: number[], rows: number, cols: number) =>
      normalizeHeatmap(data, rows, cols),
    [],
  );
  const colormap = useCallback(
    (data: number[], cm: Colormap) => applyColormap(data, cm),
    [],
  );
  const correlationMatrix = useCallback(
    (data: number[][]) => computeCorrelationMatrix(data),
    [],
  );

  // Data Compression
  const lz4Decompress = useCallback(
    (compressed: Uint8Array) => decompressLz4(compressed),
    [],
  );
  const lz4Compress = useCallback((data: Uint8Array) => compressLz4(data), []);
  const parseF64 = useCallback((bytes: Uint8Array) => parseF64Array(bytes), []);
  const parseF32 = useCallback((bytes: Uint8Array) => parseF32Array(bytes), []);

  return useMemo(
    () => ({
      isReady,
      isLoading,
      isWasmNative: isWasmAvailable(),
      error,
      // Decimation
      computeStats,
      computeMultiStats,
      decimate,
      decimateMulti,
      // Filters
      highpass,
      lowpass,
      bandpass,
      notch,
      notchMulti,
      // FFT
      fftMagnitude,
      psd,
      fftFrequencies,
      // Normalization
      zscore,
      zscoreMulti,
      // Statistics
      percentiles,
      iqr,
      artifacts,
      artifactsGradient,
      // Matrix
      normalizeMatrix,
      colormap,
      correlationMatrix,
      // Compression
      lz4Decompress,
      lz4Compress,
      parseF64,
      parseF32,
    }),
    [
      isReady,
      isLoading,
      error,
      computeStats,
      computeMultiStats,
      decimate,
      decimateMulti,
      highpass,
      lowpass,
      bandpass,
      notch,
      notchMulti,
      fftMagnitude,
      psd,
      fftFrequencies,
      zscore,
      zscoreMulti,
      percentiles,
      iqr,
      artifacts,
      artifactsGradient,
      normalizeMatrix,
      colormap,
      correlationMatrix,
      lz4Decompress,
      lz4Compress,
      parseF64,
      parseF32,
    ],
  );
}

/**
 * Initialize WASM at app startup (optional but recommended).
 * Call this in your root component or _app.tsx to preload WASM.
 *
 * @example
 * ```tsx
 * // In _app.tsx or layout.tsx
 * useEffect(() => {
 *   preloadWasm();
 * }, []);
 * ```
 */
export function preloadWasm(): void {
  initWasm().catch((err) => {
    console.warn("[preloadWasm] Failed to preload WASM:", err);
  });
}

// Re-export types for convenience
export type { ChannelStats, IQRResult, DecimationMethod, Colormap };
