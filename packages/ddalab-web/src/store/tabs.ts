// The open recordings as tabs: their order, the view each keeps while another is shown, and where each one's files
// are read again on the next visit. Tabs live in the one store (`tabs`, `activeTab`, `tabReasons`) and are keyed by
// fingerprint, as results and tiles are. A tab is attached while its recording is open and detached while the browser
// cannot read its files yet. A switch is one update (`enter` in store.ts). The set lives in IndexedDB beside the
// recent list (`saveTabs`); app/tabs.ts restores and reattaches it.
import type { RecordingInput } from "../core/engine";
import { directory, pathOf } from "../core/sources";
import { database } from "./recent";
import { enter, type ShownResult, tabViewOf, useStore, type View } from "./store";

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
  /** The SHA-256 of each file once hashed: a file picked again with another date must hash the same. */
  sha256?: Record<string, string>;
  /** Its picked files are being hashed before it reattaches (not remembered). */
  verifying?: boolean;
}

export const tabOf = (fingerprint: string) =>
  useStore.getState().tabs.find((t) => t.fingerprint === fingerprint);

/** The id of the open recording of `fingerprint`, which is attached; `undefined` while detached. */
export function idOf(fingerprint: string, recordings = useStore.getState().recordings) {
  return Object.keys(recordings).find((id) => recordings[id].fingerprint === fingerprint);
}

/** Whether every file of `source` can be read again through a handle: its folder's, or each file's. */
export const hasHandles = (source: TabSource | null) =>
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

/**
 * A recording opened: its tab joins at the end, or the detached tab of the same recording attaches in place, and shows
 * its recording at once when it is the selected tab.
 */
export function tabOpened(id: string, fingerprint: string, name: string, source: TabSource | null) {
  useStore.setState((s) => {
    const { [fingerprint]: _, ...tabReasons } = s.tabReasons;
    const old = s.tabs.find((t) => t.fingerprint === fingerprint);
    // A source without handles does not replace one with them: the next visit could not reattach on its own.
    const kept = old && hasHandles(old.source) && !hasHandles(source) ? old.source : (source ?? old?.source);
    const tabs = old
      ? s.tabs.map((t) => (t === old ? { ...old, source: kept ?? null } : t))
      : [...s.tabs, { fingerprint, name, source }];
    if (s.activeTab === fingerprint && s.activeRecordingId !== id) {
      return { ...enter(s, fingerprint, { tabs }), tabReasons };
    }
    return { tabs, tabReasons };
  });
}

/** Makes the tab of `fingerprint` the selected one, in one update; a detached tab leaves no recording active. */
export function selectTab(fingerprint: string) {
  useStore.setState((s) =>
    s.activeTab === fingerprint || !s.tabs.some((t) => t.fingerprint === fingerprint)
      ? s
      : enter(s, fingerprint),
  );
}

/** Removes the tab of `fingerprint` from the set; when it was selected the next tab, else the previous one, is. */
export function forgetTab(fingerprint: string) {
  useStore.setState((s) => {
    const i = s.tabs.findIndex((t) => t.fingerprint === fingerprint);
    if (i < 0) return s;
    const tabs = s.tabs.filter((_, k) => k !== i);
    if (s.activeTab !== fingerprint) return { tabs };
    const next = s.tabs[i + 1] ?? s.tabs[i - 1];
    return enter({ ...s, tabs, activeTab: null }, next?.fingerprint ?? null);
  });
}

/** Moves the tab at `from` to `to`. */
export function moveTab(from: number, to: number) {
  useStore.setState((s) => {
    const tabs = [...s.tabs];
    tabs.splice(to, 0, ...tabs.splice(from, 1));
    return { tabs };
  });
}

export const setReason = (fingerprint: string, reason: string) =>
  useStore.setState((s) => ({ tabReasons: { ...s.tabReasons, [fingerprint]: reason } }));

