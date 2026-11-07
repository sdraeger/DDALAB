// The reference in the scale band: the channels the viewer draws and DDA reads are the recorded ones or derived from
// them (dda_rs::io::reference), set in a popover beside the display filter.
import { Popover } from "@base-ui/react/popover";
import { useRef, useState } from "react";
import { rereference } from "../../app/recordings";
import type { Reference as Ref } from "../../core/types";
import { activeRecording, useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import styles from "./Viewer.module.css";

const NAMES: Record<Ref["kind"], string> = {
  average: "Average",
  bipolar: "Bipolar",
  laplacian: "Laplacian",
  custom: "Montage",
};

const referenceLabel = (reference: Ref | undefined) =>
  !reference ? "Recorded" : reference.kind === "custom" ? reference.name : NAMES[reference.kind];

export function Reference() {
  const id = useStore((s) => s.activeRecordingId);
  const reference = useStore((s) => activeRecording(s)?.reference);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const montage = useRef<HTMLInputElement>(null);
  const positions = useRef<HTMLInputElement>(null);
  if (!id) return null;

  const choose = async (next: Ref | undefined) => {
    setBusy(true);
    setError(undefined);
    await rereference(id, next)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  /** The text of the file the input `ref` picked, then `use` of it. */
  const picked =
    (use: (text: string, name: string) => Ref) => async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) await choose(use(await file.text(), file.name));
    };
  const option = (kind: "average" | "bipolar" | "laplacian") => (
    <button
      key={kind}
      type="button"
      className={controls.button}
      aria-pressed={reference?.kind === kind}
      disabled={busy}
      onClick={() => choose({ kind })}
    >
      {NAMES[kind]}
    </button>
  );

  return (
    <div className={styles.filterReadout}>
      <dt>Reference</dt>
      <dd>
        <Popover.Root>
          <Popover.Trigger
            className={styles.filterButton}
            data-on={reference !== undefined}
            aria-label={`Reference: ${referenceLabel(reference)}`}
          >
            {referenceLabel(reference)}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="top" sideOffset={8}>
              <Popover.Popup className={`${controls.panel} ${styles.filterPanel}`} aria-label="Reference">
                <fieldset className={styles.bands}>
                  <legend className={controls.label}>Reference</legend>
                  <button
                    type="button"
                    className={controls.button}
                    aria-pressed={reference === undefined}
                    disabled={busy}
                    onClick={() => choose(undefined)}
                  >
                    Recorded
                  </button>
                  {option("average")}
                  {option("bipolar")}
                  {option("laplacian")}
                </fieldset>
                <div className={styles.bands}>
                  <button
                    type="button"
                    className={controls.quiet}
                    disabled={busy}
                    onClick={() => montage.current?.click()}
                  >
                    Montage file…
                  </button>
                  <button
                    type="button"
                    className={controls.quiet}
                    disabled={busy}
                    onClick={() => positions.current?.click()}
                  >
                    Laplacian from positions…
                  </button>
                </div>
                {error && (
                  <p className={styles.filterNote} role="alert">
                    {error}
                  </p>
                )}
                <p className={styles.filterNote}>
                  The derived channels replace the recorded ones in the viewer and in DDA runs. A montage file
                  is a TSV with the columns channel, source and weight; a positions file one with name, x, y
                  and z.
                </p>
                <input
                  ref={montage}
                  type="file"
                  accept=".tsv,.txt"
                  hidden
                  aria-label="Montage file"
                  onChange={picked((montage_tsv, name) => ({ kind: "custom", montage_tsv, name }))}
                />
                <input
                  ref={positions}
                  type="file"
                  accept=".tsv,.txt"
                  hidden
                  aria-label="Electrode positions file"
                  onChange={picked((electrodes_tsv, name) => ({ kind: "laplacian", electrodes_tsv, name }))}
                />
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </dd>
    </div>
  );
}
