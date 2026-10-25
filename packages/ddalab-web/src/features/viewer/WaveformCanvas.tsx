// The waveform pane: the label gutter with electrode-group tints, the time ruler, the traces (WebGL2) over a 2D
// underlay of grid, selection, events, cursor and regions without data, and the printed scale. View changes reach
// the canvases through store.subscribe; React renders the structure and the visible gutter rows only.
import { useEffect, useMemo, useRef, useState } from "react";
import { engine } from "../../app/recordings";
import { cssColor, webgl2 } from "../../render/gl";
import { hatch, minorStep, tickLabel, ticks } from "../../render/overviewLayer";
import { createWaveformLayer, type Drawn, type Frame, type WaveformLayer } from "../../render/waveformLayer";
import {
  CSS_PX_PER_MM,
  type OpenRecording,
  setCursor,
  setPlotWidth,
  setSelection,
  setView,
  useStore,
  zoomBy,
} from "../../store/store";
import { electrodeGroups } from "../inspector/groups";
import { Readouts, type ReadoutsHandle } from "./Readouts";
import styles from "./Viewer.module.css";

/** What dev and e2e builds let tests see of the last frame. */
export interface ProbeFrame extends Omit<Frame, "ink" | "pointSize"> {
  recordingId: string;
  cssWidth: number;
  /** Per display channel: display units per raw unit, offset in display units. */
  params: [number, number][];
  mode: Drawn["plan"]["mode"];
  level: number | null;
  complete: boolean;
  /** Device-pixel ranges drawn hatched: the scan has not reached them. */
  missing: [number, number][];
}

/** The e2e probe (`window.__ddalab.viewer`); inert in production, where nothing reads it. */
export const viewerProbe = {
  frame: null as ProbeFrame | null,
  waiters: [] as ((frame: ProbeFrame) => void)[],
  /** Frame times in ms (drawing plus a GPU sync) while an array; `null` turns the probe off. */
  timing: null as { ms: number; complete: boolean }[] | null,
  redraw: undefined as (() => void) | undefined,
  read: undefined as (() => { width: number; height: number; data: Uint8Array }) | undefined,
  /** Resolves with the next frame of the active recording that has all its planned data. */
  settled(): Promise<ProbeFrame> {
    return new Promise((resolve) => {
      viewerProbe.waiters.push(resolve);
      viewerProbe.redraw?.();
    });
  },
  /** Draws now and reads the trace canvas back: RGBA, bottom row first. */
  pixels() {
    if (!viewerProbe.read) throw new Error("no waveform canvas");
    return viewerProbe.read();
  },
};
const probing = import.meta.env.DEV || import.meta.env.MODE === "e2e";

/**
 * Per display channel, display units per raw unit and the offset: µV for voltage channels (SI volts).
 * shortcut: other units draw in their SI unit at the µV/mm sensitivity; give them a scale of their own when
 * recordings mix in non-voltage channels that matter.
 */
export function paramsOf(recording: OpenRecording): Float32Array {
  const params = new Float32Array(2 * recording.analysis_channels.length);
  recording.analysis_channels.forEach((index, c) => {
    const { unit, gain, offset } = recording.info.channels[index];
    const scale = unit === "V" ? 1e6 : 1;
    params[2 * c] = gain * scale;
    params[2 * c + 1] = offset * scale;
  });
  return params;
}

interface Colors {
  trace: [number, number, number, number];
  grid: string;
  hairline: string;
  muted: string;
  event: string;
  eventInk: string;
  primary: string;
  wash: string;
  font: string;
}

function readColors(element: Element): Colors {
  const style = getComputedStyle(element);
  const color = (value: string) => cssColor(element, value).css;
  return {
    trace: cssColor(element, "var(--trace)").rgba,
    grid: color("var(--grid)"),
    hairline: color("var(--hairline)"),
    muted: color("var(--muted)"),
    event: color("var(--event)"),
    eventInk: color("var(--event-ink)"),
    primary: color("var(--primary)"),
    wash: color("var(--primary-wash)"),
    font: style.fontFamily,
  };
}

const RULER_CSS = 22;

