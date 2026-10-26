// Opening recordings: the app's engine, and what happens between a chosen file and an open recording.
import { createEngine, type RecordingInput } from "../core/engine";
import type { Annotations } from "../core/protocol";
import { buildFileSet } from "../core/sources";
import type { SyntheticSpec } from "../core/synthetic";
import type { RecordingInfo } from "../core/types";
import { restoreAnnotations } from "../features/annotations/model";
import { database, forgetRecent, listRecent, type RecentEntry, rememberRecent } from "../store/recent";
import {
  activateRecording,
  addRecording,
  removeRecording,
  setAnnotations,
  setScan,
  useStore,
} from "../store/store";
import { filesSource, forgetTab, type TabSource, tabOpened } from "../store/tabs";
import { loadViewer, viewerLoaded } from "./viewerChunk";

export const engine = createEngine();

/**
 * The viewer's chunk, which main.tsx loads once the shell has painted, awaited beside an open that comes before: the
 * recording then renders with its plots at once (viewerChunk.ts). A chunk that does not load is reported where the
 * plots go.
 */
const viewerReady = () => (viewerLoaded() ? undefined : loadViewer().catch(() => {}));

/**
 * The annotation list of the files of recording `id`: read once per fingerprint (an EDF+ takes a pass over the whole
 * file) and kept in IndexedDB for the next open.
 */
async function fileAnnotations(id: string, fingerprint: string): Promise<Annotations> {
  const db = await database().catch(() => undefined);
  const kept: Annotations | undefined = await db?.get("fileAnnotations", fingerprint).catch(() => undefined);
  if (kept) return kept;
  const found = await engine.annotations(id);
  await db?.put("fileAnnotations", found, fingerprint).catch(() => {});
  return found;
}

/** Brings what the engine learns about a recording after it opened into the store: its scan and its annotations. */
function follow(id: string, fingerprint: string) {
  engine.onScan(id, (scan) => setScan(id, scan));
  fileAnnotations(id, fingerprint)
    .catch((error: Error) => ({
      annotations: [],
      warnings: [`The annotations could not be read: ${error.message}`],
    }))
    .then((found) => setAnnotations(id, found));
}

/**
 * Shows an opened recording: a new one joins the store and its tab the tabs; one that was already open becomes the
 * active one. `origin` is where its tab reads it again; `activate` false leaves the active recording as it is.
 */
function adopt(
  opened: Awaited<ReturnType<typeof engine.open>>,
  source: "files" | "url" | "synthetic",
  origin: TabSource | null,
  activate = true,
) {
  const { id, info, fingerprint, analysis_channels } = opened;
  if (useStore.getState().recordings[id]) {
    if (activate) activateRecording(id);
    return tabOpened(id, fingerprint, info.input_files[0], origin);
  }
  addRecording(id, { info, fingerprint, analysis_channels, source }, activate);
  // The tab before the scan reports: a hash that finished while the open waited (for the viewer's chunk) reaches it.
  tabOpened(id, fingerprint, info.input_files[0], origin);
  follow(id, fingerprint);
  void restoreAnnotations(fingerprint);
}

/** Why an opened recording is not the one of `expect`, which closes it again unless it was already open. */
function unexpected(
  opened: { id: string; fingerprint: string; duplicate?: boolean },
  name: string,
  expect?: string,
  release = releaser(opened),
) {
  if (expect === undefined || opened.fingerprint === expect) return undefined;
  release();
  return `${name} changed since it was opened`;
}

/**
 * Closes the engine recording of `opened` at most once, and only when this open made it and nothing shows it: the id
 * of an open of the same content that came first (`duplicate`), or one the store holds, belongs to someone else.
 */
function releaser(opened: { id: string; duplicate?: boolean }) {
  let released = false;
  return () => {
    if (released || opened.duplicate || useStore.getState().recordings[opened.id]) return;
    released = true;
    engine.close(opened.id);
  };
}

/**
 * Opens an input as the UI opens files: an OpenNeuro recording, or a synthetic one in dev and e2e builds. With
 * `expect`, another recording than the one of that fingerprint is refused. Stopped (`signal`) before it shows, it
 * closes what it opened and throws.
 */
export async function openInput(
  input: RecordingInput,
  options: { expect?: string; activate?: boolean; signal?: AbortSignal } = {},
) {
  const [opened] = await Promise.all([engine.open(input), viewerReady()]);
  const release = releaser(opened);
  const name = "primary" in input ? input.primary : "The recording";
  const refused = unexpected(opened, name, options.expect, release);
  if (refused) throw new Error(refused);
  if (options.signal?.aborted) {
    release();
    throw new Error("The check was stopped");
  }
  adopt(opened, input.kind, input.kind === "url" ? { kind: "url", input } : null, options.activate);
  return opened.id;
}

export const openSynthetic = (spec: SyntheticSpec) => openInput({ kind: "synthetic", spec });

/** What the UI tells the user after an attempt to open. */
export type Outcome =
  | { kind: "opened"; id: string; warning?: string }
  | { kind: "error"; message: string; folder: boolean }
  | { kind: "choose"; candidates: string[] };

/** The handles of a recording's files and of the folder they were walked from, where the browser gives them. */
export type FileHandles = { files?: FileSystemFileHandle[]; root?: FileSystemDirectoryHandle };

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

