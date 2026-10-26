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
// Version 2 adds the analyses of history.ts; version 4 the user annotations of userAnnotations.ts and the open tabs of
// tabs.ts. Two branches each took version 3 for one of these stores, and a browser can sit at version 3 with either:
// each store is made when it is missing. Version 5 also came in two shapes: one stores each user annotation as a record
// of its own, by id with an index on the fingerprint (a version 4 record held a recording's whole list), and adds the
// annotation lists read from the files (`fileAnnotations`, by fingerprint); the other adds the batches of core/batch.ts
// and keeps the annotation lists. Version 6 joins them: each store is made when it is missing and the annotations are
// converted by their key path, whatever version the browser comes from. The stores of earlier versions are kept as
// they are.
let connection: Promise<IDBPDatabase> | undefined;
export const database = () =>
  (connection ??= openDB("ddalab", 6, {
    upgrade(db, old, _new, upgrading) {
      if (old < 1) db.createObjectStore("recent", { keyPath: "fingerprint" });
      if (old < 2) db.createObjectStore("analyses", { keyPath: "id" });
      if (!db.objectStoreNames.contains("tabs")) db.createObjectStore("tabs");
      if (!db.objectStoreNames.contains("fileAnnotations")) db.createObjectStore("fileAnnotations");
      if (!db.objectStoreNames.contains("batches")) db.createObjectStore("batches", { keyPath: "id" });
      const perRecord = () => {
        const store = db.createObjectStore("annotations", { keyPath: "id" });
        store.createIndex("fingerprint", "fingerprint");
        return store;
      };
      if (!db.objectStoreNames.contains("annotations")) perRecord();
      else if (upgrading.objectStore("annotations").keyPath === "fingerprint") {
        // A list per recording: each of its annotations becomes a record, within this upgrade's transaction.
        void upgrading
          .objectStore("annotations")
          .getAll()
          .then((lists: { fingerprint: string; annotations?: { id?: unknown }[] }[]) => {
            db.deleteObjectStore("annotations");
            const store = perRecord();
            for (const { fingerprint, annotations } of lists) {
              for (const a of annotations ?? []) {
                // One without an id has no key: putting it would abort the whole upgrade.
                if (typeof a?.id === "string") void store.put({ ...a, fingerprint });
                else console.warn("An annotation without an id was left out of the upgrade", fingerprint, a);
              }
            }
          });
      }
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
