// Results in the origin private file system, written by the IO worker: /results/<id>/<path> holds the arrays of a
// bundle (window-major f64 `.npy` files, as `ddalab run --bundle` writes them), then `manifest.json`. The `status` file
// says "running" from before the first array exists until every array is flushed and the manifest written, then
// "complete": a directory that is not complete is a run that a reload or a crash cut short. Complete results are read
// back for the heatmap: their manifest, and tiles of each array's max-magnitude pyramid (render/resultPyramid.ts).
import { buildPyramid, FANOUT, type Pyramid, type ResultTile, TILE_CELLS } from "../render/resultPyramid";
import { put } from "./opfs";
import type { ResultArray } from "./protocol";
import type { BlockChunks, BundleLayout, ResultDocument } from "./types";

/** The open array files of each result being written, and the bytes of all of them. */
const writing = new Map<string, { files: FileSystemSyncAccessHandle[]; bytes: number }>();

const resultsDirectory = async () =>
  (await navigator.storage.getDirectory()).getDirectoryHandle("results", { create: true });

const arrayBytes = ({ header, shape }: BundleLayout["arrays"][number]) =>
  header.length + 8 * shape.reduce((n, d) => n * d, 1);

/**
 * Runs `task` again while a file it touches is held by a sync access handle, for up to a second: the page that was
 * just reloaded lets go within moments, a run in another tab does not.
 */
