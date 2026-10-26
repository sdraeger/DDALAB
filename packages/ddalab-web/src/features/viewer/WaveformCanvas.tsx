// The waveform pane: the label gutter with electrode-group tints, the time ruler, the traces (WebGL2) over a 2D
// underlay, the printed scale and the channel scroller. View changes reach the canvases through store.subscribe;
// React renders the structure and the visible gutter rows only.
import { useEffect, useMemo, useRef, useState } from "react";
import { engine } from "../../app/recordings";
import { drawRuler, drawUnderlay } from "../../render/axis";
import { observeDevicePixels } from "../../render/devicePixels";
import { paramsOf } from "../../render/display";
import { webgl2 } from "../../render/gl";
import { readColors, watchTheme } from "../../render/themeColors";
import { createWaveformLayer, type Drawn, type Frame, type WaveformLayer } from "../../render/waveformLayer";
import { CSS_PX_PER_MM, setPlotWidth, setView, useStore } from "../../store/store";
import { electrodeGroups } from "../inspector/groups";
import { type ProbeFrame, probing, viewerProbe } from "./probe";
import { Readouts, type ReadoutsHandle } from "./Readouts";
import { usePlotPointer } from "./usePlotPointer";
import styles from "./Viewer.module.css";

const RULER_CSS = 22;

const GL_MISSING =
  "DDALAB draws recordings with WebGL2, which this browser does not provide. Use a current Chrome, Edge, " +
  "Firefox or Safari with hardware acceleration turned on.";
const GL_LOST = "The browser reset WebGL2 drawing. The traces return once it restores it.";

