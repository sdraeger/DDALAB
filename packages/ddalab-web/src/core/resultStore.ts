// Results in the origin private file system, written by the IO worker: /results/<id>/<path> holds the arrays of a
// bundle (window-major f64 `.npy` files, as `ddalab run --bundle` writes them), then `manifest.json`. The `status` file
// says "running" from before the first array exists until every array is flushed and the manifest written, then
// "complete": a directory that is not complete is a run that a reload or a crash cut short. The worker writing a
// result holds the Web Lock `ddalab-result:<id>` from before its status is written until it is complete or deleted; a
// lock dies with its worker, and a result whose lock is held is being written in some tab. Complete results are read
// back for the heatmap: their manifest, and tiles of each array's max-magnitude pyramid (render/resultPyramid.ts),
// whose levels the first view writes beside the array (`<array>.L<level>.f32`, `<array>.pyramid.json`); an export
// of the bundle leaves them out.
import { buildPyramid, FANOUT, type ResultTile, resultLevels, TILE_CELLS } from "../render/resultPyramid";
import { put } from "./opfs";
import type { ResultArray } from "./protocol";
import type { BlockChunks, BundleLayout, ResultDocument } from "./types";

/** The open array files of each result being written, the bytes of all of them and the release of its lock. */
const writing = new Map<
  string,
  { files: FileSystemSyncAccessHandle[]; bytes: number; release: () => void }
>();

/**
 * The folder of every result, for writing and reading. A window without OPFS rejects with an UnknownError that calls
 * itself transient (private browsing can cause it), or has no `navigator.storage` at all (an insecure origin).
 */
export async function resultsDirectory() {
  let root: FileSystemDirectoryHandle;
  try {
    root = await navigator.storage.getDirectory();
  } catch (cause) {
    throw new Error(
      "Browser storage, where results are kept, is not available in this window; private browsing can cause this. " +
        "Open DDALAB in a regular window.",
      { cause },
    );
  }
  return root.getDirectoryHandle("results", { create: true });
}

const arrayBytes = ({ header, shape }: BundleLayout["arrays"][number]) =>
  header.length + 8 * shape.reduce((n, d) => n * d, 1);

const lockOf = (resultId: string) => `ddalab-result:${resultId}`;

