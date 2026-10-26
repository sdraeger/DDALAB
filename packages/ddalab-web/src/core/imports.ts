// Imports of the results the CLI writes, in the IO worker: a bundle as a zip or as a folder's files, or a JSON result
// document. Everything the history, the provenance and the CLI command read is checked before anything is stored: a
// malformed file is refused with the field that is wrong. The result is stored as a bundle under a new id
// (resultStore.ts) and recorded in the history as complete.
import { type AnalysisRecord, recordedManifest, saveAnalysis } from "./history";
import { count, npyHeader, readNpyHeader } from "./npy";
import { storeResult } from "./resultStore";
import type { BundleLayout, ResultDocument, VariantDocument } from "./types";

/** A file of a bundle folder and its path from the folder that was picked or dropped. */
export interface FolderFile {
  path: string;
  file: Blob;
}

/**
 * A JSON document above this size is refused. The worker holds its text, the parsed numbers and their Float64Arrays at
 * once. The worst case is short numbers: `0,` is 2 bytes of text and about 18 bytes in the worker, 9 times its size,
 * which puts the peak at this cap near 0.85 GiB. A larger result imports as its bundle folder, which streams.
 */
const DOCUMENT_LIMIT = 96 * 2 ** 20;

/** A result to import: its manifest and each array's `.npy` bytes by bundle path. */
type Incoming = { manifest: ResultDocument; arrays: Map<string, Blob> };

/** An entry of a zip archive: its name, how it is compressed, its sizes and where its bytes start. */
export interface ZipEntry {
  name: string;
  /** 0: stored, 8: deflated. */
  method: number;
  /** Bytes in the archive. */
  compressed: number;
  /** Bytes once unpacked. */
  size: number;
  start: number;
}

/** A central directory above this size is refused: it is read whole (about 600,000 entries). */
const DIRECTORY_LIMIT = 64 * 2 ** 20;

const u64 = (view: DataView, at: number) => Number(view.getBigUint64(at, true));

/**
 * The entries of the zip archive `zip`, from its central directory, ZIP64 where it has it. The directory is read by
 * its size, as Python's zipfile reads it: an archive of more than 65,535 entries with no ZIP64 record (client-zip
 * writes none for the count alone) reads whole, its 16-bit count saying 65,535. Each entry's local header must name it
 * and its method as the directory does, its bytes must lie before the directory, and no two entries may share bytes:
 * one byte range listed many times would be read, and stored, as many files.
 */
