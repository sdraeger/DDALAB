// Project files (.ddalab): the open tabs of a workspace with every file their recordings read, byte for byte, their
// annotations, channel choices and views, and the results of those recordings with their batches, in one zip archive
// (app/project.ts writes and opens it). Every entry is stored, so a recording is a byte range of the project, which the
// app reads in place. `project.json` says what the archive holds; `recordings/<k>/<name>` are the files of the k-th
// tab's recording and `results/<id>/` the bundle of a result, as `ddalab run --bundle` writes it. A project from
// elsewhere is untrusted: its project.json is bounded and checked field by field and rebuilt from the fields checked,
// every file it names must be a stored entry of the size it names, and each recording's files must have the
// fingerprint it claims.
import type { TabView } from "../store/tabs";
import type { BatchRecord } from "./batch";
import { fingerprintOf, sha256Hex } from "./fingerprint";
import { at, isNumber, isObject, isString, type KeptRecord, listOf, optional, zipEntries } from "./imports";
import type { UserAnnotation } from "./userAnnotations";

export const SCHEMA = "ddalab.project/1";

/** A project.json above this size is refused: it holds settings and annotations, never samples. */
const PROJECT_LIMIT = 32 * 2 ** 20;

/** A file of a recording in the project. */
export interface ProjectFile {
  /** Its entry: `recordings/<k>/<name>`. */
  path: string;
  name: string;
  size: number;
  sha256: string;
  last_modified: number;
}

export interface ProjectRecording {
  fingerprint: string;
  /** The primary file first, then every other file DDALAB read for it. */
  files: ProjectFile[];
  annotations: UserAnnotation[];
  /** What its tab shows again (view, selection, chosen channels, result), as the store keeps it; `null`: never shown. */
  saved: TabView | null;
  channel_query?: string;
}

export type ProjectBatch = Omit<BatchRecord, "handle">;

export interface Project {
  schema: typeof SCHEMA;
  app_version: string;
  engine_version: string;
  git_commit: string | null;
  created_at_iso: string;
  /** In tab order. */
  recordings: ProjectRecording[];
  /** The fingerprint of the selected tab. */
  active_tab: string | null;
  /** Each result's bundle folder (`results/<id>/`) and what its history record keeps beside the bundle's manifest. */
  results: { path: string; record: KeptRecord }[];
  /** The batches the results belong to, without their folder handles. */
  batches: ProjectBatch[];
}

type Test = (v: unknown) => boolean;
/** Each field by its path and what it must be: a test, or the fields of every item of a list. */
type Fields = [string, Test | Fields][];

/** The first field of `value` that is wrong, as its path after `prefix`; `undefined` if none. */
function wrong(value: unknown, fields: Fields, prefix = ""): string | undefined {
  for (const [path, test] of fields) {
    const v = at(value, path);
    if (typeof test === "function") {
      if (!test(v)) return prefix + path;
      continue;
    }
    if (!Array.isArray(v)) return prefix + path;
    for (const [i, item] of v.entries()) {
      const found = wrong(item, test, `${prefix}${path}[${i}].`);
      if (found) return found;
    }
  }
  return undefined;
}

const shaped = (fields: Fields) => (v: unknown) => wrong(v, fields) === undefined;
const oneOf =
  (...values: unknown[]) =>
  (v: unknown) =>
    values.includes(v);
const matches = (pattern: RegExp) => (v: unknown) => isString(v) && pattern.test(v as string);
const between = (low: number, high: number) => (v: unknown) =>
  isNumber(v) && (v as number) >= low && (v as number) <= high;
const isHash = matches(/^[0-9a-f]{64}$/);
const isId = matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const isCount = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const isBoolean = (v: unknown) => typeof v === "boolean";
/** A time a Date holds, in ms: the History prints it, and a Date beyond ±8.64e15 ms has no ISO string. */
const isTime = between(-8.64e15, 8.64e15);
/** A file name the app may give a File: no folder, no parent. */
const isName = (v: unknown) =>
  isString(v) && /^[^/\\\0]{1,255}$/.test(v as string) && v !== "." && v !== "..";
