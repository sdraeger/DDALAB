// The overview strip: the whole recording as the envelope of every display channel, drawn on a 2D canvas from the
// pyramid level whose tiles are few enough to fetch at once.
import { bucketSize, levelCount, tileCount } from "../core/opfs";
import { column, hatch, tickLabel, ticks } from "./axis";
import type { Colors } from "./themeColors";
import { decodeTile } from "./waveformLayer";

/** The overview fetches at most this many tiles. */
const MAX_TILES = 16;
const TILE_BUCKETS = 1024;

// shortcut: a recording shorter than the strip has pixels draws 64-sample buckets, blocky at full width; read raw
// rows for recordings under a few thousand buckets if that matters.
export function overviewLevel(rows: number): number {
  const top = levelCount(rows) - 1;
  let level = 0;
  while (level < top && tileCount(rows, level) > MAX_TILES) level++;
  return level;
}

/** Per bucket of a tile, the smallest and largest display value over all channels: min, max interleaved. */
export function envelope(bytes: ArrayBuffer, params: Float32Array): Float32Array {
  const { channels, buckets, values } = decodeTile(bytes);
  const out = new Float32Array(2 * buckets);
  const maxima = channels * buckets;
  for (let b = 0; b < buckets; b++) {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let c = 0; c < channels; c++) {
      const [gain, offset] = [params[2 * c], params[2 * c + 1]];
      const a = values[b * channels + c] * gain + offset;
      const z = values[maxima + b * channels + c] * gain + offset;
      lo = Math.min(lo, a, z);
      hi = Math.max(hi, a, z);
    }
    out[2 * b] = lo;
    out[2 * b + 1] = hi;
  }
  return out;
}

export interface OverviewScene {
  /** Device pixels. */
  width: number;
  height: number;
  dpr: number;
  rows: number;
  rate: number;
  level: number;
  /** Envelopes by tile index. */
  tiles: Map<number, Float32Array>;
  /** Percent of the scan done while one runs. */
  scanPercent: number | null;
  selection: { t0: number; t1: number } | null;
  /** Onsets of the file's events and of the user's annotations. */
  annotations: number[];
  user: number[];
  colors: Colors;
}

/** Top band of the strip that holds the tick labels, in CSS px. */
export const TICK_BAND = 16;

export function drawOverview(ctx: CanvasRenderingContext2D, scene: OverviewScene) {
  const { width: W, height: H, dpr, rows, rate, level, tiles, colors } = scene;
  const duration = rows / rate;
  const band = Math.round(TICK_BAND * dpr);
  const plotH = H - band;
  const x = (s: number) => (s / duration) * W;
  ctx.clearRect(0, 0, W, H);

  // Ticks and their labels.
  ctx.font = `${11 * dpr}px ${colors.font}`;
  ctx.textBaseline = "middle";
  const { step, at } = ticks(0, duration, W / dpr, 64);
  for (const s of at) {
    const px = Math.round(x(s));
    ctx.fillStyle = colors.grid;
    ctx.fillRect(px, band, Math.max(1, Math.round(dpr)), plotH);
    ctx.fillStyle = colors.muted;
    ctx.fillText(tickLabel(s, step), px + 3 * dpr, band / 2);
  }

  if (scene.selection) {
    ctx.fillStyle = colors.wash;
    ctx.fillRect(
      x(scene.selection.t0),
      band,
      Math.max(1, x(scene.selection.t1) - x(scene.selection.t0)),
      plotH,
    );
  }

  // The envelope, one column per device pixel, scaled to the largest magnitude loaded.
  const size = bucketSize(level);
  let peak = 0;
  for (const env of tiles.values())
    for (const v of env) if (Number.isFinite(v)) peak = Math.max(peak, Math.abs(v));
  const middle = band + plotH / 2;
  const scale = peak > 0 ? (plotH / 2 - 2 * dpr) / peak : 0;
  let hatchFrom = -1;
  const hatches: [number, number][] = [];
  ctx.fillStyle = colors.muted;
  for (let c = 0; c < W; c++) {
    const b0 = Math.floor(((c / W) * rows) / size);
    const b1 = Math.max(b0, Math.ceil((((c + 1) / W) * rows) / size) - 1);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let b = b0; b <= b1; b++) {
      const env = tiles.get(Math.floor(b / TILE_BUCKETS));
      const i = b % TILE_BUCKETS;
      if (!env || 2 * i + 1 >= env.length) continue;
      lo = Math.min(lo, env[2 * i]);
      hi = Math.max(hi, env[2 * i + 1]);
    }
    if (lo <= hi) {
      if (hatchFrom >= 0) hatches.push([hatchFrom, c]);
      hatchFrom = -1;
      const top = Math.floor(middle - hi * scale);
      ctx.fillRect(c, top, 1, Math.floor(middle - lo * scale) + 1 - top);
    } else if (hatchFrom < 0) hatchFrom = c;
  }
  if (hatchFrom >= 0) hatches.push([hatchFrom, W]);
  for (const [from, to] of hatches) hatch(ctx, from, band, to - from, plotH, colors.muted, dpr);
  if (hatches.length > 0 && scene.scanPercent !== null) {
    const label = `Scanning overview ${scene.scanPercent}%`;
    const from = hatches[0][0] + 6 * dpr;
    const w = ctx.measureText(label).width;
    ctx.clearRect(from - 3 * dpr, middle - 8 * dpr, w + 6 * dpr, 16 * dpr);
    ctx.fillStyle = colors.muted;
    ctx.fillText(label, from, middle);
  }

  // The events as on the plots, dashed red for the file's and solid ink for the user's, each on a ground halo.
  const line = Math.max(1, Math.round(dpr));
  const marks: [number[], string, boolean][] = [
    [scene.annotations, colors.event, true],
    [scene.user, colors.ink, false],
  ];
  for (const [onsets, color, dashed] of marks) {
    for (const onset of onsets) {
      const px = Math.round(x(onset));
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = colors.ground;
      column(ctx, px - line, band, 3 * line, plotH, dashed, dpr);
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      column(ctx, px, band, line, plotH, dashed, dpr);
    }
  }
}
