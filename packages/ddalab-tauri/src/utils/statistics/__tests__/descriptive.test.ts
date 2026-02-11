import { describe, it, expect } from "vitest";
import { computeGroupStats } from "../descriptive";

describe("computeGroupStats", () => {
  it("returns NaN fields for empty input", () => {
    const result = computeGroupStats([]);
    expect(result.n).toBe(0);
    expect(result.mean).toBeNaN();
    expect(result.std).toBeNaN();
    expect(result.median).toBeNaN();
    expect(result.values).toEqual([]);
  });

  it("handles a single value", () => {
    const result = computeGroupStats([5]);
    expect(result.n).toBe(1);
    expect(result.mean).toBe(5);
    expect(result.std).toBe(0);
    expect(result.median).toBe(5);
    expect(result.q1).toBe(5);
    expect(result.q3).toBe(5);
    expect(result.iqr).toBe(0);
    expect(result.min).toBe(5);
    expect(result.max).toBe(5);
  });

  it("computes correct stats for [1, 2, 3, 4, 5]", () => {
    const result = computeGroupStats([1, 2, 3, 4, 5]);
    expect(result.n).toBe(5);
    expect(result.mean).toBe(3);
    expect(result.median).toBe(3);
    expect(result.min).toBe(1);
    expect(result.max).toBe(5);
    // sample std = sqrt(10/4) = sqrt(2.5) ≈ 1.5811
    expect(result.std).toBeCloseTo(1.5811, 3);
    // Q1 = quantile(0.25) on [1,2,3,4,5]: idx=1.0 → 2
    expect(result.q1).toBe(2);
    // Q3 = quantile(0.75) on [1,2,3,4,5]: idx=3.0 → 4
    expect(result.q3).toBe(4);
    expect(result.iqr).toBe(2);
  });

  it("computes correct stats for even-length array [2, 4, 6, 8]", () => {
    const result = computeGroupStats([2, 4, 6, 8]);
    expect(result.n).toBe(4);
    expect(result.mean).toBe(5);
    // median: idx=1.5 → (4+6)/2 = 5
    expect(result.median).toBe(5);
    // sample std = sqrt(((2-5)^2+(4-5)^2+(6-5)^2+(8-5)^2)/3) = sqrt(20/3) ≈ 2.5820
    expect(result.std).toBeCloseTo(2.582, 3);
    // Q1: idx=0.75 → 2*0.25 + 4*0.75 = 3.5
    expect(result.q1).toBeCloseTo(3.5, 10);
    // Q3: idx=2.25 → 6*0.75 + 8*0.25 = 6.5
    expect(result.q3).toBeCloseTo(6.5, 10);
    expect(result.iqr).toBeCloseTo(3, 10);
  });

  it("filters out NaN and Infinity values", () => {
    const result = computeGroupStats([1, NaN, 3, Infinity, 5, -Infinity]);
    expect(result.n).toBe(3);
    expect(result.mean).toBe(3);
    expect(result.values).toEqual([1, 3, 5]);
  });

  it("handles all-NaN input as empty", () => {
    const result = computeGroupStats([NaN, NaN, NaN]);
    expect(result.n).toBe(0);
    expect(result.mean).toBeNaN();
  });

  it("preserves filtered values in output", () => {
    const result = computeGroupStats([10, 20, 30]);
    expect(result.values).toEqual([10, 20, 30]);
  });

  it("handles negative values", () => {
    const result = computeGroupStats([-3, -1, 0, 1, 3]);
    expect(result.mean).toBe(0);
    expect(result.median).toBe(0);
    expect(result.min).toBe(-3);
    expect(result.max).toBe(3);
  });

  it("handles identical values", () => {
    const result = computeGroupStats([7, 7, 7, 7]);
    expect(result.mean).toBe(7);
    expect(result.std).toBe(0);
    expect(result.median).toBe(7);
    expect(result.iqr).toBe(0);
  });
});
