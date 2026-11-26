// Pure heatmap data transformations: robust percentile scaling, per-row z-score normalization,
// channel/activity/group row ordering, and B - A difference computation between compatible results.
import type { ResultArray } from "../../core/protocol";
import { type MapName, scaleOf } from "../../render/colormaps";
import type { ResultTile } from "../../render/resultPyramid";
import {
  DEFAULT_HEATMAP_OPTIONS,
  type HeatmapOptions,
  type RowSort,
  type ScaleMode,
} from "../../store/store";

export { DEFAULT_HEATMAP_OPTIONS, type HeatmapOptions, type RowSort, type ScaleMode };

export interface RowStats {
  mean: Float64Array;
  std: Float64Array;
}

/** Computes display row permutation `displayRow -> originalRow`. */
export function computeRowOrder(
  rows: number,
  sort: RowSort,
  array: Pick<ResultArray, "rowMin" | "rowMax">,
  groupOfRow?: number[],
): number[] {
  const order = Array.from({ length: rows }, (_, i) => i);
  if (sort === "channel") return order;
  if (sort === "activity") {
    const score = (r: number) => {
      const lo = array.rowMin[r];
      const hi = array.rowMax[r];
      if (!(lo <= hi)) return -1;
      return hi - lo + Math.max(Math.abs(lo), Math.abs(hi)) * 1e-6;
    };
    return order.sort((a, b) => score(b) - score(a) || a - b);
  }
  if (sort === "group" && groupOfRow && groupOfRow.length === rows) {
    return order.sort((a, b) => groupOfRow[a] - groupOfRow[b] || a - b);
  }
  return order;
}

/** Computes per-row mean and standard deviation across finite values in `tile`. */
export function computeRowStats(tile: ResultTile): RowStats {
  const { rows, windows, values } = tile;
  const mean = new Float64Array(rows);
  const std = new Float64Array(rows);
  const counts = new Uint32Array(rows);

  for (let w = 0; w < windows; w++) {
    const base = w * rows;
    for (let r = 0; r < rows; r++) {
      const v = values[base + r];
      if (Number.isFinite(v)) {
        mean[r] += v;
        counts[r]++;
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    mean[r] = counts[r] > 0 ? mean[r] / counts[r] : 0;
  }
  for (let w = 0; w < windows; w++) {
    const base = w * rows;
    for (let r = 0; r < rows; r++) {
      const v = values[base + r];
      if (Number.isFinite(v)) {
        const d = v - mean[r];
        std[r] += d * d;
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    std[r] = counts[r] > 1 ? Math.sqrt(std[r] / counts[r]) : 0;
  }
  return { mean, std };
}

/** Computes the `[pLow, pHigh]` percentile bounds over all finite entries of `values`. */
export function robustBounds(values: Float32Array, pLow = 0.02, pHigh = 0.98): { min: number; max: number } {
  const finite: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) return { min: 1, max: -1 };
  finite.sort((a, b) => a - b);
  const loIdx = Math.min(finite.length - 1, Math.max(0, Math.floor(pLow * (finite.length - 1))));
  const hiIdx = Math.min(finite.length - 1, Math.max(0, Math.ceil(pHigh * (finite.length - 1))));
  return { min: finite[loIdx], max: finite[hiIdx] };
}

/** Applies optional `B - A` diff, per-row z-score, and row permutation to a tile. */
export function transformTile(
  primary: ResultTile,
  opts: {
    rowOrder?: number[];
    zStats?: RowStats | null;
    compare?: { tile: ResultTile; rowMap: Int32Array } | null;
  },
): ResultTile {
  const { windows, rows } = primary;
  const order = opts.rowOrder;
  const zStats = opts.zStats;
  const compare = opts.compare;
  const isIdentityOrder = !order || order.every((orig, i) => orig === i);
  if (isIdentityOrder && !zStats && !compare) return primary;

  const out = new Float32Array(windows * rows);
  for (let w = 0; w < windows; w++) {
    const pBase = w * rows;
    const cValid = compare && w < compare.tile.windows;
    const cBase = cValid ? w * compare.tile.rows : 0;
    for (let disp = 0; disp < rows; disp++) {
      const r = order ? order[disp] : disp;
      let v = primary.values[pBase + r];
      if (compare) {
        const cr = compare.rowMap[r];
        if (!cValid || cr < 0) {
          v = Number.NaN;
        } else {
          // B - A: positive means comparison result is higher than primary.
          v = compare.tile.values[cBase + cr] - v;
        }
      }
      if (zStats && Number.isFinite(v)) {
        const s = zStats.std[r];
        v = s > 1e-12 ? (v - zStats.mean[r]) / s : 0;
      }
      out[pBase + disp] = v;
    }
  }
  return { ...primary, values: out };
}

/** Resolves effective color limits `[lo, hi]` given scale mode, optional robust sample tile, and custom bounds. */
export function resolveScale(
  map: MapName,
  array: Pick<ResultArray, "rows" | "rowMin" | "rowMax">,
  options: Pick<HeatmapOptions, "scaleMode" | "customMin" | "customMax" | "zScore">,
  sampleValues?: Float32Array | null,
): { map: MapName; lo: number; hi: number } {
  if (
    options.scaleMode === "custom" &&
    options.customMin !== null &&
    options.customMax !== null &&
    Number.isFinite(options.customMin) &&
    Number.isFinite(options.customMax) &&
    options.customMin < options.customMax
  ) {
    return { map, lo: options.customMin, hi: options.customMax };
  }
  if (sampleValues && (options.scaleMode === "robust" || options.zScore)) {
    const { min, max } =
      options.scaleMode === "robust"
        ? robustBounds(sampleValues, 0.02, 0.98)
        : robustBounds(sampleValues, 0, 1);
    return { map, ...scaleOf(map, min, max) };
  }
  if (sampleValues) {
    const { min, max } = robustBounds(sampleValues, 0, 1);
    return { map, ...scaleOf(map, min, max) };
  }
  let [min, max] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let r = 0; r < array.rows; r++) {
    min = Math.min(min, array.rowMin[r]);
    max = Math.max(max, array.rowMax[r]);
  }
  return { map, ...scaleOf(map, min, max) };
}