/** Takes the lock of a result and keeps it until the returned function is called. */
function hold(resultId: string): Promise<() => void> {
  return new Promise((held, refused) => {
    navigator.locks
      .request(lockOf(resultId), () => new Promise<void>((release) => held(release)))
      .catch(refused);
  });
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

/** A failed create keeps its lock until `discardResult` deletes what it wrote. */
export async function createResultFiles(resultId: string, layout: BundleLayout): Promise<void> {
  const bytes = layout.arrays.reduce((sum, array) => sum + arrayBytes(array), 0);
  const result = { files: [] as FileSystemSyncAccessHandle[], bytes, release: await hold(resultId) };
  writing.set(resultId, result);
  try {
    const directory = await (await resultsDirectory()).getDirectoryHandle(resultId, { create: true });
    await writeText(directory, "status", "running");
    for (const array of layout.arrays) {
      const path = array.path.split("/");
      let folder = directory;
      for (const name of path.slice(0, -1)) folder = await folder.getDirectoryHandle(name, { create: true });
      const handle = await folder.getFileHandle(path[path.length - 1], { create: true });
      const file = await handle.createSyncAccessHandle();
      result.files.push(file);
      file.truncate(arrayBytes(array));
      put(file, Uint8Array.from(array.header), 0);
    }
  } catch (error) {
    throw quota(error, bytes);
  }
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

/** A failed finish keeps the lock until `discardResult`. */
export async function finishResult(resultId: string, manifest: ResultDocument): Promise<void> {
  const result = writing.get(resultId);
  if (!result) throw new Error(`no result ${resultId} is being written`);
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
  writing.delete(resultId);
  result.release();
}

const removeResult = (root: FileSystemDirectoryHandle, resultId: string) =>
  root.removeEntry(resultId, { recursive: true }).catch((error) => {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
  });

/** Bytes copied into a stored result at a time. */
const STORE_SLICE_BYTES = 4 * 2 ** 20;

/**
 * Writes a result that was made elsewhere (an import) under `resultId`, with the protocol of a run: the files of
 * `layout`, the values of each array from `values` (its bytes after the header) a slice at a time, then the manifest.
 * A result that cannot be written leaves no files.
 */
export async function storeResult(
  resultId: string,
  layout: BundleLayout,
  values: Blob[],
  manifest: ResultDocument,
): Promise<void> {
  try {
    await createResultFiles(resultId, layout);
    for (const [array, blob] of values.entries()) {
      const offset = layout.arrays[array].header.length;
      for (let at = 0; at < blob.size; at += STORE_SLICE_BYTES) {
        const bytes = await blob.slice(at, at + STORE_SLICE_BYTES).arrayBuffer();
        await writeChunks(resultId, { chunks: [{ array, offset: offset + at, bytes }] });
      }
    }
    await finishResult(resultId, manifest);
  } catch (error) {
    // The error that stopped the import is the one reported, whatever the clean-up does.
    await discardResult(resultId).catch(() => {});
    throw error;
  }
}

/** Deletes the files of a result that will not complete (it failed or was cancelled). */
export async function discardResult(resultId: string): Promise<void> {
  const result = writing.get(resultId);
  writing.delete(resultId);
  try {
    for (const file of result?.files ?? []) file.close();
    await removeResult(await resultsDirectory(), resultId);
  } finally {
    result?.release();
  }
}

/**
 * Deletes a result, its pyramid levels with it. It waits for the pyramid builds of every tab
 * (`ddalab-pyramid:<id>`, which they hold shared) and for a tab still writing it (`ddalab-result:<id>`).
 */
export async function deleteResult(resultId: string): Promise<void> {
  await navigator.locks.request(`ddalab-pyramid:${resultId}`, () =>
    navigator.locks.request(lockOf(resultId), async () => {
      for (const path of shown.keys()) if (path.startsWith(`${resultId}/`)) shown.delete(path);
      await removeResult(await resultsDirectory(), resultId);
    }),
  );
}

async function statusOf(directory: FileSystemDirectoryHandle) {
  try {
    return await (await (await directory.getFileHandle("status")).getFile()).text();
  } catch {
    return undefined;
  }
}

/**
 * On startup: deletes the files of results that are not complete and returns their ids. A result whose lock is held
 * is being written (in this tab or another) and stays; under the lock the status is read again, as the run that held
 * it may have completed meanwhile. A result that cannot be removed stays for the next start; the others go.
 */
export async function sweepInterrupted(): Promise<string[]> {
  const root = await resultsDirectory();
  const directories: [string, FileSystemDirectoryHandle][] = [];
  for await (const [id, entry] of root.entries()) {
    if (entry.kind === "directory") directories.push([id, entry]);
  }
  const statuses = await Promise.all(directories.map(([, directory]) => statusOf(directory)));
  const unfinished = directories.filter((_, i) => statuses[i] !== "complete");
  const swept: string[] = [];
  for (const [id, directory] of unfinished) {
    await navigator.locks
      .request(lockOf(id), { ifAvailable: true }, async (lock) => {
        if (!lock || (await statusOf(directory)) === "complete") return;
        await removeResult(root, id);
        swept.push(id);
      })
      .catch(() => {});
  }
  return swept;
}

export async function resultManifest(resultId: string): Promise<ResultDocument> {
  const directory = await (await resultsDirectory()).getDirectoryHandle(resultId);
  return JSON.parse(await (await (await directory.getFileHandle("manifest.json")).getFile()).text());
}

/** An array file of a complete result: its windows, its rows and a reader of windows `w0..w1` as f64. */
async function npy(file: File, path: string) {
  const start = 10 + new DataView(await file.slice(0, 10).arrayBuffer()).getUint16(8, true); // npy format 1.0
  const shape = /'shape': \((\d+), (\d+)\)/.exec(await file.slice(10, start).text());
  if (!shape) throw new Error(`${path} does not hold windows of rows`);
  const [windows, rows] = [Number(shape[1]), Number(shape[2])];
  const read = async (w0: number, w1: number) =>
    new Float64Array(await file.slice(start + w0 * rows * 8, start + w1 * rows * 8).arrayBuffer());
  return { windows, rows, read };
}

/** What `<array>.pyramid.json` holds; a row without a finite value has `null` ranges. */
interface PyramidRecord {
  levels: number;
  rowMin: (number | null)[];
  rowMax: (number | null)[];
}

/**
 * The pyramid of an array lives beside it: `<array>.L<level>.f32` holds the cells of each level from 1 up (f32,
 * window-major) and `<array>.pyramid.json`, written last, its level count and row ranges. A pyramid without the
 * record is built again. The Web Lock `ddalab-pyramid:<path>` keeps two tabs from building one at once, and the
 * shared lock `ddalab-pyramid:<id>` keeps the result from being deleted meanwhile.
 */
async function pyramidOf(
  folder: FileSystemDirectoryHandle,
  array: string,
  resultId: string,
  path: string,
  source: File,
) {
  const { windows, rows, read } = await npy(source, path);
  const levels = resultLevels(windows);
  const name = (level: number) => `${array}.L${level}.f32`;
  /** Writes every level's file, then the record. A full storage leaves neither. */
  async function build(): Promise<PyramidRecord> {
    const files: FileSystemSyncAccessHandle[] = [];
    let bytes = 0;
    try {
      for (let level = 1; level < levels; level++) {
        const file = await (
          await folder.getFileHandle(name(level), { create: true })
        ).createSyncAccessHandle();
        files.push(file);
        file.truncate(0);
        bytes += Math.ceil(windows / FANOUT ** level) * rows * 4;
      }
      const ranges = await buildPyramid(read, windows, rows, (level, cell, values) =>
        put(
          files[level - 1],
          new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
          cell * rows * 4,
        ),
      );
      for (const file of files) file.flush();
      const toJson = (values: Float64Array) => Array.from(values, (v) => (Number.isFinite(v) ? v : null));
      const record = { levels, rowMin: toJson(ranges.rowMin), rowMax: toJson(ranges.rowMax) };
      await writeText(folder, `${array}.pyramid.json`, JSON.stringify(record));
      return record;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "QuotaExceededError")) throw error;
      // What was written goes (a file open for writing cannot be removed): the next view builds the pyramid again.
      for (const file of files) file.close();
      for (let level = 1; level < levels; level++) await folder.removeEntry(name(level)).catch(() => {});
      await folder.removeEntry(`${array}.pyramid.json`).catch(() => {});
      const mb = (bytes / 1e6).toLocaleString("en", { maximumSignificantDigits: 2 });
      throw new Error(
        `Zooming out on this result needs about ${mb} MB of browser storage, more than is available. Free up space and show it again.`,
      );
    } finally {
      for (const file of files) file.close();
    }
  }
  const record = await navigator.locks.request(`ddalab-pyramid:${resultId}`, { mode: "shared" }, () =>
    navigator.locks.request(`ddalab-pyramid:${path}`, async () => {
      const stored = await folder
        .getFileHandle(`${array}.pyramid.json`)
        .then(async (handle) => JSON.parse(await (await handle.getFile()).text()) as PyramidRecord)
        .catch(() => null);
      return stored?.levels === levels ? stored : build();
    }),
  );
  const files = await Promise.all(
    Array.from({ length: levels - 1 }, async (_, i) => (await folder.getFileHandle(name(i + 1))).getFile()),
  );
  const ranges = (values: (number | null)[], none: number) => Float64Array.from(values, (v) => v ?? none);
  return {
    windows,
    rows,
    levels,
    read,
    files,
    rowMin: ranges(record.rowMin, Number.POSITIVE_INFINITY),
    rowMax: ranges(record.rowMax, Number.NEGATIVE_INFINITY),
  };
}

