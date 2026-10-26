// The overview locator: the whole recording, the view outlined with its range tab, the selection and the events.
// The outline follows every view change at once, paging included: it moves with the traces.
import { useEffect, useRef } from "react";
import { engine } from "../../app/recordings";
import { EngineStopped } from "../../core/engine";
import { tileCount, tileRows } from "../../core/opfs";
import type { ScanState } from "../../core/protocol";
import { observeDevicePixels, type PlotSize } from "../../render/devicePixels";
import { paramsOf } from "../../render/display";
import { drawOverview, envelope, overviewLevel, signalChannels } from "../../render/overviewLayer";
import { readColors, watchTheme } from "../../render/themeColors";
import { setView, useStore } from "../../store/store";
import { userOf } from "../annotations/model";
import styles from "./Viewer.module.css";

/** A tile that failed to read is asked for again after this pause. */
const RETRY_MS = 5000;

const compact = (s: number) => Number(s.toFixed(2)).toString();
/** A text with every digit the same, which stands for its width in tabular numerals. */
const digitless = (text: string) => text.replace(/\d/g, "0");

export function Overview({ recordingId }: { recordingId: string }) {
  const duration = useStore((s) => s.recordings[recordingId]?.info.duration_s ?? 0);
  const strip = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const outline = useRef<HTMLDivElement>(null);
  const tab = useRef<HTMLSpanElement>(null);
  const problem = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const [stripEl, canvasEl, outlineEl, tabEl, problemEl] = [
      strip.current,
      canvas.current,
      outline.current,
      tab.current,
      problem.current,
    ];
    const opened = useStore.getState().recordings[recordingId];
    if (!stripEl || !canvasEl || !outlineEl || !tabEl || !problemEl || !opened) return;
    const ctx = canvasEl.getContext("2d") as CanvasRenderingContext2D;
    const rows = opened.info.sample_count;
    const rate = opened.info.sample_rate_hz;
    const span = rows / rate;
    const level = overviewLevel(rows);
    const count = tileCount(rows, level);
    const params = paramsOf(opened);
    const counted = signalChannels(opened.analysis_channels.map((c) => opened.info.channels[c]));
    const tiles = new Map<number, Float32Array>();
    /** Why each tile was last asked for; a tile asked for before the scan reached it is asked again after. */
    const asked = new Map<number, "scanned" | "idle" | "failed">();
    const pending = new Set<number>();
    let size: PlotSize = { cssW: 0, cssH: 0, dpr: 1, W: 0, H: 0 };
    let raf = 0;
    /** The view and the strip width the outline was last placed for. */
    let last = { t0: Number.NaN, t1: Number.NaN, cssW: Number.NaN };
    let colors = readColors(stripEl);
    /** What the canvas last showed: it is redrawn when that changes, and a move of the view alone leaves it. */
    let drawnScene: unknown[] = [];
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const report = (message: string | null) => {
      problemEl.textContent = message ?? "";
      problemEl.hidden = message === null;
    };

    // While the scan runs, a tile is asked for once the scan has stored it: building it from the file as well
    // would read the recording twice. Without a running scan each tile is asked for once.
    const fetchTiles = (scan: ScanState) => {
      const running = scan.scannedRows < scan.totalRows && !scan.notice && !scan.error;
      for (let i = 0; i < count; i++) {
        const end = Math.min(rows, (i + 1) * tileRows(level));
        if (tiles.has(i) || pending.has(i) || (running && scan.scannedRows < end)) continue;
        const reason = scan.scannedRows >= end ? "scanned" : "idle";
        if (asked.get(i) === reason || asked.get(i) === "failed") continue;
        asked.set(i, reason);
        pending.add(i);
        engine
          .tile(recordingId, level, i)
          .then((found) => {
            if (found) tiles.set(i, envelope(found.bytes, params, counted));
            report(null);
          })
          .catch((error: Error) => {
            // An engine that restarted is asked again at once; another failure is shown and asked again later.
            if (error instanceof EngineStopped) return void asked.delete(i);
            asked.set(i, "failed");
            report(`The overview could not be read: ${error.message}`);
            setTimeout(() => {
              asked.delete(i);
              schedule();
            }, RETRY_MS);
          })
          .finally(() => {
            pending.delete(i);
            schedule();
          });
      }
    };

    const paint = () => {
      raf = 0;
      const state = useStore.getState();
      const recording = state.recordings[recordingId];
      if (!recording || size.W === 0) return;
      const { scan } = recording;
      fetchTiles(scan);
      const scanning = scan.scannedRows < scan.totalRows && !scan.notice;
      const scanPercent = scanning ? Math.floor((100 * scan.scannedRows) / scan.totalRows) : null;
      const { selection } = state;
      const { annotations } = recording.info;
      const user = userOf(state, recording.fingerprint);
      const scene = [tiles.size, scanPercent, selection?.t0, selection?.t1, annotations, user, size, colors];
      if (scene.some((part, i) => part !== drawnScene[i])) {
        drawnScene = scene;
        drawOverview(ctx, {
          width: size.W,
          height: size.H,
          dpr: size.dpr,
          rows,
          rate,
          level,
          tiles,
          scanPercent,
          selection,
          annotations: annotations.map((a) => a.onset_s),
          user: user.map((a) => a.onset_s),
          colors,
        });
      }
      const { t0, t1 } = state.view;
      if (t0 === last.t0 && t1 === last.t1 && size.cssW === last.cssW) return;
      last = { t0, t1, cssW: size.cssW };
      // Read before the writes, from the last frame's layout: the tabular numerals (base.css) give a text that differs
      // only in its digits the same width. Any other change of the text is measured after it is written.
      let tabW = tabEl.offsetWidth;
      const left = (t0 / span) * size.cssW;
      const width = Math.max(2, ((t1 - t0) / span) * size.cssW);
      outlineEl.style.transform = `translateX(${left}px)`;
      outlineEl.style.width = `${width}px`;
      const text = `${compact(t0)} to ${compact(t1)} s`;
      const resized = digitless(text) !== digitless(tabEl.textContent ?? "");
      tabEl.textContent = text;
      if (resized) tabW = tabEl.offsetWidth;
      // The tab sits over the middle of the outline and stays inside the strip.
      const centered = width / 2 - tabW / 2;
      tabEl.style.transform = `translateX(${Math.min(size.cssW - left - tabW, Math.max(-left, centered))}px)`;
    };

    const stopResize = observeDevicePixels(canvasEl, (next) => {
      size = next;
      canvasEl.width = size.W;
      canvasEl.height = size.H;
      paint();
    });
    // A paint follows what it draws: the view, the selection, the recording (its scan, its events) and the user's
    // annotations.
    const unsubscribe = useStore.subscribe((s, p) => {
      if (
        s.view !== p.view ||
        s.selection !== p.selection ||
        s.recordings[recordingId] !== p.recordings[recordingId] ||
        s.annotations !== p.annotations ||
        s.annotationDraft !== p.annotationDraft
      )
        schedule();
    });
    const unwatch = watchTheme(() => {
      colors = readColors(stripEl);
      schedule();
    });

    // Pointing at the strip centers the view there; dragging moves it along.
    const center = (clientX: number) => {
      const box = canvasEl.getBoundingClientRect();
      const at = ((clientX - box.left) / box.width) * span;
      setView((v) => ({ t0: at - (v.t1 - v.t0) / 2, t1: at + (v.t1 - v.t0) / 2 }));
    };
    let dragging = false;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragging = true;
      stripEl.setPointerCapture(event.pointerId);
      center(event.clientX);
    };
    const move = (event: PointerEvent) => {
      if (dragging) center(event.clientX);
    };
    const up = () => {
      dragging = false;
    };
    stripEl.addEventListener("pointerdown", down);
    stripEl.addEventListener("pointermove", move);
    stripEl.addEventListener("pointerup", up);
    stripEl.addEventListener("pointercancel", up);

    return () => {
      cancelAnimationFrame(raf);
      stopResize();
      unsubscribe();
      unwatch();
      stripEl.removeEventListener("pointerdown", down);
      stripEl.removeEventListener("pointermove", move);
      stripEl.removeEventListener("pointerup", up);
      stripEl.removeEventListener("pointercancel", up);
    };
  }, [recordingId]);

  return (
    <div className={styles.overview} data-appear>
      <div className={styles.overviewLabel}>
        <span>Overview</span>
        <span className={styles.muted}>{compact(duration)} s</span>
      </div>
      <div
        className={styles.strip}
        ref={strip}
        role="img"
        aria-label="The whole recording, with the part on screen outlined"
      >
        <canvas ref={canvas} className={styles.stripCanvas} />
        <div ref={outline} className={styles.outline}>
          <span ref={tab} className={styles.tab} />
        </div>
      </div>
      <p ref={problem} className={styles.problem} role="alert" hidden />
    </div>
  );
}
