// The result under the waveform, on its time axis: the variant tabs, the heatmap of the chosen array with its color bar
// and electrode-group tints, the multi-row line plot of pinned rows, and the time axis. Supports robust percentile
// scaling, custom color limits, per-row z-score normalization, row sorting (channel / activity / group), B - A diff
// comparison against another completed result, and bidirectional hover highlighting with the waveform pane above.
import { Tabs } from "@base-ui/react/tabs";
import GripVertical from "lucide-react/dist/esm/icons/grip-vertical.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import {
  type CSSProperties,
  type KeyboardEvent,
  memo,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  Suspense,
  use,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { MiddleText } from "../../app/MiddleText";
import { engine } from "../../app/recordings";
import { inTransition } from "../../app/viewTransition";
import { getChannelHighlight, setChannelHighlight, subscribeChannelHighlight } from "../../core/highlight";
import { clampAndSnap, RATIO_STOPS, type ResultDock } from "../../core/layoutSnap";
import type { ResultArray } from "../../core/protocol";
import type { ResultDocument } from "../../core/types";
import { count } from "../../core/words";
import { drawMarks, drawTimeAxis } from "../../render/axis";
import { LUTS, type MapName, mapOf } from "../../render/colormaps";
import { observeDevicePixels } from "../../render/devicePixels";
import { webgl2 } from "../../render/gl";
import { createHeatmapLayer, type HeatmapLayer } from "../../render/heatmapLayer";
import { FANOUT } from "../../render/resultPyramid";
import { isDark, readColors, watchTheme } from "../../render/themeColors";
import {
  openResult,
  setCursor,
  setPanelDrag,
  setResultDock,
  setResultHeight,
  setResultWidth,
  setShownResult,
  setView,
  togglePinnedRow,
  useStore,
} from "../../store/store";
import controls from "../../styles/controls.module.css";
import { userOf } from "../annotations/model";
import { channelLabels } from "../inspector/groups";
import { probing } from "../viewer/probe";
import { usePlotPointer } from "../viewer/usePlotPointer";
import { ColorMapPicker } from "./ColorMapPicker";
import { HoverReadout, type HoverReadoutHandle } from "./HoverReadout";
import { arrayKey, arrayOf, type Loaded, loads, manifestKey, manifestOf, pick } from "./loads";
import { type HeatmapProbeFrame, heatmapProbe } from "./probe";
import { ResultDisplayMenu } from "./ResultDisplayMenu";
import styles from "./Results.module.css";
import { RowPlot, type RowPlotHandle } from "./RowPlot";
import {
  computeRowOrder,
  computeRowStats,
  type HeatmapOptions,
  type RowStats,
  resolveScale,
  transformTile,
} from "./resultTransform";
import { VariantTabs, valueInfo } from "./VariantTabs";

const AXIS_CSS = 22;
/** The heatmap's height as the user sets it, in CSS pixels: from the CSS minimum to 60 % of the window. */
const heightOf = (height: number) => Math.round(Math.max(56, Math.min(height, 0.6 * innerHeight)));
const GL_MISSING = "The heatmap is drawn with WebGL2, which this browser does not provide.";
const GL_LOST = "The browser reset WebGL2 drawing. The heatmap returns once it restores it.";

const print = (value: number) => value.toPrecision(3);

/** A row label as shown: the engine's ASCII arrows as the arrows LaTeX draws (\leftrightarrow, \leftarrow). */
const arrows = (label: string) => label.replace(" <-> ", " ↔ ").replace(" <- ", " ← ");

/** The channels a shown row label names: "A", "A & B", "A ← B" or "A ↔ B". */
const channelsOf = (label: string) => label.split(/ (?:↔|←|&) /);

export default function ResultPanel(props: { recordingId: string | null; resultId: string }) {
  const loaded = use(manifestOf(props.resultId));
  // An imported result has no fingerprint (history.ts): it is recreated by importing it again.
  const imported = useStore((s) => s.analyses.find((a) => a.id === props.resultId)?.fingerprint === "");
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  if ("error" in loaded) {
    const retry = () => {
      loads.delete(manifestKey(props.resultId));
      rerender();
    };
    return (
      <section className={styles.result} aria-label="Result" data-appear>
        <p role="alert" className={styles.failed}>
          The result could not be read: {loaded.error}.{" "}
          {imported ? "Import it again to recreate it." : "Run the analysis again to recreate it."}{" "}
          <button type="button" className={controls.quiet} onClick={retry}>
            Try again
          </button>
        </p>
      </section>
    );
  }
  return <Heatmap {...props} manifest={loaded.ok} />;
}

