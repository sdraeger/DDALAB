// Exports of a stored result: the bundle as a zip, the JSON result document, one variant's Q values as CSV. The
// document carries the summaries dda-rs `build_document` computes and equals what `ddalab run --output` writes for
// the same request. The document and the CSV are built in the IO worker a slice at a time, each slice's text going
// into a Blob part at once: the JS heap holds one slice of values and its text at a time.
import { makeZip } from "client-zip";
import { count, type Npy, readNpyHeader } from "./npy";
import { resultManifest, resultsDirectory } from "./resultStore";
import type { VariantDocument } from "./types";

/** Above this estimated size a text export is refused: the bundle holds the same arrays at a fraction of it. */
export const TEXT_LIMIT = 512 * 2 ** 20;
/** Bytes of text per value, as `-0.17573526565987174,` takes. */
const TEXT_BYTES_PER_VALUE = 20;
/** Bytes of an array read at a time. */
const SLICE_BYTES = 4 * 2 ** 20;
/** Bytes of whole rows gathered per pass over a window-major array, to write them row by row. */
const GATHER_BYTES = 16 * 2 ** 20;
/** Values turned into one Blob part of text. */
const PART_VALUES = 2 ** 16;

type Stored = Npy & { file: Blob };

const megabytes = (bytes: number) => (bytes / 1e6).toLocaleString("en", { maximumSignificantDigits: 2 });