export const updateTab = (fingerprint: string, change: Partial<Tab>) =>
  useStore.setState((s) => ({
    tabs: s.tabs.map((t) => (t.fingerprint === fingerprint ? { ...t, ...change } : t)),
  }));

/**
 * Names for the tabs of `names`: a BIDS name drops the entities every BIDS name among them shares, as in
 * `run-01_ieeg.vhdr`; a BIDS name alone drops its subject and session, which the dataset's folders name. A name that
 * would keep no entity stays whole.
 */
export function shortNames(names: string[]): string[] {
  const parsed = names.map((name) => {
    const bids = /^((?:[a-z0-9]+-[a-z0-9]+_)+)([a-z0-9]+\.[a-z0-9.]+)$/i.exec(name);
    return bids && { entities: bids[1].slice(0, -1).split("_"), rest: bids[2] };
  });
  const bids = parsed.filter((p) => p !== null);
  if (bids.length === 0) return names;
  const shared = new Set(
    bids.length === 1
      ? bids[0].entities.filter((e) => /^(sub|ses)-/i.test(e))
      : bids[0].entities.filter((e) => bids.every((p) => p.entities.includes(e))),
  );
  return names.map((name, i) => {
    const kept = parsed[i]?.entities.filter((e) => !shared.has(e)) ?? [];
    return kept.length > 0 ? [...kept, parsed[i]?.rest].join("_") : name;
  });
}

/**
 * The picked files that are the recording's `files` again, told by name and size: its files, the path of its primary
 * and whether every modification time matches as well (`same`), why they do not reattach, or `null` when none of
 * them was picked. Whether the content is the same is for the fingerprint and SHA-256 to say.
 */
export function matchFiles(
  files: TabFile[],
  picked: File[],
): { files: File[]; primary: string; same: boolean } | { reason: string } | null {
  const named = files.map((f) => picked.filter((p) => p.name === f.name));
  if (named.every((found) => found.length === 0)) return null;
  const sized = files.map((f, i) => named[i].filter((p) => p.size === f.size));
  const changed = files.find((_, i) => named[i].length > 0 && sized[i].length === 0);
  if (changed) return { reason: `${changed.name} changed since it was opened` };
  const missing = files.filter((_, i) => named[i].length === 0).map((f) => f.name);
  if (missing.length > 0) {
    return {
      reason: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not among the chosen files`,
    };
  }
  const dated = (f: TabFile) => (p: File) => p.lastModified === f.lastModified;
  const primary = sized[0].find(dated(files[0])) ?? sized[0][0];
  const beside = (p: File) => directory(pathOf(p)) === directory(pathOf(primary));
  // The core reads a recording's files from one folder: a copy beside the primary comes first, then one of its date.
  const found = files.map((f, i) =>
    i === 0
      ? primary
      : (sized[i].find((p) => beside(p) && dated(f)(p)) ??
        sized[i].find(beside) ??
        sized[i].find(dated(f)) ??
        sized[i][0]),
  );
  return { files: found, primary: pathOf(primary), same: found.every((p, i) => dated(files[i])(p)) };
}

/**
 * The tabs as remembered: synthetic ones left out, the selected one's view current. The others keep what they saved
 * when they were left: channels are chosen on the selected tab only, and a recording reattached in the background has
 * none chosen until its tab is entered.
 */
export function remembered(): { tabs: Tab[]; active: string | null } {
  const s = useStore.getState();
  const tabs = s.tabs
    .filter((t) => t.source !== null)
    .map(({ verifying: _, ...t }) =>
      t.fingerprint === s.activeTab ? { ...t, saved: tabViewOf(s, t.saved) } : t,
    );
  return { tabs, active: s.activeTab };
}

const KEY = "open";

export async function saveTabs(value = remembered()): Promise<void> {
  await (await database()).put("tabs", value, KEY);
}

export async function loadTabs(): Promise<{ tabs: Tab[]; active: string | null } | undefined> {
  return (await database()).get("tabs", KEY);
}