const span = shaped([
  ["t0", isNumber],
  ["t1", isNumber],
]);

/** What a tab shows again, with the viewer setting 2.0.1 adds (`chosenOnly`). */
const SAVED: Fields = [
  ["view", isObject],
  ["view.t0", isNumber],
  ["view.t1", isNumber],
  ["view.firstChannel", isCount],
  ["view.rowCount", isCount],
  ["view.epochS", oneOf(10, 20, 30)],
  ["view.sensitivityUvPerMm", between(1e-3, 1e6)],
  ["view.chosenOnly", optional(isBoolean)],
  ["selection", optional(span)],
  ["selectedChannels", listOf(isCount)],
  [
    "shownResult",
    optional(
      shaped([
        ["id", isString],
        ["fingerprint", isString],
        ["variant", optional(isString)],
        ["array", oneOf("q", "fit_error")],
        ["row", optional(isCount)],
        ["interval", optional(span)],
      ]),
    ),
  ],
  ["activeResultId", optional(isString)],
];

const RECORDING: Fields = [
  ["fingerprint", isHash],
  ["files", (v) => Array.isArray(v) && v.length > 0],
  [
    "files",
    [
      ["path", isString],
      ["name", isName],
      ["size", isCount],
      ["sha256", isHash],
      ["last_modified", isTime],
    ],
  ],
  [
    "annotations",
    [
      // Not `file:<index>`, the ids of a file's own annotations.
      ["id", matches(/^[\w-]{1,64}$/)],
      ["onset_s", isNumber],
      ["duration_s", (v) => isNumber(v) && (v as number) >= 0],
      ["label", isString],
    ],
  ],
  ["saved", optional(shaped(SAVED))],
  ["channel_query", optional(isString)],
];

const RESULT: Fields = [
  ["path", isString],
  ["record.id", isId],
  ["record.fingerprint", isHash],
  ["record.fileName", isString],
  ["record.inputFiles", optional(listOf(isString))],
  [
    "record.plan",
    optional(
      shaped([
        ["windows", isCount],
        ["blocks", optional(isCount)],
        ["workers", optional(isCount)],
      ]),
    ),
  ],
  ["record.createdAt", isTime],
  ["record.finishedAt", optional(isTime)],
  ["record.batch", optional(isId)],
];

const BATCH: Fields = [
  ["id", isId],
  ["createdAt", isTime],
  ["finishedAt", optional(isTime)],
  ["root", isString],
  ["form.expert", isBoolean],
  ["form.variants", listOf(isString)],
  ...["windowLength", "windowStep", "delays", "modelTerms", "dm", "order", "nrTau"].map(
    (key): [string, Test] => [`form.${key}`, isString],
  ),
  [
    "channels",
    (c) => isObject(c) && (c.kind === "signal" || (c.kind === "labels" && listOf(isString)(c.labels))),
  ],
  [
    "interval",
    (i) =>
      isObject(i) && (i.kind === "whole" || (i.kind === "range" && isNumber(i.startS) && isNumber(i.endS))),
  ],
  ["paths", listOf(isString)],
  [
    "results",
    [
      ["path", isString],
      ["status", oneOf("ok", "error")],
      ["resultId", optional(isId)],
      ["warnings", listOf(isString)],
      ["error", optional(isString)],
    ],
  ],
  ["status", oneOf("running", "complete", "cancelled", "interrupted")],
];

const PROJECT: Fields = [
  ["app_version", isString],
  ["engine_version", isString],
  ["git_commit", optional(isString)],
  ["created_at_iso", isString],
  ["recordings", RECORDING],
  ["active_tab", optional(isHash)],
  ["results", RESULT],
  ["batches", BATCH],
];

/** `value` with only `keys`, those it has; a list of checked primitives is taken as it is. */
const only = <T extends object, K extends keyof T>(value: T, keys: readonly K[]) =>
  Object.fromEntries(keys.filter((k) => value[k] !== undefined).map((k) => [k, value[k]])) as Pick<T, K>;

