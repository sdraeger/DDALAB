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
  matchProject,
  rememberDigests,
  saveTabs,
  selectTab,
  setReason,
  sought,
  type Tab,
  type TabSource,
  tabOf,
  updateTab,
} from "../store/tabs";
import { ask, fileAt, permitted } from "./handles";
import { closeRecording, engine, type FileHandles, openFiles, openInput } from "./recordings";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The tabs whose recording is not open. */
export function detachedTabs(s: State = useStore.getState()): Tab[] {
  return s.tabs.filter((t) => !idOf(t.fingerprint, s.recordings));
}

/** An attempt to reattach a tab under way: what stops it, and its end. */
interface Attempt {
  controller: AbortController;
  done: Promise<void>;
}

/** The attempt under way by tab: one at a time. */
const attempts = new Map<string, Attempt>();

/**
 * Runs `work` as the tab's one attempt to reattach, registered before anything is awaited. A quiet attempt gives way
 * to one under way. A superseding one (a pick, Retry) stops it and waits for it to end first: the stopped attempt's
 * close reaches the engine before the new open, which then gets a recording of its own. `work` gets the signal that
 * stops it; a tab closed meanwhile is not worked on.
 */
async function attempt(
  fingerprint: string,
  supersede: boolean,
  work: (signal: AbortSignal) => Promise<unknown>,
) {
  const before = attempts.get(fingerprint);
  if (before && !supersede) return;
  const controller = new AbortController();
  let ended = () => {};
  const own: Attempt = { controller, done: new Promise<void>((resolve) => (ended = resolve)) };
  attempts.set(fingerprint, own);
  before?.controller.abort();
  try {
    // Only when there is one: the work of a first attempt starts in the caller's task.
    if (before) await before.done;
    if (!controller.signal.aborted && tabOf(fingerprint)) await work(controller.signal);
  } finally {
    if (attempts.get(fingerprint) === own) {
      attempts.delete(fingerprint);
      // However it ended, no check of this tab's files goes on: it never sits "Verifying" with nothing under way.
      if (tabOf(fingerprint)?.verifying) updateTab(fingerprint, { verifying: false });
    }
    ended();
  }
}

/** Stops the tab's attempt under way, if any: it neither attaches nor reports. */
export function stopCheck(fingerprint: string) {
  attempts.get(fingerprint)?.controller.abort();
  updateTab(fingerprint, { verifying: false });
}

/** Closes a tab; an attempt to reattach it stops, and the tab stays closed. */
export function closeTab(fingerprint: string) {
  stopCheck(fingerprint);
  const id = idOf(fingerprint);
  if (id) closeRecording(id);
  else forgetTab(fingerprint);
}

