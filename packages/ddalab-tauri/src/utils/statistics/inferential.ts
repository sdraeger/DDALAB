export interface TTestResult {
  tStatistic: number;
  degreesOfFreedom: number;
  pValue: number;
  meanDifference: number;
}

export interface PermutationResult {
  observedDifference: number;
  pValue: number;
  iterations: number;
}

// ---------------------------------------------------------------------------
// Regularized incomplete beta function (for Student's t CDF)
// Uses the continued fraction expansion (Lentz's algorithm)
// ---------------------------------------------------------------------------

const GAMMA_COEFFS = [
  76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
  0.001208650973866179, -0.000005395239384953,
];

function lnGamma(x: number): number {
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    ser += GAMMA_COEFFS[j] / ++y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betaCF(a: number, b: number, x: number): number {
  const maxIter = 200;
  const eps = 3e-12;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;

    // even step
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;

    // odd step
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1) < eps) break;
  }

  return h;
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const bt = Math.exp(
    lnGamma(a + b) -
      lnGamma(a) -
      lnGamma(b) +
      a * Math.log(x) +
      b * Math.log(1 - x),
  );

  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaCF(a, b, x)) / a;
  }
  return 1 - (bt * betaCF(b, a, 1 - x)) / b;
}

function studentTCDF(t: number, df: number): number {
  const x = df / (df + t * t);
  const ibeta = regularizedBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - 0.5 * ibeta : 0.5 * ibeta;
}

// ---------------------------------------------------------------------------
// Welch's t-test (two-sample, unequal variance, two-tailed)
// ---------------------------------------------------------------------------

function sampleMean(v: number[]): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i];
  return s / v.length;
}

function sampleVariance(v: number[], m: number): number {
  if (v.length < 2) return 0;
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    const d = v[i] - m;
    s += d * d;
  }
  return s / (v.length - 1);
}

export function welchTTest(a: number[], b: number[]): TTestResult {
  const nA = a.length;
  const nB = b.length;

  if (nA < 2 || nB < 2) {
    return {
      tStatistic: NaN,
      degreesOfFreedom: NaN,
      pValue: NaN,
      meanDifference: NaN,
    };
  }

  const meanA = sampleMean(a);
  const meanB = sampleMean(b);
  const varA = sampleVariance(a, meanA);
  const varB = sampleVariance(b, meanB);

  const seA = varA / nA;
  const seB = varB / nB;
  const seDiff = Math.sqrt(seA + seB);

  if (seDiff === 0) {
    return {
      tStatistic: 0,
      degreesOfFreedom: nA + nB - 2,
      pValue: 1,
      meanDifference: meanA - meanB,
    };
  }

  const t = (meanA - meanB) / seDiff;

  // Welch-Satterthwaite degrees of freedom
  const num = (seA + seB) ** 2;
  const den = seA ** 2 / (nA - 1) + seB ** 2 / (nB - 1);
  const df = num / den;

  // Two-tailed p-value
  const cdf = studentTCDF(Math.abs(t), df);
  const pValue = 2 * (1 - cdf);

  return {
    tStatistic: t,
    degreesOfFreedom: df,
    pValue: Math.min(pValue, 1),
    meanDifference: meanA - meanB,
  };
}

// ---------------------------------------------------------------------------
// Permutation test (two-sample, two-tailed)
// ---------------------------------------------------------------------------

export function permutationTest(
  a: number[],
  b: number[],
  iterations: number = 10000,
): PermutationResult {
  const nA = a.length;
  const nB = b.length;

  if (nA < 1 || nB < 1) {
    return { observedDifference: NaN, pValue: NaN, iterations };
  }

  const observedDiff = sampleMean(a) - sampleMean(b);
  const absObserved = Math.abs(observedDiff);

  const pooled = [...a, ...b];
  const n = pooled.length;
  let count = 0;

  for (let iter = 0; iter < iterations; iter++) {
    // Fisher-Yates shuffle
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pooled[i];
      pooled[i] = pooled[j];
      pooled[j] = tmp;
    }

    // Compute mean difference of shuffled split
    let sumA = 0;
    for (let i = 0; i < nA; i++) sumA += pooled[i];
    let sumB = 0;
    for (let i = nA; i < n; i++) sumB += pooled[i];
    const permDiff = Math.abs(sumA / nA - sumB / nB);

    if (permDiff >= absObserved) count++;
  }

  return {
    observedDifference: observedDiff,
    pValue: (count + 1) / (iterations + 1),
    iterations,
  };
}

// ---------------------------------------------------------------------------
// Cohen's d (pooled standard deviation)
// ---------------------------------------------------------------------------

export function cohensD(a: number[], b: number[]): number {
  const nA = a.length;
  const nB = b.length;

  if (nA < 2 || nB < 2) return NaN;

  const meanA = sampleMean(a);
  const meanB = sampleMean(b);
  const varA = sampleVariance(a, meanA);
  const varB = sampleVariance(b, meanB);

  const pooledVar = ((nA - 1) * varA + (nB - 1) * varB) / (nA + nB - 2);
  const pooledStd = Math.sqrt(pooledVar);

  if (pooledStd === 0) return 0;
  return (meanA - meanB) / pooledStd;
}