export async function zipEntries(zip: Blob, source: string): Promise<ZipEntry[]> {
  const broken = (what: string) => new Error(`${source} is not a readable zip archive: ${what}`);
  // The end of central directory record is in the last 22 bytes plus a comment of up to 64 KiB.
  const tail = new DataView(await zip.slice(Math.max(0, zip.size - 22 - 0xffff)).arrayBuffer());
  let end = tail.byteLength - 22;
  while (end >= 0 && tail.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error(`${source} is not a zip archive`);
  let count = tail.getUint16(end + 10, true);
  let size = tail.getUint32(end + 12, true);
  let offset = tail.getUint32(end + 16, true);
  // ZIP64: a locator right before the end record gives the place of the ZIP64 end record and its full values.
  if (end >= 20 && tail.getUint32(end - 20, true) === 0x07064b50) {
    const at = u64(tail, end - 20 + 8);
    const record = new DataView(await zip.slice(at, at + 56).arrayBuffer());
    if (record.byteLength < 56 || record.getUint32(0, true) !== 0x06064b50)
      throw broken("its ZIP64 end record");
    count = u64(record, 32);
    size = u64(record, 40);
    offset = u64(record, 48);
  }
  if (size > DIRECTORY_LIMIT || offset + size > zip.size) throw broken("its central directory");
  const directory = new DataView(await zip.slice(offset, offset + size).arrayBuffer());
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  /** Where each entry's local header starts and its bytes end. */
  const spans: { local: number; end: number; name: string }[] = [];
  for (let at = 0; at < size; ) {
    if (at + 46 > size || directory.getUint32(at, true) !== 0x02014b50) throw broken("its central directory");
    const method = directory.getUint16(at + 10, true);
    let compressed = directory.getUint32(at + 20, true);
    let length = directory.getUint32(at + 24, true);
    const nameBytes = directory.getUint16(at + 28, true);
    const extra = at + 46 + nameBytes;
    const extraEnd = extra + directory.getUint16(at + 30, true);
    const next = extraEnd + directory.getUint16(at + 32, true);
    let local = directory.getUint32(at + 42, true);
    if (next > size) throw broken("its central directory");
    const raw = new Uint8Array(directory.buffer, at + 46, nameBytes);
    const name = decoder.decode(raw);
    // The ZIP64 field holds, in this order, each of these that the 32-bit field leaves at 0xffffffff.
    for (let x = extra; x + 4 <= extraEnd; ) {
      const fieldEnd = x + 4 + directory.getUint16(x + 2, true);
      if (fieldEnd > extraEnd) throw broken(`the extra fields of ${name}`);
      let y = x + 4;
      const take = () => {
        if (y + 8 > fieldEnd) throw broken(`the ZIP64 field of ${name}`);
        y += 8;
        return u64(directory, y - 8);
      };
      if (directory.getUint16(x, true) === 1) {
        if (length === 0xffffffff) length = take();
        if (compressed === 0xffffffff) compressed = take();
        if (local === 0xffffffff) local = take();
      }
      x = fieldEnd;
    }
    at = next;
    const header = new Uint8Array(await zip.slice(local, local + 30 + nameBytes).arrayBuffer());
    const view = new DataView(header.buffer);
    const named =
      header.length === 30 + nameBytes &&
      view.getUint32(0, true) === 0x04034b50 &&
      view.getUint16(8, true) === method &&
      view.getUint16(26, true) === nameBytes &&
      header.subarray(30).every((b, i) => b === raw[i]);
    if (!named) throw broken(`the local header of ${name}`);
    const start = local + 30 + nameBytes + view.getUint16(28, true);
    if (start + compressed > offset) throw broken(`${name} reaches into the central directory`);
    entries.push({ name, method, compressed, size: length, start });
    spans.push({ local, end: start + compressed, name });
  }
  if (count === 0xffff ? entries.length < count : entries.length !== count) throw broken("its entry count");
  spans.sort((a, b) => a.local - b.local);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i - 1].end > spans[i].local) throw broken(`${spans[i - 1].name} overlaps ${spans[i].name}`);
  }
  return entries;
}

/** The entries of a zip archive by name; stored and deflated entries. */
export async function unzip(zip: File): Promise<Map<string, Blob>> {
  const found = new Map<string, Blob>();
  for (const { name, method, compressed, start } of await zipEntries(zip, zip.name)) {
    if (name.endsWith("/")) continue;
    const data = zip.slice(start, start + compressed);
    if (method === 0) found.set(name, data);
    else if (method === 8) {
      const inflated = data.stream().pipeThrough(new DecompressionStream("deflate-raw"));
      found.set(name, await new Response(inflated).blob());
    } else throw new Error(`${name} in ${zip.name} is compressed in a way DDALAB does not read`);
  }
  return found;
}

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const isString = (v: unknown) => typeof v === "string";
export const isNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v);
export const listOf = (item: (v: unknown) => boolean) => (v: unknown) => Array.isArray(v) && v.every(item);
export const optional = (test: (v: unknown) => boolean) => (v: unknown) =>
  v === undefined || v === null || test(v);
const pair = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(isNumber);

