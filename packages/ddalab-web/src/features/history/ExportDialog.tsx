// The export panel of a complete result: the bundle as a zip, the JSON result document, or one variant's Q values as
// CSV, each named after the recording as the CLI names its bundle. The IO worker builds the document and the CSV.
import { Popover } from "@base-ui/react/popover";
import { useState } from "react";
import { download } from "../../app/download";
import { engine } from "../../app/recordings";
import { bundleZip } from "../../core/exporters";
import type { AnalysisRecord } from "../../core/history";
import controls from "../../styles/controls.module.css";
import styles from "./History.module.css";

export default function ExportDialog({ record }: { record: AnalysisRecord }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stem = record.fileName.replace(/\.[^.]*$/, "");
  const variants = record.manifest?.variants.map((v) => v.id) ?? [];

  async function save(name: string, make: () => Promise<Blob>) {
    setBusy(true);
    setError(null);
    try {
      download(await make(), name);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  // shortcut: the zip becomes one Blob before it is saved (browsers keep large blobs on disk); stream it into
  // showSaveFilePicker if bundles of many GB need it.
  const zip = async () => new Response(await bundleZip(record.id)).blob();

  return (
    <div className={styles.export}>
      <Popover.Title className={styles.subheading}>Export result</Popover.Title>
      <button
        type="button"
        className={styles.option}
        disabled={busy}
        onClick={() => save(`${stem}.dda.zip`, zip)}
      >
        <b>Bundle</b>
        <span>manifest.json and the .npy arrays in a zip, as ddalab run --bundle writes them</span>
      </button>
      <button
        type="button"
        className={styles.option}
        disabled={busy}
        onClick={() => save(`${stem}.dda.json`, () => engine.exportDocument(record.id))}
      >
        <b>Document</b>
        <span>One JSON file with the matrices inline, as ddalab run --output writes it</span>
      </button>
      <fieldset className={styles.csv}>
        <legend>Q values as CSV, a window per line</legend>
        <div className={styles.variants}>
          {variants.map((variant) => (
            <button
              key={variant}
              type="button"
              className={controls.button}
              disabled={busy}
              aria-label={`CSV of ${variant}`}
              onClick={() => save(`${stem}.${variant}.csv`, () => engine.exportCsv(record.id, variant))}
            >
              {variant}
            </button>
          ))}
        </div>
      </fieldset>
      {busy && (
        <p className={styles.note} aria-live="polite">
          Preparing the file
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