/** Closes every tab and recording, and stops every attempt to reattach. Results, tiles and the recent list stay. */
export function closeAll() {
  for (const fingerprint of [...attempts.keys()]) stopCheck(fingerprint);
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

type Match = Exclude<ReturnType<typeof matchFiles>, null | { reason: string }>;

/** The picked files that are `source`'s again (see `matchFiles`); a project by its name alone (`matchProject`). */
const matchOf = (source: Local, picked: File[]) =>
  source.kind === "project" ? matchProject(source, picked) : matchFiles(source.files, picked);

/**
 * Opens `match`, the detached `tab`'s files among `files`, as that tab. `handles` holds the handles of `files` in
 * their order, where the browser gives them; `picked`: the user chose these files. Stopped (`signal`), it reports
 * nothing.
 */
async function attachMatch(
  tab: Tab,
  match: Match,
  files: File[],
  handles: FileHandles | undefined,
  picked: boolean,
  signal: AbortSignal,
) {
  const { fingerprint } = tab;
  // Same name and size with another date (a copy, a download again): hashed against the tab's digest first. With no
  // digest kept, the fingerprint decides and the recording says its contents went unchecked.
  const verify = match.same ? undefined : tab.sha256;
  // Set either way: a check this attempt stopped may have left it on.
  updateTab(fingerprint, { verifying: verify !== undefined });
  // A project's recording must have the digests the tab holds (from the project.json that brought it), picked or not.
  if (picked && tab.source?.kind !== "project") unpicked.delete(fingerprint);
  else unpicked.add(fingerprint);
  const options = {
    choice: match.primary,
    expect: fingerprint,
    exact: true,
    verify,
    signal,
    handles: handlesFor(match.files, files, handles),
    activate: false,
  };
  // A project's recording is read from inside it; its chunk loads with the first.
  const outcome =
    tab.source?.kind === "project"
      ? await (await import("./project")).openProjectRecording(match.files[0], options)
      : await openFiles(match.files, options);
  if (signal.aborted) return;
  if (verify) updateTab(fingerprint, { verifying: false });
  if (outcome.kind === "error") {
    unpicked.delete(fingerprint);
    setReason(fingerprint, outcome.message);
  } else if (!match.same && !tab.sha256) {
    const id = idOf(fingerprint);
    if (id) warn(id, "Contents could not be verified; earlier results may not match.");
  }
}

/** Reattaches the detached `tab` by its URL; `supersede` stops an attempt under way first. */
export function attachUrl(tab: Tab, supersede = false) {
  const { source, fingerprint } = tab;
  if (source?.kind !== "url") return Promise.resolve();
  return attempt(fingerprint, supersede, async (signal) => {
    unpicked.add(fingerprint);
    await openInput(source.input, { expect: fingerprint, activate: false, signal }).catch((error) => {
      unpicked.delete(fingerprint);
      if (!signal.aborted) setReason(fingerprint, `${tab.name} could not be read: ${messageOf(error)}`);
    });
  });
}

/** The handles a reattach reads `source` through: its folder's, else every file's. */
const handlesOf = (source: Local): FileSystemHandle[] =>
  source.kind === "files" && source.root
    ? [source.root]
    : sought(source).flatMap((f) => (f.handle ? [f.handle] : []));

/** A source read from this device: a recording's files, or the project that holds them. */
type Local = Exclude<TabSource, { kind: "url" }>;
const local = (source: TabSource | null | undefined): source is Local => !!source && source.kind !== "url";

/** The files of `source` read through its handles, when the browser lets them be read; `undefined` otherwise. */
async function viaHandles(source: Local) {
  const root = source.kind === "files" ? source.root : undefined;
  if (!hasHandles(source)) return undefined;
  for (const handle of handlesOf(source)) if (!(await permitted(handle))) return undefined;
  if (root && source.kind === "files")
    return { files: await Promise.all(source.files.map((f) => fileAt(root, f.path))), handles: { root } };
  const handles = sought(source).map((f) => f.handle as FileSystemFileHandle);
  return { files: await Promise.all(handles.map((h) => h.getFile())), handles: { files: handles } };
}

/**
 * Reattaches `tab` when it needs no prompt: by URL, or through handles that may still be read. An attempt under way
 * goes on, unless `supersede` (Retry) stops it.
 */
function attachQuietly(tab: Tab, supersede = false) {
  const { source, fingerprint } = tab;
  if (source?.kind === "url") return attachUrl(tab, supersede);
  if (!local(source)) return Promise.resolve();
  return attempt(fingerprint, supersede, async (signal) => {
    try {
      const read = await viaHandles(source);
      const match = read && matchOf(source, read.files);
      if (signal.aborted || !read || !match || !tabOf(fingerprint)) return;
      if ("reason" in match) return setReason(fingerprint, match.reason);
      await attachMatch(tab, match, read.files, read.handles, false, signal);
    } catch (error) {
      if (!signal.aborted) setReason(fingerprint, `${tab.name} could not be read: ${messageOf(error)}`);
    }
  });
}

/**
 * Reattaches every detached tab that needs no prompt, `first` started first; `supersede` is the tab whose attempt
 * under way is stopped and made again (Retry). Each goes on its own: one whose files are being hashed holds up no
 * other.
 */
async function attachAllQuietly(first?: string | null, supersede?: string) {
  const tabs = detachedTabs().sort(
    (a, b) => Number(b.fingerprint === first) - Number(a.fingerprint === first),
  );
  await Promise.all(tabs.map((tab) => attachQuietly(tab, tab.fingerprint === supersede)));
}

/** The prompts `tab` still needs, a click each: 1 for its folder, else one per file not allowed yet. */
export async function promptsLeft(tab: Tab): Promise<number> {
  if (!local(tab.source) || !hasHandles(tab.source)) return 0;
  const allowed = await Promise.all(handlesOf(tab.source).map(permitted));
  return allowed.filter((ok) => !ok).length;
}

/**
 * Asks for read access to one handle of `tab`: its folder's, else the first of its files' not granted yet. A click must
 * call it, and asks one question: a recording of loose files takes a click per file. Every tab the grant covers then
 * reattaches; with `supersede` (Retry) this tab's attempt under way is stopped and made again.
 */
export async function requestAccess(tab: Tab, supersede = false) {
  if (!local(tab.source)) return;
  for (const handle of handlesOf(tab.source)) {
    if (await permitted(handle)) continue;
    const answer = await ask(handle);
    if (answer === "lapsed") return setReason(tab.fingerprint, "Click Reattach again to let the browser ask");
    if (answer !== "granted") return setReason(tab.fingerprint, "Permission not granted");
    break;
  }
  await attachAllQuietly(tab.fingerprint, supersede ? tab.fingerprint : undefined);
}

/** The picker that finds `tab`'s files: the folder one when they came from a folder. */
export const pickerFor = (tab: Tab): "folder" | "files" =>
  tab.source?.kind === "files" && (tab.source.root || tab.source.files.some((f) => f.path.includes("/")))
    ? "folder"
    : "files";

/**
 * Reattaches every detached tab whose files are among the picked ones, each stopping an attempt under way for it;
 * `target` says when none of its files is. `among`: only the tabs of these fingerprints.
 */
export async function reattachFrom(
  picked: File[],
  target: string | null,
  handles?: FileHandles,
  among?: Set<string>,
) {
  await Promise.all(
    detachedTabs()
      .filter((tab) => !among || among.has(tab.fingerprint))
      .map(async (tab) => {
        const match = local(tab.source) ? matchOf(tab.source, picked) : null;
        if (!match) {
          if (tab.fingerprint === target)
            setReason(tab.fingerprint, `None of the chosen files is ${tab.name}`);
          return;
        }
        if ("reason" in match) return setReason(tab.fingerprint, match.reason);
        await attempt(tab.fingerprint, true, (signal) =>
          attachMatch(tab, match, picked, handles, true, signal),
        );
      }),
  );
}

/**
 * Reattaches the detached `tab` from `files`, whose SHA-256 the caller has found equal to the tab's (a project's copy
 * of its recording), as the tab's one attempt. The tab keeps its own source: the next visit reads its own files again.
 */
export function attachChecked(fingerprint: string, files: File[]) {
  return attempt(fingerprint, false, async (signal) => {
    // The tab as it is now: reattached meanwhile, or given another source by a pick, it stays as the user left it.
    const tab = tabOf(fingerprint);
    if (!tab || idOf(fingerprint)) return;
    // Read at the open as the check read them, or the hash detaches it.
    unpicked.add(fingerprint);
    const options = { choice: files[0].name, expect: fingerprint, exact: true, signal, activate: false };
    const outcome = await openFiles(files, { ...options, origin: tab.source ?? undefined });
    if (!signal.aborted && outcome.kind === "error") setReason(fingerprint, outcome.message);
  });
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

// A tab keeps the SHA-256 of its files from the first time they are hashed, or from the project.json that brought it. A
// recording reattached without a pick whose hash differs (an edit the fingerprint does not see) is closed again and its
// tab says why, as is a project's recording, picked or not; loose files the user picked stay open with a warning, and
// their hash becomes the tab's.
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
      if (changed && quiet && tab.source?.kind === "project") {
        return detach(
          fingerprint,
          `${changed} in ${tab.source.project.name} does not have the SHA-256 that the project lists for it: the project is damaged or was altered`,
        );
      }
      if (changed && quiet) return detach(fingerprint, `${changed} changed since it was opened`);
      if (changed) {
        warn(
          id,
          `${changed} differs from the file this tab had open before: results from before may not match it.`,
        );
      }
      if (changed || !tab.sha256) updateTab(fingerprint, { sha256 });
      // What a project's copy of this recording is checked against, once this tab is gone (app/project.ts).
      void rememberDigests(fingerprint, sha256).catch(() => {});
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
