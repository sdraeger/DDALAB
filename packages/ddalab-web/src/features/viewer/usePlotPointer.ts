// Pointer gestures on the plot: the wheel zooms about the pointer (sideways scrolling pans), a drag pans, Shift-drag
// selects the interval of a run, a click sets the cursor and a press off the plot lets it go. On a touch screen two
// fingers pinch to zoom about their midpoint and pan as it moves, and a press held still before dragging selects.
import { type RefObject, useEffect } from "react";
import { setCursor, setSelection, setView, useStore, zoomBy } from "../../store/store";

/** How long a touch stays still before its drag selects instead of panning, in milliseconds. */
const HOLD_MS = 450;
/** The narrowest horizontal finger spread a pinch measures, in CSS pixels: closer fingers would zoom in a jump. */
const MIN_SPREAD = 24;

/** `recordingId` is null for a result shown without its recording: there is nothing to run, and Shift-drag pans. */
export function usePlotPointer(plot: RefObject<HTMLElement | null>, recordingId: string | null) {
  useEffect(() => {
    const plotEl = plot.current;
    if (!plotEl) return;
    const timeAt = (clientX: number) => {
      const { view } = useStore.getState();
      const box = plotEl.getBoundingClientRect();
      return view.t0 + ((clientX - box.left) / box.width) * (view.t1 - view.t0);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? plotEl.clientHeight : 1;
      const [dx, dy] = [event.deltaX * unit, event.deltaY * unit];
      if (Math.abs(dx) > Math.abs(dy)) {
        const width = plotEl.clientWidth;
        setView((v) => {
          const shift = (dx / width) * (v.t1 - v.t0);
          return { t0: v.t0 + shift, t1: v.t1 + shift };
        });
      } else zoomBy(Math.exp(dy * 0.002), timeAt(event.clientX));
    };
    /** The drag under way; the plot's width is read once, as the move writes the dataset its styles match. */
    let drag: {
      x: number;
      t0: number;
      t1: number;
      anchor: number;
      select: boolean;
      moved: boolean;
      width: number;
    } | null = null;
    /** Where each touch is, by pointer; two of them make a pinch. */
    const touches = new Map<number, number>();
    /** The pinch under way: the view, the time under the fingers' midpoint and their spread when it began. */
    let pinch: { t0: number; t1: number; at: number; spread: number } | null = null;
    /** A pinch ends the gesture: lifting one finger neither pans nor sets the cursor. */
    let pinched = false;
    let hold: ReturnType<typeof setTimeout> | undefined;
    const spreadOf = (xs: number[]) => Math.max(MIN_SPREAD, Math.abs(xs[0] - xs[1]));
    const startPinch = () => {
      const xs = [...touches.values()];
      const { view } = useStore.getState();
      pinch = { t0: view.t0, t1: view.t1, at: timeAt((xs[0] + xs[1]) / 2), spread: spreadOf(xs) };
      pinched = true;
      drag = null;
      clearTimeout(hold);
      plotEl.dataset.dragging = "pan";
    };
    const movePinch = () => {
      if (!pinch) return;
      const xs = [...touches.values()];
      const span = ((pinch.t1 - pinch.t0) * pinch.spread) / spreadOf(xs);
      const box = plotEl.getBoundingClientRect();
      const t0 = pinch.at - (((xs[0] + xs[1]) / 2 - box.left) / box.width) * span;
      setView({ t0, t1: t0 + span });
    };
    const down = (event: PointerEvent) => {
      // A button over the plot (Try again) keeps its own click: capturing the pointer would take it.
      if (event.button !== 0 || (event.target as Element).closest("button")) return;
      plotEl.setPointerCapture(event.pointerId);
      if (event.pointerType === "touch") {
        touches.set(event.pointerId, event.clientX);
        if (touches.size === 2) return startPinch();
        if (touches.size > 2 || pinched) return;
      }
      const { view } = useStore.getState();
      const anchor = timeAt(event.clientX);
      const select = event.shiftKey && recordingId !== null;
      const width = plotEl.clientWidth;
      drag = { x: event.clientX, t0: view.t0, t1: view.t1, anchor, select, moved: false, width };
      // A finger held still turns its drag into a selection: a touch screen has no Shift.
      if (event.pointerType === "touch" && recordingId !== null) {
        hold = setTimeout(() => {
          if (!drag || drag.moved) return;
          drag.select = true;
          plotEl.dataset.dragging = "select";
          navigator.vibrate?.(10);
        }, HOLD_MS);
      }
    };
    const move = (event: PointerEvent) => {
      if (touches.has(event.pointerId)) {
        touches.set(event.pointerId, event.clientX);
        if (pinch) return movePinch();
      }
      if (!drag) return;
      const dx = event.clientX - drag.x;
      if (!drag.moved) {
        if (Math.abs(dx) <= 3) return;
        drag.moved = true;
        clearTimeout(hold);
        plotEl.dataset.dragging = drag.select ? "select" : "pan";
      }
      if (drag.select) {
        const duration =
          recordingId === null ? 0 : (useStore.getState().recordings[recordingId]?.info.duration_s ?? 0);
        const t = Math.min(duration, Math.max(0, timeAt(event.clientX)));
        setSelection({ t0: Math.min(drag.anchor, t), t1: Math.max(drag.anchor, t) });
      } else {
        const shift = (-dx / drag.width) * (drag.t1 - drag.t0);
        setView({ t0: drag.t0 + shift, t1: drag.t1 + shift });
      }
    };
    const up = (event: PointerEvent) => {
      clearTimeout(hold);
      touches.delete(event.pointerId);
      if (pinched) {
        // The gesture ends with its last finger; until then the remaining one does nothing.
        pinch = null;
        if (touches.size > 0) return;
        pinched = false;
      } else if (drag && !drag.moved) setCursor(timeAt(event.clientX));
      drag = null;
      delete plotEl.dataset.dragging;
    };
    // A press anywhere off the plot lets the cursor go; one on another plot sets it there as the press ends. A control
    // that acts at the cursor (Annotate, `data-keeps-cursor`) keeps it.
    const off = (event: PointerEvent) => {
      const target = event.target as Element;
      if (plotEl.contains(target) || target.closest?.("[data-keeps-cursor]")) return;
      if (useStore.getState().cursorS !== null) setCursor(null);
    };
    document.addEventListener("pointerdown", off);
    plotEl.addEventListener("wheel", wheel, { passive: false });
    plotEl.addEventListener("pointerdown", down);
    plotEl.addEventListener("pointermove", move);
    plotEl.addEventListener("pointerup", up);
    plotEl.addEventListener("pointercancel", up);
    return () => {
      clearTimeout(hold);
      document.removeEventListener("pointerdown", off);
      plotEl.removeEventListener("wheel", wheel);
      plotEl.removeEventListener("pointerdown", down);
      plotEl.removeEventListener("pointermove", move);
      plotEl.removeEventListener("pointerup", up);
      plotEl.removeEventListener("pointercancel", up);
    };
  }, [plot, recordingId]);
}