/** What a project keeps of a result's record; the bundle's manifest gives the rest. */
export const kept = (record: KeptRecord): KeptRecord => ({
  ...only(record, ["id", "fingerprint", "fileName", "inputFiles", "createdAt", "finishedAt", "batch"]),
  ...(record.plan && { plan: only(record.plan, ["windows", "blocks", "workers"]) }),
});

/** A batch with the fields of BatchRecord and nothing else, in one order (two of them compare as JSON). */
export const batchOf = (b: ProjectBatch): ProjectBatch => ({
  ...only(b, ["id", "createdAt", "finishedAt", "root", "paths", "status"]),
  form: only(b.form, [
    "expert",
    "variants",
    "windowLength",
    "windowStep",
    "delays",
    "modelTerms",
    "dm",
    "order",
    "nrTau",
  ]),
  channels: b.channels.kind === "labels" ? { kind: "labels", labels: b.channels.labels } : { kind: "signal" },
  interval:
    b.interval.kind === "range"
      ? { kind: "range", startS: b.interval.startS, endS: b.interval.endS }
      : { kind: "whole" },
  results: b.results.map((r) => only(r, ["path", "status", "resultId", "warnings", "error"])),
});

/** A tab's saved state with the fields a tab reads; the calibration belongs to the display and stays out. */
function savedOf(saved: TabView): TabView {
  const view = only(saved.view as TabView["view"] & { chosenOnly?: boolean }, [
    "t0",
    "t1",
    "firstChannel",
    "rowCount",
    "chosenOnly",
    "epochS",
    "sensitivityUvPerMm",
  ]);
  const shown = saved.shownResult;
  const interval = shown?.interval && only(shown.interval, ["t0", "t1"]);
  return {
    view,
    selection: saved.selection ? only(saved.selection, ["t0", "t1"]) : null,
    selectedChannels: saved.selectedChannels,
    shownResult: shown
      ? { ...only(shown, ["id", "fingerprint", "variant", "array", "row"]), ...(interval && { interval }) }
      : null,
    activeResultId: saved.activeResultId ?? null,
  };
}

/** The first field that does not fit the rest of the project (paths, references, ids twice); `undefined` if none. */
function inconsistent(project: Project): string | undefined {
  // Sets throughout: a project.json of 32 MiB may list hundreds of thousands of items.
  const prints = new Set<string>();
  const marks = new Map<string, number>();
  for (const r of project.recordings)
    for (const a of r.annotations) marks.set(a.id, (marks.get(a.id) ?? 0) + 1);
  for (const [k, { fingerprint, files, annotations }] of project.recordings.entries()) {
    if (prints.has(fingerprint)) return `recordings[${k}].fingerprint`;
    prints.add(fingerprint);
    const names = new Set<string>();
    for (const [i, { path, name }] of files.entries()) {
      if (path !== `recordings/${k}/${name}`) return `recordings[${k}].files[${i}].path`;
      if (names.has(name)) return `recordings[${k}].files[${i}].name`;
      names.add(name);
    }
    // Annotation ids are the store's keys across recordings: one id twice would file one over the other.
    const twice = annotations.findIndex((a) => (marks.get(a.id) as number) > 1);
    if (twice >= 0) return `recordings[${k}].annotations[${twice}].id`;
  }
  if (project.active_tab != null && !prints.has(project.active_tab)) return "active_tab";
  const batches = new Set(project.batches.map((b) => b.id));
  if (batches.size !== project.batches.length) return "batches";
  const results = new Set<string>();
  for (const [i, { path, record }] of project.results.entries()) {
    if (path !== `results/${record.id}/`) return `results[${i}].path`;
    if (!prints.has(record.fingerprint)) return `results[${i}].record.fingerprint`;
    if (results.has(record.id)) return `results[${i}].record.id`;
    results.add(record.id);
    if (record.batch != null && !batches.has(record.batch)) return `results[${i}].record.batch`;
  }
  return undefined;
}

