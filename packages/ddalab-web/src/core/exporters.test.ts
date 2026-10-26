// Exports of a stored result, over the in-memory stand-in for the origin private file system.
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { beforeEach, expect, test, vi } from "vitest";
import { bundleZip, documentJson, variantCsv } from "./exporters";
import { unzip } from "./imports";
import { memoryOpfs, putFile, type Tree } from "./memoryOpfs";
import { npyHeader } from "./npy";

let root: Tree;
beforeEach(() => {
  root = memoryOpfs();
});

/** A `.npy` file of `values` in `shape`. */
function npy(shape: number[], values: ArrayLike<number> = []) {
  const header = npyHeader(shape);
  const bytes = new Uint8Array(header.length + 8 * values.length);
  bytes.set(header);
  bytes.set(new Uint8Array(Float64Array.from(values).buffer), header.length);
  return bytes;
}

/** Stores a complete result of one variant under `id`, as a run leaves it, plus `extra` files. */
function store(id: string, variant: object, files: Record<string, Uint8Array | string>, windows: number[]) {
  const manifest = {
    schema: "ddalab.result/2",
    id,
    file_name: "fixture.edf",
    created_at_iso: "2026-10-25T00:00:00Z",
    diagnostics: [],
    window_centers_seconds: windows,
    variants: [variant],
    reproduction: {},
  };
  putFile(root, `results/${id}/status`, "complete");
  putFile(root, `results/${id}/manifest.json`, JSON.stringify(manifest));
  for (const [path, bytes] of Object.entries(files)) putFile(root, `results/${id}/${path}`, bytes);
}

const cd = {
  id: "CD",
  label: "Cross-Dynamical (CD)",
  row_labels: ["Fp1 <- Fp2", 'Odd, "label"'],
  matrix: [],
};

test("csv_header_and_first_row", async () => {
  // Two windows of two rows, window-major; a non-finite value is an empty field.
  const q = npy([2, 2], [0.25, Number.NaN, -1e-7, 3]);
  store("r", { ...cd, arrays: ["CD/q.npy"] }, { "CD/q.npy": q }, [1.5, 1.7]);
  const lines = (await (await variantCsv("r", "CD")).text()).split("\n");
  expect(lines[0]).toBe('window_center_s,Fp1 <- Fp2,"Odd, ""label"""');
  expect(lines[1]).toBe("1.5,0.25,");
  expect(lines[2]).toBe("1.7,-1e-7,3");
});

test("document_takes_serde_jsons_pretty_layout", async () => {
  // Q of two windows and rows (a NaN among them), coefficients of three terms, and the fit error; JSON.stringify with
  // two spaces lays JSON out as serde_json's to_string_pretty does, and the CLI adds no newline after a file's brace.
  const arrays = ["CD/q.npy", "CD/coefficients.npy", "CD/fit_error.npy"];
  const files = {
    "CD/q.npy": npy([2, 2], [0.25, Number.NaN, -1e-7, 3]),
    "CD/coefficients.npy": npy(
      [2, 2, 3],
      Array.from({ length: 12 }, (_, i) => i / 8),
    ),
    "CD/fit_error.npy": npy([2, 2], [1, 2, 3, 4]),
  };
  store("r", { ...cd, arrays }, files, [1.5, 1.7]);
  const text = await (await documentJson("r")).text();
  expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
  const { variants } = JSON.parse(text);
  expect(variants[0].matrix).toEqual([
    [0.25, -1e-7],
    [null, 3],
  ]);
  expect(variants[0].coefficient_matrices[2]).toEqual([
    [0.25, 1],
    [0.625, 1.375],
  ]);
  // No rows: an empty matrix, and one empty matrix per term.
  store(
    "e",
    { ...cd, arrays },
    { ...files, "CD/q.npy": npy([2, 0]), "CD/coefficients.npy": npy([2, 0, 2]) },
    [1, 2],
  );
  const empty = await (await documentJson("e")).text();
  expect(empty).toBe(JSON.stringify(JSON.parse(empty), null, 2));
  expect(JSON.parse(empty).variants[0]).toMatchObject({ matrix: [], coefficient_matrices: [[], []] });
});

