// The user's annotations: every change goes through these functions, which keep an undo history per recording for
// the session and store the annotations each change touched in IndexedDB (core/userAnnotations.ts). Another instance
// of the app that stores a change makes this one read the recording's annotations again; undo and redo act on the
// annotations their step touched, which leaves the other instance's alone. File annotations are read-only and listed
// beside them with the id `file:<index>`.
import type { Annotation } from "../../core/types";
import {
  loadAnnotations,
  onStoredElsewhere,
  storeChanges,
  type UserAnnotation,
} from "../../core/userAnnotations";
import { activeRecording, setAnnotations, setView, useStore } from "../../store/store";

type State = ReturnType<typeof useStore.getState>;
type Change = Partial<Omit<UserAnnotation, "id">>;
/** One change: the recording's list before and after it. */
type Step = { before: UserAnnotation[]; after: UserAnnotation[] };

const EMPTY: UserAnnotation[] = [];
/** Per fingerprint: the changes made (undo) and those undone (redo), newest last. */
const undos = new Map<string, Step[]>();
const redos = new Map<string, Step[]>();
/** The label a new annotation starts with: the one saved last. */
let lastLabel = "";
/** The time under the pointer while it is over the waveform plot, else null. */
export const pointer: { s: number | null } = { s: null };
/** The reads and writes of IndexedDB, one after another in the order of the changes. */
let saving: Promise<void> = Promise.resolve();

/** Resolves once every change made so far is stored (or has warned that it could not be). */
export const saved = () => saving;

/** Stores the change from `before` to `after` after the writes before it. */
function store(fingerprint: string, before: UserAnnotation[], after: UserAnnotation[]) {
  saving = saving.then(() =>
    storeChanges(fingerprint, before, after).catch((error) => warn(fingerprint, error)),
  );
}

/** The user's annotations of a recording, with the one being dragged where the drag has it. */
export function userOf(state: State, fingerprint: string): UserAnnotation[] {
  const list = state.annotations[fingerprint] ?? EMPTY;
  const draft = state.annotationDraft;
  return draft ? list.map((a) => (a.id === draft.id ? draft : a)) : list;
}

const listOf = (fingerprint: string) => useStore.getState().annotations[fingerprint] ?? EMPTY;

/** Tells the user, on the recording, that a change was not stored. */
function warn(fingerprint: string, error: unknown) {
  const reason = error instanceof Error ? error.message : String(error);
  const warning = `Your annotations could not be stored in this browser (${reason}). Export them to keep them.`;
  for (const [id, recording] of Object.entries(useStore.getState().recordings)) {
    if (recording.fingerprint === fingerprint) {
      setAnnotations(id, { annotations: recording.info.annotations, warnings: [warning] });
    }
  }
}

/** Per fingerprint: how many changes its list has had, which tells a restore whether one came during its read. */
const changes = new Map<string, number>();

/** Shows `next` as the recording's list and stores the change; a picked or edited annotation that is gone is let go. */
function show(fingerprint: string, next: UserAnnotation[]) {
  changes.set(fingerprint, (changes.get(fingerprint) ?? 0) + 1);
  store(fingerprint, listOf(fingerprint), next);
  replace(fingerprint, next);
}

/** Shows `next` as the recording's list; a picked or edited annotation that is gone is let go. */
function replace(fingerprint: string, next: UserAnnotation[]) {
  useStore.setState((s) => {
    const gone = (id: string | undefined | null) =>
      Boolean(id) && !id?.startsWith("file:") && !next.some((a) => a.id === id);
    return {
      annotations: { ...s.annotations, [fingerprint]: next },
      pickedAnnotation: gone(s.pickedAnnotation) ? null : s.pickedAnnotation,
      annotationEditor: gone(s.annotationEditor?.id) ? null : s.annotationEditor,
    };
  });
}

const push = (stacks: Map<string, Step[]>, fingerprint: string, step: Step) =>
  stacks.set(fingerprint, [...(stacks.get(fingerprint) ?? []), step]);

/** One undoable change: what it did can be taken back with `undo`. */
function commit(fingerprint: string, next: UserAnnotation[]) {
  push(undos, fingerprint, { before: listOf(fingerprint), after: next });
  redos.delete(fingerprint);
  show(fingerprint, next);
}

/**
 * Reads the stored annotations of a recording after the writes queued before the read. A change made meanwhile is
 * stored after the read, which then reads again; otherwise the stored list replaces the one shown.
 */
