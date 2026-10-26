// Tabs across visits: the open set written to IndexedDB, brought back on the next visit, and reattached as smoothly as
// each browser allows. URL recordings, and files whose handles may still be read (Chromium), reattach on their own.
// Reattach acts on one tab: it asks for read access to one of its handles (Chromium), retries its URL, or opens a
// picker, whose files reattach every detached tab they match by name and size. Files of another date are hashed
// against the tab's SHA-256 before they attach; the others attach at once and the hash worker confirms them after.
import { removeRecording, type State, useStore } from "../store/store";
import {
  forgetTab,
  hasHandles,
  idOf,
  loadTabs,
  matchFiles,
  saveTabs,
  selectTab,
  setReason,
  type Tab,
  type TabSource,
  updateTab,
} from "../store/tabs";
import { ask, fileAt, permitted } from "./handles";
import { closeRecording, engine, type FileHandles, openFiles, openInput } from "./recordings";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The tabs whose recording is not open. */
export function detachedTabs(s: State = useStore.getState()): Tab[] {
  return s.tabs.filter((t) => !idOf(t.fingerprint, s.recordings));
}

/** The checks of picked or read files under way, by tab: a later attempt or a close stops the one before. */
const checks = new Map<string, AbortController>();

/** Stops the check of the tab's files under way, if any: it neither attaches nor reports. */
export function stopCheck(fingerprint: string) {
  if (!checks.has(fingerprint)) return;
  checks.get(fingerprint)?.abort();
  checks.delete(fingerprint);
  updateTab(fingerprint, { verifying: false });
}

/** Closes a tab; a check of its files under way stops, and the tab stays closed. */
export function closeTab(fingerprint: string) {
  stopCheck(fingerprint);
  const id = idOf(fingerprint);
  if (id) closeRecording(id);
  else forgetTab(fingerprint);
}

/** Closes every tab and recording. Results, tiles and the recent list stay. */
export function closeAll() {
  useStore.setState({ tabs: [], activeTab: null, tabReasons: {} });
  for (const id of Object.keys(useStore.getState().recordings)) closeRecording(id);
}

/** Closes the recording of a tab and keeps the tab, detached, with `reason`; a selected tab stays selected. */
function detach(fingerprint: string, reason: string) {
  const id = idOf(fingerprint);
  if (id) {
    engine.close(id);
    removeRecording(id, fingerprint);
  }
  setReason(fingerprint, reason);
}

/** Recordings reattached without the user picking their files (handles, URLs): another SHA-256 detaches them. */
const unpicked = new Set<string>();

/** The handles of `chosen`, a part of `files` whose handles `handles` holds in the same order; all or none. */
function handlesFor(chosen: File[], files: File[], handles?: FileHandles): FileHandles | undefined {
  if (!handles) return undefined;
  const own = chosen.map((file) => handles.files?.[files.indexOf(file)]);
  return { root: handles.root, files: own.every((h) => h !== undefined) ? own : undefined };
}

/**
 * Opens the detached `tab` from `files` when they hold its files; `false` when they hold none of them. `handles`
 * holds the handles of `files` in their order, where the browser gives them. `picked`: the user chose these files.
 */
async function attachFiles(tab: Tab, files: File[], handles: FileHandles | undefined, picked: boolean) {
  if (tab.source?.kind !== "files") return false;
  const { fingerprint } = tab;
  const match = matchFiles(tab.source.files, files);
  if (!match) return false;
  if ("reason" in match) {
    setReason(fingerprint, match.reason);
    return true;
  }
  // Same name and size with another date (a copy, a download again): hashed against the tab's digest first. With no
  // digest kept, the fingerprint decides and the recording says its contents went unchecked.
  const verify = match.same ? undefined : tab.sha256;
  const check = new AbortController();
  stopCheck(fingerprint);
  checks.set(fingerprint, check);
  if (verify) updateTab(fingerprint, { verifying: true });
  if (picked) unpicked.delete(fingerprint);
  else unpicked.add(fingerprint);
  const options = {
    choice: match.primary,
    expect: fingerprint,
    exact: true,
    verify,
    signal: check.signal,
    handles: handlesFor(match.files, files, handles),
    activate: false,
  };
  const outcome = await openFiles(match.files, options);
  // A later attempt or a close of the tab took over: this one is done.
  if (checks.get(fingerprint) !== check) return true;
  checks.delete(fingerprint);
  if (verify) updateTab(fingerprint, { verifying: false });
  if (outcome.kind === "error") {
    unpicked.delete(fingerprint);
    setReason(fingerprint, outcome.message);
  } else if (!match.same && !tab.sha256) {
    const id = idOf(fingerprint);
    if (id) warn(id, "Contents could not be verified; earlier results may not match.");
  }
  return true;
}

