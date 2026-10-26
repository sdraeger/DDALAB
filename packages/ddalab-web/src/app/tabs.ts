// Tabs across visits: the open set written to IndexedDB as it changes, brought back on the next visit, and reattached
// as smoothly as each browser allows. URL recordings, and files whose handles may still be read (Chromium), reattach
// on their own. Reattach asks for read access once per distinct folder or file handle (Chromium), or opens a picker
// once (every browser): the picked files reattach every detached tab they match, and the hash worker confirms each
// by SHA-256 afterwards.
import { removeRecording, useStore } from "../store/store";
import {
  forgetTab,
  idOf,
  loadTabs,
  matchFiles,
  saveTabs,
  selectTab,
  setReason,
  type Tab,
  type TabSource,
  tabOf,
  updateTab,
  useTabs,
} from "../store/tabs";
import { fileAt, permissionsOnce } from "./handles";
import { closeRecording, engine, type Handles, openFiles, openInput } from "./recordings";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The tabs whose recording is not open. */
export function detachedTabs(): Tab[] {
  const { recordings } = useStore.getState();
  return useTabs.getState().tabs.filter((t) => !idOf(t.fingerprint, recordings));
}

export function closeTab(fingerprint: string) {
  const id = idOf(fingerprint);
  if (id) closeRecording(id);
  else forgetTab(fingerprint);
}

/** Closes every tab and recording. Results, tiles and the recent list stay. */
export function closeAll() {
  useTabs.setState({ tabs: [], active: null, reasons: {} });
  for (const id of Object.keys(useStore.getState().recordings)) closeRecording(id);
}

/** Closes the recording of a tab and keeps the tab, detached, with `reason`. */
function detach(fingerprint: string, reason: string) {
  const id = idOf(fingerprint);
  const shown = useTabs.getState().active === fingerprint;
  if (id) {
    engine.close(id);
    removeRecording(id);
  }
  setReason(fingerprint, reason);
  if (shown) selectTab(fingerprint);
}

/** Opens the detached `tab` from `files` when they hold its files; `false` when they hold none of them. */
async function attachFiles(tab: Tab, files: File[], handles?: Handles): Promise<boolean> {
  if (tab.source?.kind !== "files") return false;
  const match = matchFiles(tab.source.files, files);
  if (!match) return false;
  if ("reason" in match) {
    setReason(tab.fingerprint, match.reason);
    return true;
  }
  const { primary } = match;
  const options = { choice: primary, expect: tab.fingerprint, exact: true, handles, activate: false };
  const outcome = await openFiles(match.files, options);
  if (outcome.kind === "error") setReason(tab.fingerprint, outcome.message);
  return true;
}

async function attachUrl(tab: Tab & { source: { kind: "url" } }) {
  await openInput(tab.source.input, { expect: tab.fingerprint, activate: false }).catch((error) =>
    setReason(tab.fingerprint, `${tab.name} could not be read: ${messageOf(error)}`),
  );
}

/** The handles a reattach reads `source` through: its folder's, else every file's. */
const handlesOf = (source: TabSource & { kind: "files" }) =>
  source.root ? [source.root] : source.files.map((f) => f.handle).filter((h) => h !== undefined);

/** The files of `source` read through its handles when `permit` grants access; `undefined` otherwise. */
async function viaHandles(
  source: TabSource & { kind: "files" },
  permit: (h: FileSystemHandle) => Promise<boolean>,
) {
  const { root } = source;
  if (root) {
    if (!(await permit(root))) return undefined;
    const files = await Promise.all(source.files.map((f) => fileAt(root, f.path)));
    return { files, handles: { root } };
  }
  const handles = source.files.map((f) => f.handle).filter((h) => h !== undefined);
  if (handles.length === 0 || handles.length < source.files.length) return undefined;
  for (const handle of handles) if (!(await permit(handle))) return undefined;
  const files = await Promise.all(handles.map((h) => h.getFile()));
  return { files, handles: { files: new Map(files.map((file, i) => [file, handles[i]])) } };
}

/** Reattaches `tab` by URL or through its handles; `false` when access to its files is not granted. */
async function attachTab(tab: Tab, permit: (h: FileSystemHandle) => Promise<boolean>): Promise<boolean> {
  const { source } = tab;
  if (source?.kind === "url") await attachUrl({ ...tab, source });
  if (source?.kind !== "files") return true;
  try {
    const read = await viaHandles(source, permit);
    if (read) await attachFiles(tab, read.files, read.handles);
    return read !== undefined;
  } catch (error) {
    setReason(tab.fingerprint, `${tab.name} could not be read: ${messageOf(error)}`);
    return true;
  }
}

