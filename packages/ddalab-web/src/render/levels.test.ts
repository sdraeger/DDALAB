import { expect, test } from "vitest";
import { bucketSize, drawPlan, tileIndices } from "./levels";

test("plan_thresholds", () => {
  expect(drawPlan(0.5, 6)).toEqual({ mode: "line" });
  expect(drawPlan(63.9, 6)).toEqual({ mode: "rawSpan" });
  expect(drawPlan(64, 6)).toEqual({ mode: "tile", level: 0 });
  expect(drawPlan(255, 6)).toEqual({ mode: "tile", level: 0 });
  expect(drawPlan(256, 6)).toEqual({ mode: "tile", level: 1 });
  // A recording has no level above its top one, however far the view zooms out.
  expect(drawPlan(1e9, 3)).toEqual({ mode: "tile", level: 2 });
});

test("bucket_size_matches_the_core", () => {
  // dda-rs tiles.rs: BASE_BUCKET * FANOUT^level.
  expect([0, 1, 2, 5].map(bucketSize)).toEqual([64, 256, 1024, 65536]);
});

test("tile_indices_cover_range", () => {
  for (const [row0, row1, level] of [
    [0, 1, 0],
    [0, 65536, 0],
    [65535, 65537, 0],
    [123_456, 9_876_543, 1],
    [1e9, 1e9 + 4e6, 3],
  ]) {
    const [first, last] = tileIndices(row0, row1, level);
    const rows = 1024 * bucketSize(level);
    // Every row of [row0, row1) lies in a returned tile, and the first and last tiles hold rows of the range.
    expect(first * rows).toBeLessThanOrEqual(row0);
    expect((last + 1) * rows).toBeGreaterThanOrEqual(row1);
    expect((first + 1) * rows).toBeGreaterThan(row0);
    expect(last * rows).toBeLessThan(row1);
  }
});
