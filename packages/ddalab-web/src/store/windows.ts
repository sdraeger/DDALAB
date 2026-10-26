// The app's windows. Each keeps its own tabs (IndexedDB, under its id in the tabs store) and session (session.ts,
// localStorage under its id), and keeps the id in sessionStorage, which a reload keeps. A window holds a Web Lock on its
// id while it is open. One that starts with no id (a fresh launch) claims the saved window used last that no open
// window holds, else starts empty; the saved windows nobody holds are what Window > Reopen window lists. History,
// annotations, results and tiles stay shared.
import { database } from "./recent";
import type { Tab } from "./tabs";

/** A window as saved: its tabs, the selected one, and when it was last saved. */
export interface SavedWindow {
  tabs: Tab[];
  active: string | null;
  used: number;
}

const PREFIX = "window:";
const LOCK = "ddalab-window:";
const ID = "ddalab.window";

/** This window's id; `claimWindow` sets it before the first render. */
export let windowId = "";
export const windowKey = () => PREFIX + windowId;
export const sessionKey = (id = windowId) => `ddalab.session.${id}`;

/**
 * The saved windows a window starting with `own` tries to claim, in order: its own (after a reload, or picked under
 * Reopen window), then every one with tabs that no open window holds (`held`), the one used last first.
 */
export function candidates(own: string | null, saved: Map<string, SavedWindow>, held: Set<string>): string[] {
  const free = [...saved]
    .filter(([id, w]) => id !== own && w.tabs.length > 0 && !held.has(id))
    .sort(([, a], [, b]) => b.used - a.used)
    .map(([id]) => id);
  return own ? [own, ...free] : free;
}

async function savedWindows(): Promise<Map<string, SavedWindow>> {
  const store = (await database()).transaction("tabs").store;
  const range = IDBKeyRange.bound(PREFIX, `${PREFIX}￿`);
  const [keys, values] = await Promise.all([store.getAllKeys(range), store.getAll(range)]);
  return new Map(keys.map((key, i) => [String(key).slice(PREFIX.length), values[i]]));
}

/** The windows that hold their id now, open or opening. */
async function heldIds(): Promise<Set<string>> {
  const { held = [], pending = [] } = await navigator.locks.query();
  return new Set(
    [...held, ...pending].flatMap(({ name }) => (name?.startsWith(LOCK) ? [name.slice(LOCK.length)] : [])),
  );
}

/**
 * Takes the lock of `id` for the life of the page: at once, or within `waitMs`, as a reload waits for the page it
 * replaces to let go. Whether it got it.
 */
const hold = (id: string, waitMs: number) =>
  new Promise<boolean>((granted) => {
    const options = waitMs > 0 ? { signal: AbortSignal.timeout(waitMs) } : { ifAvailable: true };
    navigator.locks
      .request(LOCK + id, options, (lock) => {
        granted(lock !== null);
        return lock && new Promise(() => {});
      })
      .catch(() => granted(false));
  });

const forgetSession = (id: string) => {
  try {
    localStorage.removeItem(sessionKey(id));
  } catch {}
};

/** 2.1 kept one set of tabs ("open") and one session ("ddalab.session"): they become a saved window. */
async function migrate() {
  const writes = (await database()).transaction("tabs", "readwrite");
  const old = await writes.store.get("open");
  if (old) {
    const id = crypto.randomUUID();
    try {
      const session = localStorage.getItem("ddalab.session");
      if (session) localStorage.setItem(sessionKey(id), session);
    } catch {}
    await writes.store.put({ ...old, used: Date.now() }, PREFIX + id);
    await writes.store.delete("open");
  }
  await writes.done;
  try {
    localStorage.removeItem("ddalab.session");
  } catch {}
}

/**
 * Claims this window's id and returns what it saved, if anything. A `window` parameter in the URL asks for a window:
 * `new` for an empty one (Window > New window), else the id of a saved one (Reopen window). Saved windows without
 * tabs that no window holds are dropped, with their sessions.
 */
export async function claimWindow(): Promise<SavedWindow | undefined> {
  const url = new URL(location.href);
  const asked = url.searchParams.get("window");
  if (asked !== null) {
    url.searchParams.delete("window");
    history.replaceState(history.state, "", url);
  }
  let own = asked;
  try {
    own ??= sessionStorage.getItem(ID);
  } catch {}
  // Without IndexedDB (some private windows) nothing is saved and the window starts empty.
  await migrate().catch(() => {});
  const saved = await savedWindows().catch(() => new Map<string, SavedWindow>());
  const held = await heldIds();
  windowId = "";
  for (const id of own === "new" ? [] : candidates(own, saved, held)) {
    if (await hold(id, id === own && held.has(id) ? 1000 : 0)) {
      windowId = id;
      break;
    }
  }
  if (!windowId) {
    windowId = crypto.randomUUID();
    await hold(windowId, 0);
  }
  try {
    sessionStorage.setItem(ID, windowId);
  } catch {}
  const empty = [...saved.keys()].filter(
    (id) => saved.get(id)?.tabs.length === 0 && id !== windowId && !held.has(id),
  );
  if (empty.length > 0) {
    const db = await database();
    await Promise.all(empty.map((id) => db.delete("tabs", PREFIX + id))).catch(() => {});
    empty.forEach(forgetSession);
  }
  return saved.get(windowId);
}

/** The saved windows with tabs that no open window holds, the one used last first: Window > Reopen window. */
export async function reopenable(): Promise<[string, SavedWindow][]> {
  const [saved, held] = await Promise.all([savedWindows(), heldIds()]);
  return candidates(null, saved, held).map((id) => [id, saved.get(id) as SavedWindow]);
}

/** Opens another window of the app: an empty one (`new`), or the saved window `id`. */
export function openWindow(id: string) {
  const url = new URL("./", location.href);
  url.searchParams.set("window", id);
  window.open(url, "_blank", "noopener");
}
