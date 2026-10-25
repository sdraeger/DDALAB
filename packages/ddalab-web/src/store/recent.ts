// Recently opened recordings in IndexedDB. A FileSystemHandle lets a recording reopen without a picker, but only
// browsers with showOpenFilePicker (Chromium) can persist one; elsewhere the entry keeps names and the fingerprint
// and the user selects the file again.
import { type IDBPDatabase, openDB } from "idb";

export interface RecentEntry {
  /** Identity of the recording; see `fingerprint.ts`. */
  fingerprint: string;
  primary: string;
  /** The files the recording was read from. */
  names: string[];
  handle?: FileSystemHandle;
  lastOpened: number;
}

const KEEP = 20;
// One connection for the page. When another tab asks for a newer version this one closes (`blocking`) and that
// tab's upgrade is not held up; the next call opens again, and fails if this code is older than the database.
// Version 2 adds the analyses of history.ts.
let connection: Promise<IDBPDatabase> | undefined;
export const database = () =>
  (connection ??= openDB("ddalab", 2, {
    upgrade(db, old, _new, upgrading) {
      if (old < 1) db.createObjectStore("recent", { keyPath: "fingerprint" });
      if (old < 2) db.createObjectStore("analyses", { keyPath: "id" });
      // idb wraps the upgrade transaction and rejects `done` if it aborts, as it does when the page closes mid-upgrade.
      upgrading.done.catch(() => {});
    },
    blocking: () => void connection?.then((db) => db.close()).finally(() => (connection = undefined)),
    terminated: () => (connection = undefined),
  }).catch((error) => {
    connection = undefined;
    throw error;
  }));

/** Notes that `entry` was opened at `lastOpened`, replacing its earlier entry and dropping the oldest past 20. */
export async function rememberRecent(
  entry: Omit<RecentEntry, "lastOpened">,
  lastOpened = Date.now(),
): Promise<void> {
  const handle = "showOpenFilePicker" in globalThis ? entry.handle : undefined;
  const db = await database();
  await db.put("recent", { ...entry, handle, lastOpened });
  const all: RecentEntry[] = await db.getAll("recent");
  const stale = all.sort((a, b) => b.lastOpened - a.lastOpened).slice(KEEP);
  await Promise.all(stale.map((e) => db.delete("recent", e.fingerprint)));
}

/** Newest first. */
export async function listRecent(): Promise<RecentEntry[]> {
  const all: RecentEntry[] = await (await database()).getAll("recent");
  return all.sort((a, b) => b.lastOpened - a.lastOpened);
}

export async function forgetRecent(fingerprint: string): Promise<void> {
  await (await database()).delete("recent", fingerprint);
}
