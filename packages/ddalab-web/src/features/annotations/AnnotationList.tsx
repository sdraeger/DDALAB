// The inspector's annotations of a recording, the user's and the file's, by time, with a filter by label and a
// switch for the file's events. The arrow keys move along the rows, Enter (or a click) centers the view on one, F2
// (or a double-click) opens its editor and Delete removes one of the user's. The picked row scrolls into view. Use
// as selection makes a span the run interval. Export annotations saves the listed rows as a BIDS events.tsv or as
// JSON. Loaded lazily with the inspector's recording.
import { Popover } from "@base-ui/react/popover";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import { type KeyboardEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { download } from "../../app/download";
import type { UserAnnotation } from "../../core/userAnnotations";
import { setSelection, useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import history from "../history/History.module.css";
import styles from "./Annotations.module.css";
import { eventsJson, eventsTsv } from "./events";
import { centerOn, type Listed, listed, openEditor, remove, when } from "./model";

const EMPTY: UserAnnotation[] = [];
const count = (n: number) => `${n} annotation${n === 1 ? "" : "s"}`;
/** The name a row is read by: its label, when, and whose, in the order of its text (WCAG 2.5.3). */
const spoken = (a: Listed) => `${a.label || "event"}, ${when(a)}, ${a.user ? "yours" : a.source}`;

export default function AnnotationList({ recordingId }: { recordingId: string }) {
  const files = useStore((s) => s.recordings[recordingId]?.info.annotations);
  const names = useStore((s) => s.recordings[recordingId]?.info.input_files);
  const fingerprint = useStore((s) => s.recordings[recordingId]?.fingerprint ?? "");
  const user = useStore((s) => s.annotations[fingerprint] ?? EMPTY);
  const picked = useStore((s) => s.pickedAnnotation);
  const [showFile, setShowFile] = useState(true);
  const [query, setQuery] = useState("");
  const filter = useDeferredValue(query);
  const all = useMemo(() => listed(files ?? [], names ?? [], user), [files, names, user]);
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return all.filter((a) => (showFile || a.user) && a.label.toLowerCase().includes(needle));
  }, [all, showFile, filter]);
  /** The row the list's Tab stop is on: the one last focused, else the first. */
  const [active, setActive] = useState<string | null>(null);
  const focusable = shown.some((a) => a.id === active) ? active : shown[0]?.id;
  const listRef = useRef<HTMLUListElement>(null);
  // The picked row, a new one say, scrolls into view within the list; the inspector stays where it is.
  useEffect(() => {
    const list = listRef.current;
    const row = picked && list?.querySelector<HTMLElement>(`[data-id="${CSS.escape(picked)}"]`);
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    }
  }, [picked]);
  const stem = (names?.[0] ?? "recording").replace(/\.[^.]*$/, "").replace(/_(eeg|ieeg|meg)$/, "");

  const onKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const list = event.currentTarget;
    const rows = () => list.querySelectorAll<HTMLElement>("[data-row]");
    const at = Number((event.target as HTMLElement).closest<HTMLElement>("[data-index]")?.dataset.index);
    const a = shown[at];
    if (!a) return;
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: shown.length - 1 }[event.key];
    if (next !== undefined) {
      rows()[Math.max(0, Math.min(shown.length - 1, next))]?.focus();
    } else if (event.key === "F2") {
      centerOn(a);
      openEditor(a.id);
    } else if ((event.key === "Delete" || event.key === "Backspace") && a.user) {
      // The focus moves on before the row goes: to the next row, or the one before at the end.
      (rows()[at + 1] ?? rows()[at - 1])?.focus();
      remove(fingerprint, a.id);
    } else return;
    event.preventDefault();
  };

  return (
    <div className={styles.section}>
      <h3 className={styles.heading}>
        Annotations
        <span className={styles.count}>
          {shown.length === all.length ? all.length : `${shown.length} of ${all.length}`}
        </span>
      </h3>
      {all.length === 0 ? (
        <p className={styles.empty}>Press A or double-click the waveform to mark an event.</p>
      ) : (
        <>
          <div className={styles.tools}>
            <input
              type="search"
              className={styles.filter}
              aria-label="Filter annotations by label"
              placeholder="Filter by label"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {(files?.length ?? 0) > 0 && (
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={showFile}
                  onChange={(event) => setShowFile(event.target.checked)}
                />
                Show file events
              </label>
            )}
          </div>
          {/* Page keys scroll this list instead of paging the recording. */}
          <ul aria-label="Annotations" className={styles.list} onKeyDown={onKey} data-own-keys ref={listRef}>
            {shown.map((a, i) => (
              <li
                key={a.id}
                data-index={i}
                data-id={a.id}
                className={styles.row}
                data-picked={a.id === picked || undefined}
              >
                <button
                  type="button"
                  data-row
                  className={styles.rowButton}
                  aria-label={spoken(a)}
                  aria-current={a.id === picked || undefined}
                  aria-keyshortcuts={a.user ? "Enter F2 Delete" : "Enter F2"}
                  tabIndex={a.id === focusable ? 0 : -1}
                  onFocus={() => setActive(a.id)}
                  onClick={() => centerOn(a)}
                  onDoubleClick={() => openEditor(a.id)}
                >
                  <span className={styles.flag} data-user={a.user || undefined} />
                  {/* The spaces render nothing in the grid; they keep the words apart in the text the name is
                      checked against. */}
                  <span className={styles.rowLabel}>{a.label || "event"}</span>{" "}
                  <span className={styles.time}>{when(a)}</span>{" "}
                  <span className={styles.source}>{a.source}</span>
                </button>
                {a.duration_s > 0 && (
                  <button
                    type="button"
                    className={`${controls.quiet} ${styles.use}`}
                    aria-label={`Use as selection: ${a.label || "event"}`}
                    tabIndex={a.id === focusable ? 0 : -1}
                    onClick={() => {
                      setSelection({ t0: a.onset_s, t1: a.onset_s + a.duration_s });
                      centerOn(a);
                    }}
                  >
                    Use as selection
                  </button>
                )}
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className={styles.empty}>No annotation matches.</p>}
        </>
      )}
      <Popover.Root>
        <Popover.Trigger className={`${controls.button} ${styles.export}`} disabled={shown.length === 0}>
          <Download aria-hidden />
          Export annotations
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={6} align="start">
            <Popover.Popup className={controls.panel}>
              <div className={history.export}>
                <Popover.Title className={history.subheading}>
                  Export{" "}
                  {shown.length === all.length
                    ? count(all.length)
                    : `${shown.length} of ${count(all.length)}`}
                </Popover.Title>
                <button
                  type="button"
                  className={history.option}
                  onClick={() =>
                    download(
                      `${stem}_events.tsv`,
                      () => new Blob([eventsTsv(shown)], { type: "text/tab-separated-values" }),
                    )
                  }
                >
                  <b>BIDS events.tsv</b>
                  <span>Onset, duration and trial_type in seconds, tab-separated</span>
                </button>
                <button
                  type="button"
                  className={history.option}
                  onClick={() =>
                    download(
                      `${stem}_annotations.json`,
                      () => new Blob([eventsJson(shown)], { type: "application/json" }),
                    )
                  }
                >
                  <b>JSON</b>
                  <span>The same records as an array</span>
                </button>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
