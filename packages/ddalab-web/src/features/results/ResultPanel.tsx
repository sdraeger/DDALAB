// The result under the waveform, on its time axis: the variant tabs, the heatmap of the chosen array with its color bar
// and electrode-group tints, the line plot of a picked row and the time axis. The heatmap draws in WebGL2
// (heatmapLayer.ts) from tiles of the array's max-magnitude pyramid, which the IO worker reads from OPFS. View, cursor
// and selection reach the canvases through store.subscribe, and the pointer and the focused row through the frame loop;
// React renders the structure only. Loaded lazily: the first result brings it. With its recording not open (an
// imported result, say) the panel shows alone, bound to the result's analysis interval and without the recording's
// events. Shell.tsx puts it inside a ResultBoundary.
import { Tabs } from "@base-ui/react/tabs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import {
  type CSSProperties,
  type KeyboardEvent,
  Suspense,
  use,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { engine } from "../../app/recordings";
import { inTransition } from "../../app/viewTransition";
import type { ResultArray } from "../../core/protocol";
import type { ResultDocument } from "../../core/types";
import { drawMarks, drawTimeAxis } from "../../render/axis";
import { gradient, LUTS, type MapName, mapOf, scaleOf } from "../../render/colormaps";
import { observeDevicePixels } from "../../render/devicePixels";
import { webgl2 } from "../../render/gl";
import { createHeatmapLayer, type HeatmapLayer } from "../../render/heatmapLayer";
import { FANOUT, type ResultTile } from "../../render/resultPyramid";
import { readColors, watchTheme } from "../../render/themeColors";
import { openResult, setCursor, setShownResult, setView, useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import { userOf } from "../annotations/model";
import { electrodeGroups } from "../inspector/groups";
import { probing } from "../viewer/probe";
import { usePlotPointer } from "../viewer/usePlotPointer";
import { HoverReadout, type HoverReadoutHandle } from "./HoverReadout";
import { type HeatmapProbeFrame, heatmapProbe } from "./probe";
import styles from "./Results.module.css";
import { RowPlot, type RowPlotHandle } from "./RowPlot";
import { VariantTabs } from "./VariantTabs";

const AXIS_CSS = 22;
const GL_MISSING = "The heatmap is drawn with WebGL2, which this browser does not provide.";
const GL_LOST = "The browser reset WebGL2 drawing. The heatmap returns once it restores it.";

export type Loaded<T> = { ok: T } | { error: string };

const loads = new Map<string, Promise<Loaded<unknown>>>();

/**
 * One promise per key, for `use`, which needs the same promise on every render: a new one would suspend the view
 * again. It settles once, a failure as its message, and a failure stays until Try again drops it.
 */
function load<T>(key: string, make: () => Promise<T>): Promise<Loaded<T>> {
  let found = loads.get(key);
  if (!found) {
    found = make().then(
      (ok) => ({ ok }),
      (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
    );
    loads.set(key, found);
  }
  return found as Promise<Loaded<T>>;
}

const manifestKey = (id: string) => `${id}/manifest`;
const manifestOf = (id: string) => load(manifestKey(id), () => engine.resultManifest(id));
const arrayKey = (id: string, variant: string, array: ResultTile["array"]) => `${id}/${variant}/${array}`;
const arrayOf = (id: string, variant: string, array: ResultTile["array"]) =>
  load(arrayKey(id, variant, array), () => engine.resultArray(id, variant, array));

const NAMES: Record<ResultTile["array"], string> = { q: "Q", fit_error: "Fit error" };
const print = (value: number) => value.toPrecision(3);

/** The limits of an array in `map`, from the range of all its rows. */
function scaleOfArray(map: MapName, { rows, rowMin, rowMax }: ResultArray) {
  let [min, max] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let r = 0; r < rows; r++) [min, max] = [Math.min(min, rowMin[r]), Math.max(max, rowMax[r])];
  return { map, ...scaleOf(map, min, max) };
}

/** The channels a row label names: "A", "A & B", "A <- B" or "A <-> B". */
const channelsOf = (label: string) => label.split(/ (?:<->|<-|&) /);

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
      <section className={styles.result} aria-label="Result">
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
  const variant = manifest.variants.find((v) => v.id === shown?.variant) ?? manifest.variants[0];
  const hasFitError = variant.arrays?.includes(`${variant.id}/fit_error.npy`) ?? false;
  const array: ResultTile["array"] = shown?.array === "fit_error" && hasFitError ? "fit_error" : "q";
  const labels = variant.row_labels;
  const rows = labels.length;
  const picked = shown?.row != null && shown.row < rows ? shown.row : null;
  const map = mapOf(variant.id, array);
  const loading = arrayOf(resultId, variant.id, array);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const retry = () => {
    loads.delete(arrayKey(resultId, variant.id, array));
    rerender();
  };
  // Each row's electrode-group tint, as in the waveform's gutter; a pair across two groups gets both halves.
  const tints = useMemo(() => {
    const names = (info && analysis?.map((c) => info.channels[c].label)) ?? [];
    const { groups, groupOf } = electrodeGroups(names);
    const tintOf = new Map(names.map((name, c) => [name, groups[groupOf[c]].tint]));
    return labels.map((label) => {
      const [a, b = a] = channelsOf(label).map((channel) => tintOf.get(channel) ?? "transparent");
      return a === b ? a : `linear-gradient(${a} 50%, ${b} 50%)`;
    });
  }, [analysis, info, labels]);
  const [focusRow, setFocusRow] = useState(0);
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
  usePlotPointer(plot, recordingId);

  // Alone, the result fills the time axis with its analysis interval, which then bounds the view.
  useEffect(() => {
    if (recordingId !== null) return;
    const interval = {
      t0: manifest.reproduction.start_time_seconds,
      t1: manifest.reproduction.end_time_seconds,
    };
    setShownResult({ interval });
    setView(interval);
  }, [recordingId, manifest]);

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
    const name = NAMES[array];
    let colors = readColors(plotEl);
    let size = { cssW: 0, cssH: 0, dpr: 1, W: 0, H: 0 };
    let raf = 0;
    let gl: WebGL2RenderingContext | null = null;
    let layer: HeatmapLayer | null = null;
    let source: { array: ResultArray; scale: ReturnType<typeof scaleOfArray> } | null = null;
    let shownProblem: string | null = null;
    let said = "";
    /** The pointer over the plot, in CSS pixels. */
    let pointer: { x: number; y: number } | null = null;
    /** The row whose button has the keyboard focus: the readout follows the cursor in it. */
    let focused: number | null = null;
    let disposed = false;

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    // A context or program that cannot be had shows its reason in the pane instead of taking the shell down.
    const start = () => {
      if (!source) return;
      try {
        gl = webgl2(heatEl);
        if (!gl) return setGlProblem(GL_MISSING);
        const { array: found, scale } = source;
        layer = createHeatmapLayer(
          gl,
          (level, index) => engine.resultTile(resultId, variant.id, array, level, index),
          {
            ...scale,
            key: arrayKey(resultId, variant.id, array),
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
    // A failure shows in the plot with Try again (ArrayStatus).
    void loading.then((found) => {
      if (disposed || "error" in found) return;
      source = { array: found.ok, scale: scaleOfArray(map, found.ok) };
      start();
    });

    const paint = () => {
      raf = 0;
      const state = useStore.getState();
      const recording = recordingId === null ? undefined : state.recordings[recordingId];
      const { W, H, dpr, cssW, cssH } = size;
      if ((recordingId !== null && !recording) || W === 0 || H === 0) return;
      const { view } = state;
      const span = view.t1 - view.t0;
      const { selection, cursorS } = state;
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
      const drawn = layer?.draw({
        width: W,
        height: H,
        p0: (view.t0 - c0) / step,
        ppx: span / W / step,
        half: halfS / step,
        hoverRow: under?.row ?? null,
      });
      marksCtx.clearRect(0, 0, W, H);
      const events = {
        recording,
        user: recording && userOf(state, recording.fingerprint),
        picked: state.pickedAnnotation,
      };
      drawMarks(marksCtx, { W, H, dpr, view, selection, cursorS, ...events, colors, over: true });
      if (at && under) {
        // The hovered row at full contrast, outlined; the others recede (heatmapLayer.ts).
        const line = Math.max(1, Math.round(dpr));
        const [y0, y1] = [Math.round((under.row * H) / rows), Math.round(((under.row + 1) * H) / rows)];
        marksCtx.strokeStyle = colors.ink;
        marksCtx.lineWidth = line;
        marksCtx.strokeRect(line / 2, y0 + line / 2, W - line, Math.max(line, y1 - y0 - line));
        const value = layer?.value(under.window, under.row);
        const center = centers[under.window];
        readout.current?.show(at.x, at.y, cssW, cssH, { row: labels[under.row], center, value, name });
      } else readout.current?.hide();
      // Screen readers hear the keyboard's cell, also while the pointer rests on the plot; the pointer's is shown only.
      const heard = cellAt(key);
      const heardValue = heard ? layer?.value(heard.window, heard.row) : undefined;
      const words =
        heard && heardValue !== undefined
          ? `${labels[heard.row]}, window at ${centers[heard.window].toFixed(3)} s, ${name} ${heardValue.toPrecision(4)}`
          : "";
      if (words !== said) {
        said = words;
        spokenEl.textContent = words;
      }
      drawTimeAxis(axisCtx, { W, H: axisEl.height, dpr, view, cursorS, colors });
      const row = state.shownResult?.row;
      let points: { t: number; v: number }[] | null = null;
      if (layer && row != null && row < rows) {
        const { level, cells } = layer.row(row);
        const f = FANOUT ** level;
        points = cells.map(([w, v]) => ({
          t: (centers[w] + centers[Math.min(windows - 1, w + f - 1)]) / 2,
          v,
        }));
        rowPlot.current?.draw({ points, view, width: W, dpr, colors, events });
      }
      const message = drawn?.error ? `The result could not be read: ${drawn.error}. Trying again.` : null;
      if (message !== shownProblem) {
        shownProblem = message;
        problemEl.textContent = message ?? "";
        problemEl.hidden = message === null;
      }
      if (!probing || !drawn || !source) return;
      heatmapProbe.rowPlot = points && row != null ? { row, points } : null;
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
      paint();
    });

    const unsubscribe = useStore.subscribe(schedule);
    const unwatch = watchTheme(() => {
      colors = readColors(plotEl);
      schedule();
    });
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
    const moved = (event: PointerEvent) => {
      pointer = at(event);
      schedule();
    };
    const left = () => {
      pointer = null;
      schedule();
    };
    // A click (not the end of a drag, nor one on Try again) plots the row under it.
    let downAt: { x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      downAt = (event.target as Element).closest("button") ? null : at(event);
    };
    const clicked = (event: MouseEvent) => {
      const { x, y } = at(event);
      if (!downAt || Math.hypot(x - downAt.x, y - downAt.y) > 3 || size.cssH === 0) return;
      setShownResult({ row: Math.min(rows - 1, Math.max(0, Math.floor((y / size.cssH) * rows))) });
    };
    plotEl.addEventListener("pointermove", moved);
    plotEl.addEventListener("pointerleave", left);
    plotEl.addEventListener("pointerdown", down);
    plotEl.addEventListener("click", clicked);
    const focusIn = (event: FocusEvent) => {
      const row = (event.target as HTMLElement).dataset.row;
      focused = row === undefined ? null : Number(row);
      schedule();
    };
    const focusOut = () => {
      focused = null;
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
  }, [recordingId, resultId, manifest, variant, array, map, labels, rows, loading]);

  const centers = manifest.window_centers_seconds;
  const focusable = Math.min(focusRow, rows - 1);
  /**
   * Up, Down, Home and End move between the row buttons (Tab leaves the list); Left and Right step the cursor one
   * window, from the window nearest the middle of the view when the cursor is elsewhere.
   */
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
    <Tabs.Root
      value={variant.id}
      onValueChange={(value) => setShownResult({ variant: value as string, row: null })}
      render={<section className={styles.result} aria-label="Result" />}
    >
      <div className={styles.bar}>
        <VariantTabs
          variants={manifest.variants}
          hasFitError={hasFitError}
          array={array}
          onArray={(next) => setShownResult({ array: next })}
        />
        <span className={styles.facts}>
          <b title={variant.label}>{variant.label}</b>
          <span className={styles.thin} aria-hidden />
          <span>{centers.length.toLocaleString("en")} windows</span>
          <span className={styles.thin} aria-hidden />
          <span>
            centers {centers[0].toFixed(2)} to {centers[centers.length - 1].toFixed(2)} s
          </span>
          {recordingId === null && (
            <>
              <span className={styles.thin} aria-hidden />
              <span>{manifest.file_name} is not open</span>
            </>
          )}
        </span>
        <Suspense fallback={null}>
          <ColorBar loading={loading} name={NAMES[array]} map={map} />
        </Suspense>
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
      <Tabs.Panel value={variant.id} className={styles.panel} style={{ "--rows": rows } as CSSProperties}>
        <ul ref={gutter} className={styles.gutter} aria-label="Result rows" onKeyDown={rove} data-own-keys>
          {labels.map((label, r) => (
            <li
              key={label}
              className={styles.gutterRow}
              style={{ top: `${(100 * r) / rows}%`, height: `${100 / rows}%` }}
            >
              <button
                type="button"
                className={styles.rowButton}
                data-row={r}
                aria-pressed={picked === r}
                tabIndex={r === focusable ? 0 : -1}
                onFocus={() => setFocusRow(r)}
                onClick={() => setShownResult({ row: picked === r ? null : r })}
              >
                {label}
              </button>
              <span className={styles.tint} style={{ background: tints[r] }} />
            </li>
          ))}
        </ul>
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
                Building the zoomed-out levels of {NAMES[array]}
              </p>
            }
          >
            <ArrayStatus loading={loading} onRetry={retry} />
          </Suspense>
          <p ref={problem} className={styles.problem} role="alert" hidden />
          <p ref={spoken} className={styles.spoken} role="status" />
          <HoverReadout ref={readout} />
        </div>
        {picked !== null && (
          <Suspense fallback={null}>
            <RowPlot ref={rowPlot} loading={loading} row={picked} label={labels[picked]} />
          </Suspense>
        )}
        <span className={styles.unit} aria-hidden>
          s
        </span>
        <canvas ref={axis} className={styles.axis} aria-hidden />
      </Tabs.Panel>
    </Tabs.Root>
  );
}

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

/** The color bar: the array's name, its map from the lower to the upper limit, both printed. */
function ColorBar(props: { loading: Promise<Loaded<ResultArray>>; name: string; map: MapName }) {
  const loaded = use(props.loading);
  if ("error" in loaded) return null;
  const { map, lo, hi } = scaleOfArray(props.map, loaded.ok);
  return (
    <span
      className={styles.colorBar}
      data-appear
      role="img"
      aria-label={`${props.name} from ${print(lo)} to ${print(hi)}`}
    >
      <b>{props.name}</b>
      <small>{print(lo)}</small>
      <span className={styles.ramp} style={{ background: gradient(map) }} />
      <small>{print(hi)}</small>
    </span>
  );
}