export function WaveformCanvas({ recordingId }: { recordingId: string }) {
  const info = useStore((s) => s.recordings[recordingId]?.info);
  const analysis = useStore((s) => s.recordings[recordingId]?.analysis_channels);
  const firstChannel = useStore((s) => s.view.firstChannel);
  const rowCount = useStore((s) => s.view.rowCount);
  const labels = useMemo(() => analysis?.map((i) => info.channels[i].label) ?? [], [analysis, info]);
  const { groups, groupOf } = useMemo(() => electrodeGroups(labels), [labels]);
  const selected = useStore((s) => s.recordings[recordingId]?.selectedChannels);
  const chosen = useMemo(() => new Set(selected), [selected]);
  /** Why the traces cannot be drawn, when they cannot. */
  const [glProblem, setGlProblem] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const under = useRef<HTMLCanvasElement>(null);
  const traces = useRef<HTMLCanvasElement>(null);
  const ruler = useRef<HTMLCanvasElement>(null);
  const problem = useRef<HTMLParagraphElement>(null);
  const readouts = useRef<ReadoutsHandle>(null);
  usePlotPointer(plot, recordingId);

  useEffect(() => {
    const [plotEl, underEl, tracesEl, rulerEl, scrollerEl, spacerEl, problemEl] = [
      plot.current,
      under.current,
      traces.current,
      ruler.current,
      scroller.current,
      spacer.current,
      problem.current,
    ];
    const opened = useStore.getState().recordings[recordingId];
    if (!plotEl || !underEl || !tracesEl || !rulerEl || !scrollerEl || !spacerEl || !problemEl || !opened)
      return;
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
    /** The scroller position last set for `firstChannel`, and the spacer's height. */
    let scrolledTo = { first: -1, rowH: 0 };
    let shownProblem: string | null = null;

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    // A context or program that cannot be had shows its reason in the pane instead of taking the shell down.
    const start = () => {
      try {
        gl = webgl2(tracesEl);
        if (!gl) return setGlProblem(GL_MISSING);
        layer = createWaveformLayer(
          gl,
          {
            tile: (level, index) => engine.tile(recordingId, level, index),
            raw: (row0, rows) => engine.raw(recordingId, row0, rows),
          },
          { key: opened.fingerprint, channels, rows: opened.info.sample_count, params },
          schedule,
        );
        setGlProblem(null);
      } catch (error) {
        layer = null;
        setGlProblem(`DDALAB could not set up WebGL2 drawing: ${(error as Error).message}`);
      }
    };
    start();

    const rowHeightCss = () => size.cssH / useStore.getState().view.rowCount;

    const paint = () => {
      raf = 0;
      const begun = performance.now();
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
        aheadRows: view.epochS * rate,
      };
      const drawn: Drawn = layer
        ? layer.draw(frame)
        : { plan: { mode: "rawSpan" }, complete: false, gaps: [], error: null };
      const scan = recording.scan;
      const scanPercent =
        scan.scannedRows < scan.totalRows && !scan.notice
          ? Math.floor((100 * scan.scannedRows) / scan.totalRows)
          : null;
      drawUnderlay(underCtx, {
        W,
        H,
        dpr,
        view,
        selection: state.selection,
        cursorS: state.cursorS,
        recording,
        gaps: drawn.gaps,
        colors,
        scanPercent,
      });
      drawRuler(rulerCtx, { W, H: rulerEl.height, dpr, view, recording, colors });
      readouts.current?.update(view, cssW);
      const message = drawn.error && `The recording could not be read: ${drawn.error}. Trying again.`;
      if (message !== shownProblem) {
        shownProblem = message;
        problemEl.textContent = message ?? "";
        problemEl.hidden = message === null;
      }
      // The channel scroller follows the view; its position is read and written only when the rows move.
      const rowH = rowHeightCss();
      if (view.firstChannel !== scrolledTo.first || rowH !== scrolledTo.rowH) {
        spacerEl.style.height = `${Math.max(0, channels - view.rowCount) * rowH}px`;
        if (rowH > 0 && Math.round(scrollerEl.scrollTop / rowH) !== view.firstChannel) {
          scrollerEl.scrollTop = view.firstChannel * rowH;
        }
        scrolledTo = { first: view.firstChannel, rowH };
      }
      if (!probing) return;
      if (viewerProbe.frames && gl) {
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); // waits for the GPU
        const blank = drawn.gaps.reduce((sum, gap) => sum + gap.x1 - gap.x0, 0);
        viewerProbe.frames.push({ ms: performance.now() - begun, complete: drawn.complete, blank });
      }
      const shown: ProbeFrame = {
        recordingId,
        width: W,
        height: H,
        cssWidth: cssW,
        rowCount: view.rowCount,
        mode: drawn.plan.mode,
        level: drawn.plan.mode === "tile" ? drawn.plan.level : null,
        complete: drawn.complete,
        gaps: drawn.gaps,
        error: drawn.error,
      };
      viewerProbe.frame = shown;
      if (drawn.complete && state.activeRecordingId === recordingId) {
        for (const resolve of viewerProbe.waiters.splice(0)) resolve(shown);
      }
    };

    const stopResize = observeDevicePixels(plotEl, (next) => {
      size = next;
      for (const canvas of [underEl, tracesEl]) {
        canvas.width = next.W;
        canvas.height = next.H;
      }
      rulerEl.width = next.W;
      rulerEl.height = Math.round(RULER_CSS * next.dpr);
      setPlotWidth(next.cssW);
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
    const restored = () => {
      start();
      schedule();
    };
    tracesEl.addEventListener("webglcontextlost", lost);
    tracesEl.addEventListener("webglcontextrestored", restored);

    const scrolled = () => {
      const rowH = rowHeightCss();
      const first = rowH > 0 ? Math.round(scrollerEl.scrollTop / rowH) : 0;
      if (first !== useStore.getState().view.firstChannel) setView({ firstChannel: first });
    };
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
      stopResize();
      unsubscribe();
      unwatch();
      tracesEl.removeEventListener("webglcontextlost", lost);
      tracesEl.removeEventListener("webglcontextrestored", restored);
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
                <span className={styles.gutterLabel} data-chosen={chosen.has(channel) || undefined}>
                  {labels[channel]}
                  {chosen.has(channel) && <span className={styles.spoken}>, chosen</span>}
                </span>
                <span className={styles.tint} style={{ background: groups[groupOf[channel]]?.tint }} />
              </li>
            ))}
          </ul>
          <div className={styles.plot} ref={plot}>
            <canvas ref={under} className={styles.layer} aria-hidden />
            <canvas ref={traces} className={styles.layer} aria-hidden data-traces />
            {glProblem && <p className={styles.glMissing}>{glProblem}</p>}
            <p ref={problem} className={styles.problem} role="alert" hidden />
            <Readouts ref={readouts} />
          </div>
        </div>
        <div ref={spacer} />
      </div>
    </section>
  );
}
