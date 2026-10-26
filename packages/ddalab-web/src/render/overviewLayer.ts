// The overview strip: the whole recording as the envelope of its signal channels, drawn on a 2D canvas from the
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

/** BIDS types of auxiliary channels: DC, triggers, the heart and eyes and the like, whose levels would fill the strip. */
const AUXILIARY =
  /^(MISC|TRIG|DC|ADC|DAC|EKG|ECG|EMG|EOG|HEOG|VEOG|RESP|GSR|TEMP|PPG|AUDIO|SYSCLOCK|REF|PD|PUPIL)$/i;

/**
 * Which display channels the envelope covers: those of signal types, without auxiliary ones by BIDS type or a DC
 * label. All of them when none is left.
 */
export function signalChannels(channels: { label: string; bids_type: string | null }[]): boolean[] {
  const signal = channels.map((c) => !AUXILIARY.test(c.bids_type ?? "") && !/^DC\d*$/i.test(c.label.trim()));
  return signal.some(Boolean) ? signal : signal.map(() => true);
}

/** Per bucket of a tile, the smallest and largest display value over the `counted` channels: min, max interleaved. */
export function envelope(bytes: ArrayBuffer, params: Float32Array, counted: boolean[]): Float32Array {
  const { channels, buckets, values } = decodeTile(bytes);
  const out = new Float32Array(2 * buckets);
  const maxima = channels * buckets;
  for (let b = 0; b < buckets; b++) {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let c = 0; c < channels; c++) {
      if (!counted[c]) continue;
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

  // The envelope, one column per device pixel, scaled to the 99th percentile of the columns' magnitudes: a few
  // artifacts reach the edges and the rest of the recording keeps its shape.
  const size = bucketSize(level);
  const lows = new Float32Array(W).fill(Number.POSITIVE_INFINITY);
  const highs = new Float32Array(W).fill(Number.NEGATIVE_INFINITY);
  for (let c = 0; c < W; c++) {
    const b0 = Math.floor(((c / W) * rows) / size);
    const b1 = Math.max(b0, Math.ceil((((c + 1) / W) * rows) / size) - 1);
    for (let b = b0; b <= b1; b++) {
      const env = tiles.get(Math.floor(b / TILE_BUCKETS));
      const i = b % TILE_BUCKETS;
      if (!env || 2 * i + 1 >= env.length) continue;
      lows[c] = Math.min(lows[c], env[2 * i]);
      highs[c] = Math.max(highs[c], env[2 * i + 1]);
    }
  }
  const magnitudes = Array.from(lows, (lo, c) => Math.max(Math.abs(lo), Math.abs(highs[c])))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const peak = magnitudes[Math.floor(0.99 * (magnitudes.length - 1))] ?? 0;
  const middle = band + plotH / 2;
  const half = plotH / 2 - 2 * dpr;
  const scale = peak > 0 ? half / peak : 0;
  const y = (v: number) => middle - Math.max(-half, Math.min(half, v * scale));
  let hatchFrom = -1;
  const hatches: [number, number][] = [];
  ctx.fillStyle = colors.muted;
  for (let c = 0; c < W; c++) {
    if (lows[c] <= highs[c]) {
      if (hatchFrom >= 0) hatches.push([hatchFrom, c]);
      hatchFrom = -1;
      const top = Math.floor(y(highs[c]));
      ctx.fillRect(c, top, 1, Math.floor(y(lows[c])) + 1 - top);
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
