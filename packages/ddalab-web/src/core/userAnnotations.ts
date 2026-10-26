// The annotations a user makes on a recording, in IndexedDB under the recording's fingerprint: one record per
// recording, its whole list rewritten on each change (the lists are short).
import { database } from "../store/recent";

/** A mark of the user's: a point when `duration_s` is 0, else a span. Seconds from the recording start. */
export interface UserAnnotation {
  id: string;
  onset_s: number;
  duration_s: number;
  label: string;
}

export async function loadAnnotations(fingerprint: string): Promise<UserAnnotation[]> {
  const found: { annotations: UserAnnotation[] } | undefined = await (await database()).get(
    "annotations",
    fingerprint,
  );
  return found?.annotations ?? [];
}

/** Stores `annotations` as the recording's list; an empty list deletes its record. */
export async function saveAnnotations(fingerprint: string, annotations: UserAnnotation[]): Promise<void> {
  const db = await database();
  if (annotations.length === 0) await db.delete("annotations", fingerprint);
  else await db.put("annotations", { fingerprint, annotations });
}
