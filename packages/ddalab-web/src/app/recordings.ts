// Opening recordings: the app's engine, and what happens between a chosen file and an open recording.
import { createEngine, type RecordingInput } from "../core/engine";
import { buildFileSet } from "../core/sources";
import type { SyntheticSpec } from "../core/synthetic";
import { restoreAnnotations } from "../features/annotations/model";
import { forgetRecent, listRecent, type RecentEntry, rememberRecent } from "../store/recent";
import {
  activateRecording,
  addRecording,
  removeRecording,
  setAnnotations,
  setScan,
  useStore,
} from "../store/store";

export const engine = createEngine();

/** Brings what the engine learns about a recording after it opened into the store: its scan and its annotations. */
function follow(id: string) {
  engine.onScan(id, (scan) => setScan(id, scan));
  engine
    .annotations(id)
    .catch((error: Error) => ({
      annotations: [],
      warnings: [`The annotations could not be read: ${error.message}`],
    }))
    .then((found) => setAnnotations(id, found));
}

/** Shows an opened recording: a new one joins the store; one that was already open becomes the active one. */
function adopt(opened: Awaited<ReturnType<typeof engine.open>>, source: "files" | "url" | "synthetic") {
  const { id, info, fingerprint, analysis_channels } = opened;
  if (useStore.getState().recordings[id]) return activateRecording(id);
  addRecording(id, { info, fingerprint, analysis_channels, source });
  follow(id);
  void restoreAnnotations(fingerprint);
}

/** Opens an input as the UI opens files: an OpenNeuro recording, or a synthetic one in dev and e2e builds. */
export async function openInput(input: RecordingInput) {
  const opened = await engine.open(input);
  adopt(opened, input.kind);
  return opened.id;
}

export const openSynthetic = (spec: SyntheticSpec) => openInput({ kind: "synthetic", spec });

/** What the UI tells the user after an attempt to open. */
export type Outcome =
  | { kind: "opened"; warning?: string }
  | { kind: "error"; message: string; folder: boolean }
  | { kind: "choose"; candidates: string[] };

// The core's reply to a header whose data file is not in the set.
const MISSING_COMPANION = /names .+, which is not among the opened files/;

type FileHandle = FileSystemFileHandle & {
  queryPermission(options: { mode: "read" }): Promise<PermissionState>;
  requestPermission(options: { mode: "read" }): Promise<PermissionState>;
};
const picker = () =>
  (window as { showOpenFilePicker?: (options: { multiple: boolean }) => Promise<FileHandle[]> })
    .showOpenFilePicker;

/** Whether the browser has its own file picker, which gives handles (Chromium). */
export const canPickFiles = () => picker() !== undefined;

export async function refreshRecent() {
  // The list is a convenience: without IndexedDB (some private windows) it stays empty.
  useStore.setState({ recent: await listRecent().catch(() => []) });
}

/**
 * Opens the recording in `files`. `choice` picks among several (see `buildFileSet`). `expect` is the fingerprint of
 * the recording the user is locating again; another file opens, with a warning. `handle` lets the recent list
 * reopen a single-file recording without a picker.
 */
export async function openFiles(
  files: File[],
  options: { choice?: string; expect?: string; handle?: FileSystemHandle } = {},
): Promise<Outcome> {
  const set = buildFileSet(files, options.choice);
  if ("error" in set) return { kind: "error", message: set.error, folder: false };
  if ("candidates" in set) return { kind: "choose", candidates: set.candidates };
  try {
    const opened = await engine.open({ kind: "files", files: set.files, primary: set.primary });
    adopt(opened, "files");
    const { info, fingerprint } = opened;
    const handle = info.input_files.length === 1 ? options.handle : undefined;
    await rememberRecent({ fingerprint, primary: set.primary, names: info.input_files, handle }).catch(
      () => {},
    );
    await refreshRecent();
    const differs = options.expect !== undefined && options.expect !== fingerprint;
    return {
      kind: "opened",
      warning: differs ? "This file differs from the recording you opened before" : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "error", message, folder: MISSING_COMPANION.test(message) };
  }
}

/** The files the user picks in the browser's own picker, which also gives handles; `undefined` without one. */
export async function pickFiles(): Promise<{ files: File[]; handle?: FileSystemHandle } | undefined> {
  const show = picker();
  if (!show) return undefined;
  const handles = await show({ multiple: true });
  return {
    files: await Promise.all(handles.map((h) => h.getFile())),
    handle: handles.length === 1 ? handles[0] : undefined,
  };
}

/** Reopens a recent single-file recording through its handle, asking for read access if it lapsed. */
export async function reopen(entry: RecentEntry & { handle: FileSystemHandle }): Promise<Outcome> {
  const handle = entry.handle as FileHandle;
  try {
    const granted = (await handle.queryPermission({ mode: "read" })) === "granted";
    if (!granted && (await handle.requestPermission({ mode: "read" })) !== "granted") {
      return { kind: "error", message: `Read access to ${entry.primary} was not granted`, folder: false };
    }
    return await openFiles([await handle.getFile()], { expect: entry.fingerprint, handle });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: "error", message: `${entry.primary} could not be read: ${reason}`, folder: false };
  }
}

export async function forget(entry: RecentEntry) {
  await forgetRecent(entry.fingerprint);
  await refreshRecent();
}

export function closeRecording(id: string) {
  engine.close(id);
  removeRecording(id);
}