function Heatmap({
  recordingId,
  resultId,
  manifest,
}: {
  recordingId: string | null;
  resultId: string;
  manifest: ResultDocument;
}) {
  const shown = useStore((s) => s.shownResult);
  const info = useStore((s) => (recordingId === null ? undefined : s.recordings[recordingId]?.info));
  const analysis = useStore((s) =>
    recordingId === null ? undefined : s.recordings[recordingId]?.analysis_channels,
  );
  const opts = useStore((s) => s.heatmapOptions);
  const analyses = useStore((s) => s.analyses);
  const { variant, hasFitError, array } = pick(manifest, shown);
  const named = useMemo(
    () => channelLabels(info?.channels ?? [], (info && analysis) || []),
    [analysis, info],
  );
  // A row label names an unnamed channel by its empty part, which shows the channel's shown name instead.
  const origLabels = useMemo(() => {
    const k = info && analysis ? analysis.findIndex((i) => !info.channels[i].label.trim()) : -1;
    const unnamed = k < 0 ? "" : named.labels[k];
    return variant.row_labels.map((label) =>
      arrows(label)
        .split(/( (?:↔|←|&) )/)
        .map((part) => part || unnamed)
        .join(""),
    );
  }, [variant.row_labels, analysis, info, named]);
  const rows = origLabels.length;

  // Group index per original row, for electrode-group sorting.
  const groupOfRow = useMemo(() => {
    const { labels: names, groupOf } = named;
    const mapByName = new Map(names.map((name, c) => [name, groupOf[c]]));
    return origLabels.map((label) => {
      const firstCh = channelsOf(label)[0];
      return mapByName.get(firstCh) ?? 9999;
    });
  }, [named, origLabels]);

  // Valid comparison target (different completed result that carries this variant).
  const compareId = useMemo(() => {
    if (!opts.compareResultId || opts.compareResultId === resultId) return null;
    const found = analyses.find((a) => a.id === opts.compareResultId && a.status === "complete");
    if (!found) return null;
    const hasVar =
      found.manifest?.variants.some((v) => v.id === variant.id) ??
      found.request.algorithm_selection.enabled_variants.includes(variant.id);
    return hasVar ? found.id : null;
  }, [opts.compareResultId, resultId, analyses, variant.id]);

  // The diverging map follows the theme; diff (B - A) and z-score always default to diverging.
  const dark = useSyncExternalStore(watchTheme, isDark);
  const colormap = useStore((s) => s.colormap);
  const auto: MapName = compareId || opts.zScore ? (dark ? "berlin" : "vik") : mapOf(variant.id, array, dark);
  const map: MapName = colormap && colormap in LUTS ? colormap : auto;

  const loading = arrayOf(resultId, variant.id, array);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const retry = () => {
    loads.delete(arrayKey(resultId, variant.id, array));
    rerender();
  };

  // Resolved row order & dynamic scale (updated once the array/top tile resolves).
  const [rowOrder, setRowOrder] = useState<number[]>(() => Array.from({ length: rows }, (_, i) => i));
  const [resolvedScale, setResolvedScale] = useState<{ map: MapName; lo: number; hi: number } | null>(null);

  useEffect(() => {
    setRowOrder(Array.from({ length: rows }, (_, i) => i));
  }, [rows]);

  const labels = useMemo(() => rowOrder.map((orig) => origLabels[orig] ?? ""), [rowOrder, origLabels]);

  // Pinned original rows (1 to 4); clicking a gutter/heatmap row selects 1, Shift-click toggles overlay.
  const pinnedOrigRows = useMemo(() => {
    const raw =
      shown?.pinnedRows && shown.pinnedRows.length > 0
        ? shown.pinnedRows
        : shown?.row != null
          ? [shown.row]
          : [];
    return raw.filter((r) => r >= 0 && r < rows);
  }, [shown?.pinnedRows, shown?.row, rows]);

  // Map original row -> display row for gutter aria-pressed and row plot retrieval.
  const origToDisp = useMemo(() => {
    const m = new Map<number, number>();
    for (let disp = 0; disp < rowOrder.length; disp++) m.set(rowOrder[disp], disp);
    return m;
  }, [rowOrder]);

  // Each displayed row's electrode-group tint, as in the waveform's gutter; a pair across two groups gets both halves.
  const tints = useMemo(() => {
    const { labels: names, groups, groupOf } = named;
    const tintOf = new Map(names.map((name, c) => [name, groups[groupOf[c]].tint]));
    return labels.map((label) => {
      const [a, b = a] = channelsOf(label).map((channel) => tintOf.get(channel) ?? "transparent");
      return a === b ? a : `linear-gradient(${a} 50%, ${b} 50%)`;
    });
  }, [named, labels]);

  /** Why the heatmap cannot be drawn, when it cannot. */
  const [glProblem, setGlProblem] = useState<string | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const heat = useRef<HTMLCanvasElement>(null);
  const marks = useRef<HTMLCanvasElement>(null);
  const axis = useRef<HTMLCanvasElement>(null);
  const gutter = useRef<HTMLUListElement>(null);
  const problem = useRef<HTMLParagraphElement>(null);
  const spoken = useRef<HTMLParagraphElement>(null);
  const readout = useRef<HoverReadoutHandle>(null);
  const rowPlot = useRef<RowPlotHandle>(null);
  const handle = useRef<HTMLHRElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const height = useStore((s) => s.resultHeight);
  const width = useStore((s) => s.resultWidth);
  const dock = useStore((s) => s.resultDock);
  const rowPlotPosition = useStore((s) => s.rowPlotPosition);
  const [dragBadge, setDragBadge] = useState<{ label: string; snapped: boolean } | null>(null);
  usePlotPointer(plot, recordingId);

  useEffect(() => {
    const [plotEl, heatEl, marksEl, axisEl, gutterEl, problemEl, spokenEl] = [
      plot.current,
      heat.current,
      marks.current,
      axis.current,
      gutter.current,
      problem.current,
      spoken.current,
    ];
    const opened = recordingId === null ? undefined : useStore.getState().recordings[recordingId];
    if (!plotEl || !heatEl || !marksEl || !axisEl || !gutterEl || !problemEl || !spokenEl) return;
    const marksCtx = marksEl.getContext("2d") as CanvasRenderingContext2D;
    const axisCtx = axisEl.getContext("2d") as CanvasRenderingContext2D;
    const centers = manifest.window_centers_seconds;
    const windows = centers.length;
    const c0 = centers[0];
    // Centers lie one window step apart: positions count steps from the first center.
    const step = windows > 1 ? (centers[windows - 1] - c0) / (windows - 1) : 1;
    const {
      window_length_samples: length,
      request,
      start_time_seconds,
      end_time_seconds,
    } = manifest.reproduction;
    // Without the recording, its rate is the interval's samples over its seconds.
    const rate =
      opened?.info.sample_rate_hz ??
      (request.time_range.end - request.time_range.start) / (end_time_seconds - start_time_seconds);
    const halfS = length / rate / 2;
    const [baseName] = valueInfo(variant.id, array);
    const name = compareId ? `Δ ${baseName}` : opts.zScore ? `${baseName} (z)` : baseName;
    let colors = readColors(plotEl);
    let size = { cssW: 0, cssH: 0, dpr: 1, W: 0, H: 0 };
    let raf = 0;
    let gl: WebGL2RenderingContext | null = null;
    let layer: HeatmapLayer | null = null;
    let source: {
      array: ResultArray;
      scale: { map: MapName; lo: number; hi: number };
      order: number[];
      zStats: RowStats | null;
      compareRowMap: Int32Array | null;
    } | null = null;
    let shownProblem: string | null = null;
    let said = "";
    /** The pointer over the plot, in CSS pixels. */
    let pointer: { x: number; y: number } | null = null;
    /** The display row whose button has the keyboard focus: the readout follows the cursor in it. */
    let focused: number | null = null;
    let disposed = false;

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };

    const start = () => {
      if (!source) return;
      try {
        gl = webgl2(heatEl);
        if (!gl) return setGlProblem(GL_MISSING);
        const { array: found, scale, order, zStats, compareRowMap } = source;
        const transformTag = [opts.sort, opts.zScore ? "z" : "", compareId ? `cmp:${compareId}` : ""]
          .filter(Boolean)
          .join("|");
        const fetchTile = async (level: number, index: number) => {
          const primaryTile = await engine.resultTile(resultId, variant.id, array, level, index);
          if (!compareId || !compareRowMap) {
            return transformTile(primaryTile, { rowOrder: order, zStats });
          }
          const compareTile = await engine.resultTile(compareId, variant.id, array, level, index);
          return transformTile(primaryTile, {
            rowOrder: order,
            zStats,
            compare: { tile: compareTile, rowMap: compareRowMap },
          });
        };
        layer = createHeatmapLayer(
          gl,
          fetchTile,
          {
            ...scale,
            key: `${arrayKey(resultId, variant.id, array)}${transformTag ? `#${transformTag}` : ""}`,
            windows: found.windows,
            rows: found.rows,
            levels: found.levels,
            lut: LUTS[scale.map],
          },
          schedule,
        );
        setGlProblem(null);
      } catch (error) {
        layer = null;
        setGlProblem(`DDALAB could not set up WebGL2 drawing: ${(error as Error).message}`);
      }
      schedule();
    };

    // Load the array metadata (and when needed, the coarse top tile for robust/z-score/diff stats).
    void (async () => {
      const found = await loading;
      if (disposed || "error" in found) return;
      const arr = found.ok;
      const order = computeRowOrder(rows, opts.sort, arr, groupOfRow);
      setRowOrder(order);

      let compareRowMap: Int32Array | null = null;
      if (compareId) {
        const cmpManifest = await manifestOf(compareId);
        if (!disposed && "ok" in cmpManifest) {
          const cmpVar = cmpManifest.ok.variants.find((v) => v.id === variant.id);
          if (cmpVar) {
            const cmpIndex = new Map(cmpVar.row_labels.map((l, i) => [l, i]));
            compareRowMap = Int32Array.from(variant.row_labels, (l) => cmpIndex.get(l) ?? -1);
          }
        }
      }

      const needsTopSample = opts.scaleMode === "robust" || opts.zScore || compareRowMap !== null;
      let zStats: RowStats | null = null;
      let sampleValues: Float32Array | null = null;
      if (needsTopSample) {
        try {
          const topLevel = Math.max(0, arr.levels - 1);
          const topPrimary = await engine.resultTile(resultId, variant.id, array, topLevel, 0);
          let working = topPrimary;
          if (compareId && compareRowMap) {
            const topCmp = await engine.resultTile(compareId, variant.id, array, topLevel, 0);
            working = transformTile(topPrimary, { compare: { tile: topCmp, rowMap: compareRowMap } });
          }
          if (opts.zScore) {
            zStats = computeRowStats(working);
            working = transformTile(working, { zStats });
          }
          sampleValues = working.values;
        } catch {
          // Fall back gracefully to array-level min/max if top tile read fails.
        }
      }
      if (disposed) return;

      const scale = resolveScale(map, arr, opts, sampleValues);
      setResolvedScale(scale);
      source = { array: arr, scale, order, zStats, compareRowMap };
      start();
    })();

    const paint = () => {
      raf = 0;
      const state = useStore.getState();
      const recording = recordingId === null ? undefined : state.recordings[recordingId];
      const { W, H, dpr, cssW, cssH } = size;
      if ((recordingId !== null && !recording) || W === 0 || H === 0) return;
      const { view } = state;
      const span = view.t1 - view.t0;
      const { selection, cursorS } = state;
      const order = source?.order ?? Array.from({ length: rows }, (_, i) => i);
      const dispLabels = order.map((orig) => origLabels[orig] ?? "");

      // The row and the window at a point: the window is the one whose center is nearest, within its analysis interval.
      const cellAt = (at: { x: number; y: number } | null) => {
        if (!at) return null;
        const t = view.t0 + (at.x / cssW) * span;
        const window = Math.min(windows - 1, Math.max(0, Math.round((t - c0) / step)));
        const row = Math.min(rows - 1, Math.floor((at.y / cssH) * rows));
        return Math.abs(t - centers[window]) <= halfS && row >= 0 ? { row, window } : null;
      };
      // The keyboard's point: the cursor in the focused row.
      const key =
        focused !== null && cursorS !== null
          ? { x: ((cursorS - view.t0) / span) * cssW, y: ((focused + 0.5) / rows) * cssH }
          : null;
      // The readout shows the cell under the pointer, else the keyboard's.
      const at = pointer ?? key;
      const under = cellAt(at);

      // Bidirectional highlight from waveform hover when pointer is not over the heatmap.
      const externalHl = !under ? getChannelHighlight() : null;
      const externalRows: number[] = [];
      if (externalHl && externalHl.source === "waveform" && externalHl.labels.length > 0) {
        const target = new Set(externalHl.labels);
        for (let d = 0; d < rows; d++) {
          if (channelsOf(dispLabels[d]).some((ch) => target.has(ch))) externalRows.push(d);
        }
      }
      const activeHoverRow = under?.row ?? (externalRows.length === 1 ? externalRows[0] : null);

      const drawn = layer?.draw({
        width: W,
        height: H,
        p0: (view.t0 - c0) / step,
        ppx: span / W / step,
        half: halfS / step,
        hoverRow: activeHoverRow,
      });
      marksCtx.clearRect(0, 0, W, H);
      const events = {
        recording,
        user: recording && userOf(state, recording.fingerprint),
        picked: state.pickedAnnotation,
      };
      drawMarks(marksCtx, { W, H, dpr, view, selection, cursorS, ...events, colors, over: true });

      const outlineRow = (d: number, strokeStyle: string) => {
        const line = Math.max(1, Math.round(dpr));
        const [y0, y1] = [Math.round((d * H) / rows), Math.round(((d + 1) * H) / rows)];
        marksCtx.strokeStyle = strokeStyle;
        marksCtx.lineWidth = line;
        marksCtx.strokeRect(line / 2, y0 + line / 2, W - line, Math.max(line, y1 - y0 - line));
      };

      if (at && under) {
        // The hovered row at full contrast, outlined; the others recede (heatmapLayer.ts).
        outlineRow(under.row, colors.ink);
        const value = layer?.value(under.window, under.row);
        const center = centers[under.window];
        readout.current?.show(at.x, at.y, cssW, cssH, {
          row: dispLabels[under.row],
          center,
          value,
          name,
        });
      } else {
        readout.current?.hide();
        for (const d of externalRows) outlineRow(d, colors.primary);
      }

      // Screen readers hear the keyboard's cell, also while the pointer rests on the plot; the pointer's is shown only.
      const heard = cellAt(key);
      const heardValue = heard ? layer?.value(heard.window, heard.row) : undefined;
      const words =
        heard && heardValue !== undefined
          ? `${dispLabels[heard.row]}, window at ${centers[heard.window].toFixed(3)} s, ${name} ${heardValue.toPrecision(4)}`
          : "";
      if (words !== said) {
        said = words;
        spokenEl.textContent = words;
      }
      drawTimeAxis(axisCtx, { W, H: axisEl.height, dpr, view, cursorS, colors });

      // Multi-row overlay in RowPlot (1 to 4 pinned original rows).
      const pinned =
        state.shownResult?.pinnedRows && state.shownResult.pinnedRows.length > 0
          ? state.shownResult.pinnedRows
          : state.shownResult?.row != null
            ? [state.shownResult.row]
            : [];
      let primaryPoints: { t: number; v: number }[] | null = null;
      if (layer && pinned.length > 0) {
        const activeLayer = layer;
        const series = pinned
          .filter((orig) => orig >= 0 && orig < rows)
          .map((orig) => {
            const disp = order.indexOf(orig);
            const targetRow = disp >= 0 ? disp : orig;
            const { level, cells } = activeLayer.row(targetRow);
            const f = FANOUT ** level;
            const points = cells.map(([w, v]) => ({
              t: (centers[w] + centers[Math.min(windows - 1, w + f - 1)]) / 2,
              v,
            }));
            return { row: orig, label: origLabels[orig], points };
          });
        if (series.length > 0) {
          primaryPoints = series[series.length - 1].points;
          rowPlot.current?.draw({ series, view, width: W, dpr, colors, events });
        }
      }
      const message = drawn?.error ? `The result could not be read: ${drawn.error}. Trying again.` : null;
      if (message !== shownProblem) {
        shownProblem = message;
        problemEl.textContent = message ?? "";
        problemEl.hidden = message === null;
      }
      if (!probing || !drawn || !source) return;
      const probeRow = state.shownResult?.row;
      heatmapProbe.rowPlot =
        primaryPoints && probeRow != null ? { row: probeRow, points: primaryPoints } : null;
      const frame: HeatmapProbeFrame = {
        resultId,
        variant: variant.id,
        array,
        width: W,
        height: H,
        rows,
        level: drawn.level,
        ...source.scale,
        complete: drawn.complete,
      };
      heatmapProbe.frame = frame;
      if (drawn.complete) for (const resolve of heatmapProbe.waiters.splice(0)) resolve(frame);
    };

    const stopResize = observeDevicePixels(plotEl, (next) => {
      size = next;
      for (const canvas of [heatEl, marksEl]) {
        canvas.width = next.W;
        canvas.height = next.H;
      }
      axisEl.width = next.W;
      axisEl.height = Math.round(AXIS_CSS * next.dpr);
      handle.current?.setAttribute("aria-valuenow", String(Math.round(next.cssH)));
      paint();
    });

    // A paint follows what it draws: the view, the selection, the cursor, the plotted rows, the recording's events and
    // the user's annotations with the one picked or dragged.
    const unsubscribe = useStore.subscribe((s, p) => {
      if (
        s.view !== p.view ||
        s.selection !== p.selection ||
        s.cursorS !== p.cursorS ||
        s.shownResult !== p.shownResult ||
        s.rowPlotHeight !== p.rowPlotHeight ||
        s.rowPlotPosition !== p.rowPlotPosition ||
        (recordingId !== null && s.recordings[recordingId] !== p.recordings[recordingId]) ||
        s.annotations !== p.annotations ||
        s.annotationDraft !== p.annotationDraft ||
        s.pickedAnnotation !== p.pickedAnnotation
      )
        schedule();
    });
    const unwatch = watchTheme(() => {
      colors = readColors(plotEl);
      schedule();
    });
    const unhighlight = subscribeChannelHighlight(schedule);
    const lost = (event: Event) => {
      event.preventDefault();
      layer?.dispose();
      layer = null;
      setGlProblem(GL_LOST);
    };
    heatEl.addEventListener("webglcontextlost", lost);
    heatEl.addEventListener("webglcontextrestored", start);

    const at = (event: MouseEvent) => {
      const box = plotEl.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    const emitRowHighlight = (dispRow: number | null) => {
      if (dispRow === null) {
        if (getChannelHighlight()?.source === "heatmap") setChannelHighlight(null);
        return;
      }
      const order = source?.order ?? Array.from({ length: rows }, (_, i) => i);
      const label = origLabels[order[dispRow]] ?? "";
      setChannelHighlight({ labels: channelsOf(label), source: "heatmap" });
    };
    const moved = (event: PointerEvent) => {
      pointer = at(event);
      if (size.cssH > 0) {
        const d = Math.min(rows - 1, Math.max(0, Math.floor((pointer.y / size.cssH) * rows)));
        emitRowHighlight(d);
      }
      schedule();
    };
    const left = () => {
      pointer = null;
      emitRowHighlight(null);
      schedule();
    };
    // A click (not the end of a drag, nor one on Try again) plots the row under it; Shift-click overlays up to 4 rows.
    let downAt: { x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      downAt = (event.target as Element).closest("button") ? null : at(event);
    };
    const clicked = (event: MouseEvent) => {
      const { x, y } = at(event);
      if (!downAt || Math.hypot(x - downAt.x, y - downAt.y) > 3 || size.cssH === 0) return;
      const disp = Math.min(rows - 1, Math.max(0, Math.floor((y / size.cssH) * rows)));
      const orig = (source?.order ?? Array.from({ length: rows }, (_, i) => i))[disp];
      if (event.shiftKey) togglePinnedRow(orig);
      else setShownResult({ row: orig });
    };
    plotEl.addEventListener("pointermove", moved);
    plotEl.addEventListener("pointerleave", left);
    plotEl.addEventListener("pointerdown", down);
    plotEl.addEventListener("click", clicked);
    const focusIn = (event: FocusEvent) => {
      const row = (event.target as HTMLElement).dataset.row;
      focused = row === undefined ? null : Number(row);
      emitRowHighlight(focused);
      schedule();
    };
    const focusOut = () => {
      focused = null;
      emitRowHighlight(null);
      schedule();
    };
    gutterEl.addEventListener("focusin", focusIn);
    gutterEl.addEventListener("focusout", focusOut);

    if (probing) {
      heatmapProbe.redraw = schedule;
      heatmapProbe.read = () => {
        cancelAnimationFrame(raf);
        raf = 0;
        paint();
        const data = new Uint8Array(size.W * size.H * 4);
        gl?.readPixels(0, 0, size.W, size.H, gl.RGBA, gl.UNSIGNED_BYTE, data);
        return { width: size.W, height: size.H, data };
      };
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      stopResize();
      unsubscribe();
      unwatch();
      unhighlight();
      if (getChannelHighlight()?.source === "heatmap") setChannelHighlight(null);
      heatEl.removeEventListener("webglcontextlost", lost);
      heatEl.removeEventListener("webglcontextrestored", start);
      plotEl.removeEventListener("pointermove", moved);
      plotEl.removeEventListener("pointerleave", left);
      plotEl.removeEventListener("pointerdown", down);
      plotEl.removeEventListener("click", clicked);
      gutterEl.removeEventListener("focusin", focusIn);
      gutterEl.removeEventListener("focusout", focusOut);
      layer?.dispose();
      if (probing && heatmapProbe.redraw === schedule) {
        heatmapProbe.redraw = undefined;
        heatmapProbe.read = undefined;
        heatmapProbe.frame = null;
        heatmapProbe.rowPlot = null;
      }
    };
  }, [
    recordingId,
    resultId,
    manifest,
    variant,
    array,
    map,
    origLabels,
    rows,
    loading,
    opts,
    groupOfRow,
    compareId,
  ]);

  const centers = manifest.window_centers_seconds;
  const [first, last] = [centers[0].toFixed(2), centers[centers.length - 1].toFixed(2)];
  const span = centers.length === 1 ? `center ${first} s` : `centers ${first} to ${last} s`;
  const [baseName, definition] = valueInfo(variant.id, array);
  const displayName = compareId ? `Δ ${baseName}` : opts.zScore ? `${baseName} (z)` : baseName;

  const isSideDock = dock === "left" || dock === "right";
  const maxWidth = () =>
    Math.max(260, Math.round((sectionRef.current?.parentElement?.clientWidth ?? 900) * 0.72));
  const widthOf = (w: number) => Math.round(Math.max(260, Math.min(w, maxWidth())));

  // The inner edge sets the result panel's height (top/bottom dock) or width (left/right dock), with magnetic snaps.
  const resize = (event: ReactPointerEvent<HTMLHRElement>) => {
    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);
    if (isSideDock) {
      const x0 = event.clientX;
      const w0 = sectionRef.current?.offsetWidth ?? 380;
      const parentW = sectionRef.current?.parentElement?.clientWidth ?? innerWidth;
      const stops = RATIO_STOPS.map((r) => Math.round(parentW * r));
      const move = (e: PointerEvent) => {
        const raw = dock === "right" ? w0 + (x0 - e.clientX) : w0 + (e.clientX - x0);
        const { value, snapped } = clampAndSnap(raw, 260, maxWidth(), stops, 14);
        setResultWidth(Math.round(value));
        const pct = Math.round((value / Math.max(1, parentW)) * 100);
        setDragBadge({
          label: snapped !== null ? `${pct}%` : `${Math.round(value)} px`,
          snapped: snapped !== null,
        });
      };
      el.addEventListener("pointermove", move);
      el.addEventListener(
        "lostpointercapture",
        () => {
          el.removeEventListener("pointermove", move);
          setDragBadge(null);
        },
        { once: true },
      );
      return;
    }
    const [y0, h0] = [event.clientY, plot.current?.offsetHeight ?? 0];
    const parentH = sectionRef.current?.parentElement?.clientHeight ?? innerHeight;
    const stops = RATIO_STOPS.map((r) => Math.round(parentH * r));
    const move = (e: PointerEvent) => {
      const raw = dock === "bottom" ? h0 + (y0 - e.clientY) : h0 + (e.clientY - y0);
      const { value, snapped } = clampAndSnap(raw, 56, heightOf(Number.POSITIVE_INFINITY), stops, 14);
      setResultHeight(Math.round(value));
      const pct = Math.round((value / Math.max(1, parentH)) * 100);
      setDragBadge({
        label: snapped !== null ? `${pct}%` : `${Math.round(value)} px`,
        snapped: snapped !== null,
      });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener(
      "lostpointercapture",
      () => {
        el.removeEventListener("pointermove", move);
        setDragBadge(null);
      },
      { once: true },
    );
  };
  const step = (event: KeyboardEvent<HTMLHRElement>) => {
    if (isSideDock) {
      const by = { ArrowLeft: 24, ArrowRight: -24 }[event.key];
      if (by === undefined) return;
      event.preventDefault();
      const dir = dock === "right" ? by : -by;
      setResultWidth(widthOf((sectionRef.current?.offsetWidth ?? 380) + dir));
      return;
    }
    const by = { ArrowUp: 24, ArrowDown: -24 }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    const dir = dock === "bottom" ? by : -by;
    setResultHeight(heightOf((plot.current?.offsetHeight ?? 0) + dir));
  };

  // Dragging the grip handle docks the DDA result panel to top, bottom, left, or right; a click cycles dock position.
  const startDockDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const x0 = event.clientX;
    const y0 = event.clientY;
    let dragging = false;
    const move = (e: PointerEvent) => {
      if (!dragging && Math.hypot(e.clientX - x0, e.clientY - y0) > 6) {
        dragging = true;
        setPanelDrag({ kind: "result" });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!dragging) {
        const cycle: ResultDock[] = ["bottom", "right", "top", "left"];
        const next = cycle[(cycle.indexOf(dock) + 1) % cycle.length];
        setResultDock(next);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const pinnedSet = useMemo(() => new Set(pinnedOrigRows), [pinnedOrigRows]);
  const pinnedRowEntries = useMemo(
    () => pinnedOrigRows.map((orig) => ({ row: orig, label: origLabels[orig] ?? "" })),
    [pinnedOrigRows, origLabels],
  );
  const pinnedDispSet = useMemo(
    () => new Set(pinnedOrigRows.map((o) => origToDisp.get(o) ?? o)),
    [pinnedOrigRows, origToDisp],
  );
  const rowPlotNode = pinnedRowEntries.length > 0 && (
    <Suspense fallback={null}>
      <RowPlot ref={rowPlot} loading={loading} rows={pinnedRowEntries} />
    </Suspense>
  );

  return (
    <Tabs.Root
      value={variant.id}
      onValueChange={(value) => setShownResult({ variant: value as string, row: null })}
      render={
        <section
          ref={sectionRef}
          className={styles.result}
          aria-label="Result"
          data-dock={dock}
          style={isSideDock && width ? ({ width: `${width}px` } as CSSProperties) : undefined}
          data-appear
        />
      }
    >
      <hr
        ref={handle}
        aria-orientation={isSideDock ? "vertical" : "horizontal"}
        aria-label={isSideDock ? "Result width" : "Result height"}
        aria-valuemin={isSideDock ? 260 : 56}
        aria-valuemax={isSideDock ? maxWidth() : heightOf(Number.POSITIVE_INFINITY)}
        aria-valuenow={isSideDock ? (width ?? undefined) : (height ?? undefined)}
        tabIndex={0}
        className={styles.resize}
        data-dock={dock}
        title="Drag to resize (snaps to presets, double-click to reset)"
        onPointerDown={resize}
        onKeyDown={step}
        onDoubleClick={() => (isSideDock ? setResultWidth(null) : setResultHeight(null))}
        data-own-keys
      />
      {dragBadge && (
        <span className={styles.snapBadge} data-snapped={dragBadge.snapped || undefined} aria-hidden>
          {dragBadge.label}
        </span>
      )}
      <div className={styles.bar}>
        <button
          type="button"
          className={styles.dockGrip}
          aria-label={`Dock result panel (currently ${dock})`}
          title="Drag to dock result panel (Top / Bottom / Left / Right) or click to cycle"
          onPointerDown={startDockDrag}
        >
          <GripVertical aria-hidden />
        </button>
        <VariantTabs
          variants={manifest.variants}
          variant={variant.id}
          hasFitError={hasFitError}
          array={array}
          onArray={(next) => setShownResult({ array: next })}
        />
        <span className={styles.facts}>
          <b className={styles.name} title={variant.label}>
            {variant.label}
          </b>
          <span className={`${styles.thin} ${styles.name}`} aria-hidden />
          <span>{count(centers.length, "window")}</span>
          <span className={styles.thin} aria-hidden />
          <span className={styles.shrinks} title={span}>
            {span}
          </span>
          {recordingId === null && (
            <>
              <span className={styles.thin} aria-hidden />
              <span>{manifest.file_name} is not open</span>
            </>
          )}
        </span>
        <Suspense fallback={null}>
          <ColorBar
            loading={loading}
            name={displayName}
            definition={definition}
            map={map}
            auto={auto}
            opts={opts}
            overrideScale={resolvedScale}
          />
        </Suspense>
        <ResultDisplayMenu resultId={resultId} variantId={variant.id} />
        <button
          type="button"
          className={controls.iconButton}
          aria-label="Close result"
          title="Close result"
          onClick={() => inTransition(() => openResult(null))}
        >
          <X aria-hidden />
        </button>
      </div>
      <Tabs.Panel
        value={variant.id}
        className={styles.panel}
        data-dock={dock}
        style={
          {
            "--rows": rows,
            "--plot-height": !isSideDock && height ? `min(${height}px, 60vh)` : undefined,
          } as CSSProperties
        }
      >
        {rowPlotPosition === "above" && rowPlotNode}
        <Gutter
          ref={gutter}
          labels={labels}
          tints={tints}
          rowOrder={rowOrder}
          pinnedDisp={pinnedDispSet}
          pinnedOrig={pinnedSet}
          centers={centers}
        />
        <div className={styles.plot} ref={plot}>
          <canvas ref={heat} className={styles.layer} aria-hidden data-heatmap />
          <canvas ref={marks} className={styles.layer} aria-hidden />
          {glProblem && (
            <p className={styles.message} data-appear>
              {glProblem}
            </p>
          )}
          <Suspense
            fallback={
              <p role="status" className={styles.message}>
                Building the zoomed-out levels of {displayName}
              </p>
            }
          >
            <ArrayStatus loading={loading} onRetry={retry} />
          </Suspense>
          <p ref={problem} className={styles.problem} role="alert" hidden />
          <p ref={spoken} className={styles.spoken} role="status" />
          <HoverReadout ref={readout} />
        </div>
        {rowPlotPosition === "below" && rowPlotNode}
        <span className={styles.unit} aria-hidden>
          s
        </span>
        <canvas ref={axis} className={styles.axis} aria-hidden />
      </Tabs.Panel>
    </Tabs.Root>
  );
}

/**
 * The row buttons beside the heatmap, which own the keyboard's place among them: moving it renders this list, the
 * heatmap stays as it is. Shift-click overlays up to 4 rows in the line plot.
 */
const Gutter = memo(function Gutter(props: {
  ref: Ref<HTMLUListElement>;
  labels: string[];
  tints: string[];
  rowOrder: number[];
  pinnedDisp: Set<number>;
  pinnedOrig: Set<number>;
  centers: number[];
}) {
  const { labels, tints, rowOrder, pinnedDisp, pinnedOrig, centers } = props;
  const rows = labels.length;
  const [focusRow, setFocusRow] = useState(0);
  const focusable = Math.min(focusRow, rows - 1);
  const rove = (event: KeyboardEvent<HTMLUListElement>) => {
    const by = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (by !== undefined) {
      event.preventDefault();
      const { cursorS, view } = useStore.getState();
      const last = centers.length - 1;
      const step = last > 0 ? (centers[last] - centers[0]) / last : 1;
      const on = cursorS !== null && cursorS >= view.t0 && cursorS <= view.t1;
      const k = ((on ? cursorS : (view.t0 + view.t1) / 2) - centers[0]) / step;
      const next = on ? (by > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1) : Math.round(k);
      const t = centers[Math.max(0, Math.min(last, next))];
      setCursor(t);
      if (t < view.t0 || t > view.t1)
        setView((v) => ({ t0: t - (v.t1 - v.t0) / 2, t1: t + (v.t1 - v.t0) / 2 }));
      return;
    }
    const next = { ArrowDown: focusable + 1, ArrowUp: focusable - 1, Home: 0, End: rows - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    event.currentTarget.querySelectorAll("button")[Math.max(0, Math.min(rows - 1, next))]?.focus();
  };
  return (
    <ul ref={props.ref} className={styles.gutter} aria-label="Result rows" onKeyDown={rove} data-own-keys>
      {labels.map((label, r) => {
        const orig = rowOrder[r] ?? r;
        const isPinned = pinnedDisp.has(r);
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional; two channels can share a label
            key={r}
            className={styles.gutterRow}
            style={{ top: `${(100 * r) / rows}%`, height: `${100 / rows}%` }}
          >
            <button
              type="button"
              className={styles.rowButton}
              data-row={r}
              aria-pressed={isPinned}
              title="Click to plot row; Shift-click to overlay up to 4 rows"
              tabIndex={r === focusable ? 0 : -1}
              onFocus={() => setFocusRow(r)}
              onClick={(event) => {
                if (event.shiftKey) togglePinnedRow(orig);
                else setShownResult({ row: isPinned && pinnedOrig.size === 1 ? null : orig });
              }}
            >
              <MiddleText text={label} />
            </button>
            <span className={styles.tint} style={{ background: tints[r] }} />
          </li>
        );
      })}
    </ul>
  );
});

/** Why an array could not be read, with Try again; nothing once it is read. */
function ArrayStatus(props: { loading: Promise<Loaded<ResultArray>>; onRetry(): void }) {
  const loaded = use(props.loading);
  if (!("error" in loaded)) return null;
  return (
    <p role="alert" className={styles.problem}>
      The result could not be read: {loaded.error}.{" "}
      <button type="button" className={controls.quiet} onClick={props.onRetry}>
        Try again
      </button>
    </p>
  );
}

/** The color bar: what the values are, their map from the lower to the upper limit, both printed; the map picks another. */
function ColorBar(props: {
  loading: Promise<Loaded<ResultArray>>;
  name: string;
  definition: string;
  map: MapName;
  auto: MapName;
  opts: HeatmapOptions;
  overrideScale: { map: MapName; lo: number; hi: number } | null;
}) {
  const loaded = use(props.loading);
  if ("error" in loaded) return null;
  const { map, lo, hi } =
    props.overrideScale && props.overrideScale.map === props.map
      ? props.overrideScale
      : resolveScale(props.map, loaded.ok, props.opts);
  return (
    <span className={styles.colorBar} data-appear>
      <b title={props.definition}>{props.name}</b>
      <small aria-hidden>{print(lo)}</small>
      <ColorMapPicker map={map} auto={props.auto} label={`${props.name} from ${print(lo)} to ${print(hi)}`} />
      <small aria-hidden>{print(hi)}</small>
    </span>
  );
}
