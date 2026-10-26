// The batch in the Folder section: "Run on all N" and its panel (the settings it takes, the channel rule, the
// interval, Start), then the batch's progress in place of the panel, and the marks of the tree rows.
import { Popover } from "@base-ui/react/popover";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ListChecks from "lucide-react/dist/esm/icons/list-checks.mjs";
import Play from "lucide-react/dist/esm/icons/play.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import { use, useId, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { variants } from "../../app/analyses";
import { cancelBatch, startBatch } from "../../app/batch";
import { batchOutcome, type Mark } from "../../core/batch";
import type { FolderRecording } from "../../core/folder";
import type { RecordingInfo } from "../../core/types";
import { activeRecording, type State, togglePanel, useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import { STANDARD, validateRequest } from "../analysis/validate";
import styles from "./Batch.module.css";
import { recordingOf, useRunPercent } from "./BatchStatus";

/** A recording of two samples at 1 Hz: the settings checked on it fail only for the settings themselves. */
const PROBE = { sample_rate_hz: 1, sample_count: 2, input_files: [""] } as RecordingInfo;

/** The labels of the active recording's chosen channels. */
const selectedLabels = (s: State) => {
  const recording = activeRecording(s);
  return (
    recording?.selectedChannels.map((i) => recording.info.channels[recording.analysis_channels[i]].label) ??
    []
  );
};

export function BatchAction(props: {
  recordings: FolderRecording[];
  root: string;
  handle?: FileSystemDirectoryHandle;
}) {
  const running = useStore((s) => s.batch?.status === "running");
  const [open, setOpen] = useState(false);
  // Where focus goes once the panel closes: the DDA settings or the batch's progress, else back to the trigger.
  const next = useRef<string | null>(null);
  const n = props.recordings.length;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        if (value) next.current = null;
        setOpen(value);
      }}
    >
      <Popover.Trigger className={`${controls.quiet} ${styles.action}`} disabled={running || n === 0}>
        <ListChecks aria-hidden />
        Run on all {n}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start">
          <Popover.Popup
            className={controls.panel}
            finalFocus={() => (next.current && document.querySelector<HTMLElement>(next.current)) || true}
          >
            <BatchPanel
              {...props}
              onClose={(focus) => {
                next.current = focus;
                setOpen(false);
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function BatchPanel(props: {
  recordings: FolderRecording[];
  root: string;
  handle?: FileSystemDirectoryHandle;
  onClose(focus: string): void;
}) {
  const { recordings } = props;
  const id = useId();
  const form = useStore((s) => s.ddaForm);
  const metadata = use(variants);
  const labels = useStore(useShallow(selectedLabels));
  const open = useStore((s) => s.activeRecordingId !== null);
  const busy = useStore((s) => s.run?.status === "running");
  const [rule, setRule] = useState<"signal" | "labels">("signal");
  const [whole, setWhole] = useState(true);
  const [range, setRange] = useState({ start: "0", end: "10" });

  const chosen = metadata.filter((v) => form.variants.includes(v.abbreviation));
  const probe = { ...form, variants: chosen, channels: [0, 1], startS: 0, endS: 1 };
  const formError = Object.values(validateRequest(probe, PROBE).errors)[0];
  const [startS, endS] = [Number(range.start), Number(range.end)];
  const typed = range.start.trim() !== "" && range.end.trim() !== "";
  const rangeError =
    !whole && !(typed && startS >= 0 && endS > startS)
      ? "Type the start and the end in seconds, the end after the start"
      : undefined;
  const labelsError =
    rule === "labels" && labels.length === 0 ? "Choose channels of an open recording first" : undefined;
  const reason =
    (formError && `The DDA settings: ${formError}`) ??
    labelsError ??
    rangeError ??
    (busy ? "Another recording's run is in progress." : undefined);
  const model = form.expert
    ? `Delays ${form.delays}, terms ${form.modelTerms}, dimension ${form.dm}, order ${form.order}`
    : `Standard, delays ${STANDARD.delays.join(" ")}`;

  function start() {
    void startBatch(
      {
        root: props.root,
        handle: props.handle,
        channels: rule === "signal" ? { kind: "signal" } : { kind: "labels", labels },
        interval: whole ? { kind: "whole" } : { kind: "range", startS, endS },
      },
      recordings,
    );
    props.onClose("[data-batch-cancel]");
  }
  function changeSettings() {
    if (!useStore.getState().panels.inspector) togglePanel("inspector");
    props.onClose("[data-dda-settings]");
  }

  return (
    <div className={styles.panel}>
      <Popover.Title className={styles.title}>
        Run on all {recordings.length} {recordings.length === 1 ? "recording" : "recordings"}
      </Popover.Title>
      <Popover.Description className={styles.note}>
        One recording at a time. Each result goes to the history.
      </Popover.Description>
      <section aria-labelledby={`${id}-settings`} className={styles.group}>
        <h3 id={`${id}-settings`} className={styles.legend}>
          DDA settings
        </h3>
        <dl className={styles.fields}>
          <dt>Variants</dt>
          <dd>{form.variants.join(" ") || "None"}</dd>
          <dt>Window</dt>
          <dd>
            {form.windowLength} samples, step {form.windowStep}
          </dd>
          <dt>Model</dt>
          <dd>{model}</dd>
        </dl>
        {open ? (
          <button type="button" className={`${controls.quiet} ${styles.link}`} onClick={changeSettings}>
            Change them in the inspector
          </button>
        ) : (
          <p className={styles.note}>Open a recording to change them in the inspector.</p>
        )}
      </section>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Channels</legend>
        <label className={styles.choice}>
          <input
            type="radio"
            name={`${id}-channels`}
            checked={rule === "signal"}
            onChange={() => setRule("signal")}
          />
          <span>
            Signal channels
            <span className={styles.note}>The good ones where channels.tsv rates them, else all</span>
          </span>
        </label>
        <label className={styles.choice}>
          <input
            type="radio"
            name={`${id}-channels`}
            checked={rule === "labels"}
            onChange={() => setRule("labels")}
          />
          <span>
            Channels named like the current selection
            <span className={styles.note}>
              {labels.length > 0 ? labels.join(", ") : "No channels are selected"}
            </span>
          </span>
        </label>
      </fieldset>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Interval</legend>
        <label className={styles.choice}>
          <input type="radio" name={`${id}-interval`} checked={whole} onChange={() => setWhole(true)} />
          <span>Whole recording</span>
        </label>
        <div className={styles.choice}>
          <input
            id={`${id}-range`}
            type="radio"
            name={`${id}-interval`}
            aria-label="From start to end in seconds, clipped to each recording"
            checked={!whole}
            onChange={() => setWhole(false)}
          />
          <span className={styles.range}>
            <label htmlFor={`${id}-range`}>From</label>
            {(["start", "end"] as const).map((field) => (
              <span key={field} className={styles.unitInput}>
                <input
                  aria-label={field === "start" ? "Start in seconds" : "End in seconds"}
                  inputMode="decimal"
                  value={range[field]}
                  aria-invalid={rangeError ? true : undefined}
                  onFocus={() => setWhole(false)}
                  onChange={(event) => setRange({ ...range, [field]: event.target.value })}
                />
                <span aria-hidden>s</span>
              </span>
            ))}
          </span>
        </div>
        <p className={styles.note}>An interval past a recording's end stops at it, with a warning.</p>
      </fieldset>
      {reason && (
        <p className={styles.reason} data-appear>
          {reason}
        </p>
      )}
      <button
        type="button"
        className={`${controls.primary} ${styles.start}`}
        disabled={!!reason}
        onClick={start}
      >
        <Play aria-hidden />
        Start
      </button>
    </div>
  );
}

const MARK: Record<Mark, { word: string; Icon: typeof Check }> = {
  done: { word: "Done", Icon: Check },
  failed: { word: "Failed", Icon: X },
  running: { word: "Running", Icon: Play },
};

/** A tree row's batch mark: an icon and its word, the color only repeating the word. */
export function RowMark({ mark }: { mark: Mark }) {
  const { word, Icon } = MARK[mark];
  return (
    <span className={styles.mark} data-mark={mark}>
      <Icon aria-hidden />
      {word}
    </span>
  );
}

/** The batch of this page in the Folder section: how far it is while it runs, then how it ended. */
export function BatchProgressView() {
  const batch = useStore((s) => s.batch);
  const record = useStore((s) => s.batches.find((b) => b.id === s.batch?.id));
  const bar = useRef<HTMLProgressElement>(null);
  const percent = useRef<HTMLSpanElement>(null);
  useRunPercent(bar, percent);
  if (!batch) return null;
  const marks = Object.values(batch.marks);
  const done = marks.filter((m) => m === "done").length;
  const failed = marks.filter((m) => m === "failed").length;
  const recording = recordingOf(batch);
  if (!recording) {
    const outcome = !record
      ? "Batch ended."
      : record.status === "complete"
        ? `Batch finished: ${batchOutcome(record)}.`
        : `Batch stopped: ${batchOutcome(record).toLowerCase()}.`;
    return (
      <p key="ended" className={styles.ended} data-appear>
        <Check aria-hidden />
        <span>{outcome} The results are in the history.</span>
      </p>
    );
  }
  return (
    <section key="running" aria-label="Batch progress" className={styles.progress} data-appear>
      <div className={styles.line}>
        <b>{recording}</b>
        <button type="button" className={controls.button} data-batch-cancel onClick={cancelBatch}>
          Cancel
        </button>
      </div>
      <p className={styles.file} title={batch.name}>
        {batch.name}
      </p>
      <div className={styles.line}>
        <progress ref={bar} aria-label="Current recording" max={100} value={0} />
        <span ref={percent} className={styles.percent} />
      </div>
      <p className={styles.note}>
        {done} finished, {failed} failed
      </p>
    </section>
  );
}
