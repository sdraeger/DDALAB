// The line plot of one to four pinned result rows on the heatmap's time axis: their values at the windows' centers
// (zoomed out, at the centers of the pyramid's cells, which keep the value of largest magnitude), drawn from the
// frame loop outside React. Single click plots one row; Shift-click overlays up to 4 rows with distinct colors.
// Resizable with magnetic snap detents and movable above or below the heatmap.
import ArrowUpDown from "lucide-react/dist/esm/icons/arrow-up-down.mjs";
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  use,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { clampAndSnap, DEFAULT_ROW_PLOT_HEIGHT, ROW_PLOT_STOPS } from "../../core/layoutSnap";
import type { ResultArray } from "../../core/protocol";
import { drawEvents, type EventsScene } from "../../render/axis";
import type { Colors } from "../../render/themeColors";
import { setRowPlotHeight, setRowPlotPosition, useStore } from "../../store/store";
import type { Loaded } from "./loads";
import styles from "./Results.module.css";

/** Default CSS pixels of the plot's height. */
export const ROW_PLOT_CSS = DEFAULT_ROW_PLOT_HEIGHT;

/** Distinct high-contrast series stroke colors when overlaying multiple rows (first uses theme ink). */
const SERIES_COLORS = ["", "#2f6a9e", "#b4372b", "#2a7b5f"];

export interface RowSeries {
  row: number;
  label: string;
  points: { t: number; v: number }[];
}

export interface RowPlotScene {
  /** One or more pinned rows to overlay on the shared time axis. */
  series: RowSeries[];
  view: { t0: number; t1: number };
  /** Device pixels across the plot, as across the heatmap, and the pixel ratio. */
  width: number;
  dpr: number;
  colors: Colors;
  /** The events marked across the plot, as on the heatmap. */
  events: Pick<EventsScene, "recording" | "user" | "picked">;
}

export interface RowPlotHandle {
  draw(scene: RowPlotScene): void;
}

const print = (value: number) => value.toPrecision(3);

