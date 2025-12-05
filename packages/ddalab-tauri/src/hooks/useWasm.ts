/**
 * React hook for using WASM signal processing
 *
 * Handles initialization and provides type-safe access to WASM functions.
 */

import { useEffect, useState, useMemo } from "react";
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
  isReady: boolean;
  isLoading: boolean;
  isWasmNative: boolean;
  error: Error | null;
  // Decimation
  computeStats: typeof computeChannelStats;
  computeMultiStats: typeof computeMultiChannelStats;
  decimate: typeof decimateData;
  decimateMulti: typeof decimateChannels;
  // Filters
  highpass: typeof filterHighpass;
  lowpass: typeof filterLowpass;
  bandpass: typeof filterBandpass;
  notch: typeof filterNotch;
  notchMulti: typeof filterNotchMulti;
  // FFT
  fftMagnitude: typeof computeFftMagnitude;
  psd: typeof computePsd;
  fftFrequencies: typeof getFftFrequencies;
  // Normalization
  zscore: typeof zscoreNormalize;
  zscoreMulti: typeof zscoreNormalizeChannels;
  // Statistics
  percentiles: typeof computePercentiles;
  iqr: typeof computeIqr;
  artifacts: typeof detectArtifacts;
  artifactsGradient: typeof detectArtifactsGradient;
  // Matrix
  normalizeMatrix: typeof normalizeHeatmap;
  colormap: typeof applyColormap;
  correlationMatrix: typeof computeCorrelationMatrix;
  // Compression
  lz4Decompress: typeof decompressLz4;
  lz4Compress: typeof compressLz4;
  parseF64: typeof parseF64Array;
  parseF32: typeof parseF32Array;
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
          setIsReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(
    () => ({
      isReady,
      isLoading,
      isWasmNative: isWasmAvailable(),
      error,
      // Decimation - direct function references (stable module imports)
      computeStats: computeChannelStats,
      computeMultiStats: computeMultiChannelStats,
      decimate: decimateData,
      decimateMulti: decimateChannels,
      // Filters
      highpass: filterHighpass,
      lowpass: filterLowpass,
      bandpass: filterBandpass,
      notch: filterNotch,
      notchMulti: filterNotchMulti,
      // FFT
      fftMagnitude: computeFftMagnitude,
      psd: computePsd,
      fftFrequencies: getFftFrequencies,
      // Normalization
      zscore: zscoreNormalize,
      zscoreMulti: zscoreNormalizeChannels,
      // Statistics
      percentiles: computePercentiles,
      iqr: computeIqr,
      artifacts: detectArtifacts,
      artifactsGradient: detectArtifactsGradient,
      // Matrix
      normalizeMatrix: normalizeHeatmap,
      colormap: applyColormap,
      correlationMatrix: computeCorrelationMatrix,
      // Compression
      lz4Decompress: decompressLz4,
      lz4Compress: compressLz4,
      parseF64: parseF64Array,
      parseF32: parseF32Array,
    }),
    [isReady, isLoading, error],
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
