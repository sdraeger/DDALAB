// An opened folder: walking it without holding up the page, finding its recordings by the rules the core opens them
// with, and shaping them into the rows of a tree.
import { directory, extension, pathOf, RANK } from "./sources";

/** What a walk reads: a picked directory, the entries of a drop, or the files of a folder <input>. */
export type FolderSource =
  | { kind: "handle"; handle: FileSystemDirectoryHandle }
  | { kind: "entries"; entries: FileSystemEntry[] }
  | { kind: "files"; files: File[] };

export type Format = "EDF" | "BDF" | "BrainVision" | "Text";

export interface FolderRecording {
  /** The primary file's path from the opened folder's parent, as `webkitRelativePath` gives it. */
  path: string;
  /** The file name without its extension; inside a BIDS dataset also without the entities its folders show
   * (sub, ses) and the modality suffix. */
  name: string;
  format: Format;
  /** Bytes of the primary file and its companions. */
  size: number;
  /** The primary file, then the companions found beside it. */
  files: File[];
  /** Why the core could not open it. */
  missing?: string;
}

/** Entries a walk leaves out at any depth. */
const skipped = (name: string) => name.startsWith(".") || name === "node_modules";
/** Names of BIDS tables and sidecars, inside a dataset or outside one. */
const BIDS_TABLE = /(^participants|_(channels|events|electrodes|scans|sessions))\.tsv$/i;
const FORMATS: Record<string, Format> = { vhdr: "BrainVision", edf: "EDF", bdf: "BDF" };
// [Common Infos] opens a header; a large file named .vhdr is not read whole.
const HEADER_BYTES = 64 * 1024;

const withPath = (file: File, path: string) => {
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
};

/** What a walk found. `handles` and `root` hold the FileSystemHandles of the files and of the opened folder where
 * the browser gives them (the directory picker, a folder dropped in Chromium). */
export interface Walked {
  files: File[];
  handles: Map<File, FileSystemFileHandle>;
  root?: FileSystemDirectoryHandle;
  /** Files, and folders below the opened one, that could not be read. */
  unreadable: { files: number; folders: number };
}

/**
 * The files under `source`, each with its path from the opened folder's parent as `webkitRelativePath`. Hidden
 * entries and node_modules are not descended into. An entry below the opened folder that cannot be read (removed
 * during the walk, a dangling link) is skipped and counted. `progress` hears the count a few times a second.
 */
export async function walk(
  source: FolderSource,
  signal: AbortSignal,
  progress: (count: number) => void,
): Promise<Walked> {
  const handles = new Map<File, FileSystemFileHandle>();
  if (source.kind === "files") {
    progress(source.files.length);
    return { files: source.files, handles, unreadable: { files: 0, folders: 0 } };
  }
  const found: File[] = [];
  let listed = 0;
  let reported = 0;
  const unreadable = { files: 0, folders: 0 };
  // Files count as they are listed: a large flat folder shows progress before its files are read.
  const count = (n: number) => {
    signal.throwIfAborted();
    listed += n;
    if (performance.now() - reported > 100) {
      reported = performance.now();
      progress(listed);
    }
  };
  const keep = async (files: Promise<File>[]) => {
    for (const read of await Promise.allSettled(files)) {
      if (read.status === "fulfilled") found.push(read.value);
      else unreadable.files++;
    }
    signal.throwIfAborted();
  };
  const below = async (folder: () => Promise<void>) => {
    try {
      await folder();
    } catch (error) {
      if (signal.aborted) throw error;
      unreadable.folders++;
    }
  };
  // A listing that fails midway still keeps the files it listed: their reads settle before the failure moves on.
  async function fromHandles(dir: FileSystemDirectoryHandle, path: string) {
    const files: Promise<File>[] = [];
    const folders: FileSystemDirectoryHandle[] = [];
    try {
      for await (const handle of dir.values()) {
        if (skipped(handle.name)) continue;
        if (handle.kind === "directory") folders.push(handle as FileSystemDirectoryHandle);
        else {
          const own = handle as FileSystemFileHandle;
          files.push(
            own.getFile().then((f) => {
              handles.set(f, own);
              return withPath(f, path + own.name);
            }),
          );
        }
        count(handle.kind === "file" ? 1 : 0);
      }
    } finally {
      await keep(files);
    }
    for (const folder of folders) await below(() => fromHandles(folder, `${path}${folder.name}/`));
  }
  const file = (entry: FileSystemEntry, path: string) =>
    new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail)).then((f) =>
      withPath(f, path),
    );
  async function fromEntries(entry: FileSystemEntry, parent: string) {
    if (skipped(entry.name)) return;
    if (entry.isFile) {
      count(1);
      return keep([file(entry, parent + entry.name)]);
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = [];
    const path = `${parent}${entry.name}/`;
    try {
      // `readEntries` returns a batch at a time (about 100 in Chromium) until it returns none.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
        if (batch.length === 0) break;
        const kept = batch.filter((child) => !skipped(child.name));
        children.push(...kept);
        count(kept.filter((child) => child.isFile).length);
      }
    } finally {
      await keep(children.filter((c) => c.isFile).map((c) => file(c, path + c.name)));
    }
    for (const child of children.filter((c) => c.isDirectory)) await below(() => fromEntries(child, path));
  }

  if (source.kind === "handle") await fromHandles(source.handle, `${source.handle.name}/`);
  else for (const entry of source.entries) await fromEntries(entry, "");
  progress(listed);
  const root = source.kind === "handle" ? source.handle : undefined;
  return { files: found, handles, root, unreadable };
}

