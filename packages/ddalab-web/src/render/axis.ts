// The time axis on 2D canvases: tick steps and labels, the hatch of regions without data, and what the waveform pane
// draws around its traces (the ruler above them, the grid, selection, events and cursor under them). The recording's
// events are red and outlined on the ruler, the user's annotations ink and solid.
import type { UserAnnotation } from "../core/userAnnotations";
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

export interface EventsScene {
  /** Device pixels. */
  W: number;
  H: number;
  dpr: number;
  view: { t0: number; t1: number };
  /** Its events are marked; a result shown without its recording has none. */
  recording: OpenRecording | undefined;
  /** The user's annotations of `recording`. */
  user?: UserAnnotation[];
  /** The id of the picked annotation: a user annotation's line is drawn at full strength. */
  picked?: string | null;
  colors: Colors;
  /** Over opaque data (the heatmap): lines get a halo of the ground color, and the selection its edges. */
  over?: boolean;
}

export interface MarksScene extends EventsScene {
  selection: { t0: number; t1: number } | null;
  cursorS: number | null;
}

/** A vertical line `line` device pixels wide at `px`; over opaque data it stands on a halo of the ground color. */
function vline(
  ctx: CanvasRenderingContext2D,
  px: number,
  line: number,
  color: string,
  scene: EventsScene,
  alpha = 1,
) {
  if (scene.over) {
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = scene.colors.ground;
    ctx.fillRect(px - line, 0, 3 * line, scene.H);
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(px, 0, line, scene.H);
  ctx.globalAlpha = 1;
}

/** The events of the view: a line at each onset (and at the end of a user span) and a light wash over spans. */
export function drawEvents(ctx: CanvasRenderingContext2D, scene: EventsScene) {
  const { W, H, dpr, view, colors } = scene;
  const x = (t: number) => ((t - view.t0) / (view.t1 - view.t0)) * W;
  const line = Math.max(1, Math.round(dpr));
  const shown = (a: { onset_s: number; duration_s: number }) =>
    a.onset_s + a.duration_s >= view.t0 && a.onset_s <= view.t1;
  const wash = (a: { onset_s: number; duration_s: number }, color: string, alpha: number) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fillRect(x(a.onset_s), 0, x(a.onset_s + a.duration_s) - x(a.onset_s), H);
    ctx.globalAlpha = 1;
  };
  for (const a of scene.recording?.info.annotations ?? []) {
    if (!shown(a)) continue;
    if (a.duration_s > 0) wash(a, colors.event, 0.08);
    vline(ctx, Math.round(x(a.onset_s)), line, colors.event, scene);
  }
  for (const a of scene.user ?? []) {
    if (!shown(a)) continue;
    const alpha = a.id === scene.picked ? 1 : 0.6;
    if (a.duration_s > 0) {
      wash(a, colors.ink, 0.06);
      vline(ctx, Math.round(x(a.onset_s + a.duration_s)), line, colors.ink, scene, alpha);
    }
    vline(ctx, Math.round(x(a.onset_s)), line, colors.ink, scene, alpha);
  }
}

/** The selection, the events and the cursor, which every plot on the time axis shares. */
export function drawMarks(ctx: CanvasRenderingContext2D, scene: MarksScene) {
  const { W, dpr, view, colors, over } = scene;
  const x = (t: number) => ((t - view.t0) / (view.t1 - view.t0)) * W;
  const line = Math.max(1, Math.round(dpr));
  const mark = (t: number, color: string) => vline(ctx, Math.round(x(t)), line, color, scene);
  if (scene.selection) {
    ctx.fillStyle = colors.wash;
    ctx.fillRect(x(scene.selection.t0), 0, x(scene.selection.t1) - x(scene.selection.t0), scene.H);
    if (over) for (const t of [scene.selection.t0, scene.selection.t1]) mark(t, colors.primary);
  }
  drawEvents(ctx, scene);
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
  user: UserAnnotation[];
  picked: string | null;
  colors: Colors;
}

/** An event's flag on the ruler, in device pixels: what a pointer over the ruler hits. */
export interface Flag {
  /** A user annotation's id, or `file:<index>` for the recording's own. */
  id: string;
  user: boolean;
  x0: number;
  x1: number;
}

/** `text` cut to `room` device pixels with an ellipsis; empty when not even one letter fits. */
function elide(ctx: CanvasRenderingContext2D, text: string, room: number): string {
  if (ctx.measureText(text).width <= room) return text;
  for (let n = text.length - 1; n > 0; n--) {
    const cut = `${text.slice(0, n).trimEnd()}\u2026`;
    if (ctx.measureText(cut).width <= room) return cut;
  }
  return "";
}

/**
 * The time ruler: labeled ticks and a flag at each event in the view, a bar under a span. The recording's events
 * have outlined red flags, the user's solid ink ones. A flag takes the room up to the next one and elides its label
 * to fit; one with no room left is a narrow pin. Returns the flags as drawn.
 */