test("json_size_guard", async () => {
  // A million windows of 40 rows is about 800 MB of text; only the header is stored, which is all the guards read.
  const variant = { id: "ST", label: "ST", row_labels: [], matrix: [], arrays: ["ST/q.npy"] };
  store("big", variant, { "ST/q.npy": npy([1_000_000, 40]) }, []);
  await expect(documentJson("big")).rejects.toThrow(/about 800 MB\. Export the bundle instead/);
  await expect(variantCsv("big", "ST")).rejects.toThrow(/about 820 MB\. Export the bundle instead/);
});

test("zip_holds_the_manifest_and_its_arrays_only", async () => {
  const q = npy([2, 2], [1, 2, 3, 4]);
  // The status file and the heatmap's pyramid levels (resultStore.ts) share the folder; `ddalab run --bundle` writes
  // neither.
  const files = { "CD/q.npy": q, "CD/q.pyramid.json": "{}", "CD/q.L1.f32": new Uint8Array(16) };
  store("r", { ...cd, arrays: ["CD/q.npy"] }, files, [1.5, 1.7]);
  const zip = new File([await new Response(await bundleZip("r")).blob()], "r.zip");
  const entries = await unzip(zip);
  expect([...entries.keys()].sort()).toEqual(["CD/q.npy", "manifest.json"]);
  expect(new Uint8Array(await (entries.get("CD/q.npy") as Blob).arrayBuffer())).toEqual(q);
});

// Only the live heap counts: a full collection runs before each sample.
setFlagsFromString("--expose-gc");
const collect = runInNewContext("gc") as () => void;
const liveHeap = () => {
  collect();
  return process.memoryUsage().heapUsed;
};

/**
 * The most live JS heap `task` held above the heap at its start, in MB, sampled as each Blob part is made: the moment
 * a slice's text is at its largest.
 */
async function heapGrowthMb(task: () => Promise<unknown>) {
  const base = liveHeap();
  let peak = base;
  const Original = globalThis.Blob;
  vi.stubGlobal(
    "Blob",
    class extends Original {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        peak = Math.max(peak, liveHeap());
      }
    },
  );
  try {
    await task();
  } finally {
    vi.stubGlobal("Blob", Original);
  }
  return (peak - base) / 1e6;
}

test("text_exports_hold_a_slice_on_the_heap", async () => {
  // 100,000 windows of 64 rows: 51 MB of values, about 130 MB of text each way.
  const [windows, rows] = [100_000, 64];
  const values = Float64Array.from({ length: windows * rows }, (_, i) => Math.sin(i) * 1e-3);
  const variant = {
    ...cd,
    row_labels: Array.from({ length: rows }, (_, r) => `CH${r}`),
    arrays: ["CD/q.npy"],
  };
  const centers = Array.from({ length: windows }, (_, w) => w / 10);
  store("large", variant, { "CD/q.npy": npy([windows, rows], values) }, centers);
  let json: Blob | undefined;
  let csv: Blob | undefined;
  const jsonGrowth = await heapGrowthMb(async () => (json = await documentJson("large")));
  const csvGrowth = await heapGrowthMb(async () => (csv = await variantCsv("large", "CD")));
  const mb = (n: number) => (n / 1e6).toFixed(1);
  console.log(
    `live heap growth: JSON ${jsonGrowth.toFixed(1)} MB for ${mb(json?.size ?? 0)} MB of text, ` +
      `CSV ${csvGrowth.toFixed(1)} MB for ${mb(csv?.size ?? 0)} MB`,
  );
  expect(json?.size).toBeGreaterThan(100e6);
  expect(csv?.size).toBeGreaterThan(100e6);
  expect(jsonGrowth).toBeLessThan(24);
  expect(csvGrowth).toBeLessThan(24);
}, 60_000); // 145 MB of text each way takes about 6 s on a 4-core CI runner
