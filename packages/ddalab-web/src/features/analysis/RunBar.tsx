// The run bar at the foot of the inspector: the interval the run covers (typed here, or selected on the plots), the
// plan the core makes for it, Run and the run's progress, and how the last run ended.
import Check from "lucide-react/dist/esm/icons/check.mjs";
import Play from "lucide-react/dist/esm/icons/play.mjs";
import { use, useCallback, useEffect, useId, useMemo, useState } from "react";
import { cancelRun, startRun, variants } from "../../app/analyses";
import { engine } from "../../app/recordings";
import type { DDARequest } from "../../core/types";
import { type RunState, setSelection, useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import styles from "./Analysis.module.css";
import { validateRequest } from "./validate";

type Interval = { t0: number; t1: number };

/** The selection, else the view interval. */
const runInterval = (): Interval => {
  const { selection, view } = useStore.getState();
  return { t0: (selection ?? view).t0, t1: (selection ?? view).t1 };
};

/** The run interval once it has rested for 200 ms: a pan or a selection drag does not re-render what depends on it. */
function useRestingInterval(): Interval {
  const [interval, settle] = useState(runInterval);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = useStore.subscribe((now, last) => {
      if (now.selection === last.selection && now.view === last.view) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = runInterval();
        settle((old) => (old.t0 === next.t0 && old.t1 === next.t1 ? old : next));
      }, 200);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, []);
  return interval;
}

/**
 * The request of the settings, the chosen channels and the interval (the selection, else the view), or why not.
 * `now` builds it from the interval of this moment, which may not have rested yet: what Run sends.
 */
export function useRunRequest(recordingId: string) {
  const form = useStore((s) => s.ddaForm);
  const info = useStore((s) => s.recordings[recordingId]?.info);
  const channels = useStore((s) => s.recordings[recordingId]?.selectedChannels);
  const interval = useRestingInterval();
  const metadata = use(variants);
  const check = useCallback(
    ({ t0, t1 }: Interval) => {
      if (!info || !channels) return { errors: { recording: "The recording is closed" } };
      const chosen = metadata.filter((v) => form.variants.includes(v.abbreviation));
      return validateRequest({ ...form, variants: chosen, channels, startS: t0, endS: t1 }, info);
    },
    [form, info, channels, metadata],
  );
  const checked = useMemo(() => check(interval), [check, interval]);
  return { ...checked, interval, now: () => check(runInterval()).request };
}

/** Starts a run of the request of this moment. */
function runNow(recordingId: string, now: () => DDARequest | undefined) {
  const request = now();
  if (request) void startRun(recordingId, request);
}

const count = (n: number, word: string) => `${n.toLocaleString("en")} ${word}${n === 1 ? "" : "s"}`;

