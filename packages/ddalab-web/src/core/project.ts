// Project files (.ddalab): the open tabs of a workspace with every file their recordings read, byte for byte, their
// annotations, channel choices and views, and the results of those recordings with their batches, in one zip archive
// (app/project.ts writes and opens it). Every entry is stored, so a recording is a byte range of the project, which the
// app reads in place. `project.json` says what the archive holds; `recordings/<k>/<name>` are the files of the k-th
// tab's recording and `results/<id>/` the bundle of a result, as `ddalab run --bundle` writes it. A project from
// elsewhere is untrusted: its project.json is bounded and checked field by field, every file it names must be a stored
// entry of the size it names, and each recording's files must have the fingerprint it claims.
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
  batches: Omit<BatchRecord, "handle">[];
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
const isHash = matches(/^[0-9a-f]{64}$/);
const isId = matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const isCount = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const isBoolean = (v: unknown) => typeof v === "boolean";
/** A file name the app may give a File: no folder, no parent. */
const isName = (v: unknown) =>
  isString(v) && /^[^/\\\0]{1,255}$/.test(v as string) && v !== "." && v !== "..";
const span = shaped([
  ["t0", isNumber],
  ["t1", isNumber],
]);

/** What a tab shows again. A viewer setting of another version rides along in `view` as a plain value. */
const SAVED: Fields = [
  ["view", isObject],
  ["view", (v) => Object.values(v as object).every((x) => x === null || typeof x !== "object")],
  ["view.t0", isNumber],
  ["view.t1", isNumber],
  ["view.firstChannel", isCount],
  ["view.rowCount", isCount],
  ["view.epochS", oneOf(10, 20, 30)],
  ["view.sensitivityUvPerMm", (v) => isNumber(v) && (v as number) > 0],
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
      ["last_modified", isNumber],
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
  ["record.createdAt", isNumber],
  ["record.finishedAt", optional(isNumber)],
  ["record.batch", optional(isId)],
];

const BATCH: Fields = [
  ["id", isId],
  ["createdAt", isNumber],
  ["finishedAt", optional(isNumber)],
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

/** What a project keeps of a result's record; the bundle's manifest gives the rest. */
export const kept = ({
  id,
  fingerprint,
  fileName,
  inputFiles,
  plan,
  createdAt,
  finishedAt,
  batch,
}: KeptRecord): KeptRecord => ({ id, fingerprint, fileName, inputFiles, plan, createdAt, finishedAt, batch });

/** The first field that does not fit the rest of the project (paths, references, ids twice); `undefined` if none. */
function inconsistent(project: Project): string | undefined {
  const prints = project.recordings.map((r) => r.fingerprint);
  for (const [k, { fingerprint, files }] of project.recordings.entries()) {
    if (prints.indexOf(fingerprint) !== k) return `recordings[${k}].fingerprint`;
    for (const [i, { path, name }] of files.entries()) {
      if (path !== `recordings/${k}/${name}`) return `recordings[${k}].files[${i}].path`;
      if (files.findIndex((f) => f.name === name) !== i) return `recordings[${k}].files[${i}].name`;
    }
  }
  if (project.active_tab != null && !prints.includes(project.active_tab)) return "active_tab";
  for (const [i, { path, record }] of project.results.entries()) {
    if (path !== `results/${record.id}/`) return `results[${i}].path`;
    if (!prints.includes(record.fingerprint)) return `results[${i}].record.fingerprint`;
    if (project.results.findIndex((r) => r.record.id === record.id) !== i) return `results[${i}].record.id`;
  }
  const batches = project.batches.map((b) => b.id);
  return batches.findIndex((id, i) => batches.indexOf(id) !== i) >= 0 ? "batches" : undefined;
}

/**
 * `document` as a project, or an error that names its first wrong field. What the app reads of it is kept and nothing
 * else: a record keeps the fields an opened project keeps, a batch no folder handle, a view no calibration (which
 * belongs to the display), and a running batch is interrupted.
 */
export function checkProject(document: unknown, source: string): Project {
  const schema = isObject(document) ? document.schema : undefined;
  if (!isString(schema) || !(schema as string).startsWith("ddalab.project/")) {
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
    ...project,
    recordings: project.recordings.map((r) => {
      if (!r.saved) return { ...r, saved: null };
      const { mmPerCssMm: _, ...view } = r.saved.view as TabView["view"] & { mmPerCssMm?: number };
      return { ...r, saved: { ...r.saved, view } };
    }),
    results: project.results.map(({ path, record }) => ({ path, record: kept(record) })),
    batches: project.batches.map(
      ({ handle: _, ...batch }: Omit<BatchRecord, "handle"> & { handle?: unknown }) => ({
        ...batch,
        status: batch.status === "running" ? "interrupted" : batch.status,
      }),
    ),
  };
}

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