/** What the history, the provenance and the CLI command read, by path, and what each must be. */
const FIELDS: [string, (v: unknown) => boolean][] = [
  ["schema", (v) => v === "ddalab.result/2"],
  ["id", isString],
  ["file_name", isString],
  ["created_at_iso", isString],
  ["diagnostics", listOf(isString)],
  ["window_centers_seconds", listOf(isNumber)],
  ["variants", Array.isArray],
  ["reproduction.engine_version", isString],
  ["reproduction.git_commit", optional(isString)],
  ["reproduction.input_sha256", (v) => isObject(v) && Object.values(v).every(isString)],
  ["reproduction.selected_channel_names", listOf(isString)],
  ["reproduction.start_time_seconds", isNumber],
  ["reproduction.end_time_seconds", isNumber],
  ["reproduction.request", isObject],
  ["reproduction.request.channels", optional(listOf(isNumber))],
  ["reproduction.request.algorithm_selection.enabled_variants", listOf(isString)],
  ["reproduction.request.ct_channel_pairs", optional(listOf(pair))],
  ["reproduction.request.cd_channel_pairs", optional(listOf(pair))],
  ["reproduction.request.window_parameters.window_length", isNumber],
  ["reproduction.request.window_parameters.window_step", isNumber],
  ["reproduction.request.window_parameters.ct_window_length", optional(isNumber)],
  ["reproduction.request.window_parameters.ct_window_step", optional(isNumber)],
  ["reproduction.request.delay_parameters.delays", listOf(isNumber)],
  ["reproduction.request.model_terms", optional(listOf(isNumber))],
  [
    "reproduction.request.model_parameters",
    optional((m) => isObject(m) && [m.dm, m.order, m.nr_tau].every(isNumber)),
  ],
  ["reproduction.request.preprocessing_options", isObject],
  ["reproduction.request.preprocessing_options.highpass", optional(isNumber)],
  ["reproduction.request.preprocessing_options.lowpass", optional(isNumber)],
  ["reproduction.request.sampling_rate", optional(isNumber)],
  ["reproduction.request.time_range.start", isNumber],
  ["reproduction.request.time_range.end", isNumber],
];

export const at = (value: unknown, path: string) =>
  path.split(".").reduce<unknown>((v, key) => (isObject(v) ? v[key] : undefined), value);

/** The first field of `document` that is missing or malformed, or of one of its variants; `undefined` if none. */
function malformed(document: unknown, variantFields: (v: VariantDocument) => string | undefined) {
  const field = FIELDS.find(([path, test]) => !test(at(document, path)))?.[0];
  if (field) return field;
  const variants = (document as ResultDocument).variants;
  const ids = new Set<unknown>();
  for (const [i, v] of variants.entries()) {
    // At least one row: a variant of none would let a manifest store window centers that no array bounds.
    const ok =
      isObject(v) &&
      /^[A-Z0-9]+$/.test(String(v.id)) &&
      isString(v.label) &&
      listOf(isString)(v.row_labels) &&
      (v.row_labels as unknown[]).length > 0 &&
      !ids.has(v.id);
    ids.add(isObject(v) ? v.id : undefined);
    if (!ok) return `variants[${i}] (its id, label or row labels, or an id that is not unique)`;
    const wrong = variantFields(v);
    if (wrong) return `variants[${i}].${wrong}`;
  }
  return undefined;
}

const refuse = (source: string, field: string) =>
  new Error(`${source} is not a DDALAB result (schema ddalab.result/2): ${field} is missing or malformed`);

/** A value's shape in a result document, as the CLI writes it (dda-rs document.rs and types.rs). */
type Shape =
  | "string"
  | "number"
  | "boolean"
  | { nullable: Shape }
  | { list: Shape; length?: number }
  | { map: Shape }
  | { fields: Record<string, Shape> };

/** The longest string a stored result keeps: a label, a name, a path, a message. */
const STRING_LIMIT = 64 * 1024;
/** A stored record's manifest (without its window centers) above this is refused: the history loads every record. */
export const RECORD_LIMIT = 16 * 2 ** 20;

