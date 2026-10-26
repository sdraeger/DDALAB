// The inspector's lines on a recording streamed from OpenNeuro: the dataset it comes from, and a copy kept on this
// device (core/offline.ts), made, followed and removed here. A copy under way goes on while the inspector shows another
// recording; this module follows it by the recording's fingerprint.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { RecordingInput } from "../../core/engine";
import { canKeep, dropCopy, keepCopy, keptFiles } from "../../core/offline";
import { useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import styles from "./Streamed.module.css";

type UrlInput = Extract<RecordingInput, { kind: "url" }>;
/** A copy's state: being made (the share copied), kept, absent, or failed with its reason. */
type Copy =
  | { kind: "copying"; share: number }
  | { kind: "kept" }
  | { kind: "none" }
  | { kind: "failed"; reason: string };

const copies = new Map<string, Copy>();
const listeners = new Set<() => void>();
const set = (fingerprint: string, copy: Copy) => {
  copies.set(fingerprint, copy);
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const controllers = new Map<string, AbortController>();

function keep(fingerprint: string, input: UrlInput) {
  const controller = new AbortController();
  controllers.set(fingerprint, controller);
  set(fingerprint, { kind: "copying", share: 0 });
  let shown = 0;
  keepCopy(
    input,
    (share) => {
      // Whole percents: the share changes with every chunk.
      if (Math.floor(100 * share) === shown) return;
      shown = Math.floor(100 * share);
      set(fingerprint, { kind: "copying", share });
    },
    controller.signal,
  ).then(
    () => set(fingerprint, { kind: "kept" }),
    (error: unknown) =>
      set(
        fingerprint,
        controller.signal.aborted
          ? { kind: "none" }
          : { kind: "failed", reason: error instanceof Error ? error.message : String(error) },
      ),
  );
}

const megabytes = new Intl.NumberFormat("en-US", {
  style: "unit",
  unit: "megabyte",
  maximumSignificantDigits: 3,
});

export function Streamed({ fingerprint }: { fingerprint: string }) {
  const input = useStore((s) => {
    const source = s.tabs.find((t) => t.fingerprint === fingerprint)?.source;
    return source?.kind === "url" ? source.input : undefined;
  });
  const copy = useSyncExternalStore(subscribe, () => copies.get(fingerprint));
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!input || copies.has(fingerprint)) return setChecked(true);
    keptFiles(input).then((files) => {
      if (!copies.has(fingerprint)) set(fingerprint, files ? { kind: "kept" } : { kind: "none" });
      setChecked(true);
    });
  }, [fingerprint, input]);
  if (!input) return null;
  const { dataset } = input;
  const size = megabytes.format(input.files.reduce((sum, f) => sum + f.size, 0) / 1e6);
  return (
    <div className={styles.streamed}>
      <p className={styles.note}>
        {dataset
          ? `Streamed from OpenNeuro ${dataset.id}, version ${dataset.tag}.`
          : "Streamed from OpenNeuro."}
      </p>
      {canKeep() && checked && copy && (
        <div className={styles.copy} data-appear>
          {copy.kind === "copying" ? (
            <>
              <span className={styles.note}>Copying {Math.floor(100 * copy.share)}%</span>
              <progress aria-label="Copy to this device" max={100} value={Math.floor(100 * copy.share)} />
              <button
                type="button"
                className={controls.quiet}
                onClick={() => controllers.get(fingerprint)?.abort()}
              >
                Stop
              </button>
            </>
          ) : copy.kind === "kept" ? (
            <>
              <span className={styles.note}>Kept on this device; it opens without the network.</span>
              <button
                type="button"
                className={controls.quiet}
                onClick={() => dropCopy(input).then(() => set(fingerprint, { kind: "none" }))}
              >
                Remove the copy
              </button>
            </>
          ) : (
            <button type="button" className={controls.button} onClick={() => keep(fingerprint, input)}>
              Keep a copy on this device ({size})
            </button>
          )}
        </div>
      )}
      {copy?.kind === "failed" && (
        <p role="alert" className={styles.error}>
          The copy failed: {copy.reason}
        </p>
      )}
    </div>
  );
}
