// The annotations a user makes on a recording, in IndexedDB: one record per annotation, by id, with the recording's
// fingerprint indexed. Each change writes only the annotations it touched, as a read-modify-write in one transaction,
// and tells the other instances of the app on this origin which recording changed: two windows on one recording
// keep each other's annotations.
import { database } from "../store/recent";

/** A mark of the user's: a point when `duration_s` is 0, else a span. Seconds from the recording start. */
export interface UserAnnotation {
  id: string;
  onset_s: number;
  duration_s: number;
  label: string;
}

/** Carries the fingerprint of each recording whose stored annotations another instance changed. */
const channel =
  typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("ddalab-annotations");

/** Calls `listener` with the fingerprint of every recording another instance of the app has stored a change to. */
export function onStoredElsewhere(listener: (fingerprint: string) => void) {
  channel?.addEventListener("message", ({ data }: MessageEvent<{ fingerprint: string }>) =>
    listener(data.fingerprint),
  );
}

export async function loadAnnotations(fingerprint: string): Promise<UserAnnotation[]> {
  const found: (UserAnnotation & { fingerprint: string })[] = await (await database()).getAllFromIndex(
    "annotations",
    "fingerprint",
    fingerprint,
  );
  return found.map(({ fingerprint: _, ...a }) => a);
}

/**
 * Stores the change from `before` to `after`, a recording's list as this instance had it and has it now: added
 * annotations are put, removed ones deleted, and each changed one gets the fields that changed merged onto the stored
 * record, which keeps another instance's change to its other fields. One deleted elsewhere stays deleted.
 */
export async function storeChanges(
  fingerprint: string,
  before: UserAnnotation[],
  after: UserAnnotation[],
): Promise<void> {
  const was = new Map(before.map((a) => [a.id, a]));
  const writes = (await database()).transaction("annotations", "readwrite");
  const store = writes.objectStore("annotations");
  const pending: Promise<unknown>[] = [];
  for (const a of after) {
    const old = was.get(a.id);
    if (!old) {
      pending.push(store.put({ ...a, fingerprint }));
      continue;
    }
    const changed = (Object.keys(a) as (keyof UserAnnotation)[]).filter((key) => a[key] !== old[key]);
    if (changed.length === 0) continue;
    pending.push(
      store.get(a.id).then((stored) => {
        if (stored)
          return store.put({ ...stored, ...Object.fromEntries(changed.map((key) => [key, a[key]])) });
      }),
    );
  }
  const kept = new Set(after.map((a) => a.id));
  for (const a of before) if (!kept.has(a.id)) pending.push(store.delete(a.id));
  await Promise.all([...pending, writes.done]);
  channel?.postMessage({ fingerprint });
}
