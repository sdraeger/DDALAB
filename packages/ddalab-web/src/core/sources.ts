// Where recording bytes come from: files the user chose and URLs, as synchronous reads for the workers.
import type { RecordingInput } from "./engine";
import { readSynthetic, type SyntheticSpec, syntheticEdfSize } from "./synthetic";
import type { OpenRequest } from "./types";

declare const FileReaderSync: new () => { readAsArrayBuffer(blob: Blob): ArrayBuffer };

const READS = "DDALAB reads EDF, BDF, BrainVision and delimited text";
/** The formats DDALAB reads, best first. The text extensions share the last rank. */
export const RANK: Record<string, number> = {
  vhdr: 0,
  edf: 1,
  bdf: 2,
  txt: 3,
  csv: 3,
  tsv: 3,
  ascii: 3,
  dat: 3,
};
/** Formats the spec names as not supported yet, by extension. */
const UNSUPPORTED: Record<string, string> = {
  fif: "FIFF",
  set: "EEGLAB",
  nwb: "NWB",
  xdf: "XDF",
  nii: "NIfTI",
  cnt: "CNT",
  gdf: "GDF",
};

export type FileSet =
  | { primary: string; files: File[] }
  | { candidates: string[] } // several recordings: the user chooses one and calls again with it
  | { error: string };

export const extension = (name: string) => (name.split(".").slice(1).at(-1) ?? "").toLowerCase();
/** A DDALAB project (core/project.ts), which opens as its tabs. */
export const isProject = (name: string) => extension(name) === "ddalab";
/** What a folder pick reports (`dir/sub/file`), or the bare name. */
export const pathOf = (file: File) => file.webkitRelativePath || file.name;
export const directory = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

/**
 * Picks the recording to open (`choice` is one of its `candidates`) and passes every file of its directory:
 * the core finds the data file and BIDS sidecars by name and reads only what it needs.
 */
export function buildFileSet(files: File[], choice?: string): FileSet {
  if (files.length === 0) return { error: "No file was chosen" };
  const rank = (file: File) => RANK[extension(file.name)] ?? Number.POSITIVE_INFINITY;
  const best = Math.min(...files.map(rank));
  if (best === Number.POSITIVE_INFINITY) {
    const named = files.map((f) => UNSUPPORTED[extension(f.name)]).find(Boolean);
    return {
      error: named
        ? `${named} files are not supported yet; ${READS}`
        : `${files[0].name} is not a format DDALAB reads; ${READS}`,
    };
  }
  const candidates = files.filter((file) => rank(file) === best).map(pathOf);
  const path = choice ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (path === undefined) return { candidates: candidates.sort() };
  const primary = files.find((file) => pathOf(file) === path);
  if (!primary) return { error: `${path} is not among the files` };
  return {
    primary: primary.name,
    files: files.filter((file) => directory(pathOf(file)) === directory(path)),
  };
}

/** The files under `entry`, each reporting its path from the dropped folder as `webkitRelativePath`. */
async function filesUnder(entry: FileSystemEntry, parent = ""): Promise<File[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail));
    Object.defineProperty(file, "webkitRelativePath", { value: parent + file.name });
    return [file];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  // `readEntries` returns a batch at a time (about 100 in Chromium) until it returns none.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (batch.length === 0) break;
    children.push(...batch);
  }
  return (await Promise.all(children.map((child) => filesUnder(child, `${parent}${entry.name}/`)))).flat();
}

type HandleItem = DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> };

/**
 * The files of a drop, descending into dropped folders. In browsers that give FileSystemHandles (Chromium), `handle`
 * is the one of a single dropped file, which lets the recent list reopen it without a picker, and `handles` holds every
 * dropped file's in the order of `files` when only files were dropped, which lets its tab reattach.
 */
export async function droppedFiles(data: DataTransfer): Promise<{
  files: File[];
  handle?: FileSystemHandle;
  handles: { files?: FileSystemFileHandle[] };
}> {
  // The item list empties when the event ends: ask for everything before the first await.
  const items = Array.from(data.items).filter((item): item is HandleItem => item.kind === "file");
  const entries = items.map((item) => item.webkitGetAsEntry());
  const plain = items.map((item) => item.getAsFile());
  const pending = items.map((item) => item.getAsFileSystemHandle?.().catch(() => null));
  const files = await Promise.all(
    entries.map((entry, i) =>
      entry?.isDirectory ? filesUnder(entry) : [plain[i]].filter((f) => f !== null),
    ),
  );
  const found = await Promise.all(pending);
  // Folders are walked by the folder tree (LibraryRail): a drop of files alone keeps their handles.
  const own = found.every((h) => h?.kind === "file") ? (found as FileSystemFileHandle[]) : undefined;
  const handle = found.length === 1 && found[0]?.kind === "file" ? found[0] : undefined;
  return { files: files.flat(), handle, handles: { files: own } };
}