export function drawRuler(ctx: CanvasRenderingContext2D, scene: RulerScene): Flag[] {
  const { W, H, dpr, view, recording, colors } = scene;
  const x = (t: number) => ((t - view.t0) / (view.t1 - view.t0)) * W;
  const line = Math.max(1, Math.round(dpr));
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = colors.hairline;
  ctx.fillRect(0, H - line, W, line);
  ctx.textBaseline = "middle";
  const events = [
    ...recording.info.annotations.map((a, i) => ({ a, id: `file:${i}`, user: false })),
    ...scene.user.map((a) => ({ a, id: a.id, user: true })),
  ]
    .filter(({ a }) => a.onset_s + a.duration_s >= view.t0 && a.onset_s <= view.t1)
    .map((e) => ({ ...e, left: Math.max(0, Math.round(x(e.a.onset_s))) }))
    .sort((p, q) => p.left - q.left);
  const [top, h, pad, pin] = [2 * dpr, H - 6 * dpr, 4 * dpr, 4 * dpr];
  ctx.font = `600 ${11 * dpr}px ${colors.font}`;
  const flags = events.map(({ a, left }, k) => {
    const room = (events[k + 1]?.left ?? W) - left - 2 * dpr;
    const text = elide(ctx, a.label || "event", room - 2 * pad);
    return { text, x0: left, x1: left + (text ? ctx.measureText(text).width + 2 * pad : pin) };
  });
  // The ticks first. A label a flag would cover moves to the left of its tick, or is left out.
  ctx.font = `${11 * dpr}px ${colors.font}`;
  const { step, at } = ticks(view.t0, view.t1, W / dpr, 96);
  const free = (l0: number, l1: number) =>
    l0 >= 0 && !flags.some((f) => f.x0 < l1 + 2 * dpr && f.x1 > l0 - 2 * dpr);
  for (const t of at) {
    const px = Math.round(x(t));
    ctx.fillStyle = colors.hairline;
    ctx.fillRect(px, H - 5 * dpr, line, 5 * dpr);
    const text = tickLabel(t, step);
    const w = ctx.measureText(text).width;
    const l0 = [px + 3 * dpr, px - 3 * dpr - w].find((l) => free(l, l + w));
    if (l0 === undefined) continue;
    ctx.fillStyle = colors.muted;
    ctx.fillText(text, l0, H / 2 - dpr);
  }
  ctx.font = `600 ${11 * dpr}px ${colors.font}`;
  events.forEach(({ a, id, user, left }, k) => {
    const { text, x1 } = flags[k];
    const w = x1 - left;
    if (a.duration_s > 0) {
      ctx.fillStyle = user ? colors.ink : colors.event;
      ctx.fillRect(left, H - 4 * dpr, Math.min(W, x(a.onset_s + a.duration_s)) - left, 2 * dpr);
    }
    ctx.fillStyle = user ? colors.ink : colors.ground;
    ctx.fillRect(left, top, w, h);
    if (!user) {
      ctx.strokeStyle = colors.event;
      ctx.lineWidth = line;
      ctx.strokeRect(left + line / 2, top + line / 2, w - line, h - line);
    }
    if (id === scene.picked) {
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = 2 * line;
      ctx.strokeRect(left - line, top - line, w + 2 * line, h + 2 * line);
    }
    ctx.fillStyle = user ? colors.ground : colors.event;
    if (text) ctx.fillText(text, left + pad, top + h / 2);
  });
  return events.map(({ id, user }, k) => ({ id, user, x0: flags[k].x0, x1: flags[k].x1 }));
}

export interface AxisScene {
  W: number;
  H: number;
  dpr: number;
  view: { t0: number; t1: number };
  cursorS: number | null;
  colors: Colors;
}

/**
 * The time axis under a plot (the heatmap's, as in the approved sketch): a hairline on top with the ticks hanging
 * from it and their labels, and the cursor's time on a tag at the cursor. The events keep their flags on the
 * waveform's ruler.
 */
export function drawTimeAxis(ctx: CanvasRenderingContext2D, scene: AxisScene) {
  const { W, H, dpr, view, colors } = scene;
  const x = (t: number) => ((t - view.t0) / (view.t1 - view.t0)) * W;
  const line = Math.max(1, Math.round(dpr));
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = colors.hairline;
  ctx.fillRect(0, 0, W, line);
  ctx.font = `${11 * dpr}px ${colors.font}`;
  ctx.textBaseline = "middle";
  const { step, at } = ticks(view.t0, view.t1, W / dpr, 96);
  for (const t of at) {
    const px = Math.round(x(t));
    ctx.fillStyle = colors.hairline;
    ctx.fillRect(px, 0, line, 5 * dpr);
    ctx.fillStyle = colors.muted;
    ctx.fillText(tickLabel(t, step), px + 3 * dpr, H / 2 + dpr);
  }
  const { cursorS } = scene;
  if (cursorS === null || cursorS < view.t0 || cursorS > view.t1) return;
  // One decimal more than the ticks, at least two.
  const text = `${cursorS.toFixed(Math.max(2, 1 - Math.floor(Math.log10(step) + 1e-9)))} s`;
  ctx.font = `600 ${11 * dpr}px ${colors.font}`;
  const w = ctx.measureText(text).width + 8 * dpr;
  const left = Math.max(0, Math.min(Math.round(x(cursorS)), W - w));
  ctx.fillStyle = colors.primary;
  ctx.fillRect(left, 3 * dpr, w, H - 6 * dpr);
  ctx.fillStyle = colors.primaryInk;
  ctx.fillText(text, left + 4 * dpr, H / 2 + dpr);
}
