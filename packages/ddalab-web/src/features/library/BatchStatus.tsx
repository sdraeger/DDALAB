// The batch in the command bar's run-status slot: which recording of how many and its run's percent, while it runs.
// Its words for screen readers come from the shell, which the page always shows (BatchAnnouncer): each recording as it
// starts, politely, and once how the batch ended, assertively.
import { type RefObject, useEffect, useRef } from "react";
import { type State, useStore } from "../../store/store";
import styles from "./Batch.module.css";

/** The percent of the batch's current run, from the store's run progress. */
const percentOf = (s: State) => {
  const p = s.run?.progress;
  return p && p.windows > 0 ? Math.floor((100 * p.windowsDone) / p.windows) : 0;
};

/** Keeps `bar` and `text` on the percent of the current run, which reports every block, without a render. */
export function useRunPercent(
  bar: RefObject<HTMLProgressElement | null>,
  text: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const show = (s: State) => {
      const percent = percentOf(s);
      if (bar.current) bar.current.value = percent;
      if (text.current) text.current.textContent = `${percent}%`;
    };
    show(useStore.getState());
    return useStore.subscribe(show);
  }, [bar, text]);
}

/** "Recording 3 of 12" of the batch running, or `undefined`. */
export const recordingOf = (batch: State["batch"]) => {
  if (batch?.status !== "running") return undefined;
  const finished = Object.values(batch.marks).filter((m) => m !== "running").length;
  return `Recording ${Math.min(batch.total, finished + 1)} of ${batch.total}`;
};

export function BatchStatus() {
  const batch = useStore((s) => s.batch);
  const percent = useRef<HTMLSpanElement>(null);
  const none = useRef<HTMLProgressElement>(null);
  useRunPercent(none, percent);
  const recording = recordingOf(batch);
  return recording ? (
    <span className={styles.barStatus} data-appear title={`${recording}, ${batch?.name}`}>
      {recording.replace("Recording", "Batch")}, <span ref={percent} />
    </span>
  ) : null;
}

export function BatchAnnouncer() {
  const batch = useStore((s) => s.batch);
  const outcome = useStore((s) => {
    const record = s.batch && s.batch.status !== "running" && s.batches.find((b) => b.id === s.batch?.id);
    if (!record) return "";
    const failed = record.results.filter((r) => r.status === "error").length;
    const of = `${record.results.length - failed} of ${record.paths.length} finished`;
    return `The batch ${record.status === "cancelled" ? "was cancelled" : "ended"}: ${of}, ${failed} failed.`;
  });
  const recording = recordingOf(batch);
  return (
    <>
      <span className={styles.announce} aria-live="polite">
        {recording && `${recording}, ${batch?.name}`}
      </span>
      <span className={styles.announce} aria-live="assertive">
        {outcome}
      </span>
    </>
  );
}
