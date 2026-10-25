// The wasm core through src/core/abi.ts, in Node. The Node reference host of the ABI (host.mjs) runs the same
// calls on the same fixtures; every byte abi.ts returns must equal the reference's.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
// @ts-expect-error The reference host is plain JavaScript without declarations.
import { load } from "../../../ddalab-wasm/node/host.mjs";
import { decodeReply, type HostRead, instantiateCore, unframe } from "./abi";
import golden from "./golden/inspect-fixture-edf.json";
import type { DDARequest, OpenRequest, Progress } from "./types";

const FIXTURES = new URL("../../../dda-rs/tests/fixtures/", import.meta.url);
const wasm = new WebAssembly.Module(readFileSync(new URL("./ddalab.wasm", import.meta.url)));

// file_id n is loaded[n - 1]; ids are never reused.
const loaded: Buffer[] = [];
const read: HostRead = (fileId, offset, dst) => {
  const file = loaded[fileId - 1];
  if (!file || offset + dst.length > file.length)
    throw new Error(`no ${dst.length} bytes at ${offset} of file ${fileId}`);
  dst.set(file.subarray(offset, offset + dst.length));
};
function recording(...names: string[]): OpenRequest {
  const files = names.map((name) => {
    loaded.push(readFileSync(new URL(name, FIXTURES)));
    return { name, file_id: loaded.length, len: loaded.at(-1)?.length ?? 0 };
  });
  return { primary: names[0], files };
}

const progress: Progress[] = [];
const core = await instantiateCore(wasm, read, (p) => progress.push(p));
const reference = await load(new URL("./ddalab.wasm", import.meta.url).pathname);
const fixturePath = (name: string) => new URL(name, FIXTURES).pathname;

/** ST over both channels of fixture.edf, 200-sample windows every 100. */
const request = (rows: number): DDARequest => ({
  file_path: "fixture.edf",
  channels: [0, 1],
  time_range: { start: 0, end: rows - 1 },
  preprocessing_options: { highpass: null, lowpass: null },
  algorithm_selection: { enabled_variants: ["ST"], select_mask: "1 0 0 0 0 0" },
  window_parameters: { window_length: 200, window_step: 100 },
  delay_parameters: { delays: [7, 10] },
  model_parameters: { dm: 4, order: 4, nr_tau: 2 },
});

test("version_reports_variants", () => {
  const { engine_version, variants } = core.version();
  expect(engine_version).toMatch(/^\d+\.\d+\.\d+/);
  const ids = variants.map((v) => v.abbreviation);
  for (const id of ["ST", "CT", "CD", "DE", "SY"]) expect(ids).toContain(id);
});

// build-wasm.mjs passes `git rev-parse HEAD`: after a commit, run `npm run build:wasm` before this test.
const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
test.skipIf(head.status !== 0)("version_carries_the_build_commit", () => {
  expect(core.version().git_commit).toBe(head.stdout.trim());
});

test("open_fixture_edf", () => {
  const { handle, info, analysis_channels } = core.open(recording("fixture.edf"));
  const scan = core.annotations(handle);
  core.close(handle);
  expect(info.channels.map((c) => c.label)).toEqual(golden.channels.map((c) => c.label));
  // `ddalab inspect` reports the scanned annotations and both warning lists.
  const scanned = { ...info, annotations: scan.annotations, warnings: [...info.warnings, ...scan.warnings] };
  expect({ ...scanned, analysis_channels }).toEqual(golden);
});

test("errors_throw_and_the_instance_survives", () => {
  expect(() => core.open(recording("result_reference.json"))).toThrow(/Unsupported file type/);
  expect(() => core.rawTile(9999, 0, 0)).toThrow(/no open recording/);
  expect(core.version().engine_version).toMatch(/^\d+\./);
});

test("host_imports_never_throw", async () => {
  let failing = true;
  const flaky = await instantiateCore(
    wasm,
    (fileId, offset, dst) => {
      if (failing) throw new Error("NotReadableError");
      read(fileId, offset, dst);
    },
    () => {
      throw new Error("progress listener failed");
    },
  );
  const input = recording("fixture.edf");
  expect(() => flaky.open(input)).toThrow(/host read failed for fixture\.edf at offset 0/);
  failing = false;
  const { handle, info } = flaky.open(input);
  const req = request(info.sample_count);
  const [block] = flaky.plan(handle, req, 64).blocks;
  expect(flaky.runBlock(handle, req, block).chunks.length).toBeGreaterThan(0);
  flaky.close(handle);
});