async function whenFree<T>(task: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      const busy = error instanceof DOMException && error.name === "NoModificationAllowedError";
      if (!busy || attempt === 40) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function writeText(directory: FileSystemDirectoryHandle, name: string, text: string) {
  const handle = await directory.getFileHandle(name, { create: true });
  const file = await handle.createSyncAccessHandle();
  try {
    file.truncate(0);
    put(file, new TextEncoder().encode(text), 0);
    file.flush();
  } finally {
    file.close();
  }
}

/** A full storage, as a message naming the size of the whole result; any other error as it is. */
function quota(error: unknown, bytes: number): unknown {
  if (!(error instanceof DOMException && error.name === "QuotaExceededError")) return error;
  const mb = (bytes / 1e6).toLocaleString("en", { maximumSignificantDigits: 2 });
  return new Error(
    `The result needs about ${mb} MB of browser storage, more than is available. Free up space and run it again.`,
  );
}

export async function createResultFiles(resultId: string, layout: BundleLayout): Promise<void> {
  const directory = await (await resultsDirectory()).getDirectoryHandle(resultId, { create: true });
  const bytes = layout.arrays.reduce((sum, array) => sum + arrayBytes(array), 0);
  const files: FileSystemSyncAccessHandle[] = [];
  try {
    await writeText(directory, "status", "running");
    for (const array of layout.arrays) {
      const path = array.path.split("/");
      let folder = directory;
      for (const name of path.slice(0, -1)) folder = await folder.getDirectoryHandle(name, { create: true });
      const handle = await folder.getFileHandle(path[path.length - 1], { create: true });
      const file = await handle.createSyncAccessHandle();
      files.push(file);
      file.truncate(arrayBytes(array));
      put(file, Uint8Array.from(array.header), 0);
    }
  } catch (error) {
    for (const file of files) file.close();
    throw quota(error, bytes);
  }
  writing.set(resultId, { files, bytes });
}

export async function writeChunks(resultId: string, { chunks }: BlockChunks): Promise<void> {
  const result = writing.get(resultId);
  if (!result) throw new Error(`no result ${resultId} is being written`);
  try {
    for (const { array, offset, bytes } of chunks) put(result.files[array], new Uint8Array(bytes), offset);
  } catch (error) {
    throw quota(error, result.bytes);
  }
}

export async function finishResult(resultId: string, manifest: ResultDocument): Promise<void> {
  const result = writing.get(resultId);
  if (!result) throw new Error(`no result ${resultId} is being written`);
  writing.delete(resultId);
  try {
    try {
      for (const file of result.files) file.flush();
    } finally {
      for (const file of result.files) file.close();
    }
    const directory = await (await resultsDirectory()).getDirectoryHandle(resultId);
    await writeText(directory, "manifest.json", JSON.stringify(manifest));
    await writeText(directory, "status", "complete");
  } catch (error) {
    throw quota(error, result.bytes);
  }
}

/** Deletes the files of a result that will not complete (it failed or was cancelled). */
export async function discardResult(resultId: string): Promise<void> {
  for (const file of writing.get(resultId)?.files ?? []) file.close();
  writing.delete(resultId);
  await (await resultsDirectory()).removeEntry(resultId, { recursive: true }).catch((error) => {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
  });
}

async function statusOf(directory: FileSystemDirectoryHandle) {
  try {
    return await (await (await directory.getFileHandle("status")).getFile()).text();
  } catch {
    return undefined;
  }
}

/** On startup: deletes the files of results that are not complete and returns their ids. */
export async function sweepInterrupted(): Promise<string[]> {
  const root = await resultsDirectory();
  const unfinished: string[] = [];
  for await (const [id, entry] of root.entries()) {
    if (entry.kind === "directory" && !writing.has(id) && (await statusOf(entry)) !== "complete") {
      unfinished.push(id);
    }
  }
  const swept: string[] = [];
  for (const id of unfinished) {
    // A run in another tab holds its files open: it is not interrupted, and its directory cannot be removed.
    await whenFree(() => root.removeEntry(id, { recursive: true })).then(
      () => swept.push(id),
      () => {},
    );
  }
  return swept;
}

export async function resultManifest(resultId: string): Promise<ResultDocument> {
  const directory = await (await resultsDirectory()).getDirectoryHandle(resultId);
  return JSON.parse(await (await (await directory.getFileHandle("manifest.json")).getFile()).text());
}

/** An array file of a complete result: its windows, its rows and a reader of windows `w0..w1` as f64. */
async function npy(resultId: string, path: string) {
  const names = path.split("/");
  let folder = await (await resultsDirectory()).getDirectoryHandle(resultId);
  for (const name of names.slice(0, -1)) folder = await folder.getDirectoryHandle(name);
  const file = await (await folder.getFileHandle(names[names.length - 1])).getFile();
  const start = 10 + new DataView(await file.slice(0, 10).arrayBuffer()).getUint16(8, true); // npy format 1.0
  const shape = /'shape': \((\d+), (\d+)\)/.exec(await file.slice(10, start).text());
  if (!shape) throw new Error(`${path} does not hold windows of rows`);
  const [windows, rows] = [Number(shape[1]), Number(shape[2])];
  const read = async (w0: number, w1: number) =>
    new Float64Array(await file.slice(start + w0 * rows * 8, start + w1 * rows * 8).arrayBuffer());
  return { windows, rows, read };
}

/**
 * The arrays shown so far with their pyramids, built in one pass on first use.
 * shortcut: pyramids stay in this worker for the session (a third of the array's windows as f32, about a sixth of
 * its file); drop the least recently shown once sessions view many large results.
 */
const shown = new Map<string, Promise<Awaited<ReturnType<typeof npy>> & { pyramid: Pyramid }>>();

function shownArray(resultId: string, variant: string, array: ResultTile["array"]) {
  const key = `${resultId}/${variant}/${array}`;
  let found = shown.get(key);
  if (!found) {
    found = npy(resultId, `${variant}/${array}.npy`).then(async (file) => ({
      ...file,
      pyramid: await buildPyramid(file.read, file.windows, file.rows),
    }));
    found.catch(() => shown.delete(key)); // asked again, it is read again
    shown.set(key, found);
  }
  return found;
}

export async function resultArray(
  resultId: string,
  variant: string,
  array: ResultTile["array"],
): Promise<ResultArray> {
  const { windows, rows, pyramid } = await shownArray(resultId, variant, array);
  const { levels, rowMin, rowMax } = pyramid;
  return { windows, rows, levels: levels.length + 1, rowMin, rowMax };
}

/** Tile `index` of `level`: level 0 from the file, the others from the pyramid. */
export async function resultTile(
  resultId: string,
  variant: string,
  array: ResultTile["array"],
  level: number,
  index: number,
): Promise<ResultTile> {
  const { windows, rows, read, pyramid } = await shownArray(resultId, variant, array);
  const cells = Math.ceil(windows / FANOUT ** level);
  if (level > pyramid.levels.length || index * TILE_CELLS >= cells) {
    throw new Error(`tile ${index} of level ${level} does not exist for ${windows} windows`);
  }
  const [c0, c1] = [index * TILE_CELLS, Math.min(cells, (index + 1) * TILE_CELLS)];
  // A copy of the pyramid's cells: the reply transfers it.
  const values =
    level === 0
      ? new Float32Array(await read(c0, c1))
      : pyramid.levels[level - 1].slice(c0 * rows, c1 * rows);
  return { variant, array, level, index, rows, windows: c1 - c0, values };
}