export function RowPlot(props: {
  ref: Ref<RowPlotHandle>;
  loading: Promise<Loaded<ResultArray>>;
  rows: { row: number; label: string }[];
  onResize?: () => void;
}) {
  const loaded = use(props.loading);
  const plotHeight = useStore((s) => s.rowPlotHeight);
  const position = useStore((s) => s.rowPlotPosition);
  const [dragBadge, setDragBadge] = useState<{ label: string; snapped: boolean } | null>(null);
  let [lo, hi] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  if ("ok" in loaded) {
    for (const { row } of props.rows) {
      if (row >= 0 && row < loaded.ok.rows) {
        lo = Math.min(lo, loaded.ok.rowMin[row]);
        hi = Math.max(hi, loaded.ok.rowMax[row]);
      }
    }
  }
  const known = lo <= hi;
  const canvas = useRef<HTMLCanvasElement>(null);

  useImperativeHandle(
    props.ref,
    () => ({
      draw({ series, view, width, dpr, colors, events }) {
        const el = canvas.current;
        if (!el) return;
        const currentHeight = useStore.getState().rowPlotHeight;
        const height = Math.round(currentHeight * dpr);
        if (el.width !== width) el.width = width;
        if (el.height !== height) el.height = height;
        const ctx = el.getContext("2d") as CanvasRenderingContext2D;
        ctx.clearRect(0, 0, width, height);
        drawEvents(ctx, { ...events, W: width, H: height, dpr, view, colors });

        // Compute finite bounds across all drawn series (handles transformed z-score / diff values cleanly).
        let [sLo, sHi] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
        for (const s of series) {
          for (const { v } of s.points) {
            if (Number.isFinite(v)) {
              if (v < sLo) sLo = v;
              if (v > sHi) sHi = v;
            }
          }
        }
        const useLo = sLo <= sHi ? sLo : lo;
        const useHi = sLo <= sHi ? sHi : hi;
        if (!(useLo <= useHi)) return;
        const [a, b] = useHi > useLo ? [useLo, useHi] : [useLo - 1, useHi + 1];
        const pad = 6 * dpr;
        const x = (t: number) => ((t - view.t0) / (view.t1 - view.t0)) * width;
        const y = (v: number) => pad + ((b - v) / (b - a)) * (height - 2 * pad);
        if (a < 0 && b > 0) {
          ctx.fillStyle = colors.hairline;
          ctx.fillRect(0, Math.round(y(0)), width, Math.max(1, Math.round(dpr)));
        }

        series.forEach(({ points }, idx) => {
          const stroke = SERIES_COLORS[idx % SERIES_COLORS.length] || colors.ink;
          ctx.strokeStyle = stroke;
          ctx.fillStyle = stroke;
          ctx.lineWidth = (idx === 0 ? 1.5 : 1.35) * dpr;
          ctx.lineJoin = "round";
          ctx.beginPath();
          let joined = false;
          for (const { t, v } of points) {
            if (Number.isNaN(v)) joined = false;
            else if (joined) ctx.lineTo(x(t), y(v));
            else {
              ctx.moveTo(x(t), y(v));
              joined = true;
            }
          }
          ctx.stroke();
          // The points themselves once they lie more than 6 px apart.
          if (points.length > 1 && x(points[1].t) - x(points[0].t) > 6 * dpr) {
            for (const { t, v } of points) {
              if (Number.isNaN(v)) continue;
              ctx.beginPath();
              ctx.arc(x(t), y(v), 2 * dpr, 0, 2 * Math.PI);
              ctx.fill();
            }
          }
        });
      },
    }),
    [lo, hi],
  );

  const startResize = (event: ReactPointerEvent<HTMLHRElement>) => {
    const el = event.currentTarget;
    const y0 = event.clientY;
    const h0 = plotHeight;
    el.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const delta = position === "above" ? e.clientY - y0 : y0 - e.clientY;
      const { value, snapped } = clampAndSnap(h0 + delta, 56, 320, ROW_PLOT_STOPS, 10);
      setRowPlotHeight(value);
      setDragBadge({ label: `${Math.round(value)} px`, snapped: snapped !== null });
      props.onResize?.();
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

  const stepResize = (event: KeyboardEvent<HTMLHRElement>) => {
    const by = { ArrowUp: 20, ArrowDown: -20 }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    setRowPlotHeight(plotHeight + (position === "above" ? -by : by));
    props.onResize?.();
  };

  const ariaName = props.rows.map((r) => r.label).join(", ");
  return (
    <>
      <div className={styles.rowGutter} data-appear>
        <div className={styles.rowGutterTop}>
          <button
            type="button"
            className={styles.rowSwap}
            aria-label={
              position === "below" ? "Move line plot above heatmap" : "Move line plot below heatmap"
            }
            title={position === "below" ? "Move line plot above heatmap" : "Move line plot below heatmap"}
            onClick={() => setRowPlotPosition(position === "below" ? "above" : "below")}
          >
            <ArrowUpDown aria-hidden />
          </button>
          <div className={styles.rowLegend}>
            {props.rows.map((entry, idx) => (
              <span key={entry.row} className={styles.rowLabel} title={entry.label}>
                {props.rows.length > 1 && (
                  <span
                    className={styles.rowDot}
                    style={{ background: SERIES_COLORS[idx % SERIES_COLORS.length] || "var(--ink)" }}
                    aria-hidden
                  />
                )}
                {entry.label}
              </span>
            ))}
          </div>
        </div>
        <ul className={styles.scale} aria-label="Line plot scale">
          {known && <li>{print(hi)}</li>}
          {known && <li>{print(lo)}</li>}
        </ul>
      </div>
      <div className={styles.rowCell} data-position={position} data-appear>
        <hr
          aria-orientation="horizontal"
          aria-label="Line plot height"
          aria-valuemin={56}
          aria-valuemax={320}
          aria-valuenow={plotHeight}
          tabIndex={0}
          data-own-keys
          className={styles.rowResize}
          title="Drag to resize line plot (snaps to presets, double-click to reset)"
          onPointerDown={startResize}
          onKeyDown={stepResize}
          onDoubleClick={() => {
            setRowPlotHeight(DEFAULT_ROW_PLOT_HEIGHT);
            props.onResize?.();
          }}
        />
        {dragBadge && (
          <span className={styles.snapBadge} data-snapped={dragBadge.snapped || undefined} aria-hidden>
            {dragBadge.label}
          </span>
        )}
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Line plot of ${ariaName}`}
          className={styles.rowCanvas}
          style={{ height: plotHeight }}
        />
      </div>
    </>
  );
}
