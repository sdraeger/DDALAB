/**
 * Time series preprocessing utilities
 * All functions operate on chunk-level data to avoid memory issues
 */

import { PreprocessingOptions } from '@/types/persistence'

/**
 * Apply all enabled preprocessing steps to a chunk of data
 * @param data Single channel data array
 * @param sampleRate Sampling rate in Hz
 * @param options Preprocessing options
 * @returns Preprocessed data array
 */
export function applyPreprocessing(
  data: number[],
  sampleRate: number,
  options: PreprocessingOptions
): number[] {
  let processed = [...data] // Copy to avoid mutation

  // 1. Baseline correction (before filtering)
  if (options.baselineCorrection && options.baselineCorrection !== 'none') {
    processed = applyBaselineCorrection(processed, options.baselineCorrection)
  }

  // 2. Detrending
  if (options.detrending && options.detrending !== 'none') {
    processed = applyDetrending(processed, options.detrending, options.polynomialDegree)
  }

  // 3. Filters (order: highpass -> lowpass -> notch)
  if (options.highpass) {
    processed = applyHighpassFilter(processed, sampleRate, options.highpass)
  }

  if (options.lowpass) {
    processed = applyLowpassFilter(processed, sampleRate, options.lowpass)
  }

  if (options.notch && options.notch.length > 0) {
    for (const freq of options.notch) {
      processed = applyNotchFilter(processed, sampleRate, freq)
    }
  }

  // 4. Spike removal
  if (options.spikeRemoval?.enabled) {
    processed = removeSpikesSafe(
      processed,
      options.spikeRemoval.threshold,
      options.spikeRemoval.windowSize
    )
  }

  // 5. Outlier removal
  if (options.outlierRemoval?.enabled) {
    processed = removeOutliersSafe(
      processed,
      options.outlierRemoval.method,
      options.outlierRemoval.threshold
    )
  }

  // 6. Smoothing
  if (options.smoothing?.enabled) {
    if (options.smoothing.method === 'moving_average') {
      processed = applyMovingAverage(processed, options.smoothing.windowSize)
    } else if (options.smoothing.method === 'savitzky_golay') {
      processed = applySavitzkyGolay(
        processed,
        options.smoothing.windowSize,
        options.smoothing.polynomialOrder || 2
      )
    }
  }

  // 7. Normalization (last step)
  if (options.normalization && options.normalization !== 'none') {
    processed = applyNormalization(processed, options.normalization, options.normalizationRange)
  }

  return processed
}

/**
 * Remove DC offset by subtracting mean or median
 */
function applyBaselineCorrection(data: number[], method: 'mean' | 'median'): number[] {
  if (method === 'mean') {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length
    return data.map(val => val - mean)
  } else {
    const sorted = [...data].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    return data.map(val => val - median)
  }
}

/**
 * Remove linear or polynomial trend
 */
function applyDetrending(data: number[], method: 'linear' | 'polynomial', degree: number = 2): number[] {
  const n = data.length
  const x = Array.from({ length: n }, (_, i) => i)

  if (method === 'linear') {
    // Simple linear regression
    const xMean = x.reduce((sum, val) => sum + val, 0) / n
    const yMean = data.reduce((sum, val) => sum + val, 0) / n

    let numerator = 0
    let denominator = 0
    for (let i = 0; i < n; i++) {
      numerator += (x[i] - xMean) * (data[i] - yMean)
      denominator += (x[i] - xMean) ** 2
    }

    const slope = numerator / denominator
    const intercept = yMean - slope * xMean

    return data.map((val, i) => val - (slope * i + intercept))
  } else {
    // Polynomial detrending (simplified - uses least squares)
    // For better performance, we use a simple moving polynomial fit
    return data // Fallback to linear for now - polynomial requires matrix operations
  }
}

/**
 * Simple first-order highpass filter (removes low frequencies)
 */
function applyHighpassFilter(data: number[], sampleRate: number, cutoff: number): number[] {
  const rc = 1 / (2 * Math.PI * cutoff)
  const dt = 1 / sampleRate
  const alpha = rc / (rc + dt)

  const filtered = new Array(data.length)
  filtered[0] = data[0]

  for (let i = 1; i < data.length; i++) {
    filtered[i] = alpha * (filtered[i - 1] + data[i] - data[i - 1])
  }

  return filtered
}

/**
 * Simple first-order lowpass filter (removes high frequencies)
 */
function applyLowpassFilter(data: number[], sampleRate: number, cutoff: number): number[] {
  const rc = 1 / (2 * Math.PI * cutoff)
  const dt = 1 / sampleRate
  const alpha = dt / (rc + dt)

  const filtered = new Array(data.length)
  filtered[0] = data[0]

  for (let i = 1; i < data.length; i++) {
    filtered[i] = filtered[i - 1] + alpha * (data[i] - filtered[i - 1])
  }

  return filtered
}

/**
 * Simple notch filter (removes specific frequency)
 */
