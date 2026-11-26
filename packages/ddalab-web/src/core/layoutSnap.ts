// Magnetic snap math and dock drop-zone hit-testing for DDALAB's resizable & draggable workspace panels.

export type DockZone = "left" | "right" | "top" | "bottom" | "center";
export type ResultDock = "bottom" | "top" | "right" | "left";
export type RowPlotPosition = "below" | "above";

export interface SplitRecording {
  /** Fingerprint of the secondary recording pinned beside or below the primary recording. */
  fingerprint: string;
  /** `"horizontal"` = side-by-side columns; `"vertical"` = stacked rows. */
  direction: "horizontal" | "vertical";
  /** Fraction (`0.25..0.75`) of the pane owned by the primary recording. */
  ratio: number;
}

export type PanelDrag = { kind: "tab"; fingerprint: string; name: string } | { kind: "result" } | null;

export const LIBRARY_STOPS = [240, 288, 360] as const;
export const INSPECTOR_STOPS = [300, 348, 420] as const;
export const RATIO_STOPS = [0.33, 0.5, 0.67] as const;
export const ROW_PLOT_STOPS = [88, 140, 200, 260] as const;
export const DEFAULT_ROW_PLOT_HEIGHT = 88;

/**
 * Magnetically snaps `raw` to the nearest entry in `stops` when within `threshold`.
 * Returns the snapped value and which stop engaged (`null` when free-sliding).
 */
export function snapValue(
  raw: number,
  stops: readonly number[],
  threshold: number,
): { value: number; snapped: number | null } {
  let best: number | null = null;
  let bestDist = threshold + Number.EPSILON;
  for (const stop of stops) {
    const dist = Math.abs(raw - stop);
    if (dist <= bestDist) {
      bestDist = dist;
      best = stop;
    }
  }
  return best === null ? { value: raw, snapped: null } : { value: best, snapped: best };
}

/** Clamps `raw` into `[min, max]` and applies magnetic snapping to `stops` within `threshold`. */
export function clampAndSnap(
  raw: number,
  min: number,
  max: number,
  stops: readonly number[],
  threshold: number,
): { value: number; snapped: number | null } {
  const clamped = Math.max(min, Math.min(max, raw));
  return snapValue(clamped, stops, threshold);
}

/** Clamps a split ratio to `[0.25, 0.75]` and magnetically snaps to `[0.33, 0.5, 0.67]`. */
export function snapRatio(
  raw: number,
  stops: readonly number[] = RATIO_STOPS,
  threshold = 0.025,
): { value: number; snapped: number | null } {
  return clampAndSnap(raw, 0.25, 0.75, stops, threshold);
}

/**
 * Resolves which dock zone (`left`, `right`, `top`, `bottom`, or `center`) a pointer at `(clientX, clientY)` targets
 * inside `rect`. Outer 28% edge bands map to the nearest edge; the interior maps to `center` when allowed, otherwise
 * to the nearest allowed edge.
 */
export function resolveDropZone(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  allowed: readonly DockZone[] = ["left", "right", "top", "bottom", "center"],
): DockZone {
  if (rect.width <= 0 || rect.height <= 0) return allowed[0] ?? "center";
  const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
  const edgeBand = 0.28;

  const all: { zone: DockZone; dist: number }[] = [
    { zone: "left", dist: nx },
    { zone: "right", dist: 1 - nx },
    { zone: "top", dist: ny },
    { zone: "bottom", dist: 1 - ny },
  ];
  const candidates = all.filter((c) => allowed.includes(c.zone));

  candidates.sort((a, b) => a.dist - b.dist);
  const nearest = candidates[0];
  if (allowed.includes("center") && (!nearest || nearest.dist > edgeBand)) {
    return "center";
  }
  return nearest?.zone ?? allowed[0] ?? "center";
}

const DOCK_KEY = "ddalab.resultDock";
const ROW_PLOT_H_KEY = "ddalab.rowPlotHeight";
const ROW_PLOT_POS_KEY = "ddalab.rowPlotPosition";

export function storedResultDock(): ResultDock {
  try {
    const v = localStorage.getItem(DOCK_KEY);
    if (v === "bottom" || v === "top" || v === "right" || v === "left") return v;
  } catch {}
  return "bottom";
}

export function saveResultDock(dock: ResultDock) {
  try {
    localStorage.setItem(DOCK_KEY, dock);
  } catch {}
}

export function storedRowPlotHeight(): number {
  try {
    const n = Number(localStorage.getItem(ROW_PLOT_H_KEY));
    if (Number.isFinite(n) && n >= 56 && n <= 320) return Math.round(n);
  } catch {}
  return DEFAULT_ROW_PLOT_HEIGHT;
}

export function saveRowPlotHeight(height: number) {
  try {
    localStorage.setItem(ROW_PLOT_H_KEY, String(Math.round(height)));
  } catch {}
}

export function storedRowPlotPosition(): RowPlotPosition {
  try {
    const v = localStorage.getItem(ROW_PLOT_POS_KEY);
    if (v === "below" || v === "above") return v;
  } catch {}
  return "below";
}

export function saveRowPlotPosition(pos: RowPlotPosition) {
  try {
    localStorage.setItem(ROW_PLOT_POS_KEY, pos);
  } catch {}
}
