// Exports of a stored result and imports of the CLI's, over an in-memory stand-in for the origin private file system.
import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, test, vi } from "vitest";
import { documentJson, importResult, variantCsv } from "./exporters";
import { listAnalyses } from "./history";

type Tree = Map<string, Tree | Blob>;

/** The parts of a FileSystemDirectoryHandle the exporters use, over `tree`. */
function directory(tree: Tree): FileSystemDirectoryHandle {
  const missing = () => new DOMException("not found", "NotFoundError");
  return {
    kind: "directory",
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      if (!tree.has(name) && options?.create) tree.set(name, new Map());
      const found = tree.get(name);
      if (!(found instanceof Map)) throw missing();
      return directory(found);
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!tree.has(name) && options?.create) tree.set(name, new Blob());
      if (!(tree.get(name) instanceof Blob)) throw missing();
      return {
        kind: "file",
        getFile: async () => new File([tree.get(name) as Blob], name),
        async createWritable() {
          const parts: BlobPart[] = [];
          return {
            write: async (data: BlobPart) => void parts.push(data),
            close: async () => void tree.set(name, new Blob(parts)),
          };
        },
      };
    },
    async removeEntry(name: string) {
      if (!tree.delete(name)) throw missing();
    },
    async *entries() {
      for (const [name, entry] of tree)
        yield [name, entry instanceof Map ? directory(entry) : { kind: "file" }];
    },
  } as unknown as FileSystemDirectoryHandle;
}

let root: Tree;
beforeEach(() => {
  root = new Map();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => directory(root) } });
});

/** A version 1.0 `.npy` file of little-endian f64 `values` in `shape`, its header unpadded. */
function npy(shape: number[], values: number[] = []) {
  const dict = `{'descr': '<f8', 'fortran_order': False, 'shape': (${shape.join(", ")}), }\n`;
  const head = Uint8Array.from([0x93, 78, 85, 77, 80, 89, 1, 0, dict.length & 255, dict.length >> 8]);
  return new Blob([head, dict, new Float64Array(values)]);
}

/** Stores a result of one variant under `id`, as a run leaves it. */
function store(id: string, variant: object, arrays: Record<string, Blob>, windows: number[]) {
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
  const files: Tree = new Map([
    ["status", new Blob(["complete"])],
    ["manifest.json", new Blob([JSON.stringify(manifest)])],
  ]);
  for (const [path, blob] of Object.entries(arrays)) {
    const [folder, name] = path.split("/");
    if (!files.has(folder)) files.set(folder, new Map());
    (files.get(folder) as Tree).set(name, blob);
  }
  root.set("results", new Map([[id, files]]));
}

test("csv_header_and_first_row", async () => {
  const variant = {
    id: "CD",
    label: "Cross-Dynamical (CD)",
    row_labels: ["Fp1 <- Fp2", 'Odd, "label"'],
    matrix: [],
    arrays: ["CD/q.npy"],
  };
  // Two windows of two rows, window-major; a non-finite value is an empty field.
  store("r", variant, { "CD/q.npy": npy([2, 2], [0.25, Number.NaN, -1e-7, 3]) }, [1.5, 1.7]);
  const lines = (await (await variantCsv("r", "CD")).text()).split("\n");
  expect(lines[0]).toBe('window_center_s,Fp1 <- Fp2,"Odd, ""label"""');
  expect(lines[1]).toBe("1.5,0.25,");
  expect(lines[2]).toBe("1.7,-1e-7,3");
});

test("json_size_guard", async () => {
  // A million windows of 40 rows is about 800 MB of JSON; only the header is stored, which is all the guard reads.
  const variant = { id: "ST", label: "ST", row_labels: [], matrix: [], arrays: ["ST/q.npy"] };
  store("big", variant, { "ST/q.npy": npy([1_000_000, 40]) }, []);
  await expect(documentJson("big")).rejects.toThrow(/Export the bundle instead/);
});

const CLI = fileURLToPath(new URL("../../../dda-rs/target/release/ddalab", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../../../dda-rs/tests/fixtures/", import.meta.url));

test.skipIf(!existsSync(CLI))("cli_document_imports_and_exports_unchanged", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "ddalab-doc-")), "doc.json");
  execFileSync(
    CLI,
    [
      "run",
      "--file",
      "fixture.vhdr",
      ...[
        "--channels",
        "0",
        "1",
        "--variants",
        "ST",
        "CT",
        "CD",
        "--ct-pairs",
        "0,1",
        "--cd-pairs",
        "0,1",
        "1,0",
      ],
      ...["--start-sample", "500", "--end-sample", "2500", "--output", out, "--quiet"],
    ],
    { cwd: FIXTURES },
  );
  const text = readFileSync(out, "utf8");
  const id = await importResult(new File([text], "doc.json", { type: "application/json" }));
  const [record] = await listAnalyses();
  expect(record).toMatchObject({ id, status: "complete", fileName: "fixture.vhdr" });
  expect(record.manifest?.variants.map((v) => v.id)).toEqual(["ST", "CT", "CD"]);
  expect(JSON.parse(await (await documentJson(id)).text())).toEqual(JSON.parse(text));
});
