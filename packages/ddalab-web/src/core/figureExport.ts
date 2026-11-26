// Publication-ready figure export (2x DPI PNG and standalone vector SVG) for a completed DDA result:
// renders row labels, exact colormap heatmap (respecting active scale/z-score/sort/colormap), synchronized time axis,
// event/annotation markers, and a labeled color bar.
import {
  computeRowOrder,
  computeRowStats,
  type HeatmapOptions,
  resolveScale,
  transformTile,
} from "../features/results/resultTransform";
import { colorIndex, LUTS, type MapName, mapOf } from "../render/colormaps";
import type { ResultTile } from "../render/resultPyramid";
import { useStore } from "../store/store";
import type { AnalysisRecord } from "./history";
import type { ResultDocument } from "./types";

export interface FigureData {
  title: string;
  subtitle: string;
  rowLabels: string[];
  /** Row-major `[w * rows + r]` displayed values across `windows` columns. */
  values: Float32Array;
  windows: number;
  rows: number;
  t0: number;
  t1: number;
  map: MapName;
  lo: number;
  hi: number;
  valueName: string;
  annotations: { onset_s: number; label: string }[];
}

const escapeXml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const fmtNum = (v: number) => (Number.isFinite(v) ? v.toPrecision(3) : "—");

function niceTicks(t0: number, t1: number, target = 6): number[] {
  const span = t1 - t0;
  if (!(span > 0)) return [t0];
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / pow;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * pow;
  const first = Math.ceil(t0 / step) * step;
  const ticks: number[] = [];
  for (let t = first; t <= t1 + step * 1e-6; t += step) ticks.push(Number(t.toFixed(6)));
  return ticks;
}

