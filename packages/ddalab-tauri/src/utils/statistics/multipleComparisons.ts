export function fdrCorrection(pValues: number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];

  // Create indexed array and sort by p-value ascending
  const indexed = pValues.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => a.p - b.p);

  // Compute Benjamini-Hochberg q-values
  const qValues = new Array<number>(m);
  for (let rank = 0; rank < m; rank++) {
    qValues[rank] = (indexed[rank].p * m) / (rank + 1);
  }

  // Enforce monotonicity from right to left
  for (let i = m - 2; i >= 0; i--) {
    qValues[i] = Math.min(qValues[i], qValues[i + 1]);
  }

  // Map back to original order, clamping to [0, 1]
  const result = new Array<number>(m);
  for (let rank = 0; rank < m; rank++) {
    result[indexed[rank].i] = Math.min(qValues[rank], 1);
  }

  return result;
}

export function bonferroniCorrection(pValues: number[]): number[] {
  const m = pValues.length;
  return pValues.map((p) => Math.min(p * m, 1));
}