/** Why the hash of the open recording `id` could not be computed, apart from any error of its scan. */
function hashErrorOf(id: string) {
  let found: string | undefined;
  engine.onScan(id, (state) => {
    found = state.hashError;
  })();
  return found;
}

/**
 * Hashes the recording `opened` before it shows: why its files are not the ones of `verify` (their SHA-256), or
 * `undefined` when they are. `signal` stops the check at any time, and `release` then closes the recording.
 */
async function verified(
  opened: { id: string; info: RecordingInfo },
  verify: Record<string, string>,
  release: () => void,
  signal?: AbortSignal,
) {
  signal?.addEventListener("abort", release, { once: true });
  // Resolves with every file's SHA-256, or with fewer once the hash failed or the recording closed.
  const sha256 = await engine.hashes(opened.id);
  signal?.removeEventListener("abort", release);
  if (signal?.aborted) return "The check was stopped";
  const names = opened.info.input_files;
  const differs = names.find((name) => verify[name] && sha256[name] && sha256[name] !== verify[name]);
  if (differs) return `${differs} changed since it was opened`;
  if (names.some((name) => !sha256[name]))
    return `${names[0]} could not be checked. ${hashErrorOf(opened.id) ?? ""}`;
  return undefined;
}

/**
 * Opens the recording in `files`. `choice` picks among several (see `buildFileSet`). `expect` is the fingerprint of
 * the recording the user is locating again; another file opens, with a warning, or with `exact` is refused. `verify`
 * holds the SHA-256 its files must have: they are hashed before the recording shows, other content is refused, and
 * `signal` stops the check. `handle` lets the recent list reopen a single-file recording without a picker. `handles`
 * (from a folder walk or the browser's file picker) keeps the files' and the folder's handles in its tab, which then
 * reattaches on the next visit (tabs.ts). `activate` false opens it beside the active recording.
 */
export async function openFiles(
  files: File[],
  options: {
    choice?: string;
    expect?: string;
    exact?: boolean;
    verify?: Record<string, string>;
    signal?: AbortSignal;
    handle?: FileSystemHandle;
    handles?: FileHandles;
    activate?: boolean;
  } = {},
): Promise<Outcome> {
  const set = buildFileSet(files, options.choice);
  if ("error" in set) return { kind: "error", message: set.error, folder: false };
  if ("candidates" in set) return { kind: "choose", candidates: set.candidates };
  try {
    const input = { kind: "files", files: set.files, primary: set.primary } as const;
    const [opened] = await Promise.all([engine.open(input), viewerReady()]);
    const release = releaser(opened);
    const refused = options.exact && unexpected(opened, set.primary, options.expect, release);
    if (refused) return { kind: "error", message: refused, folder: false };
    if (options.signal?.aborted) {
      release();
      return { kind: "error", message: "The check was stopped", folder: false };
    }
    if (options.verify && !useStore.getState().recordings[opened.id]) {
      const refusal = await verified(opened, options.verify, release, options.signal);
      if (refusal) {
        release();
        return { kind: "error", message: refusal.trim(), folder: false };
      }
    }
    const { info, fingerprint } = opened;
    // Each file's handle, from `handles` in the order of `files`, or the one `handle` of a single file.
    const byFile = new Map<File, FileSystemFileHandle>();
    for (const [i, file] of files.entries()) {
      const own = options.handles?.files?.[i];
      if (own) byFile.set(file, own);
    }
    if (options.handle?.kind === "file" && files.length === 1) {
      byFile.set(files[0], options.handle as FileSystemFileHandle);
    }
    const used = [set.primary, ...info.input_files.filter((name) => name !== set.primary)];
    const source = filesSource(set.files, used, { files: byFile, root: options.handles?.root });
    adopt(opened, "files", source, options.activate);
    const primary = set.files.find((file) => file.name === set.primary);
    const handle =
      info.input_files.length === 1 ? (options.handle ?? (primary && byFile.get(primary))) : undefined;
    await rememberRecent({ fingerprint, primary: set.primary, names: info.input_files, handle }).catch(
      () => {},
    );
    await refreshRecent();
    const differs = options.expect !== undefined && options.expect !== fingerprint;
    return {
      kind: "opened",
      id: opened.id,
      warning: differs ? "This file differs from the recording you opened before" : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "error", message, folder: MISSING_COMPANION.test(message) };
  }
}

/** The files the user picks in the browser's own picker, which also gives handles; `undefined` without one. */
export async function pickFiles(): Promise<
  { files: File[]; handle?: FileSystemHandle; handles: FileHandles } | undefined
> {
  const show = picker();
  if (!show) return undefined;
  const handles = await show({ multiple: true });
  return {
    files: await Promise.all(handles.map((h) => h.getFile())),
    handle: handles.length === 1 ? handles[0] : undefined,
    handles: { files: handles },
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

/** Closes a recording and its tab, which leaves the remembered set; the recording stays in the recent list. */
export function closeRecording(id: string) {
  const fingerprint = useStore.getState().recordings[id]?.fingerprint;
  if (fingerprint) forgetTab(fingerprint);
  engine.close(id);
  removeRecording(id);
}
