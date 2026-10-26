// A batch in the history: when it ran, its settings and how it stands, opened to show its results (ordinary rows),
// the recordings that failed with their reasons, the combined export and, for a batch cut short, Resume. Resume reads
// the folder again through its handle where the browser kept one, else asks for the folder once more on the same
// button. Once the batch resumes, its row takes the focus the button had.
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import { type ChangeEvent, type ReactNode, useId, useRef, useState } from "react";
import { exportBatch, reattach } from "../../app/batch";
import { type BatchRecord, batchOutcome, settingsLine } from "../../core/batch";
import type { FolderSource } from "../../core/folder";
import { useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import rail from "../library/LibraryRail.module.css";
import styles from "./History.module.css";

type DirectoryPicker = (options: { mode: "read" }) => Promise<FileSystemDirectoryHandle>;

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export function BatchEntry(props: {
  batch: BatchRecord;
  /** The rows of its results. */
  children: ReactNode;
  when: ReactNode;
  onResume(source: FolderSource, batch: string): void;
}) {
  const { batch } = props;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [choose, setChoose] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean }>();
  const busy = useStore((s) => s.batch?.status === "running" || s.run?.status === "running");
  const folderInput = useRef<HTMLInputElement>(null);
  const head = useRef<HTMLButtonElement>(null);
  const failures = batch.results.filter((r) => r.status === "error");
  const ok = batch.results.length - failures.length;
  const resumable = batch.status === "interrupted" || batch.status === "cancelled";
  const name = `${batch.form.variants.join(" ")} on ${batch.root || "a folder"}`;

  async function save() {
    setNote(undefined);
    try {
      if (await exportBatch(batch)) setNote({ text: "Saved", error: false });
    } catch (failure) {
      setNote({
        text: `The export failed: ${failure instanceof Error ? failure.message : failure}`,
        error: true,
      });
    }
  }
  // The button goes once the batch runs again.
  const resumeOn = (source: FolderSource) => {
    setChoose(false);
    head.current?.focus();
    props.onResume(source, batch.id);
  };
  async function resume() {
    setNote(undefined);
    const handle = await reattach(batch);
    if (handle) resumeOn({ kind: "handle", handle });
    else setChoose(true);
  }
  function chosen(source: FolderSource, folder: string) {
    if (batch.root && folder !== batch.root) {
      return setNote({ text: `That folder is ${folder}. The batch ran on ${batch.root}.`, error: true });
    }
    resumeOn(source);
  }
  async function chooseFolder() {
    const pick = (window as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
    if (!pick) return folderInput.current?.click();
    const handle = await pick({ mode: "read" }).catch(() => null); // null: the user closed the picker
    if (handle) chosen({ kind: "handle", handle }, handle.name);
  }
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) chosen({ kind: "files", files }, files[0].webkitRelativePath.split("/")[0]);
  };

  return (
    <li data-appear>
      <button
        ref={head}
        type="button"
        className={rail.entry}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span className={styles.batchName}>
          <ChevronRight aria-hidden className={styles.chevron} />
          <span className={rail.entryName}>{name}</span>
        </span>
        <span className={`${rail.entryMeta} ${styles.indent}`}>
          <span className={failures.length > 0 ? styles.failed : undefined}>{batchOutcome(batch)}</span>
          <span className={rail.thin} aria-hidden />
          {props.when}
        </span>
        <span className={styles.settingsLine}>Batch of {settingsLine(batch)}</span>
      </button>
      <div id={id} className={styles.batchBody} hidden={!open}>
        {ok > 0 && <ul aria-label={`Results of ${name}`}>{props.children}</ul>}
        {failures.length > 0 && (
          <ul aria-label="Failed recordings" className={styles.failures}>
            {failures.map((failure) => (
              <li key={failure.path} title={failure.path}>
                <span className={styles.fileName}>{fileName(failure.path)}</span>
                <span className={styles.failed}>{failure.error}</span>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.actions}>
          {ok > 0 && (
            <button type="button" className={controls.button} onClick={save}>
              <Download aria-hidden />
              Export batch
            </button>
          )}
          {resumable && (
            // One button: its label and action follow the step, and focus stays on it.
            <button
              type="button"
              className={controls.button}
              disabled={busy}
              onClick={choose ? chooseFolder : resume}
            >
              {choose ? "Choose the folder again" : "Resume"}
            </button>
          )}
        </div>
        {choose && (
          <p className={styles.note}>
            Choose {batch.root || "the folder"} again to run its {batch.paths.length - batch.results.length}{" "}
            remaining recordings.
          </p>
        )}
        {note && (
          <p role={note.error ? "alert" : "status"} className={note.error ? styles.error : styles.note}>
            {note.text}
          </p>
        )}
        <input
          ref={folderInput}
          type="file"
          hidden
          aria-label={`Folder of ${name}`}
          onChange={picked}
          {...{ webkitdirectory: "" }}
        />
      </div>
    </li>
  );
}
