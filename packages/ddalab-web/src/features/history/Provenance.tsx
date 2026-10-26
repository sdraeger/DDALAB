// The provenance of the active result: what was asked of which files, the engine that ran it, the plan and the
// timings, and the CLI command that writes the same bundle natively. Until the manifest records the input files'
// digests, the open recording's hash worker says how far it has come. A result without a manifest (running, failed,
// interrupted) names no engine: this page's engine need not be the one that ran it.
import { Popover } from "@base-ui/react/popover";
import Copy from "lucide-react/dist/esm/icons/copy.mjs";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import { lazy, Suspense, useState } from "react";
import { deleteResult } from "../../app/analyses";
import { inTransition } from "../../app/viewTransition";
import { cliCommand } from "../../core/cliCommand";
import { type AnalysisRecord, resultName } from "../../core/history";
import { openResult, useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import styles from "./History.module.css";
import { ResultBoundary } from "./ResultBoundary";

const ExportDialog = lazy(() => import("./ExportDialog"));

/**
 * Keyboard focus once the provenance closes: the result's history row, else (it was deleted) the history heading.
 * The rows and the heading are HistoryRail's.
 */
const focusHistory = (id: string) =>
  requestAnimationFrame(() =>
    (
      document.querySelector<HTMLElement>(`[data-result="${id}"]`) ??
      document.getElementById("history-heading")
    )?.focus(),
  );

const count = (n: number, word: string) => `${n.toLocaleString("en")} ${word}${n === 1 ? "" : "s"}`;
const when = (time: number) =>
  new Date(time).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
const seconds = (s: number) => `${Number(s.toFixed(3))} s`;

const STATUS: Record<Exclude<AnalysisRecord["status"], "complete">, string> = {
  running: "Running.",
  interrupted: "Interrupted by a reload or a crash; its files were deleted.",
  failed: "The run failed",
};

export default function Provenance() {
  const id = useStore((s) => s.activeResultId);
  const close = (
    <button type="button" className={controls.quiet} onClick={() => inTransition(() => openResult(null))}>
      Close the result
    </button>
  );
  return (
    <ResultBoundary key={id} what="This result" action={close}>
      <Details />
    </ResultBoundary>
  );
}

function Details() {
  const record = useStore((s) => s.analyses.find((a) => a.id === s.activeResultId));
  if (!record) return null;
  const { request, manifest, plan } = record;
  const reproduction = manifest?.reproduction;
  const model = request.model_parameters;
  // An imported result knows its files by digest only; its manifest says when the CLI ran it.
  const imported = record.fingerprint === "";
  const started = imported && manifest ? Date.parse(manifest.created_at_iso) : record.createdAt;
  const listed = (parts: (string | false | undefined)[]) => parts.filter(Boolean).join(", ");
  return (
    <section aria-label="Provenance" className={styles.provenance}>
      <header className={styles.header}>
        <h2 className={styles.title}>{resultName(record)}</h2>
        <Actions record={record} />
      </header>
      {record.status !== "complete" && (
        <p
          key={record.status}
          role={record.status === "failed" ? "alert" : undefined}
          className={record.status === "failed" ? styles.error : styles.note}
          data-appear
        >
          {STATUS[record.status]}
          {record.error && `: ${record.error}`}
        </p>
      )}
      <dl className={styles.fields}>
        <dt>Channels</dt>
        <dd>{reproduction?.selected_channel_names.join(", ") ?? request.channels?.join(", ")}</dd>
        <dt>Interval</dt>
        <dd>
          {reproduction &&
            `${seconds(reproduction.start_time_seconds)} to ${seconds(reproduction.end_time_seconds)}, `}
          samples {request.time_range.start} to {request.time_range.end}
        </dd>
        <dt>Window</dt>
        <dd>
          {count(request.window_parameters.window_length, "sample")}, step{" "}
          {request.window_parameters.window_step}
        </dd>
        <dt>Delays</dt>
        <dd>{request.delay_parameters.delays.join(", ")}</dd>
        <dt>Model</dt>
        <dd>
          {listed([
            request.model_terms && `terms ${request.model_terms.join(" ")}`,
            model && `dimension ${model.dm}`,
            model && `order ${model.order}`,
            model && `${model.nr_tau} delays used`,
          ])}
        </dd>
        <EngineFields record={record} />
        {plan && (
          <>
            <dt>Plan</dt>
            <dd>
              {listed([
                count(plan.windows, "window"),
                plan.blocks !== undefined && count(plan.blocks, "block"),
                plan.workers !== undefined && count(plan.workers, "worker"),
              ])}
            </dd>
          </>
        )}
        <dt>Run</dt>
        <dd>
          {when(started)}
          {record.finishedAt && `, took ${seconds((record.finishedAt - record.createdAt) / 1000)}`}
          {imported && " by the CLI, imported"}
        </dd>
      </dl>
      <h3 className={styles.subheading}>Input files</h3>
      <InputFiles record={record} />
      {manifest && manifest.diagnostics.length > 0 && (
        <ul aria-label="Diagnostics" className={styles.diagnostics}>
          {manifest.diagnostics.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <h3 className={styles.subheading}>CLI command</h3>
      <Command record={record} />
    </section>
  );
}

/** Export, delete (once confirmed) and close; a running result can only be closed. */
function Actions({ record }: { record: AnalysisRecord }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = () =>
    deleteResult(record.id).then(
      () => focusHistory(record.id),
      (failure: unknown) =>
        setError(`The result could not be deleted: ${failure instanceof Error ? failure.message : failure}`),
    );
  if (confirming) {
    return (
      <>
        {/* Keyed: the row mounts anew and Keep takes focus, where React would reuse the Close button. */}
        <div className={styles.actions} key="confirm" data-appear>
          <span className={styles.confirm}>Delete this result and its files?</span>
          <button type="button" className={controls.quiet} onClick={remove}>
            Delete
          </button>
          {/* biome-ignore lint/a11y/noAutofocus: the safe answer takes focus when the question appears */}
          <button type="button" className={controls.quiet} autoFocus onClick={() => setConfirming(false)}>
            Keep
          </button>
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </>
    );
  }
  return (
    <div className={styles.actions} data-appear>
      <Popover.Root>
        <Popover.Trigger className={controls.button} disabled={record.status !== "complete"}>
          <Download aria-hidden />
          Export
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={6} align="start">
            <Popover.Popup className={controls.panel}>
              <Suspense fallback={null}>
                <ExportDialog record={record} />
              </Suspense>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <button
        type="button"
        className={controls.quiet}
        disabled={record.status === "running"}
        onClick={() => setConfirming(true)}
      >
        Delete
      </button>
      <button
        type="button"
        className={`${controls.quiet} ${styles.close}`}
        onClick={() => {
          inTransition(() => openResult(null));
          focusHistory(record.id);
        }}
      >
        Close
      </button>
    </div>
  );
}

function EngineFields({ record }: { record: AnalysisRecord }) {
  if (!record.manifest) return null;
  const { engine_version, git_commit } = record.manifest.reproduction;
  return (
    <>
      <dt>Engine</dt>
      <dd>{engine_version}</dd>
      <dt>Commit</dt>
      <dd>
        {git_commit ? <code className={styles.digest}>{git_commit}</code> : "not recorded in this build"}
      </dd>
    </>
  );
}

/** Each input file and its SHA-256: from the manifest, else from the open recording, hashed so far. */
function InputFiles({ record }: { record: AnalysisRecord }) {
  const recording = useStore((s) =>
    record.fingerprint
      ? Object.values(s.recordings).find((r) => r.fingerprint === record.fingerprint)
      : undefined,
  );
  const recorded = record.manifest?.reproduction.input_sha256;
  const names = recorded ? Object.keys(recorded) : (recording?.info.input_files ?? []);
  if (names.length === 0) {
    return (
      <p className={styles.note}>
        {recorded ? "The input files were not hashed." : "Open the recording to hash its files."}
      </p>
    );
  }
  return (
    <ul className={styles.files}>
      {names.map((name) => {
        const sha256 = recorded?.[name] ?? recording?.scan.sha256?.[name];
        const hashed = recording?.scan.hashed?.[name] ?? 0;
        return (
          <li key={name}>
            <span className={styles.fileName}>{name}</span>
            {sha256 ? (
              <code className={styles.digest} data-appear>
                {sha256}
              </code>
            ) : (
              <span className={styles.note}>hashing {Math.floor(100 * hashed)}%</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Command({ record }: { record: AnalysisRecord }) {
  const command = cliCommand(record.request, record.fileName);
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = () =>
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(command))
      .then(
        () => setCopied(true),
        () => setCopied(false),
      );
  return (
    <>
      <pre className={styles.command}>{command}</pre>
      <div className={styles.copy}>
        <button type="button" className={controls.button} onClick={copy}>
          <Copy aria-hidden />
          Copy command
        </button>
        <span className={styles.note} aria-live="polite">
          {copied === true && "Copied"}
          {copied === false && "The browser did not allow copying; select the command instead."}
        </span>
      </div>
      <p className={styles.note}>Run it in the folder that holds {record.fileName}.</p>
    </>
  );
}
