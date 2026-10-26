// The open recordings as tabs: their order, the view each keeps while another is shown, and where each one's files
// are read again on the next visit. Tabs are keyed by fingerprint, as results and tiles are. A tab is attached while
// its recording is open in the store and detached while the browser cannot read its files yet. The set lives in
// IndexedDB beside the recent list (`saveTabs`); app/tabs.ts restores and reattaches it.
import { create } from "zustand";
import type { RecordingInput } from "../core/engine";
import { directory, pathOf } from "../core/sources";
import { database } from "./recent";
import {
  activateRecording,
  activeRecording,
  type OpenRecording,
  type ShownResult,
  setView,
  useStore,
  type View,
} from "./store";

/** One file of a recording as it was opened: what tells it apart among picked files, and its handle (Chromium). */
export interface TabFile {
  /** The path a folder pick or drop reports (`folder/sub/name`), else the name. */
  path: string;
  name: string;
  size: number;
  lastModified: number;
  handle?: FileSystemFileHandle;
}

/** Where a recording's files are read again. `files` lists the files the recording uses, its primary first. */
export type TabSource =
  | { kind: "files"; files: TabFile[]; root?: FileSystemDirectoryHandle }
  | { kind: "url"; input: Extract<RecordingInput, { kind: "url" }> };

/** What a tab shows again when it becomes active. */
export interface TabView {
  view: Omit<View, "mmPerCssMm">;
  selection: { t0: number; t1: number } | null;
  selectedChannels: number[];
  shownResult: ShownResult | null;
  activeResultId: string | null;
}

export interface Tab {
  fingerprint: string;
  /** The primary file's name. */
  name: string;
  /** `null`: a synthetic recording (dev and e2e builds), which is not remembered. */
  source: TabSource | null;
  saved?: TabView;
  /** The inspector's channel search. */
  channelQuery?: string;
  /** The SHA-256 of each file once hashed: a reattached recording must hash the same. */
  sha256?: Record<string, string>;
}

interface TabsState {
  tabs: Tab[];
  /** The active tab: the active recording's, or a detached one the user selected. */
  active: string | null;
  /** Why a detached tab did not reattach. */
  reasons: Record<string, string>;
}

export const useTabs = create<TabsState>()(() => ({ tabs: [], active: null, reasons: {} }));

export const tabOf = (fingerprint: string) =>
  useTabs.getState().tabs.find((t) => t.fingerprint === fingerprint);

/** The id of the open recording of `fingerprint`, which is attached; `undefined` while detached. */
export function idOf(fingerprint: string, recordings = useStore.getState().recordings) {
  return Object.keys(recordings).find((id) => recordings[id].fingerprint === fingerprint);
}

const hasHandles = (source: TabSource | null) =>
  source?.kind === "files" && (source.root !== undefined || source.files.every((f) => f.handle));

/**
 * The source of a recording opened from `files`, of which the core used `used` (the primary first). `handles` maps
 * a file to its handle; `root` is the handle of the folder the files came from.
 */
export function filesSource(
  files: File[],
  used: string[],
  handles: { files?: Map<File, FileSystemFileHandle>; root?: FileSystemDirectoryHandle } = {},
): TabSource {
  const tabFiles = used.flatMap((name) => {
    const file = files.find((f) => f.name === name);
    if (!file) return [];
    const { size, lastModified } = file;
    return [{ path: pathOf(file), name, size, lastModified, handle: handles.files?.get(file) }];
  });
  // A root covers only files whose paths start with its name.
  const root = tabFiles.every((f) => f.path.startsWith(`${handles.root?.name}/`)) ? handles.root : undefined;
  return { kind: "files", files: tabFiles, root };
}