test("replies_decode_unsigned", () => {
  // A reply at 2.25 GiB arrives from wasm as a negative i64.
  const reply = BigInt.asIntN(64, (0x9000_0000n << 32n) | 0xffff_fff0n);
  expect(reply < 0n).toBe(true);
  expect(decodeReply(reply)).toEqual([0x9000_0000, 0xffff_fff0]);
});

test("unframe_splits_length_prefixed_items", () => {
  const bytes = Uint8Array.from([2, 0, 0, 0, 3, 0, 0, 0, 7, 8, 9, 0, 0, 0, 0]);
  expect(unframe(bytes).map((item) => [...item])).toEqual([[7, 8, 9], []]);
});

test("sha256_streams_and_rejects_unknown_ids", () => {
  const hash = core.sha256();
  hash.update(new TextEncoder().encode("abc"));
  expect(hash.hex()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(() => hash.update(new Uint8Array(1))).toThrow(/no hash/);
  expect(() => hash.hex()).toThrow(/no hash/);
});

test("raw_data_matches_reference", () => {
  const input = recording("fixture.edf");
  const { handle, analysis_channels } = core.open(input);
  const ref = reference.open([fixturePath("fixture.edf")]).handle;
  const raw = core.readRaw(handle, 1, 3);
  expect(raw.length).toBe(3 * analysis_channels.length);
  expect(raw).toEqual(reference.readRaw(ref, 1, 3));
  expect(new TextDecoder().decode(new Uint8Array(core.rawTile(handle, 0, 0), 0, 4))).toBe("DDT1");
  expect(new Uint8Array(core.rawTile(handle, 0, 0))).toEqual(reference.rawTile(ref, 0, 0));
  expect(() => core.readRaw(handle, 7679, 2)).toThrow(/rows/);
  core.close(handle);
  reference.close(ref);
});

test("pyramid_matches_reference", () => {
  const { handle, info } = core.open(recording("fixture.edf"));
  const ref = reference.open([fixturePath("fixture.edf")]).handle;
  const [mine, theirs] = [core.pyramid(handle), reference.pyramid(ref)];
  expect(() => mine.push(5, 10)).toThrow(/rows from 0/);
  const built: ArrayBuffer[] = [];
  const expected: Uint8Array[] = [];
  for (let row = 0; row < info.sample_count; row += 999) {
    const rows = Math.min(999, info.sample_count - row);
    built.push(...mine.push(row, rows));
    expected.push(...theirs.push(row, rows));
  }
  built.push(...mine.finish());
  expected.push(...theirs.finish());
  expect(built.length).toBeGreaterThan(0);
  expect(built.map((tile) => new Uint8Array(tile))).toEqual(expected);
  expect(() => mine.push(0, 1)).toThrow(/no pyramid/);
  core.close(handle);
  reference.close(ref);
});

test("pyramid_drop_ends_it", () => {
  const { handle } = core.open(recording("fixture.edf"));
  const pyramid = core.pyramid(handle);
  pyramid.drop();
  expect(() => pyramid.push(0, 10)).toThrow(/no pyramid/);
  core.close(handle);
  expect(() => core.pyramid(handle)).toThrow(/no pyramid/);
});

test("blocks_and_manifest_match_reference", () => {
  const { handle, info } = core.open(recording("fixture.edf"));
  const ref = reference.open([fixturePath("fixture.edf")]).handle;
  const req = request(info.sample_count);
  // 0 MiB plans one window per block.
  const plan = core.plan(handle, req, 0);
  expect(plan.blocks.length).toBe(plan.windows);
  expect(JSON.parse(JSON.stringify(plan))).toEqual(reference.plan(ref, req, 0));
  progress.length = 0;
  for (const block of plan.blocks) {
    const chunks = core
      .runBlock(handle, req, block)
      .chunks.map((c) => ({ ...c, bytes: new Uint8Array(c.bytes) }));
    expect(chunks).toEqual(reference.runBlock(ref, req, block.w0, block.w1));
  }
  expect(progress.length).toBeGreaterThan(0);
  const extras = {
    id: "run",
    created_at_iso: "2026-10-25T00:00:00Z",
    input_sha256: {},
    windows: plan.windows,
  };
  expect(core.manifest(handle, req, extras)).toEqual(reference.manifest(ref, req, extras));
  core.close(handle);
  reference.close(ref);
});

test("open_takes_a_cache_size", () => {
  const input = recording("fixture.edf");
  const [small, standard] = [core.open(input, { cacheMb: 4 }), core.open(input)];
  expect(core.readRaw(small.handle, 0, 3000)).toEqual(core.readRaw(standard.handle, 0, 3000));
  core.close(small.handle);
  core.close(standard.handle);
});
