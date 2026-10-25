import { expect, test } from "vitest";
import { buildPyramid, maxMagnitudeLevel, resultLevels } from "./resultPyramid";

test("keeps_signed_extreme", () => {
  expect([...maxMagnitudeLevel(new Float64Array([0.2, -0.9, 0.5]), 1, 4)]).toEqual([Math.fround(-0.9)]);
});

test("partial_last_group", () => {
  // Five windows of two rows, window-major: the second cell holds window 4 alone.
  const values = new Float64Array([1, -1, 2, 0.5, -3, 0, 0.1, 4, 7, -8]);
  expect([...maxMagnitudeLevel(values, 2, 4)]).toEqual([-3, 4, 7, -8]);
});

test("nan_only_where_every_window_is", () => {
  const values = new Float64Array([Number.NaN, Number.NaN, -0.5, Number.NaN, Number.NaN]);
  expect([...maxMagnitudeLevel(values, 1, 2)]).toEqual([Number.NaN, -0.5, Number.NaN]);
});

test("pyramid_levels_equal_one_fold_of_all_windows", async () => {
  // Three rows of 70,001 windows, read and written in pieces of 64 KiB: each level must equal one fold of the whole
  // array, up to a top level of one cell.
  const rows = 3;
  const windows = 70_001;
  const all = new Float64Array(windows * rows);
  let seed = 7;
  for (let i = 0; i < all.length; i++) {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    all[i] = seed / 2 ** 30 - 1;
  }
  all[31_415 * rows + 2] = -40;
  const chunk = 64 * 1024;
  const reads: number[] = [];
  const read = async (w0: number, w1: number) => {
    reads.push((w1 - w0) * rows * 8);
    return all.slice(w0 * rows, w1 * rows);
  };
  const levels = resultLevels(windows);
  expect(levels).toBe(10);
  const stored = Array.from(
    { length: levels - 1 },
    (_, i) => new Float32Array(Math.ceil(windows / 4 ** (i + 1)) * rows),
  );
  const writes: number[] = [];
  const pyramid = await buildPyramid(
    read,
    windows,
    rows,
    (level, cell, values) => {
      writes.push(values.byteLength);
      stored[level - 1].set(values, cell * rows);
    },
    chunk,
  );
  expect(Math.max(...reads)).toBeLessThanOrEqual(chunk);
  expect(Math.max(...writes)).toBeLessThanOrEqual(chunk);
  for (let level = 1; level < levels; level++) {
    expect(stored[level - 1]).toEqual(maxMagnitudeLevel(all, rows, 4 ** level));
  }
  expect(stored[levels - 2]).toHaveLength(rows);
  expect(stored[levels - 2][2]).toBe(-40);
  expect(pyramid.rowMin[2]).toBe(-40);
  expect(pyramid.rowMax[0]).toBe(all.filter((_, i) => i % rows === 0).reduce((a, b) => Math.max(a, b)));
});

test("levels_reach_one_cell", () => {
  expect([1, 2, 4, 5, 1000, 1024, 1025].map(resultLevels)).toEqual([1, 2, 2, 3, 6, 6, 7]);
});
