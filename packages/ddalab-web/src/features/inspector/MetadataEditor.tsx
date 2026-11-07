// The metadata editor of the active recording: its recording fields and a table of its channels' columns, as the
// format stores them (dda-rs io/edit.rs). Save copy saves an edited copy; the original files stay as they are. One file saves as itself; several (BrainVision, an EEGLAB dataset's BrainVision copy, a BIDS
// `_channels.tsv`) save as one zip.
import { Dialog } from "@base-ui/react/dialog";
import { makeZip } from "client-zip";
import { useEffect, useState } from "react";
import { useDownload } from "../../app/download";
import { engine } from "../../app/recordings";
import type { Metadata, MetadataField } from "../../core/types";
import controls from "../../styles/controls.module.css";
import styles from "./MetadataEditor.module.css";

/** Formats whose copy is one file (unless a BIDS `_channels.tsv` comes along). */
const ONE_FILE = new Set(["EDF", "BDF", "ASCII", "CSV"]);

/** Why `value` cannot be stored in `field`, or `null`. */
function problemOf(field: MetadataField, value: string): string | null {
  if (field.max !== null && [...value].length > field.max) return `At most ${field.max} characters`;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused
  if (/[\u0000-\u001f\u007f]/.test(value)) return "No line breaks or tabs";
  if (field.ascii && /[^\x20-\x7e]/.test(value)) return "ASCII letters, digits and signs only";
  return null;
}

/** `name` without its directory, `-edited` before its extension (as dda-rs `copy_name`). */
const copyName = (name: string, extension?: string) => {
  const base = name.split(/[/\\]/).at(-1) ?? name;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return `${stem}-edited.${extension ?? (dot > 0 ? base.slice(dot + 1) : "")}`;
};

export default function MetadataEditor(props: { recordingId: string; fileName: string; sidecar: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={controls.button}>Edit metadata</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.popup}>
          {open && <Editor {...props} onDone={() => setOpen(false)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Editor(props: { recordingId: string; fileName: string; sidecar: boolean; onDone(): void }) {
  const [original, setOriginal] = useState<Metadata | null>(null);
  const [draft, setDraft] = useState<Metadata | null>(null);
  const { save: download, busy, error, setError } = useDownload();
  useEffect(() => {
    engine.metadata(props.recordingId).then(
      (metadata) => {
        setOriginal(metadata);
        setDraft(metadata);
      },
      (failure: Error) => setError(failure.message),
    );
  }, [props.recordingId, setError]);

  const name = props.fileName.split(/[/\\]/).at(-1) ?? props.fileName;
  if (!original || !draft) {
    return (
      <>
        <Dialog.Title className={styles.title}>Metadata of {name}</Dialog.Title>
        <p className={error ? styles.error : styles.note} role={error ? "alert" : undefined}>
          {error ?? "Reading the header"}
        </p>
      </>
    );
  }

  const labelColumn = draft.columns.findIndex((c) => c.key === "label");
  const labels = draft.channels.map((c) => c.values[labelColumn]?.trim() ?? "");
  const cellProblem = (row: number, column: number) => {
    const value = draft.channels[row].values[column];
    const problem = problemOf(draft.columns[column], value);
    if (problem || column !== labelColumn) return problem;
    if (labels[row] === "") return "A label is required";
    return labels.indexOf(labels[row]) !== row ? "Used by another channel" : null;
  };
  const fieldProblems = draft.fields.map((field) => problemOf(field, field.value));
  const invalid =
    fieldProblems.some(Boolean) ||
    draft.channels.some((c, row) => c.values.some((_, column) => cellProblem(row, column)));
  const changed = JSON.stringify(draft) !== JSON.stringify(original);

  const setField = (i: number, value: string) =>
    setDraft({ ...draft, fields: draft.fields.map((f, k) => (k === i ? { ...f, value } : f)) });
  const setCell = (row: number, column: number, value: string) =>
    setDraft({
      ...draft,
      channels: draft.channels.map((c, k) =>
        k === row ? { ...c, values: c.values.map((v, j) => (j === column ? value : v)) } : c,
      ),
    });

  const oneFile = ONE_FILE.has(draft.writes_as) && !props.sidecar;
  const target = oneFile ? copyName(props.fileName) : copyName(props.fileName, "zip");
  // The copy is made once the Save dialog has a file for it; a dialog closed unanswered leaves the editor open.
  async function save() {
    const made = await download({
      name: target,
      make: async () => {
        const files = await engine.editCopy(props.recordingId, draft as Metadata);
        return files.length === 1 && oneFile
          ? files[0].blob
          : makeZip(files.map((f) => ({ name: f.name, input: f.blob, lastModified: new Date() })));
      },
    });
    if (made) props.onDone();
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid && !busy) void save();
      }}
    >
      <header className={styles.header}>
        <Dialog.Title className={styles.title}>Metadata of {name}</Dialog.Title>
        <Dialog.Description className={styles.note}>
          Saves an edited copy as {target}; {name} stays as it is.
          {draft.notes.map((note) => ` ${note}`)}
        </Dialog.Description>
      </header>
      {draft.fields.length > 0 && (
        <fieldset className={styles.fields}>
          <legend className={styles.heading}>Recording</legend>
          {draft.fields.map((field, i) => (
            <label key={field.key} className={styles.field}>
              <span>{field.name}</span>
              <input
                value={field.value}
                maxLength={field.max ?? undefined}
                aria-invalid={fieldProblems[i] ? true : undefined}
                onChange={(event) => setField(i, event.target.value)}
              />
              {fieldProblems[i] && <small className={styles.problem}>{fieldProblems[i]}</small>}
            </label>
          ))}
        </fieldset>
      )}
      <div className={styles.tableScroller}>
        <table className={styles.table}>
          <caption className={styles.heading}>Channels</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              {draft.columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.channels.map((channel, row) => (
              <tr key={channel.index}>
                <th scope="row">{channel.index + 1}</th>
                {channel.values.map((value, column) => {
                  const problem = cellProblem(row, column);
                  const label = `${draft.columns[column].name} of channel ${channel.index + 1}`;
                  return (
                    <td key={draft.columns[column].key}>
                      <input
                        value={value}
                        aria-label={label}
                        aria-invalid={problem ? true : undefined}
                        title={problem ?? undefined}
                        onChange={(event) => setCell(row, column, event.target.value)}
                      />
                      {problem && <small className={styles.problem}>{problem}</small>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className={styles.footer}>
        <p className={error ? styles.error : styles.note} role={error ? "alert" : "status"}>
          {error ?? (busy ? "Writing the copy" : changed ? "" : "Nothing edited yet")}
        </p>
        <Dialog.Close className={controls.button} type="button">
          Cancel
        </Dialog.Close>
        <button type="submit" className={controls.primary} disabled={invalid || busy}>
          Save copy
        </button>
      </footer>
    </form>
  );
}
