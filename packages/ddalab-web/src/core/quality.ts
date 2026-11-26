// Non-destructive signal quality screening over a slice of raw multiplexed samples: detects flatlined/disconnected
// channels, amplifier rail clipping, and dominant 50/60 Hz mains line noise without altering the underlying data.

export type QualityFlag = "flat" | "clipped" | "50 Hz" | "60 Hz";

export interface ChannelQuality {
  channel: number;
  flags: QualityFlag[];
  /** Fraction of AC variance concentrated at 50 Hz (0..1), when Nyquist > 55 Hz. */
  line50Fraction: number;
  /** Fraction of AC variance concentrated at 60 Hz (0..1), when Nyquist > 65 Hz. */
  line60Fraction: number;
  /** Fraction of 1-second sub-windows that are constant (0..1). */
  flatFraction: number;
  /** Fraction of samples sitting on consecutive identical min/max extrema (0..1). */
  clippedFraction: number;
}

/** Exact single-bin Goertzel power of `freqHz` normalized to the signal's total AC variance (0..1). */
function goertzelPowerFraction(
  samples: Float32Array,
  stride: number,
  channel: number,
  rows: number,
  mean: number,
  variance: number,
  rateHz: number,
  freqHz: number,
): number {
  if (rows < 16 || variance <= 0 || rateHz <= 2 * freqHz + 5) return 0;
  const omega = (2 * Math.PI * freqHz) / rateHz;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  for (let r = 0; r < rows; r++) {
    const x = samples[r * stride + channel] - mean;
    const s0 = x + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  // Two-sided sinusoidal power: 2 * |X(f)|^2 / N^2 compared to sample variance.
  const magSq = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  const tonePower = (2 * magSq) / (rows * rows);
  return Math.min(1, Math.max(0, tonePower / variance));
}

/**
 * Assesses each channel in a multiplexed `Float32Array` of shape `(rows, nChannels)` sampled at `rateHz`.
 * Purely diagnostic: returns flags and metrics without modifying samples.
 */
export function assessChannelQuality(
  samples: Float32Array,
  nChannels: number,
  rateHz: number,
): ChannelQuality[] {
  const rows = nChannels > 0 ? Math.floor(samples.length / nChannels) : 0;
  const results: ChannelQuality[] = [];
  if (rows === 0 || nChannels === 0) return results;

  const subWin = Math.max(16, Math.min(rows, Math.round(rateHz || 256)));
  const nSubs = Math.max(1, Math.floor(rows / subWin));

  for (let ch = 0; ch < nChannels; ch++) {
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let r = 0; r < rows; r++) {
      const v = samples[r * nChannels + ch];
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const mean = sum / rows;
    const range = max - min;

    let varSum = 0;
    let flatSubs = 0;
    let clippedRuns = 0;
    const railEps = range > 0 ? range * 1e-6 : 0;

    for (let r = 0; r < rows; r++) {
      const v = samples[r * nChannels + ch];
      const d = v - mean;
      varSum += d * d;
      if (range > 0 && r > 0) {
        const prev = samples[(r - 1) * nChannels + ch];
        const atHigh = v >= max - railEps && prev >= max - railEps;
        const atLow = v <= min + railEps && prev <= min + railEps;
        if (atHigh || atLow) clippedRuns++;
      }
    }
    const variance = varSum / rows;
    const std = Math.sqrt(variance);

    for (let s = 0; s < nSubs; s++) {
      let sMin = Infinity;
      let sMax = -Infinity;
      const start = s * subWin;
      for (let r = start; r < start + subWin; r++) {
        const v = samples[r * nChannels + ch];
        if (v < sMin) sMin = v;
        if (v > sMax) sMax = v;
      }
      if (sMax - sMin <= 1e-12) flatSubs++;
    }

    const flatFraction = flatSubs / nSubs;
    const clippedFraction = rows > 1 ? clippedRuns / (rows - 1) : 0;
    const line50Fraction = goertzelPowerFraction(samples, nChannels, ch, rows, mean, variance, rateHz, 50);
    const line60Fraction = goertzelPowerFraction(samples, nChannels, ch, rows, mean, variance, rateHz, 60);

    const flags: QualityFlag[] = [];
    if (std <= 1e-12 || flatFraction >= 0.5) {
      flags.push("flat");
    } else {
      if (clippedFraction >= 0.02) flags.push("clipped");
      if (line50Fraction >= 0.35 && line50Fraction >= line60Fraction) flags.push("50 Hz");
      else if (line60Fraction >= 0.35) flags.push("60 Hz");
    }

    results.push({
      channel: ch,
      flags,
      line50Fraction,
      line60Fraction,
      flatFraction,
      clippedFraction,
    });
  }
  return results;
}

/** Human-readable tooltip summarizing numeric quality metrics for a channel. */
export function qualitySummary(q: ChannelQuality): string {
  const parts: string[] = [];
  if (q.flags.includes("flat")) parts.push(`flatline (${Math.round(q.flatFraction * 100)}% of windows)`);
  if (q.flags.includes("clipped"))
    parts.push(`rail clipping (${(q.clippedFraction * 100).toFixed(1)}% of samples)`);
  if (q.flags.includes("50 Hz"))
    parts.push(`50 Hz line noise (${Math.round(q.line50Fraction * 100)}% power)`);
  if (q.flags.includes("60 Hz"))
    parts.push(`60 Hz line noise (${Math.round(q.line60Fraction * 100)}% power)`);
  return parts.length > 0 ? `Quality flag: ${parts.join(", ")}` : "No signal quality flags";
}