export function WaveformCanvas({ recordingId }: { recordingId: string }) {
  const info = useStore((s) => s.recordings[recordingId]?.info);
  const analysis = useStore((s) => s.recordings[recordingId]?.analysis_channels);
  const firstChannel = useStore((s) => s.view.firstChannel);
  const rowCount = useStore((s) => s.view.rowCount);
  const labels = useMemo(() => analysis?.map((i) => info.channels[i].label) ?? [], [analysis, info]);
  const { groups, groupOf } = useMemo(() => electrodeGroups(labels), [labels]);
  const [glMissing, setGlMissing] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const under = useRef<HTMLCanvasElement>(null);
  const traces = useRef<HTMLCanvasElement>(null);
  const ruler = useRef<HTMLCanvasElement>(null);
  const readouts = useRef<ReadoutsHandle>(null);

  useEffect(() => {
    const [plotEl, underEl, tracesEl, rulerEl, scrollerEl, spacerEl] = [
      plot.current,
      under.current,
      traces.current,
      ruler.current,
      scroller.current,
      spacer.current,
    ];
    const opened = useStore.getState().recordings[recordingId];
    if (!plotEl || !underEl || !tracesEl || !rulerEl || !scrollerEl || !spacerEl || !opened) return;
    const underCtx = underEl.getContext("2d") as CanvasRenderingContext2D;
    const rulerCtx = rulerEl.getContext("2d") as CanvasRenderingContext2D;
    const params = paramsOf(opened);
    const channels = opened.analysis_channels.length;
    let colors = readColors(plotEl);
    let size = { cssW: 0, cssH: 0, dpr: 1, W: 0, H: 0 };
    let raf = 0;
    let layer: WaveformLayer | null = null;
    let gl: WebGL2RenderingContext | null = null;
    let lastScanned = -1;

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    function start() {
      gl = webgl2(tracesEl as HTMLCanvasElement);
      setGlMissing(!gl);
      layer = gl
        ? createWaveformLayer(
            gl,
            {
              tile: (level, index) => engine.tile(recordingId, level, index),
              raw: (row0, rows) => engine.raw(recordingId, row0, rows),
            },
            { channels, rows: opened.info.sample_count, params },
            schedule,
          )
        : null;
    }
    start();

    const rowHeightCss = () => size.cssH / useStore.getState().view.rowCount;

    const paint = () => {
      raf = 0;
      const state = useStore.getState();
      const recording = state.recordings[recordingId];
      const { W, H, dpr, cssW } = size;
      if (!recording || W === 0 || H === 0) return;
      if (recording.scan.scannedRows !== lastScanned) {
        lastScanned = recording.scan.scannedRows;
        layer?.scanAdvanced(lastScanned);
      }
      const { view } = state;
      const rate = recording.info.sample_rate_hz;
      const pxPerMm = (CSS_PX_PER_MM / view.mmPerCssMm) * dpr;
      const frame: Frame = {
        width: W,
        height: H,
        s0: view.t0 * rate,
        spp: ((view.t1 - view.t0) * rate) / W,
        firstChannel: view.firstChannel,
        rowCount: view.rowCount,
        rowHeight: H / view.rowCount,
        pxPerUnit: pxPerMm / view.sensitivityUvPerMm,
        pointSize: Math.max(3, Math.round(3 * dpr)),
        ink: colors.trace,
      };
      const begun = performance.now();
      const drawn: Drawn = layer
        ? layer.draw(frame)
        : { plan: { mode: "rawSpan" }, complete: false, missing: [] };
      if (probing && viewerProbe.timing && gl) {
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); // waits for the GPU
        viewerProbe.timing.push({ ms: performance.now() - begun, complete: drawn.complete });
      }
      const scanPercent =
        recording.scan.scannedRows < recording.scan.totalRows && !recording.scan.notice
          ? Math.floor((100 * recording.scan.scannedRows) / recording.scan.totalRows)
          : null;
      drawUnderlay(underCtx, { W, H, dpr, view, state, recording, drawn, colors, scanPercent });
      drawRuler(rulerCtx, { W, H: rulerEl.height, dpr, view, recording, colors });
      readouts.current?.update(view, cssW);
      // The channel scroller follows the view.
      const rowH = rowHeightCss();
      spacerEl.style.height = `${Math.max(0, channels - view.rowCount) * rowH}px`;
      if (rowH > 0 && Math.round(scrollerEl.scrollTop / rowH) !== view.firstChannel) {
        scrollerEl.scrollTop = view.firstChannel * rowH;
      }
      if (probing) {
        const shown: ProbeFrame = {
          ...frame,
          recordingId,
          cssWidth: cssW,
          params: Array.from({ length: channels }, (_, c) => [params[2 * c], params[2 * c + 1]]),
          mode: drawn.plan.mode,
          level: drawn.plan.mode === "tile" ? drawn.plan.level : null,
          complete: drawn.complete,
          missing: drawn.missing,
        };
        viewerProbe.frame = shown;
        if (drawn.complete && state.activeRecordingId === recordingId) {
          for (const resolve of viewerProbe.waiters.splice(0)) resolve(shown);
        }
      }
    };

    // Device pixels exactly, where the browser reports them.
    const resize = new ResizeObserver(([entry]) => {
      const box = entry.devicePixelContentBoxSize?.[0];
      const dpr = window.devicePixelRatio || 1;
      const cssW = entry.contentRect.width;
      const cssH = entry.contentRect.height;
      // The box is exact on real displays; under an emulated pixel ratio Chromium reports CSS pixels in it.
      const exact =
        box && Math.abs(box.inlineSize - cssW * dpr) <= 1 && Math.abs(box.blockSize - cssH * dpr) <= 1;
      const W = exact ? box.inlineSize : Math.round(cssW * dpr);
      const H = exact ? box.blockSize : Math.round(cssH * dpr);
      size = { cssW, cssH, dpr, W, H };
      for (const canvas of [underEl, tracesEl]) {
        canvas.width = W;
        canvas.height = H;
      }
      rulerEl.width = W;
      rulerEl.height = Math.round(RULER_CSS * dpr);
      setPlotWidth(cssW);
      paint();
    });
    try {
      resize.observe(plotEl, { box: "device-pixel-content-box" });
    } catch {
      resize.observe(plotEl); // Safari has no device-pixel box: CSS size times the ratio
    }

    const unsubscribe = useStore.subscribe(schedule);
    const theme = new MutationObserver(() => {
      colors = readColors(plotEl);
      schedule();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const schemeChanged = () => {
      colors = readColors(plotEl);
      schedule();
    };
    scheme.addEventListener("change", schemeChanged);

    const lost = (event: Event) => {
      event.preventDefault();
      layer?.dispose();
      layer = null;
    };
    const restored = () => {
      start();
      schedule();
    };
    tracesEl.addEventListener("webglcontextlost", lost);
    tracesEl.addEventListener("webglcontextrestored", restored);

    // Wheel zooms about the pointer (sideways scrolling pans), drag pans, Shift-drag selects, a click sets the cursor.
    const timeAt = (clientX: number) => {
      const { view } = useStore.getState();
      const box = plotEl.getBoundingClientRect();
      return view.t0 + ((clientX - box.left) / box.width) * (view.t1 - view.t0);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.cssH : 1;
      const [dx, dy] = [event.deltaX * unit, event.deltaY * unit];
      if (Math.abs(dx) > Math.abs(dy)) {
        setView((v) => {
          const shift = (dx / size.cssW) * (v.t1 - v.t0);
          return { t0: v.t0 + shift, t1: v.t1 + shift };
        });
      } else zoomBy(Math.exp(dy * 0.002), timeAt(event.clientX));
    };
    let drag: { x: number; t0: number; t1: number; anchor: number; select: boolean; moved: boolean } | null =
      null;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      plotEl.setPointerCapture(event.pointerId);
      const { view } = useStore.getState();
      drag = {
        x: event.clientX,
        t0: view.t0,
        t1: view.t1,
        anchor: timeAt(event.clientX),
        select: event.shiftKey,
        moved: false,
      };
    };
    const move = (event: PointerEvent) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      drag.moved ||= Math.abs(dx) > 3;
      if (!drag.moved) return;
      plotEl.dataset.dragging = drag.select ? "select" : "pan";
      if (drag.select) {
        const duration = useStore.getState().recordings[recordingId]?.info.duration_s ?? 0;
        const t = Math.min(duration, Math.max(0, timeAt(event.clientX)));
        setSelection({ t0: Math.min(drag.anchor, t), t1: Math.max(drag.anchor, t) });
      } else {
        const shift = (-dx / size.cssW) * (drag.t1 - drag.t0);
        setView({ t0: drag.t0 + shift, t1: drag.t1 + shift });
      }
    };
    const up = (event: PointerEvent) => {
      if (drag && !drag.moved) setCursor(timeAt(event.clientX));
      drag = null;
      delete plotEl.dataset.dragging;
    };
    const scrolled = () => {
      const rowH = rowHeightCss();
      if (rowH > 0) setView({ firstChannel: Math.round(scrollerEl.scrollTop / rowH) });
    };
    plotEl.addEventListener("wheel", wheel, { passive: false });
    plotEl.addEventListener("pointerdown", down);
    plotEl.addEventListener("pointermove", move);
    plotEl.addEventListener("pointerup", up);
    plotEl.addEventListener("pointercancel", up);
    scrollerEl.addEventListener("scroll", scrolled, { passive: true });

    if (probing) {
      viewerProbe.redraw = schedule;
      viewerProbe.read = () => {
        cancelAnimationFrame(raf);
        paint();
        const data = new Uint8Array(size.W * size.H * 4);
        gl?.readPixels(0, 0, size.W, size.H, gl.RGBA, gl.UNSIGNED_BYTE, data);
        return { width: size.W, height: size.H, data };
      };
    }

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      unsubscribe();
      theme.disconnect();
      scheme.removeEventListener("change", schemeChanged);
      tracesEl.removeEventListener("webglcontextlost", lost);
      tracesEl.removeEventListener("webglcontextrestored", restored);
      plotEl.removeEventListener("wheel", wheel);
      plotEl.removeEventListener("pointerdown", down);
      plotEl.removeEventListener("pointermove", move);
      plotEl.removeEventListener("pointerup", up);
      plotEl.removeEventListener("pointercancel", up);
      scrollerEl.removeEventListener("scroll", scrolled);
      layer?.dispose();
      if (probing && viewerProbe.redraw === schedule) {
        viewerProbe.redraw = undefined;
        viewerProbe.read = undefined;
      }
    };
  }, [recordingId]);

  if (!info || !analysis) return null;
  const shown = Math.max(0, Math.min(rowCount, labels.length - firstChannel));
  const rows = Array.from({ length: shown }, (_, i) => firstChannel + i);
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the pane takes focus so that paging keys reach the viewer
    <section className={styles.waveforms} aria-label="Waveforms" tabIndex={0}>
      <div className={styles.scroller} ref={scroller}>
        <div className={styles.sticky}>
          <span className={styles.unit} aria-hidden>
            s
          </span>
          <canvas ref={ruler} className={styles.ruler} aria-hidden />
          <ul className={styles.gutter} aria-label="Channel rows">
            {rows.map((channel) => (
              <li
                key={channel}
                className={styles.gutterRow}
                style={{
                  top: `${(100 * (channel - firstChannel)) / rowCount}%`,
                  height: `${100 / rowCount}%`,
                }}
              >
                <span className={styles.gutterLabel}>{labels[channel]}</span>
                <span className={styles.tint} style={{ background: groups[groupOf[channel]]?.tint }} />
              </li>
            ))}
          </ul>
          <div className={styles.plot} ref={plot}>
            <canvas ref={under} className={styles.layer} aria-hidden />
            <canvas ref={traces} className={styles.layer} aria-hidden />
            {glMissing && (
              <p className={styles.glMissing}>
                DDALAB draws recordings with WebGL2, which this browser does not provide. Use a current
                Chrome, Edge, Firefox or Safari with hardware acceleration turned on.
              </p>
            )}
            <Readouts ref={readouts} />
          </div>
        </div>
        <div ref={spacer} />
      </div>
    </section>
  );
}

