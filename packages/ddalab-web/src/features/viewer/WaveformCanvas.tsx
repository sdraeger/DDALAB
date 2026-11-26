// The waveform pane: the label gutter with electrode-group tints, the time ruler, the traces (WebGL2) over a 2D
// underlay, the printed scale and the channel scroller. View changes reach the canvases through store.subscribe;
// React renders the structure and the visible gutter rows only.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { MiddleText } from "../../app/MiddleText";
import { engine } from "../../app/recordings";
import { getChannelHighlight, setChannelHighlight, subscribeChannelHighlight } from "../../core/highlight";
import { drawRuler, drawUnderlay, type Flag } from "../../render/axis";
import { observeDevicePixels } from "../../render/devicePixels";
import { paramsOf } from "../../render/display";
import { webgl2 } from "../../render/gl";
import { readColors, watchTheme } from "../../render/themeColors";
import { createWaveformLayer, type Drawn, type WaveformLayer } from "../../render/waveformLayer";
import {
  CSS_PX_PER_MM,
  rowChannels,
  type State,
  selectChannels,
  setPlotWidth,
  setView,
  setViewedChannels,
  useStore,
} from "../../store/store";
import controls from "../../styles/controls.module.css";
import { userOf } from "../annotations/model";
import { useAnnotationGestures } from "../annotations/useAnnotationGestures";
import { channelLabels } from "../inspector/groups";
import { type ProbeFrame, probing, viewerProbe } from "./probe";
import { Readouts, type ReadoutsHandle } from "./Readouts";
import { usePlotPointer } from "./usePlotPointer";
import styles from "./Viewer.module.css";

const RULER_CSS = 22;
const AnnotationEditor = lazy(() => import("../annotations/AnnotationEditor"));

const GL_MISSING =
  "DDALAB draws recordings with WebGL2, which this browser does not provide. Use a current Chrome, Edge, " +
  "Firefox or Safari with hardware acceleration turned on.";
const GL_LOST = "The browser reset WebGL2 drawing. The traces return once it restores it.";

