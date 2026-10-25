// Exports of a stored result (the bundle as a zip, the JSON result document, one variant as CSV) and imports of the
// results the CLI writes (a bundle zip or folder, or a JSON document). A result is stored as a bundle
// (resultStore.ts); its JSON document is built from the arrays on demand, with the summaries dda-rs `build_document`
// computes. It equals the document `ddalab run --output` writes for the same request.
import { makeZip } from "client-zip";
import { type AnalysisRecord, recordedManifest, saveAnalysis } from "./history";
import { discardResult, quota, readManifest, resultsDirectory } from "./resultStore";
import type { ResultDocument, VariantDocument } from "./types";

/** Above this estimated size the JSON document is refused: the bundle holds the same arrays. */
const JSON_LIMIT = 512 * 2 ** 20;
/** Bytes of JSON per value, as `-0.17573526565987174,` takes. */
const JSON_BYTES_PER_VALUE = 20;
/** Bytes of a variant's Q values turned into CSV text at a time. */
const CSV_SLICE_BYTES = 4 * 2 ** 20;
/** The arrays a bundle may hold, by path. */
const ARRAY_PATH = /^[A-Z0-9]+\/(q|coefficients|fit_error)\.npy$/;
const NPY_MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // \x93NUMPY

type Npy = { headerBytes: number; shape: number[] };
type Array64 = { shape: number[]; values: Float64Array };

const count = (shape: number[]) => shape.reduce((n, d) => n * d, 1);
const megabytes = (bytes: number) => (bytes / 1e6).toLocaleString("en", { maximumSignificantDigits: 2 });

/** The header of a version 1.0 `.npy` file of C-order little-endian f64 values; `path` names it in errors. */
async function npyHeader(file: Blob, path: string): Promise<Npy> {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  const length = head[8] | (head[9] << 8);
  const dict = await file.slice(10, 10 + length).text();
  const shape = /'shape': \(([\d, ]*)\)/
    .exec(dict)?.[1]
    .split(",")
    .filter((d) => d.trim())
    .map(Number);
  const ok =
    NPY_MAGIC.every((b, i) => head[i] === b) &&
    head[6] === 1 &&
    dict.includes("'descr': '<f8'") &&
    dict.includes("'fortran_order': False");
  if (!ok || !shape) throw new Error(`${path} is not a .npy file of 64-bit floats`);
  return { headerBytes: 10 + length, shape };
}