const S = "string";
const N = "number";
const B = "boolean";
const list = (item: Shape, length?: number): Shape => ({ list: item, length });
const map = (item: Shape): Shape => ({ map: item });
const fields = (named: Record<string, Shape>): Shape => ({ fields: named });
const PAIRS = list(list(N, 2));
const REQUEST = fields({
  algorithm_selection: fields({ enabled_variants: list(S), select_mask: S }),
  cd_channel_pairs: PAIRS,
  channels: list(N),
  ct_channel_pairs: PAIRS,
  delay_parameters: fields({ delays: list(N) }),
  file_path: S,
  model_parameters: fields({ dm: N, nr_tau: N, order: N }),
  model_terms: list(N),
  preprocessing_options: fields({ highpass: N, lowpass: N }),
  sampling_rate: N,
  time_range: fields({ end: N, start: N }),
  variant_configs: map(
    fields({
      cd_channel_pairs: PAIRS,
      conditioning_channels: list(N),
      conditioning_strategy: S,
      ct_channel_pairs: PAIRS,
      max_active_sources: N,
      selected_channels: list(N),
      surrogate_shifts: list(N),
      temporal_lambda: N,
    }),
  ),
  window_parameters: fields({ ct_window_length: N, ct_window_step: N, window_length: N, window_step: N }),
});
const MATRIX = list(list({ nullable: N }));
const DOCUMENT = fields({
  schema: S,
  id: S,
  file_name: S,
  created_at_iso: S,
  diagnostics: list(S),
  window_centers_seconds: list(N),
  variants: list(
    fields({
      id: S,
      label: S,
      row_labels: list(S),
      matrix: MATRIX,
      min_value: N,
      max_value: N,
      row_mean_absolute: list(N),
      row_peak_absolute: list(N),
      coefficient_matrices: list(MATRIX),
      fit_error_matrix: MATRIX,
      arrays: list(S),
    }),
  ),
  reproduction: fields({
    expert_mode: B,
    compute_device: S,
    variant_ids: list(S),
    selected_channel_indices: list(N),
    selected_channel_names: list(S),
    variant_channel_indices: map(list(N)),
    variant_channel_names: map(list(S)),
    variant_pair_indices: map(PAIRS),
    variant_pair_names: map(list(S)),
    window_length_samples: N,
    window_step_samples: N,
    delays: list(N),
    model_terms: list(N),
    model_dimension: N,
    polynomial_order: N,
    nr_tau: N,
    start_time_seconds: N,
    end_time_seconds: N,
    ddalab_version: S,
    input_sha256: map(S),
    engine_version: S,
    git_commit: S,
    request: REQUEST,
  }),
});

/**
 * `value` rebuilt to `shape`: an object keeps the keys `shape` names, in its own order, each checked (a named field may
 * be null), a map its keys; strings are bounded. Throws the path of the first value that does not fit.
 */
function rebuilt(value: unknown, shape: Shape, path: string): unknown {
  const wrong = (): never => {
    throw new Error(path);
  };
  if (shape === S) return isString(value) && (value as string).length <= STRING_LIMIT ? value : wrong();
  if (shape === N) return isNumber(value) ? value : wrong();
  if (shape === B) return typeof value === "boolean" ? value : wrong();
  if ("nullable" in shape) return value === null ? null : rebuilt(value, shape.nullable, path);
  if ("list" in shape) {
    if (!Array.isArray(value) || (shape.length !== undefined && value.length !== shape.length)) wrong();
    return (value as unknown[]).map((item, i) => rebuilt(item, shape.list, `${path}[${i}]`));
  }
  if (!isObject(value)) wrong();
  const entries = Object.entries(value as Record<string, unknown>);
  if ("map" in shape) {
    return Object.fromEntries(
      entries.map(([key, v]) => [
        key.length <= STRING_LIMIT ? key : wrong(),
        rebuilt(v, shape.map, `${path}.${key}`),
      ]),
    );
  }
  return Object.fromEntries(
    entries
      .filter(([key]) => Object.hasOwn(shape.fields, key))
      .map(([key, v]) => [key, v === null ? null : rebuilt(v, shape.fields[key], `${path}.${key}`)]),
  );
}

/**
 * `manifest` with the fields of a result document only, each of its type, and its variants as a bundle's manifest has
 * them (the arrays hold the values): what is stored, recorded and exported again. Throws, naming the field, when one
 * does not fit, and when the record would be too large.
 */
