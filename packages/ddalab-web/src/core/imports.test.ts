// Imports of the CLI's results, over the in-memory stand-in for the origin private file system: what they store, and
// the malformed files they refuse before storing anything.
import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, test } from "vitest";
import { documentJson } from "./exporters";
import { deleteAnalysis, listAnalyses } from "./history";
import { type FolderFile, importResult } from "./imports";
import { memoryOpfs, type Tree } from "./memoryOpfs";

const CLI = fileURLToPath(new URL("../../../dda-rs/target/release/ddalab", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../../../dda-rs/tests/fixtures/", import.meta.url));
/** Skipped without the native binary, except in CI, which builds it first and must not skip. */
const noCli = !existsSync(CLI) && !process.env.CI;

let root: Tree;
beforeEach(async () => {
  root = memoryOpfs();
  for (const { id } of await listAnalyses()) await deleteAnalysis(id);
});

/** Runs `ddalab run` on Fp1 and Fp2 of the BrainVision fixture, ST, CT and CD, samples 500 to 2500. */
function cli(...output: string[]) {
  execFileSync(
    CLI,
    [
      "run",
      "--file=fixture.vhdr",
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
      ...["--start-sample", "500", "--end-sample", "2500", ...output, "--quiet"],
    ],
    { cwd: FIXTURES },
  );
}

/** The files under `dir` as a picked folder gives them: paths from the folder's parent. */
function folder(dir: string): FolderFile[] {
  const parent = join(dir, "..");
  const walk = (at: string): string[] =>
    readdirSync(at).flatMap((name) =>
      statSync(join(at, name)).isDirectory() ? walk(join(at, name)) : [join(at, name)],
    );
  return walk(dir).map((path) => ({ path: relative(parent, path), file: new Blob([readFileSync(path)]) }));
}

/** The bytes of each stored file of result `id`, by path. */
function stored(id: string) {
  const found: Record<string, Uint8Array> = {};
  const walk = (tree: Tree, prefix: string) => {
    for (const [name, entry] of tree) {
      if (entry instanceof Map) walk(entry, `${prefix}${name}/`);
      else found[prefix + name] = entry.bytes;
    }
  };
  walk((root.get("results") as Tree).get(id) as Tree, "");
  return found;
}

test.skipIf(noCli)("cli_document_imports_and_exports_unchanged", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "ddalab-doc-")), "doc.json");
  cli("--output", out);
  const text = readFileSync(out, "utf8");
  const id = await importResult(new File([text], "doc.json", { type: "application/json" }));
  const [record] = await listAnalyses();
  expect(record).toMatchObject({ id, status: "complete", fileName: "fixture.vhdr", plan: { windows: 18 } });
  expect(record.manifest?.variants.map((v) => v.id)).toEqual(["ST", "CT", "CD"]);
  expect(JSON.parse(await (await documentJson(id)).text())).toEqual(JSON.parse(text));
});

test.skipIf(noCli)("cli_bundle_folder_imports_byte_for_byte", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ddalab-bundle-")), "fixture.dda");
  cli(`--bundle=${dir}`);
  const id = await importResult(folder(dir));
  const files = stored(id);
  expect(new TextDecoder().decode(files.status)).toBe("complete");
  // The arrays byte for byte; the manifest is written again from its parsed form, which only formats numbers anew.
  for (const { path, file } of folder(dir)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = path.slice("fixture.dda/".length);
    if (name === "manifest.json") {
      expect(JSON.parse(new TextDecoder().decode(files[name]))).toEqual(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
    } else expect(files[name], path).toEqual(bytes);
  }
});

