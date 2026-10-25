// Importing a result the CLI wrote: a bundle zip, a bundle folder or a JSON document, picked or dropped here. Dropped
// here it is a result; dropped anywhere else in the window it would be taken for a recording. The IO worker reads,
// checks and stores it.
import FileUp from "lucide-react/dist/esm/icons/file-up.mjs";
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { refreshAnalyses } from "../../app/analyses";
import { engine } from "../../app/recordings";
import { droppedFiles } from "../../core/sources";
import { openResult } from "../../store/store";
import controls from "../../styles/controls.module.css";
import rail from "../library/LibraryRail.module.css";
import styles from "./History.module.css";

export default function ImportDrop() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  async function run(input: File | File[]) {
    setBusy(true);
    setError(null);
    try {
      // A folder's paths go along: a File sent to a worker loses its `webkitRelativePath`.
      const id = await engine.importResult(
        Array.isArray(input)
          ? input.map((file) => ({ path: file.webkitRelativePath || file.name, file }))
          : input,
      );
      await refreshAnalyses();
      openResult(id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) void run(event.target === folderInput.current ? files : files[0]);
  };
  const dragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOver(true);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOver(false);
    // A single file is a zip or a document; a folder arrives as its files with their paths.
    void droppedFiles(event.dataTransfer).then(({ files }) => {
      if (files.length > 0) void run(files.length === 1 && !files[0].webkitRelativePath ? files[0] : files);
    });
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target; its buttons are the keyboard's way in
    <div
      className={styles.import}
      data-over={over || undefined}
      onDragOver={dragOver}
      onDragLeave={(event) => {
        // Entering a button inside also leaves the target.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={drop}
    >
      <div className={rail.actions}>
        <button
          type="button"
          className={controls.button}
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <FileUp aria-hidden />
          Import result
        </button>
        <button
          type="button"
          className={controls.quiet}
          disabled={busy}
          onClick={() => folderInput.current?.click()}
        >
          Import folder
        </button>
      </div>
      <p className={rail.hint}>
        A bundle zip, a bundle folder or a JSON document from the CLI; or drop one here.
      </p>
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".zip,.json,application/zip,application/json"
        aria-label="Result file"
        onChange={picked}
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        aria-label="Result folder"
        onChange={picked}
        {...{ webkitdirectory: "" }}
      />
      {busy && (
        <p className={rail.hint} aria-live="polite">
          Importing
        </p>
      )}
      {error && (
        <p role="alert" className={rail.error}>
          {error}
        </p>
      )}
    </div>
  );
}
