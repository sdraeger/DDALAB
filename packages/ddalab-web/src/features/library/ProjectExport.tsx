// The export of the open tabs as a project (app/project.ts), from the library rail: what it holds and its size,
// measured as the panel opens, what to do about tabs that cannot go in, and Save project.
import { Popover } from "@base-ui/react/popover";
import { useEffect, useState } from "react";
import { type Contents, exportProject, projectContents } from "../../app/project";
import controls from "../../styles/controls.module.css";
import styles from "../history/History.module.css";
import { size } from "../settings/LocalData";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function ProjectExport() {
  const [contents, setContents] = useState<Contents | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    projectContents().then(
      (found) => live && setContents(found),
      (failure) => live && setError(messageOf(failure)),
    );
    return () => {
      live = false;
    };
  }, []);

  // The save dialog opens first (download.ts): busy starts when the file is written.
  async function save(ready: Contents) {
    setError(null);
    try {
      await exportProject(ready, () => setBusy(true));
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  const ready = contents && contents.problems.length === 0 && contents.members.length > 0 ? contents : null;
  const holds = contents && [
    count(contents.members.length, "recording"),
    count(contents.results.length, "result"),
    ...(contents.batches.length > 0 ? [count(contents.batches.length, "batch", "batches")] : []),
  ];
  return (
    <div className={styles.export} data-appear>
      <Popover.Title className={styles.subheading}>Export project</Popover.Title>
      <p className={styles.note}>
        The open tabs in one .ddalab file: every file their recordings read, your annotations, chosen channels
        and views, and their results. It opens in DDALAB on any device, and any zip tool unpacks it.
      </p>
      <p aria-live="polite">
        {contents ? `${holds?.join(", ")}: ${size(contents.bytes)}` : error ? "" : "Measuring…"}
      </p>
      {contents && contents.problems.length > 0 && (
        <ul className={styles.diagnostics} aria-label="Tabs to fix first">
          {contents.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className={`${controls.primary} ${styles.save}`}
        disabled={!ready || busy}
        onClick={() => ready && save(ready)}
      >
        Save project
      </button>
      {busy && (
        <p className={styles.note} aria-live="polite">
          Writing the project
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