/** Builds a clean standalone SVG string from pre-assembled `FigureData` (pure, testable without DOM). */
export function buildFigureSvg(data: FigureData, heatmapDataUrl?: string): string {
  const { title, subtitle, rowLabels, values, windows, rows, t0, t1, map, lo, hi, valueName, annotations } =
    data;
  const lut = LUTS[map];
  const left = 112;
  const right = 24;
  const top = 56;
  const bottom = 68;
  const plotW = 760;
  const plotH = Math.max(160, Math.min(520, rows * 18));
  const width = left + plotW + right;
  const height = top + plotH + bottom;
  const span = Math.max(1e-9, t1 - t0);
  const xOf = (t: number) => left + ((t - t0) / span) * plotW;

  // Colorbar gradient stops (16 steps of the exact LUT).
  const gradStops = Array.from({ length: 17 }, (_, s) => {
    const i = Math.round((s / 16) * 255);
    const rgb = `rgb(${lut[4 * i]},${lut[4 * i + 1]},${lut[4 * i + 2]})`;
    return `<stop offset="${((s / 16) * 100).toFixed(1)}%" stop-color="${rgb}"/>`;
  }).join("");

  // Fallback vector rect grid when no PNG data URL is embedded (keeps SVG self-contained in headless environments).
  let heatmapBody = "";
  if (heatmapDataUrl) {
    heatmapBody = `<image x="${left}" y="${top}" width="${plotW}" height="${plotH}" preserveAspectRatio="none" style="image-rendering:pixelated" href="${heatmapDataUrl}"/>`;
  } else {
    const cols = Math.min(windows, 256);
    const cw = plotW / Math.max(1, cols);
    const rh = plotH / Math.max(1, rows);
    const rects: string[] = [];
    for (let c = 0; c < cols; c++) {
      const w = Math.floor((c / cols) * windows);
      for (let r = 0; r < rows; r++) {
        const v = values[w * rows + r];
        if (!Number.isFinite(v)) continue;
        const idx = colorIndex(v, lo, hi);
        rects.push(
          `<rect x="${(left + c * cw).toFixed(1)}" y="${(top + r * rh).toFixed(1)}" width="${(cw + 0.4).toFixed(1)}" height="${(rh + 0.4).toFixed(1)}" fill="rgb(${lut[4 * idx]},${lut[4 * idx + 1]},${lut[4 * idx + 2]})"/>`,
        );
      }
    }
    heatmapBody = rects.join("");
  }

  // Row labels (thin out automatically if many rows so labels stay legible).
  const labelStep = Math.max(1, Math.ceil(rows / 32));
  const yLabels = rowLabels
    .map((label, r) => {
      if (r % labelStep !== 0) return "";
      const y = top + ((r + 0.5) / rows) * plotH + 4;
      return `<text x="${left - 8}" y="${y.toFixed(1)}" text-anchor="end" font-size="11" fill="#1e2a33">${escapeXml(label)}</text>`;
    })
    .join("");

  // Time axis ticks.
  const ticks = niceTicks(t0, t1, 7)
    .map((t) => {
      const x = xOf(t);
      return `<line x1="${x.toFixed(1)}" y1="${top + plotH}" x2="${x.toFixed(1)}" y2="${top + plotH + 5}" stroke="#56636e"/><text x="${x.toFixed(1)}" y="${top + plotH + 18}" text-anchor="middle" font-size="11" fill="#56636e">${t}</text>`;
    })
    .join("");

  // Annotations inside [t0, t1].
  const markers = annotations
    .filter((a) => a.onset_s >= t0 && a.onset_s <= t1)
    .slice(0, 30)
    .map((a) => {
      const x = xOf(a.onset_s);
      return `<line x1="${x.toFixed(1)}" y1="${top}" x2="${x.toFixed(1)}" y2="${top + plotH}" stroke="#b4372b" stroke-width="1" stroke-dasharray="3,2"/><text x="${(x + 3).toFixed(1)}" y="${top - 4}" font-size="10" fill="#b4372b">${escapeXml(a.label)}</text>`;
    })
    .join("");

  const cbX = left + plotW - 160;
  const cbY = top + plotH + 38;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`,
    `<defs><linearGradient id="cbar" x1="0" x2="1" y1="0" y2="0">${gradStops}</linearGradient></defs>`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<text x="${left}" y="22" font-size="15" font-weight="600" fill="#1e2a33">${escapeXml(title)}</text>`,
    `<text x="${left}" y="38" font-size="11" fill="#56636e">${escapeXml(subtitle)}</text>`,
    `<rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="#f1f3f5" stroke="#dee2e6"/>`,
    heatmapBody,
    markers,
    `<rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="none" stroke="#56636e" stroke-width="1"/>`,
    yLabels,
    ticks,
    `<text x="${(left + plotW / 2).toFixed(1)}" y="${top + plotH + 34}" text-anchor="middle" font-size="11" fill="#1e2a33">Time (s)</text>`,
    `<text x="${cbX - 8}" y="${cbY + 9}" text-anchor="end" font-size="11" font-weight="600" fill="#1e2a33">${escapeXml(valueName)}</text>`,
    `<rect x="${cbX}" y="${cbY}" width="160" height="10" fill="url(#cbar)" stroke="#56636e" stroke-width="0.5"/>`,
    `<text x="${cbX}" y="${cbY + 22}" text-anchor="start" font-size="10" fill="#56636e">${escapeXml(fmtNum(lo))}</text>`,
    `<text x="${cbX + 160}" y="${cbY + 22}" text-anchor="end" font-size="10" fill="#56636e">${escapeXml(fmtNum(hi))}</text>`,
    `</svg>`,
  ].join("\n");
}

