import { describe, it, expect } from "vitest";
import { fdrCorrection, bonferroniCorrection } from "../multipleComparisons";

// ---------------------------------------------------------------------------
// Reference: R p.adjust(c(0.01, 0.04, 0.03, 0.005), method="BH")
// → [0.02, 0.04, 0.04, 0.02]
// ---------------------------------------------------------------------------

describe("fdrCorrection (Benjamini-Hochberg)", () => {
  it("matches R p.adjust for known p-values", () => {
    const raw = [0.01, 0.04, 0.03, 0.005];
    const corrected = fdrCorrection(raw);
    expect(corrected[0]).toBeCloseTo(0.02, 10);
    expect(corrected[1]).toBeCloseTo(0.04, 10);
    expect(corrected[2]).toBeCloseTo(0.04, 10);
    expect(corrected[3]).toBeCloseTo(0.02, 10);
  });

  it("returns empty array for empty input", () => {
    expect(fdrCorrection([])).toEqual([]);
  });

  it("returns same value for single p-value", () => {
    const corrected = fdrCorrection([0.03]);
    expect(corrected[0]).toBeCloseTo(0.03, 10);
  });

  it("clamps to 1.0", () => {
    const corrected = fdrCorrection([0.5, 0.8]);
    for (const q of corrected) {
      expect(q).toBeLessThanOrEqual(1);
    }
  });

  it("preserves original order", () => {
    // Input: [0.05, 0.01, 0.10]
    // Sorted: [0.01(idx1), 0.05(idx0), 0.10(idx2)]
    // q_sorted: [0.01*3/1=0.03, 0.05*3/2=0.075, 0.10*3/3=0.10]
    // monotonic: [0.03, 0.075, 0.10]
    // result[0]=0.075, result[1]=0.03, result[2]=0.10
    const corrected = fdrCorrection([0.05, 0.01, 0.1]);
    expect(corrected[0]).toBeCloseTo(0.075, 10);
    expect(corrected[1]).toBeCloseTo(0.03, 10);
    expect(corrected[2]).toBeCloseTo(0.1, 10);
  });

  it("enforces monotonicity", () => {
    // After BH adjustment, q-values should be non-decreasing in sorted order
    const raw = [0.001, 0.01, 0.04, 0.05, 0.5];
    const corrected = fdrCorrection(raw);
    const sortedCorrected = [...corrected].sort((a, b) => a - b);
    for (let i = 1; i < sortedCorrected.length; i++) {
      expect(sortedCorrected[i]).toBeGreaterThanOrEqual(sortedCorrected[i - 1]);
    }
  });

  it("corrected p-values are >= raw p-values", () => {
    const raw = [0.01, 0.02, 0.03, 0.04, 0.05];
    const corrected = fdrCorrection(raw);
    for (let i = 0; i < raw.length; i++) {
      expect(corrected[i]).toBeGreaterThanOrEqual(raw[i] - 1e-15);
    }
  });
});

describe("bonferroniCorrection", () => {
  it("multiplies each p-value by the number of tests", () => {
    const corrected = bonferroniCorrection([0.01, 0.02, 0.03]);
    expect(corrected[0]).toBeCloseTo(0.03, 10);
    expect(corrected[1]).toBeCloseTo(0.06, 10);
    expect(corrected[2]).toBeCloseTo(0.09, 10);
  });

  it("clamps to 1.0", () => {
    const corrected = bonferroniCorrection([0.5, 0.6]);
    expect(corrected[0]).toBe(1);
    expect(corrected[1]).toBe(1);
  });

  it("returns empty array for empty input", () => {
    expect(bonferroniCorrection([])).toEqual([]);
  });

  it("returns same value for single p-value", () => {
    const corrected = bonferroniCorrection([0.04]);
    expect(corrected[0]).toBeCloseTo(0.04, 10);
  });

  it("is more conservative than FDR", () => {
    const raw = [0.01, 0.02, 0.03, 0.04, 0.05];
    const fdr = fdrCorrection(raw);
    const bonf = bonferroniCorrection(raw);
    for (let i = 0; i < raw.length; i++) {
      expect(bonf[i]).toBeGreaterThanOrEqual(fdr[i] - 1e-15);
    }
  });
});
