import { expect, test } from "vitest";
import type { ResultTile } from "../../render/resultPyramid";
import {
  computeRowOrder,
  computeRowStats,
  DEFAULT_HEATMAP_OPTIONS,
  resolveScale,
  robustBounds,
  transformTile,
} from "./resultTransform";

test("robust_bounds_ignores_extreme_outliers", () => {
  const vals = new Float32Array(100);
  for (let i = 0; i < 99; i++) vals[i] = i / 100;
  vals[99] = 10_000; // single artifact spike
  const { min, max } = robustBounds(vals, 0.02, 0.98);
  expect(min).toBeCloseTo(0.01, 2);
  expect(max).toBeLessThan(1.0);
});

test("row_order_sorts_by_activity_and_group", () => {
  const arr = {
    rowMin: new Float64Array([-1, -10, 0]),
    rowMax: new Float64Array([1, 10, 0.2]),
  };
  expect(computeRowOrder(3, "channel", arr)).toEqual([0, 1, 2]);
  expect(computeRowOrder(3, "activity", arr)).toEqual([1, 0, 2]);
  expect(computeRowOrder(3, "group", arr, [2, 0, 1])).toEqual([1, 2, 0]);
});

test("transform_tile_applies_diff_zscore_and_permutation", () => {
  const primary: ResultTile = {
    variant: "ST",
    array: "q",
    level: 0,
    index: 0,
    rows: 2,
    windows: 3,
    // w0: [1, 10], w1: [2, 20], w2: [3, 30]
    values: new Float32Array([1, 10, 2, 20, 3, 30]),
  };
  const stats = computeRowStats(primary);
  expect(stats.mean[0]).toBeCloseTo(2, 6);
  expect(stats.mean[1]).toBeCloseTo(20, 6);

  const zPerm = transformTile(primary, { rowOrder: [1, 0], zStats: stats });
  // Mean value at w=1 becomes 0 for both rows
  expect(zPerm.values[2]).toBeCloseTo(0, 5);
  expect(zPerm.values[3]).toBeCloseTo(0, 5);
  // Extremes are symmetric (+/- sqrt(3/2))
  expect(zPerm.values[0]).toBeCloseTo(-zPerm.values[4], 5);

  // Diff B - A
  const compareTile: ResultTile = {
    ...primary,
    values: new Float32Array([2, 12, 4, 22, 6, 32]),
  };
  const diff = transformTile(primary, {
    compare: { tile: compareTile, rowMap: new Int32Array([0, 1]) },
  });
  expect(Array.from(diff.values)).toEqual([1, 2, 2, 2, 3, 2]);
});

test("resolve_scale_honors_custom_bounds_and_robust_mode", () => {
  const arr = { rows: 2, rowMin: new Float64Array([-100, -1]), rowMax: new Float64Array([100, 1]) };
  const custom = resolveScale("vik", arr, {
    ...DEFAULT_HEATMAP_OPTIONS,
    scaleMode: "custom",
    customMin: -2,
    customMax: 5,
  });
  expect(custom).toEqual({ map: "vik", lo: -2, hi: 5 });
});