export function WaveformCanvas({ recordingId }: { recordingId: string }) {
  const info = useStore((s) => s.recordings[recordingId]?.info);
  const analysis = useStore((s) => s.recordings[recordingId]?.analysis_channels);
  const firstChannel = useStore((s) => s.view.firstChannel);
  const rowCount = useStore((s) => s.view.rowCount);
  const chosenOnly = useStore((s) => s.view.chosenOnly);
  const { labels, groups, groupOf } = useMemo(
    () => channelLabels(info?.channels ?? [], analysis ?? []),
    [analysis, info],
  );
  const selected = useStore((s) => s.recordings[recordingId]?.selectedChannels);
  const viewed = useStore((s) => s.recordings[recordingId]?.viewedChannels ?? null);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const order = useMemo(
    () =>
      rowChannels(
        { chosenOnly },
        { analysis_channels: analysis ?? [], selectedChannels: selected ?? [], viewedChannels: viewed },
      ),
    [chosenOnly, analysis, selected, viewed],
  );
  const lastGutterClicked = useRef<number | null>(null);
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
  const flags = useRef<Flag[]>([]);
  const tip = useRef<HTMLDivElement>(null);
  const editing = useStore((s) => s.annotationEditor !== null);
  usePlotPointer(plot, recordingId);
  useAnnotationGestures(plot, ruler, tip, flags, recordingId);

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
    /** The scroller position last set for `firstChannel`, and the spacer's height for `count` rows' channels. */
    let scrolledTo = { first: -1, rowH: 0, count: 0 };
    let shownProblem: string | null = null;

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    // A context or program that cannot be had shows its reason in the pane instead of taking the shell down.
    const start = () => {
      try {
        gl = webgl2(tracesEl);
        if (!gl) return setGlProblem(GL_MISSING);
        // Display filtering runs off the main thread in the IO worker (with settling padding on each side).
        // shortcut: pyramid tiles (64 or more samples per pixel) stay unfiltered; filter them if wide views need it.
        const { filter } = useStore.getState();
        const total = opened.info.sample_count;
        const raw = (row0: number, rows: number) => engine.raw(recordingId, row0, rows, filter);
        layer = createWaveformLayer(
          gl,
          { tile: (level, index) => engine.tile(recordingId, level, index), raw },
          { key: `${opened.fingerprint} ${JSON.stringify(filter)}`, channels, rows: total, params },
          schedule,
        );
        setGlProblem(null);
      } catch (error) {
        layer = null;
        setGlProblem(`DDALAB could not set up WebGL2 drawing: ${(error as Error).message}`);
      }
    };
    start();

    /** The rows' channels and the rows on screen, fewer when fewer channels show. */
    const rowsOf = (state: State) => {
      const recording = state.recordings[recordingId];
      const order = recording ? rowChannels(state.view, recording) : [];
      return { order, rowCount: Math.min(state.view.rowCount, order.length) };
    };
    const rowHeightCss = () => {
      const count = rowsOf(useStore.getState()).rowCount;
      return count > 0 ? size.cssH / count : 0;
    };

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
      const { order, rowCount } = rowsOf(state);
      const rate = recording.info.sample_rate_hz;
      const pxPerMm = (CSS_PX_PER_MM / view.mmPerCssMm) * dpr;
      const drawn: Drawn =
        layer && rowCount > 0
          ? layer.draw({
              width: W,
              height: H,
              s0: view.t0 * rate,
              spp: ((view.t1 - view.t0) * rate) / W,
              order,
              firstChannel: view.firstChannel,
              rowCount,
              rowHeight: H / rowCount,
              pxPerUnit: pxPerMm / view.sensitivityUvPerMm,
              pointSize: Math.max(3, Math.round(3 * dpr)),
              ink: colors.trace,
              aheadRows: view.epochS * rate,
            })
          : (() => {
              if (gl) {
                gl.viewport(0, 0, W, H);
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);
              }
              return { plan: { mode: "rawSpan" as const }, complete: rowCount === 0, gaps: [], error: null };
            })();
      const scan = recording.scan;
      const scanPercent =
        scan.scannedRows < scan.totalRows && !scan.notice
          ? Math.floor((100 * scan.scannedRows) / scan.totalRows)
          : null;
      const events = {
        recording,
        user: userOf(state, recording.fingerprint),
        picked: state.pickedAnnotation,
      };
      drawUnderlay(underCtx, {
        W,
        H,
        dpr,
        view,
        selection: state.selection,
        cursorS: state.cursorS,
        ...events,
        gaps: drawn.gaps,
        colors,
        scanPercent,
      });
      // Bidirectional highlight: when the pointer hovers a heatmap row below, highlight its channel(s) here.
      const hl = getChannelHighlight();
      if (hl && hl.source === "heatmap" && hl.labels.length > 0 && rowCount > 0) {
        const visible = order.slice(view.firstChannel, view.firstChannel + rowCount);
        const visibleCount = Math.min(rowCount, order.length);
        const { labels: chNames } = channelLabels(recording.info.channels, recording.analysis_channels);
        const targetSet = new Set(hl.labels);
        const barW = Math.max(3, Math.round(3 * dpr));
        for (let i = 0; i < visible.length; i++) {
          const chName = chNames[visible[i]];
          if (!targetSet.has(chName)) continue;
          const y0 = Math.round((i * H) / visibleCount);
          const y1 = Math.round(((i + 1) * H) / visibleCount);
          underCtx.fillStyle = colors.wash;
          underCtx.fillRect(0, y0, W, y1 - y0);
          underCtx.fillStyle = colors.primary;
          underCtx.fillRect(0, y0, barW, y1 - y0);
        }
      }
      flags.current = drawRuler(rulerCtx, { W, H: rulerEl.height, dpr, view, ...events, colors });
      readouts.current?.update(view, cssW);
      const message = drawn.error && `The recording could not be read: ${drawn.error}. Trying again.`;
      if (message !== shownProblem) {
        shownProblem = message;
        problemEl.textContent = message ?? "";
        problemEl.hidden = message === null;
      }
      // The channel scroller follows the view; its position is read and written only when the rows move.
      const rowH = rowCount > 0 ? size.cssH / rowCount : 0;
      const count = order.length;
      if (view.firstChannel !== scrolledTo.first || rowH !== scrolledTo.rowH || count !== scrolledTo.count) {
        spacerEl.style.height = `${Math.max(0, count - rowCount) * rowH}px`;
        if (rowH > 0 && Math.round(scrollerEl.scrollTop / rowH) !== view.firstChannel) {
          scrollerEl.scrollTop = view.firstChannel * rowH;
        }
        scrolledTo = { first: view.firstChannel, rowH, count };
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
        rowCount,
        channels: order.slice(view.firstChannel, view.firstChannel + rowCount),
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

    // A paint follows what it draws: the view, the selection, the cursor, the recording (its scan, its events) and the
    // user's annotations with the one picked or dragged.
    const unsubscribe = useStore.subscribe((s, p) => {
      if (
        s.view !== p.view ||
        s.selection !== p.selection ||
        s.cursorS !== p.cursorS ||
        s.recordings[recordingId] !== p.recordings[recordingId] ||
        s.annotations !== p.annotations ||
        s.annotationDraft !== p.annotationDraft ||
        s.pickedAnnotation !== p.pickedAnnotation
      )
        schedule();
    });
    // A new filter draws from raw rows filtered by it: a new layer, as after a lost context.
    const unfilter = useStore.subscribe((s, p) => {
      if (s.filter === p.filter) return;
      layer?.dispose();
      lastScanned = -1;
      start();
      schedule();
    });
    const unwatch = watchTheme(() => {
      colors = readColors(plotEl);
      schedule();
    });
    const unhighlight = subscribeChannelHighlight(schedule);
    const onPointerMove = (event: PointerEvent) => {
      if (size.cssH <= 0) return;
      const state = useStore.getState();
      const rec = state.recordings[recordingId];
      if (!rec) return;
      const orderNow = rowChannels(state.view, rec);
      const visibleCount = Math.min(state.view.rowCount, orderNow.length);
      if (visibleCount <= 0) return;
      const box = plotEl.getBoundingClientRect();
      const y = event.clientY - box.top;
      const row = Math.min(visibleCount - 1, Math.max(0, Math.floor((y / size.cssH) * visibleCount)));
      const ch = orderNow[state.view.firstChannel + row];
      if (ch === undefined) return;
      const { labels: chNames } = channelLabels(rec.info.channels, rec.analysis_channels);
      const label = chNames[ch];
      if (label) setChannelHighlight({ labels: [label], source: "waveform" });
    };
    const onPointerLeave = () => {
      if (getChannelHighlight()?.source === "waveform") setChannelHighlight(null);
    };
    plotEl.addEventListener("pointermove", onPointerMove);
    plotEl.addEventListener("pointerleave", onPointerLeave);

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
      unfilter();
      unwatch();
      unhighlight();
      plotEl.removeEventListener("pointermove", onPointerMove);
      plotEl.removeEventListener("pointerleave", onPointerLeave);
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
  const rowsOnScreen = Math.min(rowCount, order.length);
  const rows = order.slice(firstChannel, firstChannel + rowsOnScreen);
  const toggleGutterChannel = (channel: number, shiftKey: boolean) => {
    const nextOn = !chosen.has(channel);
    if (shiftKey && lastGutterClicked.current !== null) {
      const from = order.indexOf(lastGutterClicked.current);
      const to = order.indexOf(channel);
      if (from >= 0 && to >= 0) {
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        selectChannels(order.slice(lo, hi + 1), nextOn);
        lastGutterClicked.current = channel;
        return;
      }
    }
    selectChannels([channel], nextOn);
    lastGutterClicked.current = channel;
  };
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the pane takes focus so that paging keys reach the viewer
    <section className={styles.waveforms} aria-label="Waveforms" tabIndex={0} data-appear>
      <div className={styles.scroller} ref={scroller}>
        <div className={styles.sticky}>
          <span className={styles.unit} aria-hidden>
            s
          </span>
          <canvas ref={ruler} className={styles.ruler} aria-hidden data-ruler />
          <ul className={styles.gutter} aria-label="Channel rows">
            {rows.map((channel, row) => (
              <li
                key={channel}
                className={styles.gutterRow}
                style={{
                  top: `${(100 * row) / rowsOnScreen}%`,
                  height: `${100 / rowsOnScreen}%`,
                }}
              >
                <button
                  type="button"
                  className={styles.gutterLabel}
                  data-chosen={chosen.has(channel) || undefined}
                  aria-pressed={chosen.has(channel)}
                  title={`${labels[channel]} — click to toggle for DDA (Shift-click for range)`}
                  onClick={(event) => toggleGutterChannel(channel, event.shiftKey)}
                >
                  <MiddleText text={labels[channel]} />
                  {chosen.has(channel) && <span className={styles.spoken}>, chosen</span>}
                </button>
                <span className={styles.tint} style={{ background: groups[groupOf[channel]]?.tint }} />
              </li>
            ))}
          </ul>
          <div className={styles.plot} ref={plot}>
            <canvas ref={under} className={styles.layer} aria-hidden />
            <canvas ref={traces} className={styles.layer} aria-hidden data-traces />
            {rowsOnScreen === 0 && !glProblem && (
              <div className={styles.noChannels} data-appear>
                <p>No channels are shown in the waveform.</p>
                <button type="button" className={controls.button} onClick={() => setViewedChannels(null)}>
                  Show all channels
                </button>
              </div>
            )}
            {glProblem && (
              <p className={styles.glMissing} data-appear>
                {glProblem}
              </p>
            )}
            <p ref={problem} className={styles.problem} role="alert" hidden />
          </div>
          <Readouts ref={readouts} />
          <div ref={tip} className={styles.tip} hidden>
            <b />
            <span />
          </div>
          {editing && (
            <Suspense fallback={null}>
              <AnnotationEditor recordingId={recordingId} ruler={ruler} />
            </Suspense>
          )}
        </div>
        <div ref={spacer} />
      </div>
    </section>
  );
}
