// Copies of recordings streamed from OpenNeuro kept on this device, in the origin private file system at
// /offline/<key>/<name>, which open without the network: a recording with a whole copy reads it before its URLs
// (app/recordings.ts). The key is the SHA-256 of the primary file's URL, which names one file of one snapshot. Clearing
// the cached tiles leaves the copies; Remove deletes one.
import type { RecordingInput } from "./engine";
import { sha256Hex } from "./fingerprint";

type UrlInput = Extract<RecordingInput, { kind: "url" }>;

/** Whether this browser writes files into its private storage from a page (Safari before 26 does not). */
export const canKeep = () =>
  typeof FileSystemFileHandle !== "undefined" && "createWritable" in FileSystemFileHandle.prototype;

const keyOf = (input: UrlInput) =>
  sha256Hex(input.files.find((f) => f.name === input.primary)?.url ?? input.primary);

async function folder(input: UrlInput, create = false) {
  const root = await navigator.storage.getDirectory();
  const offline = await root.getDirectoryHandle("offline", { create });
  return offline.getDirectoryHandle(await keyOf(input), { create });
}

/** The files of `input`'s copy, named as the input names them, when each is there whole; `undefined` otherwise. */
export async function keptFiles(input: UrlInput): Promise<File[] | undefined> {
  try {
    const dir = await folder(input);
    const files = await Promise.all(
      input.files.map(async (f) => (await dir.getFileHandle(f.name)).getFile()),
    );
    return files.every((file, i) => file.size === input.files[i].size) ? files : undefined;
  } catch {
    return undefined;
  }
}

/** Deletes `input`'s copy, whole or partial. */
export async function dropCopy(input: UrlInput) {
  const root = await navigator.storage.getDirectory();
  const offline = await root.getDirectoryHandle("offline").catch(() => undefined);
  await offline?.removeEntry(await keyOf(input), { recursive: true }).catch(() => {});
}

/**
 * Copies every file of `input` to this device, telling `progress` the share of its bytes copied so far. A copy that
 * fails or is stopped (`signal`) is deleted, and the error thrown.
 */
export async function keepCopy(input: UrlInput, progress: (share: number) => void, signal?: AbortSignal) {
  const total = input.files.reduce((sum, f) => sum + f.size, 0) || 1;
  let copied = 0;
  try {
    const dir = await folder(input, true);
    for (const file of input.files) {
      const response = await fetch(file.url, { signal });
      if (!response.ok || !response.body)
        throw new Error(`${file.name}: the server answered ${response.status}`);
      const writable = await (await dir.getFileHandle(file.name, { create: true })).createWritable();
      try {
        const reader = response.body.getReader();
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
          await writable.write(chunk.value);
          copied += chunk.value.length;
          progress(copied / total);
        }
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
    }
    if (!(await keptFiles(input))) throw new Error("The copy does not match the files' sizes");
  } catch (error) {
    await dropCopy(input);
    if (error instanceof DOMException && error.name === "QuotaExceededError")
      throw new Error("This device has no room left for the copy");
    throw error;
  }
}
