// The export of the open tabs as a project (app/project.ts), from the library rail: what it holds and its size,
// measured as the panel opens, what to do about tabs that cannot go in, and Save project.
import { Popover } from "@base-ui/react/popover";
import { useEffect, useState } from "react";
import { type Contents, exportProject, projectContents } from "../../app/project";
import { mebibytes, PROJECT_RECORDS_LIMIT, RECORD_LIMIT } from "../../core/imports";
import controls from "../../styles/controls.module.css";
import styles from "../history/History.module.css";
import { size } from "../settings/LocalData";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Why the results cannot go in the project, and the two ways forward. */
function tooMuch({ bytes, refused }: Contents["budget"]) {
  const why =
    refused.length > 0
      ? `${refused.join(", ")} ${refused.length === 1 ? "is" : "are"} too large for a project, which can carry at most ${mebibytes(RECORD_LIMIT)} MiB of one result.`
      : `The results come to ${mebibytes(bytes)} MiB, and a project can carry at most ${mebibytes(PROJECT_RECORDS_LIMIT)} MiB of results.`;
  return `${why} Export without results, which keeps the recordings, annotations, chosen channels and views, or delete results you do not need in History and export again.`;
}

export default function ProjectExport() {
  const [contents, setContents] = useState<Contents | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What the save is doing, or did: "Writing the project", then "The project is saved". */
  const [status, setStatus] = useState("");
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

  // The save dialog opens first (download.ts): busy starts when the file is made, and a closed dialog makes none.
  async function save(ready: Contents, withResults: boolean) {
    setError(null);
    setStatus("");
    let made = false;
    try {
      await exportProject(
        ready,
        () => {
          made = true;
          setBusy(true);
          setStatus("Writing the project");
        },
        withResults,
      );
      if (made) setStatus("The project is saved");
    } catch (failure) {
      setStatus("");
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  const ready = contents && contents.problems.length === 0 && contents.members.length > 0 ? contents : null;
  // Results a DDALAB opening the project would refuse never go in: then the project goes without them.
  const whole = !ready || ready.budget.fits;
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
      <p className={styles.note} aria-live="polite">
        {ready && !whole && tooMuch(ready.budget)}
      </p>
      <button
        type="button"
        className={`${controls.primary} ${styles.save}`}
        disabled={!ready || busy}
        onClick={() => ready && save(ready, whole)}
      >
        {whole ? "Save project" : "Export without results"}
      </button>
      {/* One region from the start: a region mounted with its text is often not read. */}
      <p className={styles.note} aria-live="polite">
        {status}
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