/** `FileSet::sidecar_names` of the core: `<prefix>_channels.tsv`, `<prefix>_events.tsv`, `<prefix>_<modality>.json`. */
function sidecarNames(primary: string): string[] {
  const stem = primary.slice(0, primary.lastIndexOf("."));
  const cut = stem.lastIndexOf("_");
  if (cut < 0) return [];
  const prefix = stem.slice(0, cut);
  return [`${prefix}_channels.tsv`, `${prefix}_events.tsv`, `${stem}.json`];
}

/** The base names of the first `DataFile` and `MarkerFile` in the [Common Infos] of a .vhdr: the ones the reader opens. */
function headerFiles(text: string): { data?: string; marker?: string } {
  const found: { data?: string; marker?: string } = {};
  let common = false;
  for (const line of text.split(/\r?\n/).map((l) => l.trim())) {
    if (line.startsWith(";")) continue;
    const section = /^\[(.*)\]$/.exec(line);
    if (section) common = section[1].trim().toLowerCase() === "common infos";
    const cut = line.indexOf("=");
    if (section || !common || cut < 0) continue;
    const key = line.slice(0, cut).trim().toLowerCase();
    const base = line
      .slice(cut + 1)
      .trim()
      .split(/[/\\]/)
      .at(-1);
    if (key === "datafile") found.data ??= base;
    if (key === "markerfile") found.marker ??= base;
  }
  return found;
}

function shortName(path: string, inBids: boolean): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const stem = name.slice(0, name.lastIndexOf("."));
  if (!inBids) return stem;
  const shown = new Set(path.split("/").slice(0, -1));
  const parts = stem.split("_");
  if (!parts.at(-1)?.includes("-")) parts.pop(); // the modality suffix, such as ieeg
  const kept = parts.filter((part) => !shown.has(part));
  return kept.length > 0 ? kept.join(" ") : stem;
}

/**
 * The recordings of a folder listing with their companion files. A recording is a file of a format the core reads
 * (.vhdr, .edf, .bdf, and delimited text outside a BIDS dataset) that is no BIDS table and no other recording's
 * companion. Its companions are its BIDS sidecars and, for a .vhdr, the data and marker files its header names. A
 * folder holding dataset_description.json is the root of a BIDS dataset.
 */
