// The session a reload restores. The lists (recent recordings, history) come from IndexedDB on startup; this adds
// the side panels, set before the first render, the active result, set once the history is listed and the first
// frame is painted (its views are the heavy part), and the view of a recording, applied when that recording opens
// again. It is small and needed before the first render, as the theme is: localStorage, written as the page goes,
// one per window (windows.ts).
import { preload } from "../features/results/loads";
import { activeRecording, openResult, setView, useStore, type View } from "./store";
import { sessionKey } from "./windows";

interface Session {
  panels: { library: boolean; inspector: boolean };
  activeResultId: string | null;
  /** The view of the recording with `fingerprint`; the calibration has a setting of its own. */
  view?: Omit<View, "mmPerCssMm"> & { fingerprint: string };
}

function stored(): Partial<Session> {
  try {
    return JSON.parse(localStorage.getItem(sessionKey()) ?? "{}");
  } catch {
    return {};
  }
}

function save() {
  const state = useStore.getState();
  const recording = activeRecording(state);
  const { mmPerCssMm: _, ...view } = state.view;
  const session: Session = {
    panels: state.panels,
    activeResultId: state.activeResultId,
    view: recording ? { ...view, fingerprint: recording.fingerprint } : stored().view,
  };
  try {
    localStorage.setItem(sessionKey(), JSON.stringify(session));
  } catch {}
}

/** Restores the window's session, once it has its id; `listed` resolves once the history is in the store. */
export function restoreSession(listed: Promise<unknown>) {
  const saved = stored();
  if (saved.panels) {
    const { library, inspector } = saved.panels;
    useStore.setState({ panels: { library: library !== false, inspector: inspector !== false } });
  }
  const resultId = saved.activeResultId;
  if (resultId) {
    // Its view loads while the history is listed.
    preload(resultId);
    const hydrate = () => {
      const { analyses, activeResultId } = useStore.getState();
      if (activeResultId === null && analyses.some((a) => a.id === resultId && a.status === "complete")) {
        openResult(resultId);
      }
    };
    void listed.then(() => requestAnimationFrame(() => setTimeout(hydrate)));
  }
  let pending = saved.view;
  useStore.subscribe((now, before) => {
    if (!pending || now.activeRecordingId === before.activeRecordingId) return;
    if (activeRecording(now)?.fingerprint !== pending.fingerprint) return;
    const { fingerprint: _, ...view } = pending;
    pending = undefined;
    setView(view);
  });
  addEventListener("pagehide", save);
}
