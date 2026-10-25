// The line plot of one result row on the heatmap's time axis: its values at the windows' centers (zoomed out, at the
// centers of the pyramid's cells, which keep the value of largest magnitude), between the row's smallest and largest
// value, which it prints. Drawn from the frame loop, not by React.
import { type Ref, use, useImperativeHandle, useRef } from "react";
import type { ResultArray } from "../../core/protocol";
import type { Colors } from "../../render/themeColors";
import type { Loaded } from "./ResultPanel";
import styles from "./Results.module.css";

/** CSS pixels of the plot's height. */
export const ROW_PLOT_CSS = 88;

export interface RowPlotScene {
  /** Times in seconds and values as stored (float32); NaN breaks the line. */
  points: { t: number; v: number }[];
  view: { t0: number; t1: number };
  /** Device pixels across the plot, as across the heatmap, and the pixel ratio. */
  width: number;
  dpr: number;
  colors: Colors;
}

export interface RowPlotHandle {
  draw(scene: RowPlotScene): void;
}

const print = (value: number) => value.toPrecision(3);

export function RowPlot(props: {
  ref: Ref<RowPlotHandle>;
  loading: Promise<Loaded<ResultArray>>;
  row: number;
  label: string;
}) {
  const loaded = use(props.loading);
  const [lo, hi] = "ok" in loaded ? [loaded.ok.rowMin[props.row], loaded.ok.rowMax[props.row]] : [0, -1];
  const known = lo <= hi; // a row without a finite value has no line
  const canvas = useRef<HTMLCanvasElement>(null);

  useImperativeHandle(
    props.ref,
    () => ({
      draw({ points, view, width, dpr, colors }) {
        const el = canvas.current;
        if (!el) return;
        const height = Math.round(ROW_PLOT_CSS * dpr);
        if (el.width !== width) el.width = width;
        if (el.height !== height) el.height = height;
        const ctx = el.getContext("2d") as CanvasRenderingContext2D;
        ctx.clearRect(0, 0, width, height);
        if (!known) return;
        const [a, b] = hi > lo ? [lo, hi] : [lo - 1, hi + 1];
        const pad = 6 * dpr;
        const x = (t: number) => ((t - view.t0) / (view.t1 - view.t0)) * width;
        const y = (v: number) => pad + ((b - v) / (b - a)) * (height - 2 * pad);
        if (a < 0 && b > 0) {
          ctx.fillStyle = colors.hairline;
          ctx.fillRect(0, Math.round(y(0)), width, Math.max(1, Math.round(dpr)));
        }
        ctx.strokeStyle = colors.ink;
        ctx.fillStyle = colors.ink;
        ctx.lineWidth = 1.5 * dpr;
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
      },
    }),
    [known, lo, hi],
  );

  return (
    <>
      <div className={styles.rowGutter}>
        <span className={styles.rowLabel}>{props.label}</span>
        <ul className={styles.scale} aria-label="Line plot scale">
          {known && <li>{print(hi)}</li>}
          {known && <li>{print(lo)}</li>}
        </ul>
      </div>
      <div className={styles.rowCell}>
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Line plot of ${props.label}`}
          className={styles.rowCanvas}
          style={{ height: ROW_PLOT_CSS }}
        />
      </div>
    </>
  );
}