/** A recording opened: its tab joins at the end, or the detached tab of the same recording attaches in place. */
export function tabOpened(id: string, fingerprint: string, name: string, source: TabSource | null) {
  useTabs.setState((s) => {
    const { [fingerprint]: _, ...reasons } = s.reasons;
    const old = s.tabs.find((t) => t.fingerprint === fingerprint);
    if (!old) return { tabs: [...s.tabs, { fingerprint, name, source }], reasons };
    // A source without handles does not replace one with them: the next visit could not reattach on its own.
    const kept = hasHandles(old.source) && !hasHandles(source) ? old.source : (source ?? old.source);
    return { tabs: s.tabs.map((t) => (t === old ? { ...old, source: kept } : t)), reasons };
  });
  // The detached tab the user is looking at shows its recording once it attaches.
  if (useTabs.getState().active === fingerprint) activateRecording(id);
}

/** Makes the tab of `fingerprint` the active one; a detached tab leaves no recording active. */
export function selectTab(fingerprint: string) {
  const id = idOf(fingerprint);
  if (id) return activateRecording(id);
  if (!tabOf(fingerprint)) return;
  useStore.setState({
    activeRecordingId: null,
    selection: null,
    cursorS: null,
    shownResult: null,
    activeResultId: null,
  });
  useTabs.setState({ active: fingerprint });
}

/** Removes the tab of `fingerprint` from the set; the next tab, else the previous one, becomes active first. */
export function forgetTab(fingerprint: string) {
  const { tabs, active } = useTabs.getState();
  const i = tabs.findIndex((t) => t.fingerprint === fingerprint);
  if (i < 0) return;
  const next = tabs[i + 1] ?? tabs[i - 1];
  if (active === fingerprint && next) selectTab(next.fingerprint);
  useTabs.setState((s) => ({
    tabs: s.tabs.filter((t) => t.fingerprint !== fingerprint),
    active: s.active === fingerprint ? null : s.active,
  }));
}

/** Moves the tab at `from` to `to`. */
export function moveTab(from: number, to: number) {
  useTabs.setState((s) => {
    const tabs = [...s.tabs];
    tabs.splice(to, 0, ...tabs.splice(from, 1));
    return { tabs };
  });
}

export const setReason = (fingerprint: string, reason: string) =>
  useTabs.setState((s) => ({ reasons: { ...s.reasons, [fingerprint]: reason } }));

export const updateTab = (fingerprint: string, change: Partial<Tab>) =>
  useTabs.setState((s) => ({
    tabs: s.tabs.map((t) => (t.fingerprint === fingerprint ? { ...t, ...change } : t)),
  }));

/** The view of `state` with `recording` active, as a tab keeps it. */
function snapshot(state: ReturnType<typeof useStore.getState>, recording: OpenRecording): TabView {
  const { mmPerCssMm: _, ...view } = state.view;
  return {
    view,
    selection: state.selection,
    selectedChannels: recording.selectedChannels,
    shownResult: state.shownResult,
    activeResultId: state.activeResultId,
  };
}

/** Puts `saved` back on the active recording `id`; `keepResult` leaves the result a switch opened. */
function restore(saved: TabView, id: string, keepResult: boolean) {
  setView(saved.view);
  useStore.setState((s) => {
    const recording = s.recordings[id];
    const complete = (resultId?: string | null) =>
      s.analyses.some((a) => a.id === resultId && a.status === "complete");
    const channels = recording.analysis_channels.length;
    const selectedChannels = saved.selectedChannels.filter((c) => c < channels);
    return {
      selection: saved.selection,
      recordings: { ...s.recordings, [id]: { ...recording, selectedChannels } },
      ...(keepResult
        ? {}
        : {
            shownResult: complete(saved.shownResult?.id) ? saved.shownResult : null,
            activeResultId: s.analyses.some((a) => a.id === saved.activeResultId)
              ? saved.activeResultId
              : null,
          }),
    };
  });
}

