// The max-magnitude pyramid of a result array (spec, "Results stream to storage"): level L has cells of 4^L windows,
// each keeping the signed value of largest magnitude among its windows, so no outlier window disappears when the
// heatmap is zoomed out. Level 0 is the windows themselves; the top level is one cell. Arrays are window-major.

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

/** Levels of an array of `windows` windows: up to the first whose one cell holds them all. */
export function resultLevels(windows: number): number {
  let levels = 1;
  while (Math.ceil(windows / FANOUT ** (levels - 1)) > 1) levels++;
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

/** The smallest and largest finite value of each row (Infinity and -Infinity for a row without one). */
export interface RowRanges {
  rowMin: Float64Array;
  rowMax: Float64Array;
}

/**
 * One pass over an array: `read(w0, w1)` gives windows `w0..w1` as f64 in pieces of about `chunkBytes`, and
 * `write(level, cell, values)` takes the cells of levels 1 and up from cell `cell` on, as f32, in pieces of about
 * `chunkBytes` (one cell when a cell is larger). Each level folds f64 cells of the level below, which is exact; memory
 * stays at a piece of each level and one open cell per level.
 */
export async function buildPyramid(
  read: (w0: number, w1: number) => Promise<Float64Array>,
  windows: number,
  rows: number,
  write: (level: number, cell: number, values: Float32Array) => void,
  chunkBytes = 8 * 2 ** 20,
): Promise<RowRanges> {
  const top = resultLevels(windows) - 1;
  const rowMin = new Float64Array(rows).fill(Number.POSITIVE_INFINITY);
  const rowMax = new Float64Array(rows).fill(Number.NEGATIVE_INFINITY);
  // Per level: the open cell (f64), how many cells of the level below it holds, and its unwritten cells (a piece holds
  // at most the level's cells).
  const open = Array.from({ length: top + 1 }, () => new Float64Array(rows));
  const held = new Int32Array(top + 1);
  const pieces = Array.from({ length: top + 1 }, (_, level) => {
    const size = Math.max(
      1,
      Math.min(Math.floor(chunkBytes / (rows * 4)), Math.ceil(windows / FANOUT ** level)),
    );
    return { cells: new Float32Array(level > 0 ? size * rows : 0), size, n: 0, at: 0 };
  });
  const flush = (level: number) => {
    const piece = pieces[level];
    if (piece.n > 0) write(level, piece.at, piece.cells.subarray(0, piece.n * rows));
    piece.at += piece.n;
    piece.n = 0;
  };
  const close = (level: number) => {
    const piece = pieces[level];
    piece.cells.set(open[level], piece.n * rows);
    if (++piece.n === piece.size) flush(level);
    held[level] = 0;
    if (level < top) merge(level + 1, open[level]);
  };
  // Folds `values` (one cell of the level below) into the open cell of `level`.
  const merge = (level: number, values: Float64Array) => {
    const cell = open[level];
    if (held[level] === 0) cell.set(values);
    else {
      for (let r = 0; r < rows; r++) {
        const v = values[r];
        if (Number.isNaN(cell[r]) || Math.abs(v) > Math.abs(cell[r])) cell[r] = v;
      }
    }
    if (++held[level] === FANOUT) close(level);
  };
  const slab = Math.max(1, Math.floor(chunkBytes / (rows * 8)));
  for (let w0 = 0; w0 < windows; w0 += slab) {
    const values = await read(w0, Math.min(windows, w0 + slab));
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) continue;
      const r = i % rows;
      if (v < rowMin[r]) rowMin[r] = v;
      if (v > rowMax[r]) rowMax[r] = v;
    }
    if (top > 0) for (let i = 0; i < values.length; i += rows) merge(1, values.subarray(i, i + rows));
  }
  // The last cells of each level hold fewer windows; lower levels close first, as their cells feed the next.
  for (let level = 1; level <= top; level++) {
    if (held[level] > 0) close(level);
    flush(level);
  }
  return { rowMin, rowMax };
}
