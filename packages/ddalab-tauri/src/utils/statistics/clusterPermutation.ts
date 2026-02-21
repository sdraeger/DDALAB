import { welchTTest } from "./inferential";

export interface ClusterInfo {
  start: number;
  end: number;
  mass: number;
  pValue: number;
  sign: "positive" | "negative";
}

export interface ClusterPermutationResult {
  tStatistics: number[];
  pointwisePValues: number[];
  clusters: ClusterInfo[];
  significantMask: boolean[];
  minClusterP: number;
  iterations: number;
}

interface ClusterPermutationOptions {
  iterations?: number;
  alpha?: number;
  clusterFormingT?: number;
}

function finiteValues(values: number[]): number[] {
  return values.filter((v) => Number.isFinite(v));
}

function mean(values: number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

function variance(values: number[], m: number): number {
  if (values.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - m;
    sum += d * d;
  }
  return sum / (values.length - 1);
}

function welchTStatistic(aRaw: number[], bRaw: number[]): number {
  const a = finiteValues(aRaw);
  const b = finiteValues(bRaw);
  if (a.length < 2 || b.length < 2) return NaN;

  const meanA = mean(a);
  const meanB = mean(b);
  const varA = variance(a, meanA);
  const varB = variance(b, meanB);
  const se = Math.sqrt(varA / a.length + varB / b.length);
  if (!Number.isFinite(se) || se === 0) return 0;
  return (meanA - meanB) / se;
}

function getWindow(values: number[][], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (window < row.length) {
      const v = row[window];
      if (Number.isFinite(v)) result.push(v);
    }
  }
  return result;
}

function buildObservedT(
  a: number[][],
  b: number[][],
  windows: number,
): number[] {
  const tStats = new Array<number>(windows);
  for (let w = 0; w < windows; w++) {
    tStats[w] = welchTStatistic(getWindow(a, w), getWindow(b, w));
  }
  return tStats;
}

interface RawCluster {
  start: number;
  end: number;
  mass: number;
  sign: "positive" | "negative";
}

function detectClusters(tStats: number[], threshold: number): RawCluster[] {
  const clusters: RawCluster[] = [];
  let idx = 0;

  while (idx < tStats.length) {
    const t = tStats[idx];
    if (!Number.isFinite(t) || Math.abs(t) < threshold) {
      idx += 1;
      continue;
    }

    const sign: "positive" | "negative" = t >= 0 ? "positive" : "negative";
    const start = idx;
    let mass = Math.abs(t);
    idx += 1;

    while (idx < tStats.length) {
      const next = tStats[idx];
      if (
        !Number.isFinite(next) ||
        Math.abs(next) < threshold ||
        (next >= 0 ? "positive" : "negative") !== sign
      ) {
        break;
      }
      mass += Math.abs(next);
      idx += 1;
    }

    clusters.push({
      start,
      end: idx - 1,
      mass,
      sign,
    });
  }

  return clusters;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

export function clusterPermutationTest(
  groupA: number[][],
  groupB: number[][],
  options: ClusterPermutationOptions = {},
): ClusterPermutationResult {
  const iterations = Math.max(100, options.iterations ?? 2000);
  const alpha = options.alpha ?? 0.05;
  const clusterFormingT = options.clusterFormingT ?? 2.0;

  const allSeries = [...groupA, ...groupB].filter((row) => row.length > 0);
  if (groupA.length < 2 || groupB.length < 2 || allSeries.length === 0) {
    return {
      tStatistics: [],
      pointwisePValues: [],
      clusters: [],
      significantMask: [],
      minClusterP: 1,
      iterations,
    };
  }

  const windowCount = allSeries.reduce(
    (minLen, row) => Math.min(minLen, row.length),
    Number.POSITIVE_INFINITY,
  );

  if (!Number.isFinite(windowCount) || windowCount < 2) {
    return {
      tStatistics: [],
      pointwisePValues: [],
      clusters: [],
      significantMask: [],
      minClusterP: 1,
      iterations,
    };
  }

  const A = groupA.map((row) => row.slice(0, windowCount));
  const B = groupB.map((row) => row.slice(0, windowCount));

  const observedT = buildObservedT(A, B, windowCount);
  const pointwisePValues = new Array<number>(windowCount);
  for (let w = 0; w < windowCount; w++) {
    const p = welchTTest(getWindow(A, w), getWindow(B, w)).pValue;
    pointwisePValues[w] = Number.isFinite(p) ? p : 1;
  }

  const observedClusters = detectClusters(observedT, clusterFormingT);
  if (observedClusters.length === 0) {
    return {
      tStatistics: observedT,
      pointwisePValues,
      clusters: [],
      significantMask: new Array(windowCount).fill(false),
      minClusterP: 1,
      iterations,
    };
  }

  const pooled = [...A, ...B];
  const nA = A.length;
  const permutedIndices = Array.from({ length: pooled.length }, (_, i) => i);
  const nullMaxClusterMasses = new Array<number>(iterations);

  for (let iter = 0; iter < iterations; iter++) {
    shuffleInPlace(permutedIndices);

    const permA: number[][] = [];
    const permB: number[][] = [];

    for (let i = 0; i < permutedIndices.length; i++) {
      const row = pooled[permutedIndices[i]];
      if (i < nA) {
        permA.push(row);
      } else {
        permB.push(row);
      }
    }

    const permT = buildObservedT(permA, permB, windowCount);
    const permClusters = detectClusters(permT, clusterFormingT);
    let maxMass = 0;
    for (let c = 0; c < permClusters.length; c++) {
      if (permClusters[c].mass > maxMass) {
        maxMass = permClusters[c].mass;
      }
    }
    nullMaxClusterMasses[iter] = maxMass;
  }

  const significantMask = new Array<boolean>(windowCount).fill(false);
  const clusters: ClusterInfo[] = observedClusters.map((cluster) => {
    let exceedCount = 0;
    for (let i = 0; i < nullMaxClusterMasses.length; i++) {
      if (nullMaxClusterMasses[i] >= cluster.mass) {
        exceedCount += 1;
      }
    }
    const pValue = (exceedCount + 1) / (iterations + 1);

    if (pValue < alpha) {
      for (let w = cluster.start; w <= cluster.end; w++) {
        significantMask[w] = true;
      }
    }

    return {
      start: cluster.start,
      end: cluster.end,
      mass: cluster.mass,
      pValue,
      sign: cluster.sign,
    };
  });

  const minClusterP = clusters.reduce(
    (minP, cluster) => Math.min(minP, cluster.pValue),
    1,
  );

  return {
    tStatistics: observedT,
    pointwisePValues,
    clusters,
    significantMask,
    minClusterP,
    iterations,
  };
}