interface UnderlayScene {
  W: number;
  H: number;
  dpr: number;
  view: { t0: number; t1: number };
  state: { selection: { t0: number; t1: number } | null; cursorS: number | null };
  recording: OpenRecording;
  drawn: Drawn;
  colors: Colors;
  scanPercent: number | null;
}

/** Under the traces: the time grid, the selection, events, the cursor and the regions with no data yet. */
function drawUnderlay(ctx: CanvasRenderingContext2D, scene: UnderlayScene) {
  const { W, H, dpr, view, state, recording, drawn, colors } = scene;
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
  if (state.selection) {
    ctx.fillStyle = colors.wash;
    ctx.fillRect(x(state.selection.t0), 0, x(state.selection.t1) - x(state.selection.t0), H);
  }
  ctx.fillStyle = colors.event;
  for (const a of recording.info.annotations) {
    if (a.onset_s + a.duration_s < view.t0 || a.onset_s > view.t1) continue;
    if (a.duration_s > 0) {
      ctx.globalAlpha = 0.08;
      ctx.fillRect(x(a.onset_s), 0, x(a.onset_s + a.duration_s) - x(a.onset_s), H);
      ctx.globalAlpha = 1;
    }
    ctx.fillRect(Math.round(x(a.onset_s)), 0, line, H);
  }
  if (state.cursorS !== null && state.cursorS >= view.t0 && state.cursorS <= view.t1) {
    ctx.fillStyle = colors.primary;
    ctx.fillRect(Math.round(x(state.cursorS)), 0, line, H);
  }
  for (const [x0, x1] of drawn.missing) {
    hatch(ctx, x0, 0, x1 - x0, H, colors.muted, dpr);
    if (scene.scanPercent !== null && x1 - x0 > 160 * dpr) {
      ctx.font = `${12 * dpr}px ${colors.font}`;
      ctx.textBaseline = "middle";
      const label = `Scanning overview ${scene.scanPercent}%`;
      const w = ctx.measureText(label).width;
      ctx.clearRect(x0 + 8 * dpr, H / 2 - 10 * dpr, w + 12 * dpr, 20 * dpr);
      ctx.fillStyle = colors.muted;
      ctx.fillText(label, x0 + 14 * dpr, H / 2);
    }
  }
}