/** The core's plan of `request`, asked for once the settings rest; `null` until it answers. */
function usePlan(recordingId: string, request: DDARequest | undefined) {
  const [plan, setPlan] = useState<{ of: DDARequest; text: string; refused: boolean } | null>(null);
  useEffect(() => {
    if (!request) return;
    let live = true;
    const timer = setTimeout(() => {
      engine.plan(recordingId, request).then(
        (p) => {
          const text = `${count(p.windows, "window")}, ${count(p.blocks, "block")}, ${count(p.workers, "worker")}`;
          if (live) setPlan({ of: request, text, refused: false });
        },
        (error: Error) => live && setPlan({ of: request, text: error.message, refused: true }),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [recordingId, request]);
  return plan?.of === request ? plan : null;
}

export function RunBar({ recordingId }: { recordingId: string }) {
  const { request, errors, interval, now } = useRunRequest(recordingId);
  const plan = usePlan(recordingId, request);
  const run = useStore((s) => s.run);
  const duration = useStore((s) => s.recordings[recordingId]?.info.duration_s ?? 0);
  const ours = run?.recordingId === recordingId ? run : null;
  const busy = run?.status === "running";
  const reason = Object.values(errors)[0];
  return (
    <section aria-label="Run" className={styles.runBar}>
      <IntervalFields interval={interval} duration={duration} error={errors.range} />
      {reason ? (
        <p className={styles.note}>{reason}</p>
      ) : plan?.refused ? (
        <p role="alert" className={styles.error}>
          {plan.text}
        </p>
      ) : (
        <p className={styles.plan}>
          {plan ? (
            <>
              <b>Plan</b> {plan.text}
            </>
          ) : (
            "Planning"
          )}
        </p>
      )}
      {ours?.status === "running" ? (
        <Progress run={ours} />
      ) : (
        <button
          type="button"
          className={`${controls.primary} ${styles.run}`}
          // A plan still on its way does not hold Run back: the run makes its own.
          disabled={!request || plan?.refused || busy}
          onClick={() => runNow(recordingId, now)}
        >
          <Play aria-hidden />
          Run DDA
        </button>
      )}
      {busy && !ours && <p className={styles.note}>Another recording's run is in progress.</p>}
      {ours && <Outcome run={ours} />}
    </section>
  );
}

/** The command bar's Run: the run bar's request, without its plan. */
export function RunButton({ recordingId, status }: { recordingId: string; status: boolean }) {
  const { request, errors, now } = useRunRequest(recordingId);
  // With the inspector hidden, the run bar is too: this button says why it cannot run and how the run goes.
  const plan = usePlan(recordingId, status ? request : undefined);
  const run = useStore((s) => s.run);
  const ours = run?.recordingId === recordingId ? run : null;
  const busy = run?.status === "running";
  const [text, refused] = barStatus(
    ours,
    Object.values(errors)[0] ?? (plan?.refused ? plan.text : undefined),
  );
  return (
    <>
      {status && (
        <span
          className={styles.barStatus}
          data-refused={refused || undefined}
          title={text}
          aria-live="polite"
        >
          {text}
        </span>
      )}
      <button
        type="button"
        className={controls.primary}
        disabled={!request || busy || (status && plan?.refused)}
        onClick={() => runNow(recordingId, now)}
      >
        <Play aria-hidden />
        Run
      </button>
    </>
  );
}

/** The command bar's status: the run's progress, else why it cannot run, else how the last run failed. */
function barStatus(run: RunState | null, refusal: string | undefined): [text: string, refused: boolean] {
  if (run?.status === "running") {
    const { windowsDone, windows } = run.progress;
    return [windows === 0 ? "Starting" : `Running, ${Math.floor((100 * windowsDone) / windows)}%`, false];
  }
  if (refusal) return [refusal, true];
  return run?.status === "failed" ? [`The run failed: ${run.error}`, true] : ["", false];
}

const seconds = (t: number) => String(Number(t.toFixed(3)));

/** Start and end in seconds: typing them sets the selection, the keyboard's way to choose what to run on. */
function IntervalFields(props: { interval: Interval; duration: number; error?: string }) {
  const { interval, duration } = props;
  const id = useId();
  const [text, setText] = useState({ start: seconds(interval.t0), end: seconds(interval.t1), of: interval });
  const [typo, setTypo] = useState(false);
  // The selection or the view moved: the fields show it.
  if (text.of !== interval) {
    setText({ start: seconds(interval.t0), end: seconds(interval.t1), of: interval });
    setTypo(false);
  }
  const commit = () => {
    if (text.start === seconds(interval.t0) && text.end === seconds(interval.t1)) return;
    const t0 = Math.max(0, Number(text.start));
    const t1 = Math.min(duration, Number(text.end));
    const ok = text.start.trim() !== "" && text.end.trim() !== "" && t1 > t0;
    setTypo(!ok);
    if (ok) setSelection({ t0, t1 });
  };
  const error = typo ? "Type the start and the end in seconds, the end after the start" : props.error;
  const field = (name: "start" | "end", label: string) => (
    <div className={styles.timeField}>
      <label htmlFor={`${id}-${name}`}>{label}</label>
      <span className={styles.unitInput}>
        <input
          id={`${id}-${name}`}
          inputMode="decimal"
          value={text[name]}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => setText({ ...text, [name]: event.target.value })}
          onBlur={commit}
          onKeyDown={(event) => event.key === "Enter" && commit()}
        />
        <span aria-hidden>s</span>
      </span>
    </div>
  );
  return (
    <>
      <div className={styles.interval}>
        {field("start", "Start")}
        {field("end", "End")}
      </div>
      {error && (
        <p id={`${id}-error`} className={styles.fieldError}>
          {error}
        </p>
      )}
    </>
  );
}

function Progress({ run }: { run: RunState }) {
  const { blocksDone, blocks, windowsDone, windows, etaS } = run.progress;
  const left = etaS === null ? "" : `, about ${count(Math.ceil(etaS), "second")} left`;
  return (
    <div className={styles.progress}>
      <progress aria-label="Run progress" max={windows || 1} value={windowsDone} />
      <p className={styles.note} aria-live="polite">
        {blocks === 0
          ? "Starting"
          : `Block ${blocksDone} of ${blocks}, ${windowsDone.toLocaleString("en")} of ${count(windows, "window")}${left}`}
      </p>
      <button type="button" className={controls.button} onClick={cancelRun}>
        Cancel run
      </button>
    </div>
  );
}

function Outcome({ run }: { run: RunState }) {
  if (run.status === "complete") {
    return (
      <p className={styles.complete}>
        <Check aria-hidden />
        Complete
      </p>
    );
  }
  if (run.status === "failed") {
    return (
      <p role="alert" className={styles.error}>
        The run failed: {run.error}
      </p>
    );
  }
  return run.status === "cancelled" ? <p className={styles.note}>Cancelled</p> : null;
}
