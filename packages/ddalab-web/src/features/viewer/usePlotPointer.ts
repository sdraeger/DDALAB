// Pointer gestures on the plot: the wheel zooms about the pointer (sideways scrolling pans), a drag pans, Shift-drag
// selects the interval of a run, a click sets the cursor and a press off the plot lets it go.
import { type RefObject, useEffect } from "react";
import { setCursor, setSelection, setView, useStore, zoomBy } from "../../store/store";

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
    const down = (event: PointerEvent) => {
      // A button over the plot (Try again) keeps its own click: capturing the pointer would take it.
      if (event.button !== 0 || (event.target as Element).closest("button")) return;
      plotEl.setPointerCapture(event.pointerId);
      const { view } = useStore.getState();
      const anchor = timeAt(event.clientX);
      const select = event.shiftKey && recordingId !== null;
      const width = plotEl.clientWidth;
      drag = { x: event.clientX, t0: view.t0, t1: view.t1, anchor, select, moved: false, width };
    };
    const move = (event: PointerEvent) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      if (!drag.moved) {
        if (Math.abs(dx) <= 3) return;
        drag.moved = true;
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
      if (drag && !drag.moved) setCursor(timeAt(event.clientX));
      drag = null;
      delete plotEl.dataset.dragging;
    };
    // A press anywhere off the plot lets the cursor go; one on another plot sets it there as the press ends.
    const off = (event: PointerEvent) => {
      if (!plotEl.contains(event.target as Node) && useStore.getState().cursorS !== null) setCursor(null);
    };
    document.addEventListener("pointerdown", off);
    plotEl.addEventListener("wheel", wheel, { passive: false });
    plotEl.addEventListener("pointerdown", down);
    plotEl.addEventListener("pointermove", move);
    plotEl.addEventListener("pointerup", up);
    plotEl.addEventListener("pointercancel", up);
    return () => {
      document.removeEventListener("pointerdown", off);
      plotEl.removeEventListener("wheel", wheel);
      plotEl.removeEventListener("pointerdown", down);
      plotEl.removeEventListener("pointermove", move);
      plotEl.removeEventListener("pointerup", up);
      plotEl.removeEventListener("pointercancel", up);
    };
  }, [plot, recordingId]);
}