/** The time ruler: labeled ticks and the event flags of the view. */
function drawRuler(
  ctx: CanvasRenderingContext2D,
  scene: {
    W: number;
    H: number;
    dpr: number;
    view: { t0: number; t1: number };
    recording: OpenRecording;
    colors: Colors;
  },
) {
  const { W, H, dpr, view, recording, colors } = scene;
  const x = (t: number) => ((t - view.t0) / (view.t1 - view.t0)) * W;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = colors.hairline;
  ctx.fillRect(0, H - Math.max(1, Math.round(dpr)), W, Math.max(1, Math.round(dpr)));
  ctx.font = `${11 * dpr}px ${colors.font}`;
  ctx.textBaseline = "middle";
  const { step, at } = ticks(view.t0, view.t1, W / dpr, 96);
  for (const t of at) {
    const px = Math.round(x(t));
    ctx.fillStyle = colors.hairline;
    ctx.fillRect(px, H - 5 * dpr, Math.max(1, Math.round(dpr)), 5 * dpr);
    ctx.fillStyle = colors.muted;
    ctx.fillText(tickLabel(t, step), px + 3 * dpr, H / 2 - dpr);
  }
  ctx.font = `600 ${11 * dpr}px ${colors.font}`;
  for (const a of recording.info.annotations) {
    if (a.onset_s < view.t0 || a.onset_s > view.t1) continue;
    const label = a.label || "event";
    const w = ctx.measureText(label).width + 8 * dpr;
    const left = Math.min(Math.round(x(a.onset_s)), W - w);
    ctx.fillStyle = colors.event;
    ctx.fillRect(left, 2 * dpr, w, H - 4 * dpr);
    ctx.fillStyle = colors.eventInk;
    ctx.fillText(label, left + 4 * dpr, H / 2);
  }
}
