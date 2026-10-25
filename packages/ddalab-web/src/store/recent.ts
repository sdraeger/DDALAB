// Recently opened recordings in IndexedDB. A FileSystemHandle lets a recording reopen without a picker, but only
// browsers with showOpenFilePicker (Chromium) can persist one; elsewhere the entry keeps names and the fingerprint
// and the user selects the file again.
import { openDB } from "idb";

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
const database = () =>
  openDB("ddalab", 1, { upgrade: (db) => void db.createObjectStore("recent", { keyPath: "fingerprint" }) });

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