/** The arrays shown so far: their sizes, row ranges and files. Tiles are read from the files on each request. */
const shown = new Map<string, Promise<Awaited<ReturnType<typeof pyramidOf>>>>();

function shownArray(resultId: string, variant: string, array: ResultTile["array"]) {
  const path = `${resultId}/${variant}/${array}`;
  let found = shown.get(path);
  if (!found) {
    found = (async () => {
      const folder = await (await (await resultsDirectory()).getDirectoryHandle(resultId)).getDirectoryHandle(
        variant,
      );
      const source = await (await folder.getFileHandle(`${array}.npy`)).getFile();
      return pyramidOf(folder, array, resultId, path, source);
    })();
    found.catch(() => shown.delete(path)); // asked again, it is read again
    shown.set(path, found);
  }
  return found;
}

export async function resultArray(
  resultId: string,
  variant: string,
  array: ResultTile["array"],
): Promise<ResultArray> {
  const { windows, rows, levels, rowMin, rowMax } = await shownArray(resultId, variant, array);
  return { windows, rows, levels, rowMin, rowMax };
}

/** Tile `index` of `level`, read from the array's file at level 0 and from the level's file above. */
export async function resultTile(
  resultId: string,
  variant: string,
  array: ResultTile["array"],
  level: number,
  index: number,
): Promise<ResultTile> {
  const { windows, rows, levels, read, files } = await shownArray(resultId, variant, array);
  const cells = Math.ceil(windows / FANOUT ** level);
  if (level >= levels || index * TILE_CELLS >= cells) {
    throw new Error(`tile ${index} of level ${level} does not exist for ${windows} windows`);
  }
  const [c0, c1] = [index * TILE_CELLS, Math.min(cells, (index + 1) * TILE_CELLS)];
  const values =
    level === 0
      ? new Float32Array(await read(c0, c1))
      : new Float32Array(await files[level - 1].slice(c0 * rows * 4, c1 * rows * 4).arrayBuffer());
  return { variant, array, level, index, rows, windows: c1 - c0, values };
}
