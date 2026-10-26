// Annotation gestures on the waveform. A double-click on the plot marks a point. On the ruler a click on a flag opens
// its editor (read-only for the recording's own events), a drag moves a user flag, and a tip names the flag under the
// pointer in full. On the plot a drag that starts within 4 px of a user span's edge resizes the span; it is caught
// before usePlotPointer's pan. While a drag lasts the annotation's place goes to the canvases through the store's
// draft; the change is stored, one step to undo, when it ends.
import { type RefObject, useEffect } from "react";
import type { UserAnnotation } from "../../core/userAnnotations";
import type { Flag } from "../../render/axis";
import { useStore } from "../../store/store";
import {
  annotate,
  eventOf,
  openEditor,
  pick,
  pointer,
  resized,
  setDraft,
  update,
  userOf,
  when,
} from "./model";

/** CSS pixels a press may miss a span's edge by. */
const SLOP = 4;

/** `flags` holds the flags as the ruler last drew them; `tip` is the element that names one. */
export function useAnnotationGestures(
  plot: RefObject<HTMLElement | null>,
  ruler: RefObject<HTMLCanvasElement | null>,
  tip: RefObject<HTMLElement | null>,
  flags: RefObject<Flag[]>,
  recordingId: string,
) {
  useEffect(() => {
    const [plotEl, rulerEl, tipEl] = [plot.current, ruler.current, tip.current];
    if (!plotEl || !rulerEl || !tipEl) return;
    void import("./AnnotationEditor"); // ready before the first A
    const state = useStore.getState;
    const recording = () => state().recordings[recordingId];
    /** The time at `clientX` over `el`, which spans the view. */
    const timeAt = (el: Element, clientX: number) => {
      const { view } = state();
      const box = el.getBoundingClientRect();
      return view.t0 + ((clientX - box.left) / box.width) * (view.t1 - view.t0);
    };
    const flagAt = (clientX: number) => {
      const box = rulerEl.getBoundingClientRect();
      const px = ((clientX - box.left) * rulerEl.width) / box.width;
      return flags.current?.findLast((f) => px >= f.x0 && px <= f.x1);
    };
    /** The user span edge within SLOP of `clientX`, the nearest. */
    const edgeAt = (clientX: number) => {
      const s = state();
      const opened = recording();
      if (!opened) return null;
      const box = plotEl.getBoundingClientRect();
      const px = (t: number) => box.left + ((t - s.view.t0) / (s.view.t1 - s.view.t0)) * box.width;
      let best: { a: UserAnnotation; edge: "start" | "end"; d: number } | null = null;
      for (const a of userOf(s, opened.fingerprint)) {
        if (a.duration_s <= 0) continue;
        for (const edge of ["start", "end"] as const) {
          const d = Math.abs(px(edge === "start" ? a.onset_s : a.onset_s + a.duration_s) - clientX);
          if (d <= SLOP && (!best || d < best.d)) best = { a, edge, d };
        }
      }
      return best;
    };

    /** A press on a flag or a span edge: what it drags, where it began, and whether it has moved. */
    let drag: {
      id: string;
      /** "open": a flag that only opens on release (a file event). */
      kind: "move" | "start" | "end" | "open";
      a?: UserAnnotation;
      x: number;
      t: number;
      moved: boolean;
    } | null = null;

    const hideTip = () => {
      tipEl.hidden = true;
    };
    const showTip = (flag: Flag) => {
      const found = eventOf(state(), recordingId, flag.id);
      if (!found) return hideTip();
      const [name, meta] = tipEl.children as unknown as HTMLElement[];
      name.textContent = found.label || "event";
      meta.textContent = `${found.user ? "Yours" : found.source}, ${when(found)}`;
      const box = rulerEl.getBoundingClientRect();
      tipEl.style.top = `${box.bottom + 4}px`;
      tipEl.hidden = false;
      // Under the flag, inside the window.
      const left = box.left + (flag.x0 * box.width) / rulerEl.width;
      tipEl.style.left = `${Math.max(0, Math.min(left, innerWidth - tipEl.offsetWidth - 8))}px`;
    };

    const moveTo = (event: PointerEvent, el: Element) => {
      if (!drag?.a) return;
      const dx = event.clientX - drag.x;
      drag.moved ||= Math.abs(dx) > 3;
      if (!drag.moved) return;
      const length = recording()?.info.duration_s ?? 0;
      const t = timeAt(el, event.clientX);
      const { a } = drag;
      if (drag.kind === "move") {
        const onset_s = Math.min(length - a.duration_s, Math.max(0, a.onset_s + t - drag.t));
        setDraft({ ...a, onset_s });
      } else if (drag.kind !== "open") {
        setDraft(resized(a, drag.kind, Math.min(length, Math.max(0, t))));
      }
    };
    /** Ends a drag: a moved annotation is stored where the draft has it. */
    const finish = () => {
      const draft = state().annotationDraft;
      const opened = recording();
      if (drag?.moved && draft && opened) {
        setDraft(null);
        update(opened.fingerprint, draft.id, { onset_s: draft.onset_s, duration_s: draft.duration_s });
      } else setDraft(null);
      const ended = drag;
      drag = null;
      return ended;
    };

    const rulerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const flag = flagAt(event.clientX);
      if (!flag) return;
      rulerEl.setPointerCapture(event.pointerId);
      const opened = recording();
      const a =
        flag.user && opened ? userOf(state(), opened.fingerprint).find((u) => u.id === flag.id) : undefined;
      const t = timeAt(rulerEl, event.clientX);
      drag = { id: flag.id, kind: a ? "move" : "open", a, x: event.clientX, t, moved: false };
      if (a) rulerEl.style.cursor = "grabbing";
      hideTip();
    };
    const rulerMove = (event: PointerEvent) => {
      if (drag) return moveTo(event, rulerEl);
      const flag = flagAt(event.clientX);
      rulerEl.style.cursor = flag ? (flag.user ? "grab" : "pointer") : "";
      if (flag) showTip(flag);
      else hideTip();
    };
    const rulerUp = () => {
      const ended = finish();
      if (ended && !ended.moved) openEditor(ended.id);
    };

    // The plot's listeners run in the capture phase, before usePlotPointer's: a press on a span edge is not a pan.
    const plotDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.shiftKey || (event.target as Element).closest("button")) return;
      const hit = edgeAt(event.clientX);
      if (!hit) return;
      event.stopPropagation();
      plotEl.setPointerCapture(event.pointerId);
      const t = timeAt(plotEl, event.clientX);
      drag = { id: hit.a.id, kind: hit.edge, a: hit.a, x: event.clientX, t, moved: false };
    };
    const plotMove = (event: PointerEvent) => {
      pointer.s = timeAt(plotEl, event.clientX);
      if (drag) {
        event.stopPropagation();
        return moveTo(event, plotEl);
      }
      if (event.buttons === 0) plotEl.style.cursor = edgeAt(event.clientX) ? "ew-resize" : "";
    };
    const plotUp = (event: PointerEvent) => {
      if (!drag) return;
      event.stopPropagation();
      const ended = finish();
      if (ended && !ended.moved) pick(ended.id);
    };
    const plotLeave = () => {
      pointer.s = null;
      plotEl.style.cursor = "";
    };
    const doubleClick = (event: MouseEvent) => {
      if ((event.target as Element).closest("button")) return;
      annotate(timeAt(plotEl, event.clientX));
    };
    const cancel = () => {
      setDraft(null);
      drag = null;
    };

    rulerEl.addEventListener("pointerdown", rulerDown);
    rulerEl.addEventListener("pointermove", rulerMove);
    rulerEl.addEventListener("pointerup", rulerUp);
    rulerEl.addEventListener("pointercancel", cancel);
    rulerEl.addEventListener("pointerleave", hideTip);
    plotEl.addEventListener("pointerdown", plotDown, true);
    plotEl.addEventListener("pointermove", plotMove, true);
    plotEl.addEventListener("pointerup", plotUp, true);
    plotEl.addEventListener("pointercancel", cancel, true);
    plotEl.addEventListener("pointerleave", plotLeave);
    plotEl.addEventListener("dblclick", doubleClick);
    return () => {
      cancel();
      hideTip();
      pointer.s = null;
      rulerEl.removeEventListener("pointerdown", rulerDown);
      rulerEl.removeEventListener("pointermove", rulerMove);
      rulerEl.removeEventListener("pointerup", rulerUp);
      rulerEl.removeEventListener("pointercancel", cancel);
      rulerEl.removeEventListener("pointerleave", hideTip);
      plotEl.removeEventListener("pointerdown", plotDown, true);
      plotEl.removeEventListener("pointermove", plotMove, true);
      plotEl.removeEventListener("pointerup", plotUp, true);
      plotEl.removeEventListener("pointercancel", cancel, true);
      plotEl.removeEventListener("pointerleave", plotLeave);
      plotEl.removeEventListener("dblclick", doubleClick);
    };
  }, [plot, ruler, tip, flags, recordingId]);
}