export async function attachUrl(tab: Tab) {
  if (tab.source?.kind !== "url") return;
  unpicked.add(tab.fingerprint);
  await openInput(tab.source.input, { expect: tab.fingerprint, activate: false }).catch((error) => {
    unpicked.delete(tab.fingerprint);
    setReason(tab.fingerprint, `${tab.name} could not be read: ${messageOf(error)}`);
  });
}

/** The handles a reattach reads `source` through: its folder's, else every file's. */
const handlesOf = (source: TabSource & { kind: "files" }): FileSystemHandle[] =>
  source.root ? [source.root] : source.files.flatMap((f) => (f.handle ? [f.handle] : []));

/** The files of `source` read through its handles, when the browser lets them be read; `undefined` otherwise. */
async function viaHandles(source: TabSource & { kind: "files" }) {
  const { root } = source;
  if (!hasHandles(source)) return undefined;
  for (const handle of handlesOf(source)) if (!(await permitted(handle))) return undefined;
  if (root)
    return { files: await Promise.all(source.files.map((f) => fileAt(root, f.path))), handles: { root } };
  const handles = source.files.map((f) => f.handle as FileSystemFileHandle);
  return { files: await Promise.all(handles.map((h) => h.getFile())), handles: { files: handles } };
}

/** Reattaches `tab` when it needs no prompt: by URL, or through handles that may still be read. */
async function attachQuietly(tab: Tab) {
  if (tab.source?.kind === "url") return attachUrl(tab);
  // A check under way goes on; a second one of the same files would race it.
  if (tab.source?.kind !== "files" || checks.has(tab.fingerprint)) return;
  try {
    const read = await viaHandles(tab.source);
    if (read) await attachFiles(tab, read.files, read.handles, false);
  } catch (error) {
    setReason(tab.fingerprint, `${tab.name} could not be read: ${messageOf(error)}`);
  }
}

/**
 * Reattaches every detached tab that needs no prompt, `first` started first. Each goes on its own: one whose files
 * are being hashed holds up no other.
 */
async function attachAllQuietly(first?: string | null) {
  const tabs = detachedTabs().sort(
    (a, b) => Number(b.fingerprint === first) - Number(a.fingerprint === first),
  );
  await Promise.all(tabs.map(attachQuietly));
}

/** The prompts `tab` still needs, a click each: 1 for its folder, else one per file not allowed yet. */
export async function promptsLeft(tab: Tab): Promise<number> {
  if (tab.source?.kind !== "files" || !hasHandles(tab.source)) return 0;
  const allowed = await Promise.all(handlesOf(tab.source).map(permitted));
  return allowed.filter((ok) => !ok).length;
}

/**
 * Asks for read access to one handle of `tab`: its folder's, else the first of its files' not granted yet. A click must
 * call it, and asks one question: a recording of loose files takes a click per file. Every tab the grant covers then
 * reattaches.
 */
export async function requestAccess(tab: Tab) {
  if (tab.source?.kind !== "files") return;
  for (const handle of handlesOf(tab.source)) {
    if (await permitted(handle)) continue;
    const answer = await ask(handle);
    if (answer === "lapsed") return setReason(tab.fingerprint, "Click Reattach again to let the browser ask");
    if (answer !== "granted") return setReason(tab.fingerprint, "Permission not granted");
    break;
  }
  await attachAllQuietly(tab.fingerprint);
}

/** The picker that finds `tab`'s files: the folder one when they came from a folder. */
export const pickerFor = (tab: Tab): "folder" | "files" =>
  tab.source?.kind === "files" && (tab.source.root || tab.source.files.some((f) => f.path.includes("/")))
    ? "folder"
    : "files";

/** Reattaches every detached tab whose files are among the picked ones; `target` says when none of its files is. */
export async function reattachFrom(picked: File[], target: string | null, handles?: FileHandles) {
  await Promise.all(
    detachedTabs().map(async (tab) => {
      const found = await attachFiles(tab, picked, handles, true);
      if (!found && tab.fingerprint === target)
        setReason(tab.fingerprint, `None of the chosen files is ${tab.name}`);
    }),
  );
}