/**
 * `document` as a project, or an error that names its first wrong field. The project is rebuilt from the fields it
 * checks and nothing else reaches the store: a record keeps the fields an opened project keeps, a batch no folder
 * handle, a view no calibration, and a running batch is interrupted.
 */
export function checkProject(document: unknown, source: string): Project {
  const schema = isObject(document) ? document.schema : undefined;
  const version = /^ddalab\.project\/(\d+)$/.exec(isString(schema) ? (schema as string) : "")?.[1];
  if (!version || Number(version) < 1) {
    throw new Error(`${source} is not a DDALAB project: its project.json names no schema ${SCHEMA}`);
  }
  if (schema !== SCHEMA) {
    throw new Error(`${source} was written by a newer DDALAB (${schema}). Update DDALAB to open it.`);
  }
  const field = wrong(document, PROJECT) ?? inconsistent(document as Project);
  if (field) {
    throw new Error(`${source} is not a DDALAB project (schema ${SCHEMA}): ${field} is missing or malformed`);
  }
  const project = document as Project;
  return {
    ...only(project, ["schema", "app_version", "engine_version", "created_at_iso"]),
    git_commit: project.git_commit ?? null,
    recordings: project.recordings.map((r) => ({
      fingerprint: r.fingerprint,
      files: r.files.map((f) => only(f, ["path", "name", "size", "sha256", "last_modified"])),
      annotations: r.annotations.map((a) => only(a, ["id", "onset_s", "duration_s", "label"])),
      saved: r.saved ? savedOf(r.saved) : null,
      ...(r.channel_query != null && { channel_query: r.channel_query }),
    })),
    active_tab: project.active_tab ?? null,
    results: project.results.map(({ path, record }) => ({ path, record: kept(record) })),
    batches: project.batches.map((b) => {
      const batch = batchOf(b);
      return { ...batch, status: batch.status === "running" ? "interrupted" : batch.status };
    }),
  };
}

/**
 * The id each of `batches` (a project's) takes beside `stored` (this browser's): its own, unless a stored batch of that
 * id is another batch (by its fields), whose place it never takes; then a new one.
 */
export const batchIds = (batches: ProjectBatch[], stored: ProjectBatch[]) =>
  new Map(
    batches.map((b) => {
      const own = stored.find((o) => o.id === b.id);
      const same = !own || JSON.stringify(batchOf(own)) === JSON.stringify(batchOf(b));
      return [b.id, same ? b.id : crypto.randomUUID()];
    }),
  );

/**
 * What this browser keeps under a recording's fingerprint, which a project's copy of it would share, and each set of
 * its files' SHA-256 known here (app/project.ts `keptHere`).
 */
export interface Kept {
  tab: "none" | "open" | "detached";
  annotations: number;
  results: number;
  tiles: boolean;
  digests: Record<string, string>[];
}

/**
 * Whether a project's `recording` may join what `kept` holds under its fingerprint, which reads only a file's name,
 * size and edges: `new` when nothing is kept; `same` when the project's bytes, which `hash` reads, have every complete
 * set of digests known here; `differs` when they, or the digests the project lists, do not; `unknown` when no complete
 * set is known here (the user's copy was never checked); `unread` when the project's bytes could not be hashed.
 */