// A switch keeps the view of the recording left and puts back the one of the recording entered. A switch that
// opened a result (openResult) keeps that result.
useStore.subscribe((now, before) => {
  if (now.activeRecordingId === before.activeRecordingId) return;
  const left = before.activeRecordingId ? before.recordings[before.activeRecordingId] : undefined;
  if (left && tabOf(left.fingerprint)) updateTab(left.fingerprint, { saved: snapshot(before, left) });
  const entered = activeRecording(now);
  useTabs.setState({ active: entered?.fingerprint ?? null });
  const saved = entered && tabOf(entered.fingerprint)?.saved;
  if (saved && now.activeRecordingId) {
    restore(saved, now.activeRecordingId, now.activeResultId !== before.activeResultId);
  }
});

/**
 * Names for the tabs of `names`: a BIDS name drops the entities every BIDS name among them shares, as in
 * `run-01_ieeg.vhdr`. A name that would keep no entity stays whole.
 */
export function shortNames(names: string[]): string[] {
  const parsed = names.map((name) => {
    const bids = /^((?:[a-z0-9]+-[a-z0-9]+_)+)([a-z0-9]+\.[a-z0-9.]+)$/i.exec(name);
    return bids && { entities: bids[1].slice(0, -1).split("_"), rest: bids[2] };
  });
  const bids = parsed.filter((p) => p !== null);
  if (bids.length < 2) return names;
  const shared = new Set(bids[0].entities.filter((e) => bids.every((p) => p.entities.includes(e))));
  return names.map((name, i) => {
    const kept = parsed[i]?.entities.filter((e) => !shared.has(e)) ?? [];
    return kept.length > 0 ? [...kept, parsed[i]?.rest].join("_") : name;
  });
}

/**
 * The picked files that are the recording's `files` again, told by name, size and modification time: its files with
 * the path of its primary, why they do not reattach, or `null` when none of them was picked.
 */
export function matchFiles(
  files: TabFile[],
  picked: File[],
): { files: File[]; primary: string } | { reason: string } | null {
  const named = files.map((f) => picked.filter((p) => p.name === f.name));
  if (named.every((found) => found.length === 0)) return null;
  const same = (f: TabFile) => (p: File) => p.size === f.size && p.lastModified === f.lastModified;
  const changed = files.find((f, i) => named[i].length > 0 && !named[i].some(same(f)));
  if (changed) return { reason: `${changed.name} changed since it was opened` };
  const missing = files.filter((_, i) => named[i].length === 0).map((f) => f.name);
  if (missing.length > 0) {
    return {
      reason: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not among the chosen files`,
    };
  }
  const primary = named[0].find(same(files[0])) as File;
  const folder = directory(pathOf(primary));
  // The core reads a recording's files from one folder: a copy beside the primary comes first.
  const found = files.map((f, i) => {
    const exact = named[i].filter(same(f));
    return i === 0 ? primary : (exact.find((p) => directory(pathOf(p)) === folder) ?? exact[0]);
  });
  return { files: found, primary: pathOf(primary) };
}

/** The tabs as remembered: synthetic ones left out, the active one's view and every open one's channels current. */
export function remembered(): { tabs: Tab[]; active: string | null } {
  const { tabs, active } = useTabs.getState();
  const state = useStore.getState();
  const live = activeRecording(state);
  const kept = tabs
    .filter((t) => t.source !== null)
    .map((t) => {
      if (live?.fingerprint === t.fingerprint) return { ...t, saved: snapshot(state, live) };
      const id = idOf(t.fingerprint, state.recordings);
      const selectedChannels = id ? state.recordings[id].selectedChannels : undefined;
      return t.saved && selectedChannels ? { ...t, saved: { ...t.saved, selectedChannels } } : t;
    });
  return { tabs: kept, active };
}

const KEY = "open";

export async function saveTabs(value = remembered()): Promise<void> {
  await (await database()).put("tabs", value, KEY);
}

export async function loadTabs(): Promise<{ tabs: Tab[]; active: string | null } | undefined> {
  return (await database()).get("tabs", KEY);
}