function documentOf(manifest: ResultDocument, source: string): ResultDocument {
  let document: ResultDocument;
  try {
    document = rebuilt(manifest, DOCUMENT, "") as ResultDocument;
  } catch (error) {
    throw refuse(source, (error as Error).message.replace(/^\./, ""));
  }
  const variants = document.variants.map((variant) => ({
    ...variant,
    matrix: [],
    min_value: null,
    max_value: null,
    row_mean_absolute: null,
    row_peak_absolute: null,
    coefficient_matrices: null,
    fit_error_matrix: null,
  }));
  if (!pairsWithin(document)) {
    const channels = document.reproduction.selected_channel_names.length;
    throw new Error(`${source} lists more channel pairs than its ${channels} channels make`);
  }
  const bounded = { ...document, variants };
  if (recordBytes(bounded) > RECORD_LIMIT) {
    throw new Error(`The manifest of ${source} is above 16 MiB without its window centers`);
  }
  return bounded;
}

/** Bytes (UTF-8) of the history record of `manifest`: what the history loads at each start. */
/**
 * Whether every list of channel pairs of a result (the request's, its variant configs', its variants' pair indices and
 * names) holds no more pairs than its channels make, which bounds the lists that grow with them.
 */
export function pairsWithin({ reproduction }: Pick<ResultDocument, "reproduction">) {
  const { request } = reproduction;
  const channels = reproduction.selected_channel_names.length;
  const pairs = [
    request.ct_channel_pairs,
    request.cd_channel_pairs,
    ...Object.values(request.variant_configs ?? {}).flatMap((c) => [c.ct_channel_pairs, c.cd_channel_pairs]),
    ...Object.values(reproduction.variant_pair_indices ?? {}),
    ...Object.values(reproduction.variant_pair_names ?? {}),
  ];
  return pairs.every((list) => (list?.length ?? 0) <= channels * channels);
}

const recordBytes = (manifest: ResultDocument) =>
  new TextEncoder().encode(JSON.stringify(recordedManifest(manifest))).length;

/** A bundle's files by path (from a zip or a folder): `manifest.json`, at the top or in one folder, and its arrays. */
async function fromBundle(files: Map<string, Blob>, source: string): Promise<Incoming> {
  const manifestPath = [...files.keys()]
    .filter((path) => path === "manifest.json" || path.endsWith("/manifest.json"))
    .sort((a, b) => a.split("/").length - b.split("/").length)[0];
  if (!manifestPath) throw new Error(`${source} holds no manifest.json: it is not a DDALAB result bundle`);
  const prefix = manifestPath.slice(0, -"manifest.json".length);
  if ((files.get(manifestPath) as Blob).size > DOCUMENT_LIMIT) {
    throw new Error(`The manifest.json of ${source} is above 96 MiB`);
  }
  let manifest: ResultDocument;
  try {
    manifest = JSON.parse(await (files.get(manifestPath) as Blob).text());
  } catch {
    throw new Error(`The manifest.json of ${source} is not JSON`);
  }
  // Each variant's arrays are its own: Q, and the model's coefficients and fit error for the variants that fit one.
  const field = malformed(manifest, (v) => {
    const own = new RegExp(`^${v.id}/(q|coefficients|fit_error)\\.npy$`);
    const ok =
      listOf((p) => isString(p) && own.test(p as string))(v.arrays) && v.arrays?.includes(`${v.id}/q.npy`);
    return ok ? undefined : "arrays";
  });
  if (field) throw refuse(source, field);
  const arrays = new Map<string, Blob>();
  for (const path of manifest.variants.flatMap((v) => v.arrays ?? [])) {
    const blob = files.get(prefix + path);
    if (!blob) throw new Error(`${source} lacks ${path}, which its manifest lists`);
    arrays.set(path, blob);
  }
  return { manifest, arrays };
}

/** `[row][window]` with `rows` rows of `windows` numbers or nulls each. */
const fits = (matrix: unknown, rows: number, windows: number) =>
  Array.isArray(matrix) &&
  matrix.length === rows &&
  matrix.every(
    (row) => Array.isArray(row) && row.length === windows && row.every((x) => x === null || isNumber(x)),
  );