export async function verdict(
  recording: ProjectRecording,
  kept: Kept,
  hash: () => Promise<Record<string, string>>,
): Promise<"new" | "same" | "differs" | "unknown" | "unread"> {
  if (kept.tab === "none" && kept.annotations === 0 && kept.results === 0 && !kept.tiles) return "new";
  const known = kept.digests.filter((set) => recording.files.every((f) => set[f.name]));
  if (known.length === 0) return "unknown";
  if (!known.every((set) => sameFiles(recording.files, set))) return "differs";
  const hashed = await hash().catch(() => undefined);
  if (!hashed) return "unread";
  const actual = recording.files.map((f) => ({ ...f, sha256: hashed[f.name] }));
  return known.every((set) => sameFiles(actual, set)) ? "same" : "differs";
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const listed = (items: string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/**
 * What the user reads when the project `project`'s copy of `name` is refused for `why`: what happened, that their own
 * stays as it is, and the step that leads on. Removing their copy is the way forward only when it differs.
 */
export function refusal(name: string, project: string, why: "differs" | "unknown" | "unread", kept: Kept) {
  const stays = `Your ${name}, its annotations and its results stay as they are, and the project's annotations and results for it were not added.`;
  if (why === "unread") {
    return `${name} was not opened from ${project}: the project's copy could not be read to check it against your ${name}. ${stays} Open the project again.`;
  }
  if (why === "unknown") {
    const check =
      kept.tab === "detached"
        ? `Reattach your tab of ${name}`
        : kept.tab === "open"
          ? `Close your tab of ${name} and open your file of it again`
          : `Open your ${name} here once`;
    return `${name} was not opened from ${project}: this browser has never checked the contents of your ${name}, which has the same name, size, start and end, so the project's copy cannot be compared with it. ${stays} ${check}, which checks it, then open the project again.`;
  }
  const remove = [
    kept.annotations > 0 &&
      `delete its ${count(kept.annotations, "annotation")}${kept.tab === "open" ? "" : " (open the recording to do so)"}`,
    kept.results > 0 && `delete its ${count(kept.results, "result")} in History`,
    kept.tab !== "none" && "close its tab",
    kept.tiles && "clear cached tiles in Local data",
  ].filter((step) => typeof step === "string");
  return `${name} was not opened from ${project}: this browser keeps another ${name} with the same name, size, start and end but other contents, and the project's copy cannot be opened while yours is here. ${stays} To use the project's copy, first remove your ${name} from this browser: ${listed(remove)}. Then open the project again.`;
}

/** Whether `files` have exactly the SHA-256 digests `known` holds, by file name. */
export const sameFiles = (files: ProjectFile[], known: Record<string, string>) =>
  files.length === Object.keys(known).length && files.every((f) => known[f.name] === f.sha256);

/** The fingerprint of a recording read from `files` (name and bytes), as the IO worker computes it on open. */
export async function fingerprintOfFiles(files: { name: string; bytes: Blob }[]): Promise<string> {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : 1));
  const prints = await Promise.all(
    sorted.map(({ name, bytes }) => fingerprintOf(name, bytes.size, (a, b) => bytes.slice(a, b))),
  );
  return sha256Hex(prints.join("\n"));
}

/**
 * The project in `file` and its entries by name, each a slice of `file`. Refused: an archive with an entry that is not
 * stored, or twice; a project.json that is too large, not JSON or malformed; a file it names that the archive lacks at
 * its size; a recording whose files do not have its fingerprint.
 */
export async function readProject(file: Blob, source: string) {
  const entries = new Map<string, Blob>();
  for (const { name, method, compressed, size, start } of await zipEntries(file, source)) {
    if (name.endsWith("/")) continue;
    if (method !== 0 || compressed !== size) {
      throw new Error(
        `${name} in ${source} is compressed: DDALAB reads a project's files in place, so each is stored`,
      );
    }
    if (entries.has(name)) throw new Error(`${source} holds ${name} twice`);
    entries.set(name, file.slice(start, start + size));
  }
  const json = entries.get("project.json");
  if (!json) throw new Error(`${source} holds no project.json: it is not a DDALAB project`);
  if (json.size > PROJECT_LIMIT) throw new Error(`The project.json of ${source} is above 32 MiB`);
  let document: unknown;
  try {
    document = JSON.parse(await json.text());
  } catch {
    throw new Error(`The project.json of ${source} is not JSON`);
  }
  const project = checkProject(document, source);
  for (const { fingerprint, files } of project.recordings) {
    for (const { path, size } of files) {
      if (entries.get(path)?.size !== size) {
        throw new Error(`${source} lacks ${path} of ${size} bytes, which its project.json lists`);
      }
    }
    const own = files.map(({ name, path }) => ({ name, bytes: entries.get(path) as Blob }));
    if ((await fingerprintOfFiles(own)) !== fingerprint) {
      throw new Error(`${files[0].path} in ${source} is not the recording its project.json names`);
    }
  }
  return { project, entries };
}