/** The header dda-rs `npy_header` writes for `shape`: the dict padded with spaces to a multiple of 64 bytes. */
function npyHeaderBytes(shape: number[]): Uint8Array<ArrayBuffer> {
  const dims = shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(", ")})`;
  const dict = `{'descr': '<f8', 'fortran_order': False, 'shape': ${dims}, }`;
  const padded = `${dict}${" ".repeat((64 - ((10 + dict.length + 1) % 64)) % 64)}\n`;
  const text = new TextEncoder().encode(padded);
  return Uint8Array.from([...NPY_MAGIC, 1, 0, text.length & 255, text.length >> 8, ...text]);
}

/** The file at `path` under `directory`. */
async function fileAt(directory: FileSystemDirectoryHandle, path: string): Promise<File> {
  const names = path.split("/");
  let folder = directory;
  for (const name of names.slice(0, -1)) folder = await folder.getDirectoryHandle(name);
  return (await folder.getFileHandle(names[names.length - 1])).getFile();
}

const resultDirectory = async (resultId: string) => (await resultsDirectory()).getDirectoryHandle(resultId);

/** The bundle file of `variant` named `name` (`q.npy`, ...), if it has one. */
const arrayOf = (variant: VariantDocument, name: string) =>
  variant.arrays?.find((p) => p === `${variant.id}/${name}`);

/** The result's files, `manifest.json` and the arrays, as one zip; the `status` file stays behind. */
export async function bundleZip(resultId: string): Promise<ReadableStream<Uint8Array>> {
  const files: { name: string; input: File }[] = [];
  async function walk(directory: FileSystemDirectoryHandle, prefix: string) {
    for await (const [name, entry] of directory.entries()) {
      if (entry.kind === "directory") await walk(entry as FileSystemDirectoryHandle, `${prefix}${name}/`);
      else if (prefix || name !== "status") {
        files.push({ name: prefix + name, input: await (entry as FileSystemFileHandle).getFile() });
      }
    }
  }
  await walk(await resultDirectory(resultId), "");
  return makeZip(files);
}

/** `rows` (each a series over the windows) as a JSON array, one part per row: no string holds a whole matrix. */
function pushMatrix(parts: BlobPart[], rows: number[][]) {
  parts.push("[");
  for (const [r, row] of rows.entries()) parts.push(r > 0 ? "," : "", JSON.stringify(row)); // non-finite: null
  parts.push("]");
}

/** One variant of the document: its arrays as `[row][window]` matrices and the summaries of its Q values. */
async function pushVariant(
  parts: BlobPart[],
  variant: VariantDocument,
  read: (path: string) => Promise<Array64>,
) {
  const q = await read(arrayOf(variant, "q.npy") ?? "");
  const [windows, rows] = q.shape;
  /** Row `r` of a window-major (W, R) or (W, R, K) array, at term `k`, over the windows. */
  const series = ({ shape, values }: Array64, r: number, k = 0) =>
    Array.from({ length: windows }, (_, w) => values[(w * rows + r) * (shape[2] ?? 1) + k]);
  const matrix = (array: Array64, k?: number) => Array.from({ length: rows }, (_, r) => series(array, r, k));
  const qRows = matrix(q);
  // Over the finite values, as dda-rs `summarize`: the mean sums |x| in window order, 0 for a row without any.
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const meanAbsolute: number[] = [];
  const peakAbsolute: number[] = [];
  for (const row of qRows) {
    let sum = 0;
    let n = 0;
    let peak = 0;
    for (const x of row) {
      if (!Number.isFinite(x)) continue;
      sum += Math.abs(x);
      n++;
      peak = Math.max(peak, Math.abs(x));
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
    meanAbsolute.push(n > 0 ? sum / n : 0);
    peakAbsolute.push(peak);
  }
  const finite = min <= max;
  const summaries = {
    min_value: finite ? min : null,
    max_value: finite ? max : null,
    row_mean_absolute: meanAbsolute,
    row_peak_absolute: peakAbsolute,
  };
  const { id, label, row_labels } = variant;
  parts.push(JSON.stringify({ id, label, row_labels }).slice(0, -1), ',"matrix":');
  pushMatrix(parts, qRows);
  parts.push(`,${JSON.stringify(summaries).slice(1, -1)},"coefficient_matrices":`);
  const coefficients = arrayOf(variant, "coefficients.npy");
  if (coefficients) {
    const array = await read(coefficients);
    parts.push("[");
    for (let k = 0; k < array.shape[2]; k++) {
      if (k > 0) parts.push(",");
      pushMatrix(parts, matrix(array, k));
    }
    parts.push("]");
  } else parts.push("null");
  parts.push(',"fit_error_matrix":');
  const fitError = arrayOf(variant, "fit_error.npy");
  if (fitError) pushMatrix(parts, matrix(await read(fitError)));
  else parts.push("null");
  parts.push("}");
}

/**
 * The result document with its matrices inline, as `ddalab run --output` writes it. Refused above 512 MiB of
 * estimated JSON: the bundle holds the same arrays at an eighth of the size.
 */
export async function documentJson(resultId: string): Promise<Blob> {
  const directory = await resultDirectory(resultId);
  const manifest = await readManifest(resultId);
  const headers = new Map<string, Npy & { file: File }>();
  for (const path of manifest.variants.flatMap((v) => v.arrays ?? [])) {
    const file = await fileAt(directory, path);
    headers.set(path, { file, ...(await npyHeader(file, path)) });
  }
  const bytes =
    [...headers.values()].reduce((sum, { shape }) => sum + count(shape), 0) * JSON_BYTES_PER_VALUE;
  if (bytes > JSON_LIMIT) {
    throw new Error(`The JSON document would be about ${megabytes(bytes)} MB. Export the bundle instead.`);
  }
  const read = async (path: string): Promise<Array64> => {
    const found = headers.get(path);
    if (!found) throw new Error(`The result has no ${path}`);
    const values = new Float64Array(await found.file.slice(found.headerBytes).arrayBuffer());
    return { shape: found.shape, values };
  };
  const { variants, reproduction, ...head } = manifest;
  const parts: BlobPart[] = [JSON.stringify(head).slice(0, -1), ',"variants":['];
  for (const [i, variant] of variants.entries()) {
    if (i > 0) parts.push(",");
    await pushVariant(parts, variant, read);
  }
  parts.push('],"reproduction":', JSON.stringify(reproduction), "}");
  return new Blob(parts, { type: "application/json" });
}

const csvField = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);

/** The Q values of `variant`, a window per line: its centre in seconds, then one column per row label. */
export async function variantCsv(resultId: string, variant: string): Promise<Blob> {
  const manifest = await readManifest(resultId);
  const found = manifest.variants.find((v) => v.id === variant);
  const path = found && arrayOf(found, "q.npy");
  if (!found || !path) throw new Error(`The result has no variant ${variant}`);
  const file = await fileAt(await resultDirectory(resultId), path);
  const {
    headerBytes,
    shape: [windows, rows],
  } = await npyHeader(file, path);
  const centers = manifest.window_centers_seconds;
  const parts: BlobPart[] = [`${["window_center_s", ...found.row_labels].map(csvField).join(",")}\n`];
  const step = Math.max(1, Math.floor(CSV_SLICE_BYTES / (8 * rows)));
  for (let w0 = 0; w0 < windows; w0 += step) {
    const w1 = Math.min(windows, w0 + step);
    const slice = file.slice(headerBytes + 8 * w0 * rows, headerBytes + 8 * w1 * rows);
    const values = new Float64Array(await slice.arrayBuffer());
    let text = "";
    for (let w = w0; w < w1; w++) {
      text += centers[w];
      for (let r = 0; r < rows; r++) {
        const value = values[(w - w0) * rows + r];
        text += Number.isFinite(value) ? `,${value}` : ","; // empty, as the document's null
      }
      text += "\n";
    }
    parts.push(text);
  }
  return new Blob(parts, { type: "text/csv" });
}

/** A result to import: its manifest and its arrays' `.npy` bytes by bundle path. */
type Incoming = { manifest: ResultDocument; arrays: Map<string, Blob> };

/**
 * The entries of a zip archive by name; stored and deflated entries.
 * shortcut: no ZIP64 (archives above 4 GiB); such a bundle imports as a folder, upgrade if large zips matter.
 */
async function unzip(zip: File): Promise<Map<string, Blob>> {
  // The end of central directory record is in the last 22 bytes plus a comment of up to 64 KiB.
  const tailStart = Math.max(0, zip.size - 22 - 0xffff);
  const tail = new DataView(await zip.slice(tailStart).arrayBuffer());
  let end = tail.byteLength - 22;
  while (end >= 0 && tail.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error(`${zip.name} is not a zip archive`);
  const [entries, size, offset] = [
    tail.getUint16(end + 10, true),
    tail.getUint32(end + 12, true),
    tail.getUint32(end + 16, true),
  ];
  if (entries === 0xffff || offset === 0xffffffff) {
    throw new Error(`${zip.name} is above 4 GiB; unpack it and import its folder instead`);
  }
  const directory = new DataView(await zip.slice(offset, offset + size).arrayBuffer());
  const found = new Map<string, Blob>();
  for (let at = 0, i = 0; i < entries; i++) {
    const method = directory.getUint16(at + 10, true);
    const compressed = directory.getUint32(at + 20, true);
    const nameBytes = directory.getUint16(at + 28, true);
    const local = directory.getUint32(at + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(directory.buffer, at + 46, nameBytes));
    at += 46 + nameBytes + directory.getUint16(at + 30, true) + directory.getUint16(at + 32, true);
    if (name.endsWith("/")) continue;
    const header = new DataView(await zip.slice(local, local + 30).arrayBuffer());
    const start = local + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    const data = zip.slice(start, start + compressed);
    if (method === 0) found.set(name, data);
    else if (method === 8) {
      found.set(
        name,
        await new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob(),
      );
    } else throw new Error(`${name} in ${zip.name} is compressed in a way DDALAB does not read`);
  }
  return found;
}

/** A bundle's files by path (from a zip or a folder): `manifest.json`, at the top or in one folder, and its arrays. */
async function fromBundle(files: Map<string, Blob>, source: string): Promise<Incoming> {
  const manifestPath = [...files.keys()]
    .filter((path) => path === "manifest.json" || path.endsWith("/manifest.json"))
    .sort((a, b) => a.split("/").length - b.split("/").length)[0];
  if (!manifestPath) throw new Error(`${source} holds no manifest.json: it is not a DDALAB result bundle`);
  const prefix = manifestPath.slice(0, -"manifest.json".length);
  let manifest: ResultDocument;
  try {
    manifest = JSON.parse(await (files.get(manifestPath) as Blob).text());
  } catch {
    throw new Error(`The manifest.json of ${source} is not JSON`);
  }
  const listed = (v: VariantDocument) => (Array.isArray(v?.arrays) ? v.arrays : []);
  const arrays = new Map<string, Blob>();
  for (const path of Array.isArray(manifest?.variants) ? manifest.variants.flatMap(listed) : []) {
    const blob = files.get(prefix + path);
    if (!blob) throw new Error(`${source} lacks ${path}, which its manifest lists`);
    arrays.set(path, blob);
  }
  return { manifest, arrays };
}

/** `[row][window]` with `rows` rows of `windows` values each. */
const fits = (matrix: unknown, rows: number, windows: number) =>
  Array.isArray(matrix) &&
  matrix.length === rows &&
  matrix.every((row) => Array.isArray(row) && row.length === windows);

/** A JSON result document as a bundle: each variant's matrices become its window-major arrays. */
function fromDocument(document: ResultDocument, source: string): Incoming {
  const windows = document?.window_centers_seconds?.length;
  const shaped =
    document?.schema === "ddalab.result/2" &&
    Array.isArray(document.variants) &&
    document.variants.every((v) => {
      const rows = v.row_labels?.length;
      const terms = v.coefficient_matrices?.every((m) => fits(m, rows, windows)) ?? true;
      return (
        fits(v.matrix, rows, windows) &&
        terms &&
        (v.fit_error_matrix === null || fits(v.fit_error_matrix, rows, windows))
      );
    });
  if (!shaped) throw new Error(`${source} is not a DDALAB result document (schema ddalab.result/2)`);
  const arrays = new Map<string, Blob>();
  const variants = document.variants.map((variant) => {
    const rows = variant.row_labels.length;
    const paths: string[] = [];
    const add = (
      name: string,
      terms: number | undefined,
      at: (w: number, r: number, k: number) => number | null,
    ) => {
      const shape = terms === undefined ? [windows, rows] : [windows, rows, terms];
      const values = new Float64Array(count(shape));
      const k1 = terms ?? 1;
      for (let w = 0; w < windows; w++)
        for (let r = 0; r < rows; r++)
          for (let k = 0; k < k1; k++) values[(w * rows + r) * k1 + k] = at(w, r, k) ?? Number.NaN;
      paths.push(`${variant.id}/${name}`);
      arrays.set(paths[paths.length - 1], new Blob([npyHeaderBytes(shape), values]));
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

/** Throws unless `incoming` is a ddalab.result/2 bundle whose arrays have the shapes its manifest implies. */
async function check({ manifest, arrays }: Incoming, source: string) {
  const shaped =
    manifest?.schema === "ddalab.result/2" &&
    Array.isArray(manifest.window_centers_seconds) &&
    typeof manifest.reproduction?.request === "object" &&
    Array.isArray(manifest.variants) &&
    manifest.variants.every(
      (v) =>
        Array.isArray(v.row_labels) &&
        v.arrays?.includes(`${v.id}/q.npy`) &&
        v.arrays.every((p) => ARRAY_PATH.test(p)),
    );
  if (!shaped) throw new Error(`${source} is not a DDALAB result (schema ddalab.result/2)`);
  const windows = manifest.window_centers_seconds.length;
  for (const variant of manifest.variants) {
    for (const path of variant.arrays ?? []) {
      const blob = arrays.get(path) as Blob;
      const { headerBytes, shape } = await npyHeader(blob, path);
      const dims = path.endsWith("coefficients.npy") ? 3 : 2;
      const ok =
        shape.length === dims &&
        shape[0] === windows &&
        shape[1] === variant.row_labels.length &&
        blob.size === headerBytes + 8 * count(shape);
      if (!ok) throw new Error(`${path} in ${source} does not have the shape its manifest implies`);
    }
  }
}

/** Writes `incoming` to OPFS as a complete result (resultStore.ts layout) under a new id. */
async function store({ manifest, arrays }: Incoming): Promise<string> {
  const id = crypto.randomUUID();
  const directory = await (await resultsDirectory()).getDirectoryHandle(id, { create: true });
  const write = async (path: string, data: Blob | string) => {
    const names = path.split("/");
    let folder = directory;
    for (const name of names.slice(0, -1)) folder = await folder.getDirectoryHandle(name, { create: true });
    const file = await (
      await folder.getFileHandle(names[names.length - 1], { create: true })
    ).createWritable();
    await file.write(data);
    await file.close();
  };
  try {
    await write("status", "running");
    for (const [path, blob] of arrays) await write(path, blob);
    await write("manifest.json", JSON.stringify(manifest));
    await write("status", "complete");
  } catch (error) {
    await discardResult(id).catch(() => {});
    throw quota(
      error,
      [...arrays.values()].reduce((sum, blob) => sum + blob.size, 0),
    );
  }
  return id;
}

const isZip = async (file: File) =>
  new Uint8Array(await file.slice(0, 4).arrayBuffer()).every((b, i) => b === [0x50, 0x4b, 0x03, 0x04][i]);

/**
 * Imports a result the CLI wrote: a bundle as a zip or as a folder's files (each with its `webkitRelativePath`), or a
 * JSON result document. It is stored as a bundle under a new id and recorded in the history as complete; the id.
 */
export async function importResult(input: File | File[]): Promise<string> {
  let incoming: Incoming;
  let source: string;
  if (Array.isArray(input)) {
    source = input[0]?.webkitRelativePath.split("/")[0] || "The folder";
    incoming = await fromBundle(
      new Map(input.map((file) => [file.webkitRelativePath || file.name, file])),
      source,
    );
  } else if (await isZip(input)) {
    source = input.name;
    incoming = await fromBundle(await unzip(input), source);
  } else {
    source = input.name;
    let document: ResultDocument;
    try {
      document = JSON.parse(await input.text());
    } catch {
      throw new Error(`${source} is neither a bundle zip nor a JSON result document`);
    }
    incoming = fromDocument(document, source);
  }
  await check(incoming, source);
  const id = await store(incoming);
  const { manifest } = incoming;
  const record: AnalysisRecord = {
    id,
    fingerprint: "",
    fileName: manifest.file_name,
    request: manifest.reproduction.request,
    manifest: recordedManifest(manifest),
    plan: { windows: manifest.window_centers_seconds.length },
    createdAt: Date.now(),
    status: "complete",
  };
  await saveAnalysis(record);
  return id;
}
