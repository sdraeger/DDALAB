// Where recording bytes come from: files the user chose and URLs, as synchronous reads for the IO worker.

declare const FileReaderSync: new () => { readAsArrayBuffer(blob: Blob): ArrayBuffer };

const READS = "DDALAB reads EDF, BDF, BrainVision and delimited text";
/** The formats DDALAB reads, best first. The text extensions share the last rank. */
const RANK: Record<string, number> = { vhdr: 0, edf: 1, bdf: 2, txt: 3, csv: 3, tsv: 3, ascii: 3, dat: 3 };
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

const extension = (name: string) => (name.split(".").slice(1).at(-1) ?? "").toLowerCase();
/** What a folder pick reports (`dir/sub/file`), or the bare name. */
const pathOf = (file: File) => file.webkitRelativePath || file.name;
const directory = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

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
 * The files of a drop, descending into dropped folders. `handle` is the FileSystemHandle of a single dropped file
 * in browsers that give one (Chromium), which lets the recent list reopen it without a picker.
 */
export async function droppedFiles(
  data: DataTransfer,
): Promise<{ files: File[]; handle?: FileSystemHandle }> {
  // The item list empties when the event ends: ask for everything before the first await.
  const items = Array.from(data.items).filter((item): item is HandleItem => item.kind === "file");
  const entries = items.map((item) => item.webkitGetAsEntry());
  const plain = items.map((item) => item.getAsFile());
  const pending = items.length === 1 ? items[0].getAsFileSystemHandle?.() : undefined;
  const files = await Promise.all(
    entries.map((entry, i) =>
      entry?.isDirectory ? filesUnder(entry) : [plain[i]].filter((f) => f !== null),
    ),
  );
  const handle = await pending?.catch(() => null);
  return { files: files.flat(), handle: handle?.kind === "file" ? handle : undefined };
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

/** Fills `dst` from `offset` of the resource at `url` with a ranged GET; the server must honor `Range`. */
export function readUrlSync(url: string, offset: number, dst: Uint8Array): void {
  if (dst.length === 0) return;
  const request = new XMLHttpRequest();
  request.open("GET", url, false);
  request.responseType = "arraybuffer";
  request.setRequestHeader("Range", `bytes=${offset}-${offset + dst.length - 1}`);
  request.send();
  if (request.status !== 206 || request.response.byteLength !== dst.length) {
    throw new Error(`${url}: asked for ${dst.length} bytes at ${offset}, got status ${request.status}`);
  }
  dst.set(new Uint8Array(request.response));
}
