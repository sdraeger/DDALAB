// The editor of one annotation, in a popover at its flag on the ruler. A new annotation's editor holds its label, the
// label saved last already in it and selected: Enter keeps it, Escape takes the annotation back. A user annotation
// picked later edits its label, onset and duration, or is deleted; a file event shows what its file says. The label
// field suggests the labels the recording already uses. Loaded lazily with the first editor.
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Popover } from "@base-ui/react/popover";
import { type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";
import type { UserAnnotation } from "../../core/userAnnotations";
import { useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import styles from "./Annotations.module.css";
import {
  closeEditor,
  discard,
  eventOf,
  type Listed,
  labelCreated,
  labelsOf,
  remove,
  update,
  when,
  within,
} from "./model";

const EMPTY: UserAnnotation[] = [];
const seconds = (s: number) => String(Number(s.toFixed(6)));

export default function AnnotationEditor(props: {
  recordingId: string;
  ruler: RefObject<HTMLCanvasElement | null>;
}) {
  const { recordingId, ruler } = props;
  const editor = useStore((s) => s.annotationEditor);
  const recording = useStore((s) => s.recordings[recordingId]);
  const user = useStore((s) => (recording && s.annotations[recording.fingerprint]) ?? EMPTY);
  const files = recording?.info.annotations;
  const labels = useMemo(() => labelsOf(files ?? [], user), [files, user]);
  /** Focus goes back here once the editor saves or cancels: the waveform, or the list row that opened it. */
  const [returnTo] = useState(() => document.activeElement);
  // Opened after the first render: a popover mounted open would skip its entry transition.
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(true), []);
  /** Saves what the form holds; a press outside the editor keeps what was typed. */
  const saveTyped = useRef<(refocus: boolean) => void>(() => {});
  // The flag's place on the ruler at this moment.
  const anchor = useMemo(
    () => ({
      getBoundingClientRect() {
        const box = ruler.current?.getBoundingClientRect() ?? new DOMRect();
        const s = useStore.getState();
        const a = s.annotationEditor && eventOf(s, recordingId, s.annotationEditor.id);
        const { t0, t1 } = s.view;
        const x = a
          ? box.left + ((Math.max(t0, Math.min(t1, a.onset_s)) - t0) / (t1 - t0)) * box.width
          : box.left;
        return new DOMRect(x, box.top, 0, box.height);
      },
    }),
    [ruler, recordingId],
  );
  if (!editor || !recording) return null;
  const found = eventOf(useStore.getState(), recordingId, editor.id);
  if (!found) return null;

  /** Closes the editor; `refocus` puts the keyboard back where it was (a press elsewhere keeps its own focus). */
  const close = (refocus: boolean) => {
    if (refocus && returnTo instanceof HTMLElement && returnTo !== document.body) returnTo.focus();
    closeEditor();
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(open, details) => {
        if (open) return;
        if (details.reason === "escape-key") {
          if (editor.created) discard(recording.fingerprint, editor.id);
          close(true);
        } else if (found.user) saveTyped.current(false);
        else close(false);
      }}
    >
      <Popover.Portal>
        <Popover.Positioner anchor={anchor} side="bottom" align="start" sideOffset={6} collisionPadding={8}>
          <Popover.Popup className={styles.editor}>
            {found.user ? (
              <Form
                key={found.id}
                a={found}
                created={editor.created}
                labels={labels}
                length={recording.info.duration_s}
                fingerprint={recording.fingerprint}
                close={close}
                saveTyped={saveTyped}
              />
            ) : (
              <FileEvent a={found} />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Form(props: {
  a: Listed;
  created: boolean;
  labels: string[];
  /** The recording's duration in seconds. */
  length: number;
  fingerprint: string;
  close(refocus: boolean): void;
  saveTyped: RefObject<(refocus: boolean) => void>;
}) {
  const { a, created, fingerprint, close } = props;
  const [label, setLabel] = useState(a.label);
  const [onset, setOnset] = useState(seconds(a.onset_s));
  const [duration, setDuration] = useState(seconds(a.duration_s));
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  /** The suggestion the arrow keys are on. */
  const highlighted = useRef<string | undefined>(undefined);
  // Suggestions once the label is edited and is not one of the recording's labels already.
  const suggesting = label !== a.label && label.trim() !== "" && !props.labels.includes(label);

  /** Saves the label and the times and closes; times that are not numbers keep the editor open, saying why. */
  const save = (refocus: boolean) => {
    const text = label.trim();
    if (created) {
      labelCreated(fingerprint, a.id, text);
      return close(refocus);
    }
    const [o, d] = [onset, duration].map((v) => (v.trim() === "" ? Number.NaN : Number(v)));
    // A press elsewhere leaves times that are not numbers as they were.
    if (!(o >= 0 && d >= 0)) {
      return refocus ? setError("Type the onset and the duration in seconds, 0 or more.") : close(false);
    }
    const next = { label: text, ...within(o, d, props.length) };
    if (next.label !== a.label || next.onset_s !== a.onset_s || next.duration_s !== a.duration_s) {
      update(fingerprint, a.id, next);
    }
    close(refocus);
  };
  useEffect(() => {
    props.saveTyped.current = save;
  });

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        save(true);
      }}
    >
      <Popover.Title className={styles.title}>
        {created ? "New annotation" : "Annotation"}
        <span className={styles.when}>{when(a)}</span>
      </Popover.Title>
      {/* Inline: the suggestions open under the field inside the editor, which grows to keep Save in view. Without
          a popup the list does not fill the field: a press or Enter on a suggestion does. */}
      <Autocomplete.Root
        items={props.labels}
        value={label}
        onValueChange={setLabel}
        onItemHighlighted={(item) => (highlighted.current = item)}
        inline
        open
      >
        <div className={styles.field}>
          <label htmlFor={id}>Label</label>
          <Autocomplete.Input
            id={id}
            className={styles.input}
            placeholder="For example, spike"
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !suggesting || highlighted.current === undefined) return;
              event.preventDefault();
              setLabel(highlighted.current);
            }}
          />
        </div>
        {suggesting && (
          <Autocomplete.List className={styles.suggestionList}>
            {(item: string) => (
              <Autocomplete.Item
                key={item}
                value={item}
                className={styles.suggestion}
                onClick={() => setLabel(item)}
              >
                {item}
              </Autocomplete.Item>
            )}
          </Autocomplete.List>
        )}
      </Autocomplete.Root>
      {!created && (
        <div className={styles.times}>
          <label className={styles.field}>
            <span>Onset (s)</span>
            <input
              className={styles.input}
              type="number"
              step="any"
              min={0}
              value={onset}
              onChange={(event) => setOnset(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Duration (s)</span>
            <input
              className={styles.input}
              type="number"
              step="any"
              min={0}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>
        </div>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        {!created && (
          <button
            type="button"
            className={`${controls.quiet} ${styles.delete}`}
            onClick={() => {
              close(true);
              remove(fingerprint, a.id);
            }}
          >
            Delete
          </button>
        )}
        <span className={styles.hint}>Enter saves, Esc cancels</span>
        <button type="submit" className={controls.primary}>
          Save
        </button>
      </div>
    </form>
  );
}

/** A file event: what its file says, read-only. */
function FileEvent({ a }: { a: Listed }) {
  return (
    <div className={styles.form}>
      <Popover.Title className={styles.title}>
        File event
        <span className={styles.when}>read-only</span>
      </Popover.Title>
      <dl className={styles.facts}>
        <dt>Label</dt>
        <dd>{a.label || "event"}</dd>
        <dt>Onset</dt>
        <dd>{seconds(a.onset_s)} s</dd>
        <dt>Duration</dt>
        <dd>{seconds(a.duration_s)} s</dd>
        <dt>Source file</dt>
        <dd>{a.source}</dd>
      </dl>
    </div>
  );
}
