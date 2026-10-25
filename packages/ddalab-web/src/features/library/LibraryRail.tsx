// The library rail: opening recordings (picker, folder, drop anywhere in the window), the open ones, the recent ones.
import FilePlus from "lucide-react/dist/esm/icons/file-plus.mjs";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open.mjs";
import { type ChangeEvent, Suspense, use, useEffect, useEffectEvent, useRef, useState } from "react";
import {
  canPickFiles,
  engine,
  forget,
  type Outcome,
  openFiles,
  pickFiles,
  reopen,
} from "../../app/recordings";
import { droppedFiles } from "../../core/sources";
import type { RecentEntry } from "../../store/recent";
import { activateRecording, useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import styles from "./LibraryRail.module.css";

const version = engine.version().then(
  (v) => v.engine_version,
  (error: Error) => `failed: ${error.message}`,
);

/** The files of one attempt to open, kept for when the user chooses among several recordings. */
interface Attempt {
  files: File[];
  handle?: FileSystemHandle;
  expect?: string;
}

export function LibraryRail() {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [opening, setOpening] = useState(false);
  const recent = useStore((s) => s.recent);
  const attempt = useRef<Attempt>({ files: [] });
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  // The recording the next pick is meant to locate again.
  const locating = useRef<string | undefined>(undefined);

  async function run(next: Attempt, choice?: string) {
    attempt.current = next;
    setOpening(true);
    try {
      setOutcome(await openFiles(next.files, { ...next, choice }));
    } finally {
      setOpening(false);
    }
  }
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void run({ files, expect: locating.current });
    locating.current = undefined;
  };
  async function chooseFiles(expect?: string) {
    locating.current = expect;
    // The <input> opens only in the task of the click that asked for it, before any await.
    if (!canPickFiles()) return filesInput.current?.click();
    const chosen = await pickFiles().catch(() => null); // null: the user closed the picker
    locating.current = undefined;
    if (chosen) await run({ ...chosen, expect });
  }
  function openFolder() {
    locating.current = undefined;
    folderInput.current?.click();
  }
  async function open(entry: RecentEntry) {
    if (!entry.handle) return chooseFiles(entry.fingerprint);
    setOpening(true);
    setOutcome(await reopen({ ...entry, handle: entry.handle }));
    setOpening(false);
  }

  // Files dropped anywhere in the window open; without this the browser would replace the page with the file.
  const dropped = useEffectEvent(async (data: DataTransfer) => {
    locating.current = undefined;
    await run(await droppedFiles(data));
  });
  useEffect(() => {
    const over = (event: DragEvent) => event.preventDefault();
    const drop = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) void dropped(event.dataTransfer);
    };
    document.addEventListener("dragover", over);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragover", over);
      document.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <div className={styles.rail}>
      <section className={styles.section} aria-label="Drop zone">
        <div className={styles.actions}>
          <button type="button" className={controls.primary} onClick={() => chooseFiles()}>
            <FilePlus aria-hidden />
            Open files
          </button>
          <button type="button" className={controls.button} onClick={() => openFolder()}>
            <FolderOpen aria-hidden />
            Open folder
          </button>
        </div>
        <p className={styles.hint}>
          Or drop a recording, or the folder that holds it, anywhere in this window.
        </p>
        <input ref={filesInput} type="file" multiple hidden aria-label="Recording files" onChange={picked} />
        <input
          ref={folderInput}
          type="file"
          hidden
          aria-label="Recording folder"
          onChange={picked}
          {...{ webkitdirectory: "" }}
        />
        <Notice
          outcome={outcome}
          opening={opening}
          onChoose={(choice) => run(attempt.current, choice)}
          onFolder={openFolder}
        />
      </section>
      <OpenRecordings />
      <Recent entries={recent} onOpen={open} />
      <p className={styles.footer}>
        Engine{" "}
        <Suspense fallback={<output>loading</output>}>
          <EngineVersion />
        </Suspense>
      </p>
    </div>
  );
}

function EngineVersion() {
  return <output>{use(version)}</output>;
}

function Notice(props: {
  outcome: Outcome | null;
  opening: boolean;
  onChoose(choice: string): void;
  onFolder(): void;
}) {
  const { outcome } = props;
  if (props.opening) {
    return (
      <p className={styles.hint} aria-live="polite">
        Opening
      </p>
    );
  }
  if (outcome?.kind === "error") {
    return (
      <div role="alert" className={styles.error}>
        <p>{outcome.message}</p>
        {outcome.folder && (
          <button type="button" className={controls.quiet} onClick={props.onFolder}>
            Open the folder that contains it.
          </button>
        )}
      </div>
    );
  }
  if (outcome?.kind === "choose") {
    return (
      <fieldset className={styles.choose}>
        <legend>Several recordings found</legend>
        {outcome.candidates.map((path) => (
          <button type="button" className={controls.quiet} key={path} onClick={() => props.onChoose(path)}>
            {path}
          </button>
        ))}
      </fieldset>
    );
  }
  return outcome?.kind === "opened" && outcome.warning ? (
    <p role="alert" className={styles.error}>
      {outcome.warning}
    </p>
  ) : null;
}

function OpenRecordings() {
  const recordings = useStore((s) => s.recordings);
  const active = useStore((s) => s.activeRecordingId);
  const ids = Object.keys(recordings);
  if (ids.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="open-heading">
      <h2 id="open-heading" className={styles.heading}>
        Open <span className={styles.count}>{ids.length}</span>
      </h2>
      <ul className={styles.entries}>
        {ids.map((id) => (
          <li key={id}>
            <button
              type="button"
              className={styles.entry}
              aria-current={id === active ? "true" : undefined}
              onClick={() => activateRecording(id)}
            >
              <span className={styles.entryName}>{recordings[id].info.input_files[0]}</span>
              <span className={styles.entryMeta}>
                {recordings[id].info.format}
                <span className={styles.thin} aria-hidden />
                {recordings[id].analysis_channels.length} channels
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Recent(props: { entries: RecentEntry[]; onOpen(entry: RecentEntry): void }) {
  if (props.entries.length === 0) return null;
  return (
    <section className={styles.section} aria-label="Recent recordings">
      <h2 className={styles.heading}>
        Recent <span className={styles.count}>{props.entries.length}</span>
      </h2>
      <ul className={styles.entries}>
        {props.entries.map((entry) => (
          <li key={entry.fingerprint} className={styles.recent}>
            <span className={styles.entryName} title={entry.names.join(", ")}>
              {entry.primary}
            </span>
            {!entry.handle && <span className={styles.entryMeta}>Select the file again to reopen it. </span>}
            <span className={styles.recentActions}>
              <button
                type="button"
                className={controls.quiet}
                aria-label={`${entry.handle ? "Reopen" : "Locate"} ${entry.primary}`}
                onClick={() => props.onOpen(entry)}
              >
                {entry.handle ? "Reopen" : "Locate"}
              </button>
              <button
                type="button"
                className={controls.quiet}
                aria-label={`Forget ${entry.primary}`}
                onClick={() => forget(entry)}
              >
                Forget
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
