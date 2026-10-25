import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { droppedFiles } from "../core/sources";
import type { RecentEntry } from "../store/recent";
import { useStore } from "../store/store";
import { forget, type Outcome, openFiles, pickFiles, reopen } from "./recordings";

/** The files of one attempt to open, kept for when the user chooses among several recordings. */
interface Attempt {
  files: File[];
  handle?: FileSystemHandle;
  expect?: string;
}

export function Open() {
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
    setOutcome(await openFiles(next.files, { ...next, choice }));
    setOpening(false);
  }
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void run({ files, expect: locating.current });
    locating.current = undefined;
  };
  async function chooseFiles(expect?: string) {
    locating.current = expect;
    const chosen = await pickFiles().catch(() => null); // null: the user closed the picker
    if (chosen === undefined) return filesInput.current?.click();
    locating.current = undefined;
    if (chosen) await run({ ...chosen, expect });
  }
  function openFolder() {
    locating.current = undefined;
    folderInput.current?.click();
  }
  async function dropped(event: DragEvent) {
    event.preventDefault();
    locating.current = undefined;
    await run(await droppedFiles(event.dataTransfer));
  }
  async function open(entry: RecentEntry) {
    if (!entry.handle) return chooseFiles(entry.fingerprint);
    setOpening(true);
    setOutcome(await reopen({ ...entry, handle: entry.handle }));
    setOpening(false);
  }

  return (
    <>
      <section aria-label="Drop zone" onDragOver={(event) => event.preventDefault()} onDrop={dropped}>
        <p>Drop a recording, or the folder that contains it, here.</p>
        <button type="button" onClick={() => chooseFiles()}>
          Open files
        </button>{" "}
        <button type="button" onClick={() => openFolder()}>
          Open folder
        </button>
        <input ref={filesInput} type="file" multiple hidden aria-label="Recording files" onChange={picked} />
        <input
          ref={folderInput}
          type="file"
          hidden
          aria-label="Recording folder"
          onChange={picked}
          {...{ webkitdirectory: "" }}
        />
      </section>
      <Notice
        outcome={outcome}
        opening={opening}
        onChoose={(choice) => run(attempt.current, choice)}
        onFolder={openFolder}
      />
      <Recent entries={recent} onOpen={open} />
    </>
  );
}

function Notice(props: {
  outcome: Outcome | null;
  opening: boolean;
  onChoose(choice: string): void;
  onFolder(): void;
}) {
  const { outcome } = props;
  if (props.opening) return <p aria-live="polite">Opening</p>;
  if (outcome?.kind === "error") {
    return (
      <div role="alert">
        <p>{outcome.message}</p>
        {outcome.folder && (
          <button type="button" onClick={props.onFolder}>
            Open the folder that contains it.
          </button>
        )}
      </div>
    );
  }
  if (outcome?.kind === "choose") {
    return (
      <fieldset>
        <legend>Several recordings found</legend>
        {outcome.candidates.map((path) => (
          <button type="button" key={path} onClick={() => props.onChoose(path)}>
            {path}
          </button>
        ))}
      </fieldset>
    );
  }
  return outcome?.kind === "opened" && outcome.warning ? <p role="alert">{outcome.warning}</p> : null;
}

function Recent(props: { entries: RecentEntry[]; onOpen(entry: RecentEntry): void }) {
  if (props.entries.length === 0) return null;
  return (
    <section aria-label="Recent recordings">
      <h2>Recent</h2>
      <ul>
        {props.entries.map((entry) => (
          <li key={entry.fingerprint}>
            {entry.names.join(", ")}{" "}
            <button type="button" onClick={() => props.onOpen(entry)}>
              {entry.handle ? `Reopen ${entry.primary}` : `Locate ${entry.primary}`}
            </button>{" "}
            {!entry.handle && "Select the file again to reopen it. "}
            <button type="button" onClick={() => forget(entry)}>
              {`Forget ${entry.primary}`}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