/** Throws when `values` would make more text than a browser tab should hold. */
function refuseAbove(values: number, what: string) {
  const bytes = values * TEXT_BYTES_PER_VALUE;
  if (bytes > TEXT_LIMIT) {
    throw new Error(`The ${what} would be about ${megabytes(bytes)} MB. Export the bundle instead.`);
  }
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

/** Values `from..to` of a stored array, in its window-major order. */
async function readValues({ file, headerBytes }: Stored, from: number, to: number) {
  return new Float64Array(await file.slice(headerBytes + 8 * from, headerBytes + 8 * to).arrayBuffer());
}

/**
 * The bundle `ddalab run --bundle` writes: `manifest.json` and the arrays it lists, whatever else the result's
 * folder holds (the status file, the heatmap's caches).
 */
export async function bundleZip(resultId: string): Promise<ReadableStream<Uint8Array>> {
  return makeZip(await bundleFiles(resultId));
}

/** The files of the bundle of `resultId`, named by their paths in it after `prefix`. */
export async function bundleFiles(resultId: string, prefix = "") {
  const directory = await resultDirectory(resultId);
  const manifest = await resultManifest(resultId);
  const paths = ["manifest.json", ...manifest.variants.flatMap((v) => v.arrays ?? [])];
  return Promise.all(
    paths.map(async (name) => ({ name: prefix + name, input: await fileAt(directory, name) })),
  );
}

/** A new line and the indent of nesting `level`, as serde_json's pretty printer writes them (two spaces a level). */
const line = (level: number) => `\n${"  ".repeat(level)}`;

/** `value` as serde_json's `to_string_pretty` lays it out, its first line at the place of nesting `level`. */
const pretty = (value: unknown, level: number) =>
  JSON.stringify(value, null, 2).replaceAll("\n", line(level));

/**
 * `series` as a JSON array at nesting `level`, a value a line, a Blob part per 64 Ki values; a non-finite value is
 * null, as serde_json writes it.
 */
function pushSeries(parts: BlobPart[], series: Float64Array, level: number) {
  if (series.length === 0) return void parts.push("[]");
  const indent = line(level + 1);
  let text = "[";
  for (let w = 0; w < series.length; w++) {
    text += `${w > 0 ? "," : ""}${indent}${Number.isFinite(series[w]) ? series[w] : "null"}`;
    if ((w + 1) % PART_VALUES === 0) {
      parts.push(new Blob([text]));
      text = "";
    }
  }
  parts.push(new Blob([`${text}${line(level)}]`]));
}

/**
 * Writes a window-major (W, R) array as the JSON matrix `[row][window]`, or a (W, R, K) one as `[term][row][window]`,
 * at nesting `level`, calling `onRow` with each row of the first form. A pass over the file gathers as many rows as fit
 * in GATHER_BYTES; a row longer than that is a pass of its own.
 */
async function pushArray(
  parts: BlobPart[],
  array: Stored,
  level: number,
  onRow?: (row: number, series: Float64Array) => void,
) {
  const [windows, rows, terms] = array.shape;
  const k1 = terms ?? 1;
  const columns = rows * k1;
  if (rows === 0) {
    const empty = Array.from({ length: terms ?? 0 }, (_, k) => `${k > 0 ? "," : ""}${line(level + 1)}[]`);
    return void parts.push(empty.length > 0 ? `[${empty.join("")}${line(level)}]` : "[]");
  }
  // The rows' level: inside the matrix, or inside a term's matrix.
  const inner = level + (terms === undefined ? 1 : 2);
  // The columns of the file (row r, term k at r * K + k) in the order of the JSON text: term first, then row.
  const order = Array.from({ length: columns }, (_, i) => (i % rows) * k1 + Math.floor(i / rows));
  const perPass = Math.max(1, Math.floor(GATHER_BYTES / (8 * Math.max(1, windows))));
  const sliceWindows = Math.max(1, Math.floor(SLICE_BYTES / (8 * columns)));
  parts.push("[");
  for (let first = 0; first < columns; first += perPass) {
    const block = order.slice(first, first + perPass);
    const series = block.map(() => new Float64Array(windows));
    for (let w0 = 0; w0 < windows; w0 += sliceWindows) {
      const w1 = Math.min(windows, w0 + sliceWindows);
      const values = await readValues(array, w0 * columns, w1 * columns);
      for (let w = w0; w < w1; w++) {
        for (const [j, column] of block.entries()) series[j][w] = values[(w - w0) * columns + column];
      }
    }
    for (const [j] of block.entries()) {
      const [k, r] = [Math.floor((first + j) / rows), (first + j) % rows];
      if (terms !== undefined && r === 0) parts.push(`${k > 0 ? "," : ""}${line(level + 1)}[`);
      parts.push(`${r > 0 ? "," : ""}${line(inner)}`);
      pushSeries(parts, series[j], inner);
      if (terms !== undefined && r === rows - 1) parts.push(`${line(level + 1)}]`);
      onRow?.(r, series[j]);
    }
  }
  parts.push(`${line(level)}]`);
}

/** One variant of the document at nesting `level`: its arrays as matrices and the summaries of its Q values. */
async function pushVariant(
  parts: BlobPart[],
  variant: VariantDocument,
  stored: (path?: string) => Stored,
  level: number,
) {
  const { id, label, row_labels } = variant;
  const field = (name: string) => `${line(level + 1)}"${name}": `;
  parts.push(`{${field("id")}${pretty(id, level + 1)},${field("label")}${pretty(label, level + 1)},`);
  parts.push(`${field("row_labels")}${pretty(row_labels, level + 1)},${field("matrix")}`);
  // Over the finite values, as dda-rs `summarize`: the mean sums |x| in window order, 0 for a row without any.
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const meanAbsolute: number[] = [];
  const peakAbsolute: number[] = [];
  await pushArray(parts, stored(arrayOf(variant, "q.npy")), level + 1, (r, series) => {
    let [sum, n, peak] = [0, 0, 0];
    for (const x of series) {
      if (!Number.isFinite(x)) continue;
      sum += Math.abs(x);
      n++;
      peak = Math.max(peak, Math.abs(x));
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
    meanAbsolute[r] = n > 0 ? sum / n : 0;
    peakAbsolute[r] = peak;
  });
  const finite = min <= max;
  const summaries = {
    min_value: finite ? min : null,
    max_value: finite ? max : null,
    row_mean_absolute: meanAbsolute,
    row_peak_absolute: peakAbsolute,
  };
  for (const [name, value] of Object.entries(summaries))
    parts.push(`,${field(name)}${pretty(value, level + 1)}`);
  parts.push(`,${field("coefficient_matrices")}`);
  const coefficients = arrayOf(variant, "coefficients.npy");
  if (coefficients) await pushArray(parts, stored(coefficients), level + 1);
  else parts.push("null");
  parts.push(`,${field("fit_error_matrix")}`);
  const fitError = arrayOf(variant, "fit_error.npy");
  if (fitError) await pushArray(parts, stored(fitError), level + 1);
  else parts.push("null");
  parts.push(`${line(level)}}`);
}

/**
 * The result document with its matrices inline, as `ddalab run --output` writes it: serde_json's pretty layout, two
 * spaces a level and no newline after the last brace. A number may be spelled otherwise (JavaScript writes 2 where Rust
 * writes 2.0); the JSON is the same. Refused above 512 MiB of estimated text.
 */
export async function documentJson(resultId: string): Promise<Blob> {
  const directory = await resultDirectory(resultId);
  const manifest = await resultManifest(resultId);
  const arrays = new Map<string, Stored>();
  for (const path of manifest.variants.flatMap((v) => v.arrays ?? [])) {
    const file = await fileAt(directory, path);
    arrays.set(path, { file, ...(await readNpyHeader(file, path)) });
  }
  refuseAbove(
    [...arrays.values()].reduce((sum, { shape }) => sum + count(shape), 0),
    "JSON document",
  );
  const stored = (path?: string) => {
    const found = path && arrays.get(path);
    if (!found) throw new Error(`The result has no ${path}`);
    return found;
  };
  const { variants, reproduction, ...head } = manifest;
  const parts: BlobPart[] = [pretty(head, 0).slice(0, -2), `,${line(1)}"variants": `];
  if (variants.length === 0) parts.push("[]");
  else {
    parts.push("[");
    for (const [i, variant] of variants.entries()) {
      parts.push(`${i > 0 ? "," : ""}${line(2)}`);
      await pushVariant(parts, variant, stored, 2);
    }
    parts.push(`${line(1)}]`);
  }
  parts.push(`,${line(1)}"reproduction": ${pretty(reproduction, 1)}\n}`);
  return new Blob(parts, { type: "application/json" });
}

const csvField = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);

/**
 * The Q values of `variant`, a window per line: its center in seconds, then one column per row label. Refused above
 * 512 MiB of estimated text.
 */
export async function variantCsv(resultId: string, variant: string): Promise<Blob> {
  const manifest = await resultManifest(resultId);
  const found = manifest.variants.find((v) => v.id === variant);
  const path = found && arrayOf(found, "q.npy");
  if (!found || !path) throw new Error(`The result has no variant ${variant}`);
  const file = await fileAt(await resultDirectory(resultId), path);
  const array = { file, ...(await readNpyHeader(file, path)) };
  const [windows, rows] = array.shape;
  refuseAbove(windows * (rows + 1), "CSV table");
  const centers = manifest.window_centers_seconds;
  const parts: BlobPart[] = [`${["window_center_s", ...found.row_labels].map(csvField).join(",")}\n`];
  // A part of text per 64 Ki values: a string built of many more pieces costs several times its length on the heap.
  const step = Math.max(1, Math.floor(PART_VALUES / Math.max(1, rows)));
  for (let w0 = 0; w0 < windows; w0 += step) {
    const w1 = Math.min(windows, w0 + step);
    const values = await readValues(array, w0 * rows, w1 * rows);
    let text = "";
    for (let w = w0; w < w1; w++) {
      text += centers[w];
      for (let r = 0; r < rows; r++) {
        const value = values[(w - w0) * rows + r];
        text += Number.isFinite(value) ? `,${value}` : ","; // empty, as the document's null
      }
      text += "\n";
    }
    parts.push(new Blob([text]));
  }
  return new Blob(parts, { type: "text/csv" });
}
