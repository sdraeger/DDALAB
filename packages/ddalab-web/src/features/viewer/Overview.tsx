// The overview locator: the whole recording, the view outlined with its range tab, the selection and the events.
// Paging glides the outline to its new place (the one authored motion); dragging and wheel moves follow at once.
import { useEffect, useRef } from "react";
import { engine } from "../../app/recordings";
import { tileCount, tileRows } from "../../core/opfs";
import type { ScanState } from "../../core/protocol";
import { cssColor } from "../../render/gl";
import { drawOverview, envelope, overviewLevel } from "../../render/overviewLayer";
import { setView, useStore } from "../../store/store";
import styles from "./Viewer.module.css";
import { paramsOf } from "./WaveformCanvas";

/** View changes closer together than this are a continuous move: the outline follows without gliding. */
const CONTINUOUS_MS = 150;

const compact = (s: number) => Number(s.toFixed(2)).toString();

export function Overview({ recordingId }: { recordingId: string }) {
  const duration = useStore((s) => s.recordings[recordingId]?.info.duration_s ?? 0);
  const strip = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const outline = useRef<HTMLDivElement>(null);
  const tab = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const [stripEl, canvasEl, outlineEl, tabEl] = [
      strip.current,
      canvas.current,
      outline.current,
      tab.current,
    ];
    const opened = useStore.getState().recordings[recordingId];
    if (!stripEl || !canvasEl || !outlineEl || !tabEl || !opened) return;
    const ctx = canvasEl.getContext("2d") as CanvasRenderingContext2D;
    const rows = opened.info.sample_count;
    const rate = opened.info.sample_rate_hz;
    const span = rows / rate;
    const level = overviewLevel(rows);
    const count = tileCount(rows, level);
    const params = paramsOf(opened);
    const tiles = new Map<number, Float32Array>();
    /** Why each tile was last asked for; a tile asked for before the scan reached it is asked again after. */
    const asked = new Map<number, "scanned" | "idle">();
    const pending = new Set<number>();
    let size = { cssW: 0, W: 0, H: 0, dpr: 1 };
    let raf = 0;
    let last = { t0: Number.NaN, t1: Number.NaN, at: 0 };
    const color = (value: string) => cssColor(stripEl, value).css;
    const readColors = () => ({
      trace: color("var(--muted)"),
      muted: color("var(--muted)"),
      event: color("var(--event)"),
      wash: color("var(--primary-wash)"),
      grid: color("var(--grid)"),
    });
    let colors = readColors();
    const fontFamily = getComputedStyle(stripEl).fontFamily;
    /** What the canvas last showed: it is redrawn when that changes, not on every move of the view. */
    let drawnScene: unknown[] = [];
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };

    // While the scan runs, a tile is asked for once the scan has stored it: building it from the file as well
    // would read the recording twice. Without a running scan each tile is asked for once.
    const fetchTiles = (scan: ScanState) => {
      const running = scan.scannedRows < scan.totalRows && !scan.notice && !scan.error;
      for (let i = 0; i < count; i++) {
        const end = Math.min(rows, (i + 1) * tileRows(level));
        if (tiles.has(i) || pending.has(i) || (running && scan.scannedRows < end)) continue;
        const reason = scan.scannedRows >= end ? "scanned" : "idle";
        if (asked.get(i) === reason) continue;
        asked.set(i, reason);
        pending.add(i);
        engine
          .tile(recordingId, level, i)
          .then((found) => {
            if (found) tiles.set(i, envelope(found.bytes, params));
          })
          .catch(() => {})
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
      const scene = [tiles.size, scanPercent, selection?.t0, selection?.t1, annotations, size, colors];
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
          colors,
          font: `${11 * size.dpr}px ${fontFamily}`,
        });
      }
      const { t0, t1 } = state.view;
      if (t0 !== last.t0 || t1 !== last.t1) {
        const now = performance.now();
        outlineEl.dataset.live = String(now - last.at < CONTINUOUS_MS);
        last = { t0, t1, at: now };
      }
      const left = (t0 / span) * size.cssW;
      const width = Math.max(2, ((t1 - t0) / span) * size.cssW);
      outlineEl.style.transform = `translateX(${left}px)`;
      outlineEl.style.width = `${width}px`;
      tabEl.textContent = `${compact(t0)} to ${compact(t1)} s`;
      // The tab sits over the middle of the outline and stays inside the strip.
      const tabW = tabEl.offsetWidth;
      const centered = width / 2 - tabW / 2;
      tabEl.style.transform = `translateX(${Math.min(size.cssW - left - tabW, Math.max(-left, centered))}px)`;
    };

    const resize = new ResizeObserver(([entry]) => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = entry.contentRect;
      size = { cssW: width, W: Math.round(width * dpr), H: Math.round(height * dpr), dpr };
      canvasEl.width = size.W;
      canvasEl.height = size.H;
      paint();
    });
    resize.observe(canvasEl);
    const unsubscribe = useStore.subscribe(schedule);
    const theme = new MutationObserver(() => {
      colors = readColors();
      schedule();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // Pointing at the strip centres the view there; dragging moves it along.
    const centre = (clientX: number) => {
      const box = canvasEl.getBoundingClientRect();
      const at = ((clientX - box.left) / box.width) * span;
      setView((v) => ({ t0: at - (v.t1 - v.t0) / 2, t1: at + (v.t1 - v.t0) / 2 }));
    };
    let dragging = false;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragging = true;
      stripEl.setPointerCapture(event.pointerId);
      centre(event.clientX);
    };
    const move = (event: PointerEvent) => {
      if (dragging) centre(event.clientX);
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
      resize.disconnect();
      unsubscribe();
      theme.disconnect();
      stripEl.removeEventListener("pointerdown", down);
      stripEl.removeEventListener("pointermove", move);
      stripEl.removeEventListener("pointerup", up);
      stripEl.removeEventListener("pointercancel", up);
    };
  }, [recordingId]);

  return (
    <div className={styles.overview}>
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
    </div>
  );
}