function rasterizeHeatmapCanvas(data: FigureData): HTMLCanvasElement {
  const { windows, rows, values, lo, hi, map } = data;
  const lut = LUTS[map];
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, windows);
  canvas.height = Math.max(1, rows);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const img = ctx.createImageData(canvas.width, canvas.height);
  for (let w = 0; w < windows; w++) {
    for (let r = 0; r < rows; r++) {
      const v = values[w * rows + r];
      const dst = (r * canvas.width + w) * 4;
      if (!Number.isFinite(v)) {
        img.data[dst] = 241;
        img.data[dst + 1] = 243;
        img.data[dst + 2] = 245;
        img.data[dst + 3] = 255;
        continue;
      }
      const idx = colorIndex(v, lo, hi);
      img.data[dst] = lut[4 * idx];
      img.data[dst + 1] = lut[4 * idx + 1];
      img.data[dst + 2] = lut[4 * idx + 2];
      img.data[dst + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function gatherFigureData(record: AnalysisRecord, variantId?: string): Promise<FigureData> {
  const { engine } = await import("../app/recordings");
  const manifest: ResultDocument = await engine.resultManifest(record.id);
  const state = useStore.getState();
  const variant =
    manifest.variants.find((v) => v.id === (variantId ?? state.shownResult?.variant)) ?? manifest.variants[0];
  if (!variant) throw new Error("Result has no variants to plot");
  const arrayKind: "q" | "fit_error" = state.shownResult?.array === "fit_error" ? "fit_error" : "q";
  const arr = await engine.resultArray(record.id, variant.id, arrayKind);
  const topLevel = Math.max(0, arr.levels - 1);
  const rawTile: ResultTile = await engine.resultTile(record.id, variant.id, arrayKind, topLevel, 0);

  const opts: HeatmapOptions = state.heatmapOptions;
  const rowOrder = computeRowOrder(arr.rows, opts.sort, arr);
  const zStats = opts.zScore ? computeRowStats(rawTile) : null;
  const transformed = transformTile(rawTile, { rowOrder, zStats });
  const map: MapName =
    state.colormap && state.colormap in LUTS
      ? state.colormap
      : opts.zScore
        ? "vik"
        : mapOf(variant.id, arrayKind, false);
  const { lo, hi } = resolveScale(map, arr, opts, transformed.values);

  const centers = manifest.window_centers_seconds;
  const t0 = centers[0] ?? 0;
  const t1 = centers[centers.length - 1] ?? t0 + 1;
  const rec = Object.values(state.recordings).find((r) => r.fingerprint === record.fingerprint);
  const annotations = [
    ...(rec?.info.annotations ?? []),
    ...(state.annotations[record.fingerprint] ?? []),
  ].map((a) => ({ onset_s: a.onset_s, label: a.label }));

  const repro = manifest.reproduction;
  return {
    title: `${record.fileName} — ${variant.label} (${variant.id})`,
    subtitle: `WL ${repro.window_length_samples}, WS ${repro.window_step_samples}, delays [${repro.delays.join(", ")}] · DDALAB ${repro.engine_version}`,
    rowLabels: rowOrder.map((orig) => variant.row_labels[orig] ?? `row ${orig}`),
    values: transformed.values,
    windows: transformed.windows,
    rows: transformed.rows,
    t0,
    t1,
    map,
    lo,
    hi,
    valueName: opts.zScore
      ? `${arrayKind === "q" ? "Q" : "Fit error"} (z)`
      : arrayKind === "q"
        ? "Q"
        : "Fit error",
    annotations,
  };
}

/** Exports a standalone vector SVG figure (with embedded crisp raster heatmap). */
export async function exportFigureSvg(record: AnalysisRecord, variantId?: string): Promise<Blob> {
  const data = await gatherFigureData(record, variantId);
  const dataUrl =
    typeof document !== "undefined" ? rasterizeHeatmapCanvas(data).toDataURL("image/png") : undefined;
  const svg = buildFigureSvg(data, dataUrl);
  return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
}

/** Exports a crisp 2× DPI publication PNG figure by rasterizing the SVG composition onto a canvas. */
export async function exportFigurePng(record: AnalysisRecord, variantId?: string): Promise<Blob> {
  const svgBlob = await exportFigureSvg(record, variantId);
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not rasterize figure SVG"));
      el.src = url;
    });
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