/** Fills `dst` from `offset` of `file`; throws when the file is shorter, which means it changed after opening. */
export function readFileSync(file: Blob, offset: number, dst: Uint8Array): void {
  const bytes = new Uint8Array(
    new FileReaderSync().readAsArrayBuffer(file.slice(offset, offset + dst.length)),
  );
  if (bytes.length !== dst.length)
    throw new Error(`read ${bytes.length} of ${dst.length} bytes at ${offset}; the file changed`);
  dst.set(bytes);
}

/** The largest file a server that ignores Range may send whole: one block of the core's cache, fetched once. */
const WHOLE_FILE_LIMIT = 4 * 2 ** 20;

/**
 * Fills `dst` from `offset` of the file of `size` bytes at `url` with a ranged GET. A server that ignores Range
 * answers 200 with the whole file, which is taken for files up to 4 MiB (OpenNeuro's object store sends its small
 * unannexed sidecars whole) and refused above, where every read would download the whole file.
 */
export function readUrlSync(url: string, size: number, offset: number, dst: Uint8Array): void {
  if (dst.length === 0) return;
  const request = new XMLHttpRequest();
  request.open("GET", url, false);
  request.responseType = "arraybuffer";
  request.setRequestHeader("Range", `bytes=${offset}-${offset + dst.length - 1}`);
  request.send();
  if (request.status === 200 && size > WHOLE_FILE_LIMIT) {
    throw new Error(
      `${new URL(url).host} ignores Range requests: ${url} is above 4 MiB and would download whole at every read`,
    );
  }
  const body = new Uint8Array(request.response);
  const whole = request.status === 200 && body.length === size;
  const part = whole ? body.subarray(offset, offset + dst.length) : body;
  if (!(whole || request.status === 206) || part.length !== dst.length) {
    throw new Error(
      `${url}: asked for ${dst.length} bytes at ${offset}, got status ${request.status} with ${body.length} bytes`,
    );
  }
  dst.set(part);
}

/** Where the bytes of one recording file come from. */
export type Source = { file: Blob } | { url: string; size: number } | { spec: SyntheticSpec };
export interface Part {
  name: string;
  size: number;
  source: Source;
}

/** The files of `input` with their sources. */
export function partsOf(input: RecordingInput): Part[] {
  if (input.kind === "files")
    return input.files.map((file) => ({ name: file.name, size: file.size, source: { file } }));
  if (input.kind === "url")
    return input.files.map(({ name, size, url }) => ({ name, size, source: { url, size } }));
  if (!(import.meta.env.DEV || import.meta.env.MODE === "e2e")) {
    throw new Error("Synthetic recordings are not available");
  }
  return [{ name: "synthetic.edf", size: syntheticEdfSize(input.spec), source: { spec: input.spec } }];
}

/** What the core opens: the primary file and every file of `parts` under the id `fileIds` has for it. */
export const openRequestOf = (input: RecordingInput, parts: Part[], fileIds: number[]): OpenRequest => ({
  primary: "primary" in input ? input.primary : parts[0].name,
  files: parts.map(({ name, size }, i) => ({ name, file_id: fileIds[i], len: size })),
});

/** Fills `dst` from `offset` of `source`. */
export function readSource(source: Source, offset: number, dst: Uint8Array): void {
  if ("file" in source) readFileSync(source.file, offset, dst);
  else if ("url" in source) readUrlSync(source.url, source.size, offset, dst);
  else if (import.meta.env.DEV || import.meta.env.MODE === "e2e") readSynthetic(source.spec, offset, dst);
  else throw new Error("Synthetic recordings are not available");
}

// shortcut: remote files above 1 GiB get on-demand tiles only, revisit if remote viewing of large files matters.
const REMOTE_SCAN_LIMIT = 2 ** 30;

/** Whether the scan builds the overview of `input` and the hash and annotation workers read it whole. */
export const isScanned = (input: RecordingInput) =>
  input.kind !== "url" || input.files.reduce((sum, { size }) => sum + size, 0) <= REMOTE_SCAN_LIMIT;