/** A JSON result document as a bundle: each variant's matrices become its window-major arrays. */
function fromDocument(document: ResultDocument, source: string): Incoming {
  const windows = Array.isArray(document?.window_centers_seconds)
    ? document.window_centers_seconds.length
    : 0;
  const field = malformed(document, (v) => {
    const rows = v.row_labels.length;
    if (!fits(v.matrix, rows, windows)) return "matrix";
    if (!optional(listOf((m) => fits(m, rows, windows)))(v.coefficient_matrices))
      return "coefficient_matrices";
    if (!optional((m) => fits(m, rows, windows))(v.fit_error_matrix)) return "fit_error_matrix";
    return undefined;
  });
  if (field) throw refuse(source, field);
  const arrays = new Map<string, Blob>();
  const variants = document.variants.map((variant) => {
    const rows = variant.row_labels.length;
    const paths: string[] = [];
    const add = (
      name: string,
      terms: number | undefined,
      value: (w: number, r: number, k: number) => number | null,
    ) => {
      const shape = terms === undefined ? [windows, rows] : [windows, rows, terms];
      const k1 = terms ?? 1;
      const values = new Float64Array(count(shape));
      for (let w = 0; w < windows; w++) {
        for (let r = 0; r < rows; r++) {
          for (let k = 0; k < k1; k++) values[(w * rows + r) * k1 + k] = value(w, r, k) ?? Number.NaN;
        }
      }
      paths.push(`${variant.id}/${name}`);
      arrays.set(paths[paths.length - 1], new Blob([npyHeader(shape), values]));
    };
    const { matrix, coefficient_matrices: coefficients, fit_error_matrix: fitError } = variant;
    add("q.npy", undefined, (w, r) => matrix[r][w]);
    if (coefficients) add("coefficients.npy", coefficients.length, (w, r, k) => coefficients[k][r][w]);
    if (fitError) add("fit_error.npy", undefined, (w, r) => fitError[r][w]);
    return {
      ...variant,
      matrix: [],
      min_value: null,
      max_value: null,
      row_mean_absolute: null,
      row_peak_absolute: null,
      coefficient_matrices: null,
      fit_error_matrix: null,
      arrays: paths,
    };
  });
  return { manifest: { ...document, variants }, arrays };
}

/** The layout of `incoming`'s arrays and the bytes of their values; throws unless each has the shape its manifest implies. */
async function layoutOf({ manifest, arrays }: Incoming, source: string) {
  const layout: BundleLayout = { arrays: [] };
  const values: Blob[] = [];
  const windows = manifest.window_centers_seconds.length;
  for (const variant of manifest.variants) {
    for (const path of variant.arrays ?? []) {
      const blob = arrays.get(path) as Blob;
      const { headerBytes, shape } = await readNpyHeader(blob, path);
      const ok =
        shape.length === (path.endsWith("/coefficients.npy") ? 3 : 2) &&
        shape[0] === windows &&
        shape[1] === variant.row_labels.length &&
        blob.size === headerBytes + 8 * count(shape);
      if (!ok) throw new Error(`${path} in ${source} does not have the shape its manifest implies`);
      const header = Array.from(new Uint8Array(await blob.slice(0, headerBytes).arrayBuffer()));
      layout.arrays.push({ path, shape, header });
      values.push(blob.slice(headerBytes));
    }
  }
  return { layout, values };
}

const isZip = async (file: Blob) =>
  new Uint8Array(await file.slice(0, 4).arrayBuffer()).every((b, i) => b === [0x50, 0x4b, 0x03, 0x04][i]);

/** What an opened project keeps of a result's record (app/project.ts): its id, its recording, its times and batch. */
export type KeptRecord = Pick<
  AnalysisRecord,
  "id" | "fingerprint" | "fileName" | "inputFiles" | "plan" | "createdAt" | "finishedAt" | "batch"
>;

/**
 * Imports a result the CLI wrote: a bundle as a zip or as a folder's files, or a JSON result document. It is stored
 * under a new id, or under the id of `kept` with the rest of that record, and recorded in the history as complete;
 * the id.
 */
export async function importResult(input: File | FolderFile[], kept?: KeptRecord): Promise<string> {
  const { manifest, layout, values } = await prepared(input);
  const id = kept?.id ?? crypto.randomUUID();
  await storeResult(id, layout, values, manifest);
  const record: AnalysisRecord = {
    fingerprint: "",
    fileName: manifest.file_name,
    createdAt: Date.now(),
    ...kept,
    id,
    request: manifest.reproduction.request,
    manifest: recordedManifest(manifest),
    plan: kept?.plan ?? { windows: manifest.window_centers_seconds.length },
    status: "complete",
  };
  await saveAnalysis(record);
  return id;
}

