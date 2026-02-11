export interface GroupDescriptiveStats {
  n: number;
  mean: number;
  std: number;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
  min: number;
  max: number;
  values: number[];
}

function filterFinite(values: number[]): number[] {
  return values.filter((v) => isFinite(v));
}

function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

function sampleStd(values: number[], m: number): number {
  if (values.length < 2) return 0;
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - m;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / (values.length - 1));
}

function quantile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];

  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

export function computeGroupStats(rawValues: number[]): GroupDescriptiveStats {
  const values = filterFinite(rawValues);
  const n = values.length;

  if (n === 0) {
    return {
      n: 0,
      mean: NaN,
      std: NaN,
      median: NaN,
      q1: NaN,
      q3: NaN,
      iqr: NaN,
      min: NaN,
      max: NaN,
      values: [],
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const m = mean(values);
  const med = quantile(sorted, 0.5);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);

  return {
    n,
    mean: m,
    std: sampleStd(values, m),
    median: med,
    q1,
    q3,
    iqr: q3 - q1,
    min: sorted[0],
    max: sorted[n - 1],
    values,
  };
}