/** A valid bundle folder of one ST variant over two windows and one row, its manifest changed by `edit`. */
function bundle(edit: (manifest: Record<string, unknown>) => void): FolderFile[] {
  const manifest: Record<string, unknown> = {
    schema: "ddalab.result/2",
    id: "cli",
    file_name: "a.edf",
    created_at_iso: "2026-10-25T00:00:00Z",
    diagnostics: [],
    window_centers_seconds: [0.5, 1.5],
    variants: [{ id: "ST", label: "ST", row_labels: ["Fp1"], arrays: ["ST/q.npy"] }],
    reproduction: {
      engine_version: "2.0.0",
      git_commit: null,
      input_sha256: { "a.edf": "00" },
      selected_channel_names: ["Fp1"],
      start_time_seconds: 0,
      end_time_seconds: 2,
      request: {
        file_path: "a.edf",
        channels: [0],
        time_range: { start: 0, end: 511 },
        preprocessing_options: { highpass: null, lowpass: null },
        algorithm_selection: { enabled_variants: ["ST"] },
        window_parameters: { window_length: 200, window_step: 100 },
        delay_parameters: { delays: [7, 10] },
      },
    },
  };
  edit(manifest);
  const dict = "{'descr': '<f8', 'fortran_order': False, 'shape': (2, 1), }\n";
  const head = Uint8Array.from([0x93, 78, 85, 77, 80, 89, 1, 0, dict.length, 0]);
  const q = new Blob([head, dict, new Float64Array([0.25, 0.5])]);
  return [
    { path: "a.dda/manifest.json", file: new Blob([JSON.stringify(manifest)]) },
    { path: "a.dda/ST/q.npy", file: q },
  ];
}

const reproduction = (m: Record<string, unknown>) => m.reproduction as Record<string, unknown>;

test("well_formed_bundle_imports", async () => {
  const id = await importResult(bundle(() => {}));
  expect(Object.keys(stored(id)).sort()).toEqual(["ST/q.npy", "manifest.json", "status"]);
});

test.each([
  ["request null", (m: Record<string, unknown>) => (reproduction(m).request = null), "reproduction.request"],
  [
    "request empty",
    (m: Record<string, unknown>) => (reproduction(m).request = {}),
    "reproduction.request.algorithm",
  ],
  ["no file name", (m: Record<string, unknown>) => delete m.file_name, "file_name"],
  ["no diagnostics", (m: Record<string, unknown>) => delete m.diagnostics, "diagnostics"],
  [
    "no channel names",
    (m: Record<string, unknown>) => delete reproduction(m).selected_channel_names,
    "reproduction.selected_channel_names",
  ],
  [
    "no time range",
    (m: Record<string, unknown>) => delete (reproduction(m).request as Record<string, unknown>).time_range,
    "reproduction.request.time_range.start",
  ],
  [
    "another variant's array",
    (m: Record<string, unknown>) => ((m.variants as { arrays: string[] }[])[0].arrays = ["CT/q.npy"]),
    "variants[0].arrays",
  ],
  [
    "no manifest fields",
    (m: Record<string, unknown>) => {
      for (const key of Object.keys(m)) delete m[key];
    },
    "schema",
  ],
])("refuses_%s", async (_, edit, field) => {
  await expect(importResult(bundle(edit))).rejects.toThrow(
    new RegExp(
      `^a\\.dda is not a DDALAB result \\(schema ddalab\\.result/2\\): ${field.replace(/[.[\]()]/g, "\\$&")}`,
    ),
  );
  // Nothing was stored.
  expect([...((root.get("results") as Tree | undefined) ?? new Map()).keys()]).toEqual([]);
  expect(await listAnalyses()).toEqual([]);
});

test("refuses_a_document_that_is_not_one", async () => {
  await expect(importResult(new File(["null"], "null.json"))).rejects.toThrow(
    /null\.json is not a DDALAB result \(schema ddalab\.result\/2\): schema/,
  );
  await expect(importResult(new File(["{"], "broken.json"))).rejects.toThrow(
    /broken\.json is neither a bundle zip nor a JSON result document/,
  );
  // Its size alone refuses a large document: no bytes past the first four are read.
  const large = Object.defineProperty(new File(["{}"], "large.json"), "size", { value: 96 * 2 ** 20 + 1 });
  await expect(importResult(large)).rejects.toThrow(
    /large\.json is above 96 MiB; import the result's bundle folder/,
  );
  expect(await listAnalyses()).toEqual([]);
});