/** The most the history records and batches of one project may take together, in bytes (UTF-8). */
export const PROJECT_RECORDS_LIMIT = 32 * 2 ** 20;
/**
 * What each record and each batch counts toward PROJECT_RECORDS_LIMIT at least: every one is an entry the history
 * lists at each start, so a project adds at most 8,192 of them however small.
 */
export const ENTRY_BYTES = 4096;

export const mebibytes = (bytes: number) =>
  (bytes / 2 ** 20).toLocaleString("en", { maximumFractionDigits: 1 });
/** Bytes (UTF-8) of `value` as JSON. */
export const utf8 = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What one result counts toward PROJECT_RECORDS_LIMIT: its record's bytes and its kept fields', at least ENTRY_BYTES. */
export const resultCost = (record: number, kept: unknown) => Math.max(ENTRY_BYTES, record + utf8(kept));
/** What one batch counts toward PROJECT_RECORDS_LIMIT: its bytes, at least ENTRY_BYTES. */
export const batchCost = (batch: unknown) => Math.max(ENTRY_BYTES, utf8(batch));

/**
 * Imports the results of a project (app/project.ts), each as `importResult` imports a bundle folder with its `kept`
 * record, beside the `batches` the project would add with them. The history loads every record and batch at each
 * start, so together they may take PROJECT_RECORDS_LIMIT, each counting at least ENTRY_BYTES: they are read and
 * checked first, and above it no result is stored and this rejects. The outcome of each: its id, or why it was not
 * added.
 */
export async function importResults(
  results: { input: FolderFile[]; kept: KeptRecord }[],
  batches: unknown[],
): Promise<({ id: string } | { error: string })[]> {
  let bytes = batches.reduce<number>((sum, batch) => sum + batchCost(batch), 0);
  // One at a time: a manifest is up to 96 MiB of text.
  for (const { input, kept } of results) {
    if (bytes > PROJECT_RECORDS_LIMIT) break;
    const record = await prepared(input).then(
      ({ manifest }) => recordBytes(manifest),
      () => 0,
    );
    bytes += resultCost(record, kept);
  }
  if (bytes > PROJECT_RECORDS_LIMIT) {
    throw new Error(
      `its ${plural(results.length, "result")} and ${plural(batches.length, "batch", "batches")} would add more than the ${mebibytes(PROJECT_RECORDS_LIMIT)} MiB a project may add to the history`,
    );
  }
  const outcomes: ({ id: string } | { error: string })[] = [];
  for (const { input, kept } of results) {
    outcomes.push(
      await importResult(input, kept).then(
        (id) => ({ id }),
        (error: Error) => ({ error: error.message }),
      ),
    );
  }
  return outcomes;
}

/** What `importResult` reads of `input` and checks, before it stores anything: the manifest, the arrays' layout and values. */
async function prepared(input: File | FolderFile[]) {
  let incoming: Incoming;
  let source: string;
  if (Array.isArray(input)) {
    source = input[0]?.path.split("/")[0] || "The folder";
    incoming = await fromBundle(new Map(input.map(({ path, file }) => [path, file])), source);
  } else if (await isZip(input)) {
    source = input.name;
    incoming = await fromBundle(await unzip(input), source);
  } else {
    source = input.name;
    if (input.size > DOCUMENT_LIMIT) {
      throw new Error(`${source} is above 96 MiB; import the result's bundle folder instead`);
    }
    let document: ResultDocument;
    try {
      document = JSON.parse(await input.text());
    } catch {
      throw new Error(`${source} is neither a bundle zip nor a JSON result document`);
    }
    incoming = fromDocument(document, source);
  }
  // Only what a result document holds is stored, recorded in the history and exported again.
  const manifest = documentOf(incoming.manifest, source);
  return { manifest, ...(await layoutOf({ manifest, arrays: incoming.arrays }, source)) };
}