/** Writes are held until the stored set has been read: an earlier write would replace it. */
let restored = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let writing = Promise.resolve();
let unsaved = false;

/** Writes the open set now; resolves once it is written. */
export function flushTabs() {
  clearTimeout(timer);
  timer = undefined;
  if (!restored) return writing;
  writing = writing
    .then(() => saveTabs())
    .catch((error) => {
      if (!unsaved) console.warn("The open tabs could not be saved", error);
      unsaved = true;
    });
  return writing;
}

// The set, its order and the selected tab are written at once: a reload right after an open or a switch finds them.
// The rest (views, the channel search, hashes) is written 300 ms after it stops changing, and as the page hides.
const later = () => {
  clearTimeout(timer);
  if (restored) timer = setTimeout(flushTabs, 300);
};
const order = (s: State) => s.tabs.map((t) => t.fingerprint).join("\n");
useStore.subscribe((now, before) => {
  if (now.activeTab !== before.activeTab || (now.tabs !== before.tabs && order(now) !== order(before))) {
    return void flushTabs();
  }
  const channels = () =>
    Object.keys(now.recordings).some(
      (id) => now.recordings[id].selectedChannels !== before.recordings[id]?.selectedChannels,
    );
  if (
    now.tabs !== before.tabs ||
    now.view !== before.view ||
    now.selection !== before.selection ||
    now.shownResult !== before.shownResult ||
    now.activeResultId !== before.activeResultId ||
    channels()
  )
    later();
});
addEventListener("pagehide", () => void flushTabs());

/** Adds `warning` to the warnings of the open recording `id`, which the inspector lists. */
const warn = (id: string, warning: string) =>
  useStore.setState((s) => {
    const recording = s.recordings[id];
    if (!recording) return s;
    const warnings = [...new Set([...recording.info.warnings, warning])];
    return { recordings: { ...s.recordings, [id]: { ...recording, info: { ...recording.info, warnings } } } };
  });

// A tab keeps the SHA-256 of its files from the first time they are hashed. A recording reattached without a pick whose
// hash differs (an edit the fingerprint does not see) is closed again and its tab says why; files the user picked stay
// open with a warning, and their hash becomes the tab's.
useStore.subscribe((now, before) => {
  if (now.recordings === before.recordings) return;
  for (const [id, { scan, info, fingerprint }] of Object.entries(now.recordings)) {
    if (scan === before.recordings[id]?.scan) continue;
    const sha256 = scan.sha256 ?? {};
    const tab = now.tabs.find((t) => t.fingerprint === fingerprint);
    if (!tab?.source || !info.input_files.every((name) => sha256[name])) continue;
    const quiet = unpicked.delete(fingerprint);
    const changed = info.input_files.find((name) => tab.sha256?.[name] && tab.sha256[name] !== sha256[name]);
    queueMicrotask(() => {
      if (changed && quiet) return detach(fingerprint, `${changed} changed since it was opened`);
      if (changed) {
        warn(
          id,
          `${changed} differs from the file this tab had open before: results from before may not match it.`,
        );
      }
      if (changed || !tab.sha256) updateTab(fingerprint, { sha256 });
    });
  }
});

/**
 * Brings back the stored set: its tabs, detached, before any opened since the page loaded; then, once the history is
 * listed (`listed`), reattaches what needs no prompt, the selected tab first.
 */
export async function restoreTabs(listed: Promise<unknown>) {
  const stored = await loadTabs().catch(() => undefined);
  restored = true;
  if (stored && stored.tabs.length > 0) {
    useStore.setState((s) => {
      const live = (t: Tab) => s.tabs.find((o) => o.fingerprint === t.fingerprint);
      const merged = stored.tabs.map((t) => ({ ...t, ...live(t), saved: live(t)?.saved ?? t.saved }));
      const fresh = s.tabs.filter((t) => !stored.tabs.some((o) => o.fingerprint === t.fingerprint));
      return { tabs: [...merged, ...fresh] };
    });
    if (useStore.getState().activeTab === null && stored.active) selectTab(stored.active);
  }
  void flushTabs(); // tabs opened while the stored set loaded
  await listed.catch(() => {});
  await attachAllQuietly(useStore.getState().activeTab);
}