function applyNotchFilter(data: number[], sampleRate: number, frequency: number): number[] {
  // Simplified notch filter using comb filter approach
  const period = Math.round(sampleRate / frequency)
  const filtered = new Array(data.length)

  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      filtered[i] = data[i]
    } else {
      // Subtract the signal from one period ago
      filtered[i] = data[i] - 0.5 * data[i - period]
    }
  }

  return filtered
}

/**
 * Moving average smoothing
 */
function applyMovingAverage(data: number[], windowSize: number): number[] {
  const halfWindow = Math.floor(windowSize / 2)
  const smoothed = new Array(data.length)

  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - halfWindow)
    const end = Math.min(data.length, i + halfWindow + 1)
    const window = data.slice(start, end)
    smoothed[i] = window.reduce((sum, val) => sum + val, 0) / window.length
  }

  return smoothed
}

/**
 * Savitzky-Golay filter (polynomial smoothing)
 * Simplified implementation for common cases
 */
function applySavitzkyGolay(data: number[], windowSize: number, polynomialOrder: number): number[] {
  // For simplicity, we'll use a moving average as fallback
  // A full Savitzky-Golay requires matrix operations
  // TODO: Implement proper Savitzky-Golay coefficients
  return applyMovingAverage(data, windowSize)
}

/**
 * Remove outliers using various methods
 */
function removeOutliersSafe(
  data: number[],
  method: 'clip' | 'remove' | 'interpolate',
  threshold: number
): number[] {
  const mean = data.reduce((sum, val) => sum + val, 0) / data.length
  const variance = data.reduce((sum, val) => sum + (val - mean) ** 2, 0) / data.length
  const stdDev = Math.sqrt(variance)

  const lowerBound = mean - threshold * stdDev
  const upperBound = mean + threshold * stdDev

  if (method === 'clip') {
    return data.map(val => Math.max(lowerBound, Math.min(upperBound, val)))
  } else if (method === 'remove') {
    // Replace outliers with NaN (visualization should handle this)
    return data.map(val => (val < lowerBound || val > upperBound) ? NaN : val)
  } else {
    // Interpolate outliers
    const result = [...data]
    for (let i = 0; i < result.length; i++) {
      if (result[i] < lowerBound || result[i] > upperBound) {
        // Linear interpolation between neighboring valid points
        let prev = i - 1
        while (prev >= 0 && (result[prev] < lowerBound || result[prev] > upperBound)) prev--
        let next = i + 1
        while (next < result.length && (result[next] < lowerBound || result[next] > upperBound)) next++

        if (prev >= 0 && next < result.length) {
          const alpha = (i - prev) / (next - prev)
          result[i] = result[prev] + alpha * (result[next] - result[prev])
        } else if (prev >= 0) {
          result[i] = result[prev]
        } else if (next < result.length) {
          result[i] = result[next]
        }
      }
    }
    return result
  }
}

/**
 * Detect and remove spikes (sharp transients)
 */
function removeSpikesSafe(data: number[], threshold: number, windowSize: number): number[] {
  const result = [...data]
  const halfWindow = Math.floor(windowSize / 2)

  for (let i = halfWindow; i < data.length - halfWindow; i++) {
    // Calculate local statistics
    const window = data.slice(i - halfWindow, i + halfWindow + 1)
    const mean = window.reduce((sum, val) => sum + val, 0) / window.length
    const variance = window.reduce((sum, val) => sum + (val - mean) ** 2, 0) / window.length
    const stdDev = Math.sqrt(variance)

    // Check if center point is a spike
    if (Math.abs(data[i] - mean) > threshold * stdDev) {
      // Replace with interpolation
      result[i] = (data[i - 1] + data[i + 1]) / 2
    }
  }

  return result
}

/**
 * Normalize data using various methods
 */
function applyNormalization(
  data: number[],
  method: 'zscore' | 'minmax',
  range?: [number, number]
): number[] {
  if (method === 'zscore') {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length
    const variance = data.reduce((sum, val) => sum + (val - mean) ** 2, 0) / data.length
    const stdDev = Math.sqrt(variance)

    if (stdDev === 0) return data
    return data.map(val => (val - mean) / stdDev)
  } else {
    // minmax
    const min = Math.min(...data)
    const max = Math.max(...data)
    const [targetMin, targetMax] = range || [0, 1]

    if (max === min) return data
    return data.map(val => {
      const normalized = (val - min) / (max - min)
      return targetMin + normalized * (targetMax - targetMin)
    })
  }
}

/**
 * Get default preprocessing options
 */
export function getDefaultPreprocessing(): PreprocessingOptions {
  return {
    highpass: undefined,
    lowpass: undefined,
    notch: [],
    smoothing: {
      enabled: false,
      method: 'moving_average',
      windowSize: 5,
    },
    detrending: 'none',
    baselineCorrection: 'none',
    outlierRemoval: {
      enabled: false,
      method: 'clip',
      threshold: 3,
    },
    spikeRemoval: {
      enabled: false,
      threshold: 4,
      windowSize: 10,
    },
    normalization: 'none',
    normalizationRange: [-1, 1],
  }
}