export async function classifyFolder(files: File[]): Promise<FolderRecording[]> {
  const listed = files.filter((file) => !pathOf(file).split("/").some(skipped));
  const byPath = new Map(listed.map((file) => [pathOf(file), file]));
  const bidsRoots = listed
    .filter((file) => file.name === "dataset_description.json")
    .map((f) => directory(pathOf(f)));
  const inBids = (path: string) => bidsRoots.some((root) => path.startsWith(root));
  const candidates = listed.filter((file) => {
    const ext = extension(file.name);
    return ext in RANK && !BIDS_TABLE.test(file.name) && (ext in FORMATS || !inBids(pathOf(file)));
  });
  const found = await Promise.all(
    candidates.map(async (file) => {
      const dir = directory(pathOf(file));
      const names = sidecarNames(file.name);
      let missing: string | undefined;
      if (extension(file.name) === "vhdr") {
        const text = await file
          .slice(0, HEADER_BYTES)
          .text()
          .catch(() => undefined);
        const { data, marker } = headerFiles(text ?? "");
        if (text === undefined) missing = "The header could not be read";
        else if (!data) missing = "The header names no data file";
        else if (!byPath.has(dir + data)) missing = `Missing data file ${data}`;
        names.push(...[data, marker].filter((n) => n !== undefined));
      }
      return { companions: names.map((n) => dir + n).filter((p) => byPath.has(p)), missing };
    }),
  );
  const taken = new Set(found.flatMap(({ companions }) => companions));
  return candidates
    .flatMap((file, i) => {
      const path = pathOf(file);
      if (taken.has(path)) return [];
      const own = [file, ...found[i].companions.map((p) => byPath.get(p) as File)];
      const recording: FolderRecording = {
        path,
        name: shortName(path, inBids(path)),
        format: FORMATS[extension(file.name)] ?? "Text",
        size: own.reduce((sum, f) => sum + f.size, 0),
        files: own,
      };
      return [found[i].missing ? { ...recording, missing: found[i].missing } : recording];
    })
    .sort((a, b) => collator.compare(a.path, b.path));
}

const collator = new Intl.Collator("en-US", { numeric: true });

/** A row of the tree: a folder (a chain of single-child folders joined by " / ") or a recording. */
export interface FolderNode {
  id: string;
  label: string;
  /** Ids of the rows below a folder: folders first, then recordings, each by label. */
  children: string[];
  /** Recordings under a folder; 1 for a recording. */
  count: number;
  recording?: FolderRecording;
}

export const ROOT = "";
/** Up to this many rows the whole tree opens expanded; above it only its first level does. */
const EXPAND_ALL_ROWS = 40;

/**
 * The tree of `recordings`, holding only folders with a recording under them. `root` names the opened folder, the
 * first segment every path shares; the rows start below it. `expanded` holds every folder when `all` is set or the
 * tree has at most 40 rows, else the top-level folders.
 */
export function folderTree(recordings: FolderRecording[], all: boolean) {
  const tops = new Set(recordings.map((r) => r.path.slice(0, r.path.indexOf("/") + 1)));
  const base = tops.size === 1 && !tops.has("") ? [...tops][0] : "";
  const nodes: Record<string, FolderNode> = { [ROOT]: { id: ROOT, label: "", children: [], count: 0 } };
  for (const recording of recordings) {
    const parts = recording.path.slice(base.length).split("/");
    let parent = ROOT;
    for (let depth = 0; depth < parts.length - 1; depth++) {
      const id = `${base}${parts.slice(0, depth + 1).join("/")}/`;
      if (!nodes[id]) {
        nodes[id] = { id, label: parts[depth], children: [], count: 0 };
        nodes[parent].children.push(id);
      }
      nodes[id].count++;
      parent = id;
    }
    nodes[recording.path] = { id: recording.path, label: recording.name, children: [], count: 1, recording };
    nodes[parent].children.push(recording.path);
  }
  // A folder whose only child is a folder gives way to it, carrying its name in front.
  const merge = (id: string): string => {
    const node = nodes[id];
    node.children = node.children
      .map((child) => (nodes[child].recording ? child : merge(child)))
      .sort(
        (a, b) =>
          Number(!!nodes[a].recording) - Number(!!nodes[b].recording) ||
          collator.compare(nodes[a].label, nodes[b].label),
      );
    const only = node.children.length === 1 ? nodes[node.children[0]] : undefined;
    if (id === ROOT || !only || only.recording) return id;
    only.label = `${node.label} / ${only.label}`;
    delete nodes[id];
    return only.id;
  };
  merge(ROOT);
  const folders = Object.keys(nodes).filter((id) => id !== ROOT && !nodes[id].recording);
  const rows = Object.keys(nodes).length - 1;
  const expanded =
    all || rows <= EXPAND_ALL_ROWS ? folders : nodes[ROOT].children.filter((id) => !nodes[id].recording);
  return { root: base.slice(0, -1), nodes, expanded };
}