function reload(fingerprint: string): Promise<void> {
  const before = changes.get(fingerprint) ?? 0;
  const read = saving.then(() =>
    loadAnnotations(fingerprint).catch((error) => {
      warn(fingerprint, error);
      return undefined;
    }),
  );
  saving = read.then(() => {});
  return read.then((stored) => {
    if ((changes.get(fingerprint) ?? 0) !== before) return reload(fingerprint);
    if (stored) replace(fingerprint, stored);
    else if (!useStore.getState().annotations[fingerprint]) replace(fingerprint, EMPTY);
  });
}

/** Reads the stored annotations of a recording that has none in the store yet. */
export function restoreAnnotations(fingerprint: string) {
  return useStore.getState().annotations[fingerprint] ? Promise.resolve() : reload(fingerprint);
}

// Another window stored a change: a recording shown here reads its annotations again.
onStoredElsewhere((fingerprint) => {
  if (useStore.getState().annotations[fingerprint]) void reload(fingerprint);
});

/** An onset and a duration held inside a recording of `length` seconds. */
export function within(onset_s: number, duration_s: number, length: number) {
  const onset = Math.min(length, Math.max(0, onset_s));
  return { onset_s: onset, duration_s: Math.min(length - onset, Math.max(0, duration_s)) };
}

/** A span with its `edge` dragged to `t`: the other edge stays, and the span turns over when `t` passes it. */
export function resized(a: UserAnnotation, edge: "start" | "end", t: number): UserAnnotation {
  const fixed = edge === "start" ? a.onset_s + a.duration_s : a.onset_s;
  return { ...a, onset_s: Math.min(t, fixed), duration_s: Math.abs(t - fixed) };
}

export function create(fingerprint: string, onset_s: number, duration_s: number): UserAnnotation {
  const made = { id: crypto.randomUUID(), onset_s, duration_s, label: lastLabel };
  commit(fingerprint, [...listOf(fingerprint), made]);
  return made;
}

export function update(fingerprint: string, id: string, change: Change) {
  if (change.label !== undefined) lastLabel = change.label;
  commit(
    fingerprint,
    listOf(fingerprint).map((a) => (a.id === id ? { ...a, ...change } : a)),
  );
}

export const remove = (fingerprint: string, id: string) =>
  commit(
    fingerprint,
    listOf(fingerprint).filter((a) => a.id !== id),
  );

/** Labels an annotation just created: its creation and its label are one step to undo. */
export function labelCreated(fingerprint: string, id: string, label: string) {
  lastLabel = label;
  show(
    fingerprint,
    listOf(fingerprint).map((a) => (a.id === id ? { ...a, label } : a)),
  );
}

/** Takes back the creation of `id`, whose label was never saved: neither undo nor redo remembers it. */
export function discard(fingerprint: string, id: string) {
  const undo = undos.get(fingerprint);
  if (undo && !undo[undo.length - 1]?.before.some((a) => a.id === id)) undo.pop();
  show(
    fingerprint,
    listOf(fingerprint).filter((a) => a.id !== id),
  );
}

/** The ids of the annotations a step added, removed or changed. */
function touched({ before, after }: Step) {
  const key = (a: UserAnnotation) => JSON.stringify([a.onset_s, a.duration_s, a.label]);
  const was = new Map(before.map((a) => [a.id, key(a)]));
  const now = new Map(after.map((a) => [a.id, key(a)]));
  return new Set([...was.keys(), ...now.keys()].filter((id) => was.get(id) !== now.get(id)));
}

/**
 * `current` with the annotations of `ids` as `target` has them, and the others as they are now (another window may
 * have changed them): in `target`'s order, then those `target` lacks.
 */
function patched(current: UserAnnotation[], ids: Set<string>, target: UserAnnotation[]) {
  const now = new Map(current.map((a) => [a.id, a]));
  const known = new Set(target.map((a) => a.id));
  return [
    ...target.flatMap((a) => (ids.has(a.id) ? [a] : (now.get(a.id) ?? []))),
    ...current.filter((a) => !known.has(a.id) && !ids.has(a.id)),
  ];
}

/**
 * Steps back (`undo`) or forward (`redo`) one change, closing an open editor; false when there is none. Only the
 * annotations the change touched move.
 */
