// The overview strip: the whole recording as the envelope of every display channel, drawn on a 2D canvas from the
// pyramid level whose tiles are few enough to fetch at once. Also the time ticks the waveform ruler shares.
import { bucketSize, levelCount, tileCount } from "../core/opfs";
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

const STEPS = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800,
  3600, 7200, 10_800, 21_600, 43_200, 86_400,
];

/** The smallest tick step that leaves `minPx` between ticks, and the ticks of `[t0, t1]`. */
export function ticks(
  t0: number,
  t1: number,
  widthPx: number,
  minPx: number,
): { step: number; at: number[] } {
  const perPx = (t1 - t0) / widthPx;
  const step = STEPS.find((s) => s / perPx >= minPx) ?? STEPS[STEPS.length - 1];
  const at: number[] = [];
  for (let k = Math.ceil(t0 / step); k * step <= t1; k++) at.push(Number((k * step).toFixed(6)));
  return { step, at };
}

/** The unlabeled grid between ticks of `step`: the finest tick step that splits it into at most five parts. */
export function minorStep(step: number): number {
  const parts = (m: number) => step / m;
  return (
    STEPS.find((m) => m < step && parts(m) <= 5 && Math.abs(parts(m) - Math.round(parts(m))) < 1e-6) ?? step
  );
}

/** Seconds from the recording start, as h:mm:ss past a minute steps, else as seconds with the step's decimals. */
export function tickLabel(s: number, step: number): string {
  if (step >= 60) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.round(s % 60);
    const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
    return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
  }
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return s.toFixed(decimals);
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
  annotations: number[];
  colors: { trace: string; muted: string; event: string; wash: string; grid: string };
  font: string;
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
  ctx.font = scene.font;
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
  ctx.fillStyle = colors.trace;
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

  ctx.fillStyle = colors.event;
  for (const onset of scene.annotations)
    ctx.fillRect(Math.round(x(onset)), band, Math.max(1, Math.round(dpr)), plotH);
}

/** Diagonal hatching over a rectangle: a region without data. */
export function hatch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  dpr: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = dpr;
  const gap = 6 * dpr;
  ctx.beginPath();
  for (let d = x - h - (x % gap); d < x + w; d += gap) {
    ctx.moveTo(d, y + h);
    ctx.lineTo(d + h, y);
  }
  ctx.stroke();
  ctx.restore();
}
