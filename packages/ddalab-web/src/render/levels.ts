// Which data a plot of `samplesPerPixel` draws from: raw samples, or the extrema pyramid of dda-rs `tiles.rs`.
import { bucketSize, tileRows } from "../core/opfs";

export { bucketSize };

export type DrawPlan = { mode: "line" } | { mode: "rawSpan" } | { mode: "tile"; level: number };

/** Raw samples below 1 sample per pixel (lines) and below 64 (spans); above, the coarsest level that still fits. */
export function drawPlan(samplesPerPixel: number, levelCount: number): DrawPlan {
  if (samplesPerPixel < 1) return { mode: "line" };
  if (samplesPerPixel < bucketSize(0)) return { mode: "rawSpan" };
  let level = 0;
  while (level + 1 < levelCount && bucketSize(level + 1) <= samplesPerPixel) level++;
  return { mode: "tile", level };
}

/** The first and last tile of `level` holding rows of `[row0, row1)`. */
export function tileIndices(row0: number, row1: number, level: number): [number, number] {
  const rows = tileRows(level);
  return [Math.floor(row0 / rows), Math.floor((Math.max(row0 + 1, row1) - 1) / rows)];
}