/** Whether Reattach asks for access (every detached file tab has handles) rather than opening a picker. */
export function reattachAsks(): boolean {
  const { reasons } = useTabs.getState();
  const files = detachedTabs().filter((t) => t.source?.kind === "files");
  return files.every(
    (t) => t.source?.kind === "files" && handlesOf(t.source).length > 0 && !reasons[t.fingerprint],
  );
}

/** The picker Reattach opens: the folder one when a detached recording came from a folder. */
export const pickerFor = (): "folder" | "files" =>
  detachedTabs().some((t) => t.source?.kind === "files" && t.source.files.some((f) => f.path.includes("/")))
    ? "folder"
    : "files";

/** Reattaches every detached tab, asking for read access once per distinct handle. A click must call it. */
export async function reattachWithAccess() {
  const permit = permissionsOnce(true);
  const tabs = detachedTabs();
  // Every prompt first, while the click still counts as the user's gesture.
  for (const { source } of tabs)
    if (source?.kind === "files") for (const h of handlesOf(source)) await permit(h);
  for (const tab of tabs) {
    if (!(await attachTab(tab, permit)))
      setReason(tab.fingerprint, `Read access to ${tab.name} was not granted`);
  }
}

/** Reattaches every detached tab whose files are among `picked`, and the URL ones. */
export async function reattachFrom(picked: File[], handles?: Handles) {
  const { active } = useTabs.getState();
  for (const tab of detachedTabs()) {
    if (tab.source?.kind === "url") await attachUrl({ ...tab, source: tab.source });
    else if (!(await attachFiles(tab, picked, handles)) && tab.fingerprint === active) {
      setReason(tab.fingerprint, `None of the chosen files is ${tab.name}`);
    }
  }
}

/** Writes are held until the stored set has been read: an earlier write would replace it. */
let restored = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let writing = Promise.resolve();

/** Writes the open set now; resolves once it is written. */
export function flushTabs() {
  clearTimeout(timer);
  timer = undefined;
  if (restored) writing = writing.then(() => saveTabs()).catch(() => {});
  return writing;
}

// A change of the tabs is written at once: a reload right after opening a recording finds it. A view moves many times
// a second while panning and is written 200 ms after it starts moving, and as the page hides.
const later = () => {
  if (restored && timer === undefined) timer = setTimeout(flushTabs, 200);
};
useTabs.subscribe(() => void flushTabs());
useStore.subscribe((now, before) => {
  const channels = () =>
    Object.keys(now.recordings).some(
      (id) => now.recordings[id].selectedChannels !== before.recordings[id]?.selectedChannels,
    );
  const { view, selection, shownResult, activeResultId } = now;
  if (
    view !== before.view ||
    selection !== before.selection ||
    shownResult !== before.shownResult ||
    activeResultId !== before.activeResultId ||
    channels()
  )
    later();
});
addEventListener("pagehide", () => void flushTabs());

// A tab keeps the SHA-256 of its files from the first time they are hashed. A reattached recording whose hash
// differs (an edit the fingerprint does not see) is closed again and its tab says why.
useStore.subscribe((now, before) => {
  if (now.recordings === before.recordings) return;
  for (const [id, { scan, info, fingerprint }] of Object.entries(now.recordings)) {
    if (scan === before.recordings[id]?.scan) continue;
    const sha256 = scan.sha256 ?? {};
    const tab = tabOf(fingerprint);
    if (!tab?.source || !info.input_files.every((name) => sha256[name])) continue;
    const kept = tab.sha256;
    if (!kept) updateTab(fingerprint, { sha256 });
    const changed = info.input_files.find((name) => kept?.[name] && kept[name] !== sha256[name]);
    if (changed) queueMicrotask(() => detach(fingerprint, `${changed} changed since it was opened`));
  }
});

/**
 * Brings back the stored set: its tabs, detached, before any opened since the page loaded; then, once the history is
 * listed (`listed`), reattaches what needs no prompt.
 */
export async function restoreTabs(listed: Promise<unknown>) {
  const stored = await loadTabs().catch(() => undefined);
  restored = true;
  if (stored && stored.tabs.length > 0) {
    useTabs.setState((s) => {
      const live = (t: Tab) => s.tabs.find((o) => o.fingerprint === t.fingerprint);
      const merged = stored.tabs.map((t) => ({ ...t, ...live(t), saved: live(t)?.saved ?? t.saved }));
      return {
        tabs: [...merged, ...s.tabs.filter((t) => !stored.tabs.some((o) => o.fingerprint === t.fingerprint))],
      };
    });
    if (useTabs.getState().active === null && stored.active) selectTab(stored.active);
  }
  void flushTabs(); // tabs opened while the stored set loaded
  await listed.catch(() => {});
  const permit = permissionsOnce(false);
  for (const tab of detachedTabs()) await attachTab(tab, permit);
}
