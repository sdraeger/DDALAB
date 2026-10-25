// The max-magnitude pyramid of a result array (spec, "Results stream to storage"): level L has cells of 4^L windows,
// each keeping the signed value of largest magnitude among its windows, so no outlier window disappears when the
// heatmap is zoomed out. Level 0 is the windows themselves; the top level fits one tile. Arrays are window-major.

/** Cells per tile, at every level. */
export const TILE_CELLS = 1024;
export const FANOUT = 4;

/** One tile of one array of a result: `windows` cells (of `4^level` windows each) of `rows` values, window-major. */
export interface ResultTile {
  variant: string;
  array: "q" | "fit_error";
  level: number;
  index: number;
  rows: number;
  windows: number;
  values: Float32Array;
}

/** Levels of an array of `windows` windows: up to the first whose cells fit one tile. */
export function resultLevels(windows: number): number {
  let levels = 1;
  while (Math.ceil(windows / FANOUT ** (levels - 1)) > TILE_CELLS) levels++;
  return levels;
}

/** Cells of `factor` windows; a cell is NaN only when every window in it is. */
function fold(values: Float64Array, rows: number, factor: number): Float64Array {
  const windows = values.length / rows;
  const cells = new Float64Array(Math.ceil(windows / factor) * rows).fill(Number.NaN);
  for (let w = 0; w < windows; w++) {
    const o = Math.floor(w / factor) * rows;
    for (let r = 0; r < rows; r++) {
      const v = values[w * rows + r];
      if (Number.isNaN(cells[o + r]) || Math.abs(v) > Math.abs(cells[o + r])) cells[o + r] = v;
    }
  }
  return cells;
}

/** Window-major in and out: each cell of `factor` windows keeps the signed value of largest magnitude. */
export function maxMagnitudeLevel(values: Float64Array, rows: number, factor: number): Float32Array {
  return new Float32Array(fold(values, rows, factor));
}

export interface Pyramid {
  /** Levels 1 and up, `levels[L - 1]` for level L. */
  levels: Float32Array[];
  /** The smallest and largest finite value of each row (Infinity and -Infinity for a row without one). */
  rowMin: Float64Array;
  rowMax: Float64Array;
}

/**
 * One pass over an array: `read(w0, w1)` gives windows `w0..w1` as f64, in slabs of whole top-level cells of about
 * `slabBytes`, so every level folds from f64 values exactly.
 */
export async function buildPyramid(
  read: (w0: number, w1: number) => Promise<Float64Array>,
  windows: number,
  rows: number,
  slabBytes = 8 * 2 ** 20,
): Promise<Pyramid> {
  const top = resultLevels(windows) - 1;
  const cell = FANOUT ** top;
  const slab = cell * Math.max(1, Math.floor(slabBytes / (cell * rows * 8)));
  const levels = Array.from(
    { length: top },
    (_, i) => new Float32Array(Math.ceil(windows / FANOUT ** (i + 1)) * rows),
  );
  const rowMin = new Float64Array(rows).fill(Number.POSITIVE_INFINITY);
  const rowMax = new Float64Array(rows).fill(Number.NEGATIVE_INFINITY);
  for (let w0 = 0; w0 < windows; w0 += slab) {
    let values = await read(w0, Math.min(windows, w0 + slab));
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) continue;
      const r = i % rows;
      if (v < rowMin[r]) rowMin[r] = v;
      if (v > rowMax[r]) rowMax[r] = v;
    }
    for (let level = 1; level <= top; level++) {
      values = fold(values, rows, FANOUT);
      levels[level - 1].set(values, (w0 / FANOUT ** level) * rows);
    }
  }
  return { levels, rowMin, rowMax };
}
