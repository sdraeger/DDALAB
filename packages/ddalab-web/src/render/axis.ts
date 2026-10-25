// The time axis on 2D canvases: tick steps and labels, the hatch of regions without data, and what the waveform pane
// draws around its traces (the ruler above them, the grid, selection, events and cursor under them).
import type { OpenRecording } from "../store/store";
import type { Colors } from "./themeColors";
import type { Gap } from "./waveformLayer";

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

/** A label on a cleared patch in the middle of a region. */
function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  colors: Colors,
  dpr: number,
) {
  ctx.font = `${12 * dpr}px ${colors.font}`;
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width;
  ctx.clearRect(x - 6 * dpr, y - 10 * dpr, w + 12 * dpr, 20 * dpr);
  ctx.fillStyle = colors.muted;
  ctx.fillText(text, x, y);
}

export interface MarksScene {
  /** Device pixels. */
  W: number;
  H: number;
  dpr: number;
  view: { t0: number; t1: number };
  selection: { t0: number; t1: number } | null;
  cursorS: number | null;
  recording: OpenRecording;
  colors: Colors;
  /** Over opaque data (the heatmap): lines get a halo of the ground color, and the selection its edges. */
  over?: boolean;
}

/** The selection, the events and the cursor, which every plot on the time axis shares. */
export function drawMarks(ctx: CanvasRenderingContext2D, scene: MarksScene) {
  const { W, H, dpr, view, recording, colors, over } = scene;
  const x = (t: number) => ((t - view.t0) / (view.t1 - view.t0)) * W;
  const line = Math.max(1, Math.round(dpr));
  const mark = (t: number, color: string) => {
    const px = Math.round(x(t));
    if (over) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = colors.ground;
      ctx.fillRect(px - line, 0, 3 * line, H);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = color;
    ctx.fillRect(px, 0, line, H);
  };
  if (scene.selection) {
    ctx.fillStyle = colors.wash;
    ctx.fillRect(x(scene.selection.t0), 0, x(scene.selection.t1) - x(scene.selection.t0), H);
    if (over) for (const t of [scene.selection.t0, scene.selection.t1]) mark(t, colors.primary);
  }
  for (const a of recording.info.annotations) {
    if (a.onset_s + a.duration_s < view.t0 || a.onset_s > view.t1) continue;
    if (a.duration_s > 0) {
      ctx.fillStyle = colors.event;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(x(a.onset_s), 0, x(a.onset_s + a.duration_s) - x(a.onset_s), H);
      ctx.globalAlpha = 1;
    }
    mark(a.onset_s, colors.event);
  }
  if (scene.cursorS !== null && scene.cursorS >= view.t0 && scene.cursorS <= view.t1) {
    mark(scene.cursorS, colors.primary);
  }
}

export interface UnderlayScene extends MarksScene {
  gaps: Gap[];
  scanPercent: number | null;
}

/** Under the traces: the time grid, the selection, events, the cursor and the regions with no data yet. */
export function drawUnderlay(ctx: CanvasRenderingContext2D, scene: UnderlayScene) {
  const { W, H, dpr, view, colors } = scene;
  const x = (t: number) => ((t - view.t0) / (view.t1 - view.t0)) * W;
  const line = Math.max(1, Math.round(dpr));
  ctx.clearRect(0, 0, W, H);
  const { step, at } = ticks(view.t0, view.t1, W / dpr, 96);
  const minor = minorStep(step);
  ctx.fillStyle = colors.grid;
  for (let k = Math.ceil(view.t0 / minor); k * minor <= view.t1; k++) {
    ctx.fillRect(Math.round(x(k * minor)), 0, line, H);
  }
  ctx.fillStyle = colors.hairline;
  for (const t of at) ctx.fillRect(Math.round(x(t)), 0, line, H);
  drawMarks(ctx, scene);
  for (const gap of scene.gaps) {
    const wide = gap.x1 - gap.x0 > 160 * dpr;
    if (gap.reason === "unscanned") {
      hatch(ctx, gap.x0, 0, gap.x1 - gap.x0, H, colors.muted, dpr);
      const scanning = scene.scanPercent === null ? "" : ` ${scene.scanPercent}%`;
      if (wide) label(ctx, `Scanning overview${scanning}`, gap.x0 + 14 * dpr, H / 2, colors, dpr);
    } else if (wide) label(ctx, "Loading", gap.x0 + 14 * dpr, H / 2, colors, dpr);
  }
}

export interface RulerScene {
  W: number;
  H: number;
  dpr: number;
  view: { t0: number; t1: number };
  recording: OpenRecording;
  colors: Colors;
}

/** The time ruler: labeled ticks and the event flags of the view. */
export function drawRuler(ctx: CanvasRenderingContext2D, scene: RulerScene) {
  const { W, H, dpr, view, recording, colors } = scene;
  const x = (t: number) => ((t - view.t0) / (view.t1 - view.t0)) * W;
  const line = Math.max(1, Math.round(dpr));
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = colors.hairline;
  ctx.fillRect(0, H - line, W, line);
  ctx.font = `${11 * dpr}px ${colors.font}`;
  ctx.textBaseline = "middle";
  const { step, at } = ticks(view.t0, view.t1, W / dpr, 96);
  for (const t of at) {
    const px = Math.round(x(t));
    ctx.fillStyle = colors.hairline;
    ctx.fillRect(px, H - 5 * dpr, line, 5 * dpr);
    ctx.fillStyle = colors.muted;
    ctx.fillText(tickLabel(t, step), px + 3 * dpr, H / 2 - dpr);
  }
  ctx.font = `600 ${11 * dpr}px ${colors.font}`;
  for (const a of recording.info.annotations) {
    if (a.onset_s < view.t0 || a.onset_s > view.t1) continue;
    const text = a.label || "event";
    const w = ctx.measureText(text).width + 8 * dpr;
    const left = Math.min(Math.round(x(a.onset_s)), W - w);
    ctx.fillStyle = colors.event;
    ctx.fillRect(left, 2 * dpr, w, H - 4 * dpr);
    ctx.fillStyle = colors.eventInk;
    ctx.fillText(text, left + 4 * dpr, H / 2);
  }
}
