import { describe, it, expect } from "vitest";
import { welchTTest, permutationTest, cohensD } from "../inferential";

// ---------------------------------------------------------------------------
// Reference values verified by manual computation of Welch's t-test:
//   meanA=1.35, meanB=1.95, varA=varB=0.01667, seA=seB=0.004167
//   seDiff=sqrt(0.008333)=0.09129, t=-0.6/0.09129=-6.5727, df=6
//   Two-tailed p via regularized incomplete beta ≈ 0.000595
// ---------------------------------------------------------------------------

const GROUP_A = [1.2, 1.4, 1.3, 1.5];
const GROUP_B = [1.8, 2.0, 1.9, 2.1];

describe("welchTTest", () => {
  it("computes correct t-statistic and df for known data", () => {
    const result = welchTTest(GROUP_A, GROUP_B);
    expect(result.tStatistic).toBeCloseTo(-6.5727, 2);
    expect(result.degreesOfFreedom).toBeCloseTo(6, 0);
    expect(result.pValue).toBeCloseTo(0.000595, 3);
    expect(result.meanDifference).toBeCloseTo(-0.6, 10);
  });

  it("returns NaN for groups smaller than 2", () => {
    const result = welchTTest([1], [2, 3, 4]);
    expect(result.tStatistic).toBeNaN();
    expect(result.pValue).toBeNaN();
  });

  it("returns NaN for empty arrays", () => {
    const result = welchTTest([], []);
    expect(result.tStatistic).toBeNaN();
  });

  it("returns p=1 for identical groups (zero variance)", () => {
    const result = welchTTest([5, 5, 5], [5, 5, 5]);
    expect(result.tStatistic).toBe(0);
    expect(result.pValue).toBe(1);
  });

  it("is symmetric: swapping groups negates t but keeps same p", () => {
    const ab = welchTTest(GROUP_A, GROUP_B);
    const ba = welchTTest(GROUP_B, GROUP_A);
    expect(ab.tStatistic).toBeCloseTo(-ba.tStatistic, 10);
    expect(ab.pValue).toBeCloseTo(ba.pValue, 10);
  });

  it("handles equal variance case correctly", () => {
    // Equal variance: t = (3-8)/sqrt(2.5/5+2.5/5) = -5/1 = -5, df = 8
    const result = welchTTest([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
    expect(result.tStatistic).toBeCloseTo(-5, 1);
    expect(result.degreesOfFreedom).toBeCloseTo(8, 0);
    expect(result.pValue).toBeCloseTo(0.001053, 3);
  });

  it("handles unequal group sizes", () => {
    // nA=3, nB=5: meanA=2, meanB=6, varA=1, varB=2.5
    // seA=1/3, seB=2.5/5=0.5, seDiff=sqrt(0.8333)=0.9129
    // t=-4/0.9129=-4.382, df≈5.88
    const result = welchTTest([1, 2, 3], [4, 5, 6, 7, 8]);
    expect(result.tStatistic).toBeCloseTo(-4.382, 2);
    expect(result.degreesOfFreedom).toBeCloseTo(5.88, 1);
    expect(result.pValue).toBeCloseTo(0.00488, 3);
  });

  it("produces p-value in [0, 1]", () => {
    const result = welchTTest([1, 2, 3, 4], [100, 200, 300, 400]);
    expect(result.pValue).toBeGreaterThanOrEqual(0);
    expect(result.pValue).toBeLessThanOrEqual(1);
  });
});

describe("permutationTest", () => {
  it("returns p-value in (0, 1] range", () => {
    const result = permutationTest(GROUP_A, GROUP_B, 1000);
    expect(result.pValue).toBeGreaterThan(0);
    expect(result.pValue).toBeLessThanOrEqual(1);
  });

  it("detects significant difference between well-separated groups", () => {
    // Use larger, more separated groups for reliable detection
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    const b = [20, 21, 22, 23, 24, 25, 26, 27];
    const result = permutationTest(a, b, 5000);
    expect(result.pValue).toBeLessThan(0.01);
  });

  it("does not detect difference for identical distributions", () => {
    const same = [1, 2, 3, 4, 5];
    const result = permutationTest(same, same, 1000);
    expect(result.pValue).toBeGreaterThan(0.5);
  });

  it("computes correct observed difference", () => {
    const result = permutationTest([10, 20], [30, 40], 100);
    expect(result.observedDifference).toBe(-20);
  });

  it("returns NaN for empty groups", () => {
    const result = permutationTest([], [1, 2, 3], 100);
    expect(result.pValue).toBeNaN();
  });

  it("records iteration count", () => {
    const result = permutationTest([1, 2], [3, 4], 500);
    expect(result.iterations).toBe(500);
  });

  it("p-value is very small for maximally separated groups", () => {
    const result = permutationTest(
      [1, 1, 1, 1, 1],
      [1000, 1000, 1000, 1000, 1000],
      5000,
    );
    expect(result.pValue).toBeLessThan(0.02);
  });
});

describe("cohensD", () => {
  it("computes correct effect size for known data", () => {
    // pooledStd = sqrt(0.01667) ≈ 0.12910
    // d = (1.35 - 1.95) / 0.12910 ≈ -4.6476
    const d = cohensD(GROUP_A, GROUP_B);
    expect(d).toBeCloseTo(-4.6476, 2);
  });

  it("returns 0 for identical groups", () => {
    expect(cohensD([5, 5, 5], [5, 5, 5])).toBe(0);
  });

  it("returns NaN for groups smaller than 2", () => {
    expect(cohensD([1], [2, 3])).toBeNaN();
  });

  it("is antisymmetric: swapping groups negates d", () => {
    const dAB = cohensD(GROUP_A, GROUP_B);
    const dBA = cohensD(GROUP_B, GROUP_A);
    expect(dAB).toBeCloseTo(-dBA, 10);
  });

  it("positive d when group A > group B", () => {
    const d = cohensD([10, 11, 12], [1, 2, 3]);
    expect(d).toBeGreaterThan(0);
  });

  it("large effect for well-separated groups", () => {
    const d = cohensD([1, 2, 3, 4, 5], [100, 101, 102, 103, 104]);
    expect(Math.abs(d)).toBeGreaterThan(0.8);
  });
});