function step(from: Map<string, Step[]>, to: Map<string, Step[]>, fingerprint: string, back: boolean) {
  const taken = from.get(fingerprint)?.pop();
  if (!taken) return false;
  const current = listOf(fingerprint);
  const next = patched(current, touched(taken), back ? taken.before : taken.after);
  push(to, fingerprint, back ? { before: next, after: current } : { before: current, after: next });
  // An editor still holding the values from before would put them back on Save.
  closeEditor();
  show(fingerprint, next);
  return true;
}
export const undo = (fingerprint: string) => step(undos, redos, fingerprint, true);
export const redo = (fingerprint: string) => step(redos, undos, fingerprint, false);

export const pick = (id: string | null) => useStore.setState({ pickedAnnotation: id });
export const openEditor = (id: string, created = false) =>
  useStore.setState({ pickedAnnotation: id, annotationEditor: { id, created } });
export const closeEditor = () => useStore.setState({ annotationEditor: null });
export const setDraft = (draft: UserAnnotation | null) => useStore.setState({ annotationDraft: draft });

/**
 * Annotates the active recording: a span over the selection; else a point at `at`, at the pointer over the
 * waveform, at the cursor on screen, or in the middle of the view. Its editor opens.
 */
export function annotate(at?: number) {
  const state = useStore.getState();
  const recording = activeRecording(state);
  if (!recording) return;
  const { selection, view, cursorS } = state;
  const cursor = cursorS !== null && cursorS >= view.t0 && cursorS <= view.t1 ? cursorS : null;
  const t = at ?? pointer.s ?? cursor ?? (view.t0 + view.t1) / 2;
  const [onset, duration] =
    at === undefined && selection ? [selection.t0, selection.t1 - selection.t0] : [t, 0];
  const where = within(onset, duration, recording.info.duration_s);
  const made = create(recording.fingerprint, where.onset_s, where.duration_s);
  openEditor(made.id, true);
}

/** An annotation as the list and the exports show it, file annotations among the user's. */
export interface Listed {
  id: string;
  onset_s: number;
  duration_s: number;
  label: string;
  /** "Yours", or the file it was read from. */
  source: string;
  user: boolean;
}

/** The file a file annotation came from: the .vmrk, the events.tsv, else the recording (an EDF+ channel). */
export const fileOf = (source: string, files: string[]) => files.find((f) => f.endsWith(source)) ?? files[0];

/** File and user annotations by onset. */
export function listed(files: Annotation[], names: string[], user: UserAnnotation[]): Listed[] {
  const fromFile = files.map((a, i) => ({
    ...a,
    id: `file:${i}`,
    source: fileOf(a.source, names),
    user: false,
  }));
  const yours = user.map((a) => ({ ...a, source: "Yours", user: true }));
  return [...fromFile, ...yours].sort((a, b) => a.onset_s - b.onset_s);
}

/** The annotation `id` of a recording (a user's, or `file:<index>`), as the list shows it. */
export function eventOf(state: State, recordingId: string, id: string): Listed | undefined {
  const recording = state.recordings[recordingId];
  if (!recording) return undefined;
  if (id.startsWith("file:")) {
    const a = recording.info.annotations[Number(id.slice(5))];
    return a && { ...a, id, source: fileOf(a.source, recording.info.input_files), user: false };
  }
  const a = userOf(state, recording.fingerprint).find((u) => u.id === id);
  return a && { ...a, source: "Yours", user: true };
}

const seconds = (s: number) => `${Number(s.toFixed(3))}`;
/** When an annotation is: "12.5 s" for a point, "12.5 to 15 s" for a span. */
export const when = (a: { onset_s: number; duration_s: number }) =>
  a.duration_s > 0
    ? `${seconds(a.onset_s)} to ${seconds(a.onset_s + a.duration_s)} s`
    : `${seconds(a.onset_s)} s`;

/** The labels used on a recording, for the label field to suggest. */
export const labelsOf = (files: Annotation[], user: UserAnnotation[]) =>
  [...new Set([...files, ...user].map((a) => a.label).filter(Boolean))].sort((a, b) => a.localeCompare(b));

/** Centers the view on an annotation and picks it. */
export function centerOn(a: { id: string; onset_s: number; duration_s: number }) {
  const middle = a.onset_s + a.duration_s / 2;
  setView((v) => ({ t0: middle - (v.t1 - v.t0) / 2, t1: middle + (v.t1 - v.t0) / 2 }));
  pick(a.id);
}
