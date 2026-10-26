// Project files: the zip reader under them (ZIP64, entries checked against the central directory, a directory read by
// its size) and a project read as an opened one is: its entries stored, its project.json checked, its files present at
// their sizes and with their fingerprints.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { makeZip } from "client-zip";
import { expect, test } from "vitest";
import { unzip, zipEntries } from "./imports";
import { checkProject, fingerprintOfFiles, type Project, readProject, SCHEMA } from "./project";

const FIXTURES = fileURLToPath(new URL("../../../dda-rs/tests/fixtures/", import.meta.url));
const fixture = (name: string): Bytes => new Uint8Array(readFileSync(FIXTURES + name));
const bytesOf = async (blob: Blob | undefined) => new Uint8Array(await (blob as Blob).arrayBuffer());

type Bytes = Uint8Array<ArrayBuffer>;
type Entry = { name: string; bytes: Bytes; method?: 0 | 8; size?: number };

const record = (size: number, fill: (v: DataView) => void) => {
  const view = new DataView(new ArrayBuffer(size));
  fill(view);
  return new Uint8Array(view.buffer);
};

/**
 * A zip of `entries` written by hand: an entry stored, or deflated (`method` 8, `size` its unpacked size). With `zip64`
 * every size and offset is in the ZIP64 fields and the end records are ZIP64's, as client-zip writes an archive above
 * 4 GiB.
 */
function handZip(entries: Entry[], zip64 = false) {
  const FULL = 0xffffffff;
  const parts: Bytes[] = [];
  const directory: Bytes[] = [];
  let offset = 0;
  for (const { name, bytes, method = 0, size = bytes.length } of entries) {
    const n = new TextEncoder().encode(name);
    const local = record(30, (v) => {
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 45, true);
      v.setUint16(8, method, true);
      v.setUint32(18, zip64 ? FULL : bytes.length, true);
      v.setUint32(22, zip64 ? FULL : size, true);
      v.setUint16(26, n.length, true);
    });
    const central = record(46, (v) => {
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 45, true);
      v.setUint16(6, 45, true);
      v.setUint16(10, method, true);
      v.setUint32(20, zip64 ? FULL : bytes.length, true);
      v.setUint32(24, zip64 ? FULL : size, true);
      v.setUint16(28, n.length, true);
      v.setUint16(30, zip64 ? 28 : 0, true);
      v.setUint32(42, zip64 ? FULL : offset, true);
    });
    const extra = record(zip64 ? 28 : 0, (v) => {
      if (!zip64) return;
      v.setUint16(0, 1, true);
      v.setUint16(2, 24, true);
      v.setBigUint64(4, BigInt(size), true);
      v.setBigUint64(12, BigInt(bytes.length), true);
      v.setBigUint64(20, BigInt(offset), true);
    });
    parts.push(local, n, bytes);
    directory.push(central, n, extra);
    offset += local.length + n.length + bytes.length;
  }
  const size = directory.reduce((sum, part) => sum + part.length, 0);
  const end = record(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, zip64 ? 0xffff : entries.length, true);
    v.setUint16(10, zip64 ? 0xffff : entries.length, true);
    v.setUint32(12, zip64 ? FULL : size, true);
    v.setUint32(16, zip64 ? FULL : offset, true);
  });
  if (!zip64) return new Blob([...parts, ...directory, end]);
  const end64 = record(56, (v) => {
    v.setUint32(0, 0x06064b50, true);
    v.setBigUint64(4, 44n, true);
    v.setBigUint64(24, BigInt(entries.length), true);
    v.setBigUint64(32, BigInt(entries.length), true);
    v.setBigUint64(40, BigInt(size), true);
    v.setBigUint64(48, BigInt(offset), true);
  });
  const locator = record(20, (v) => {
    v.setUint32(0, 0x07064b50, true);
    v.setBigUint64(8, BigInt(offset + size), true);
    v.setUint32(16, 1, true);
  });
  return new Blob([...parts, ...directory, end64, locator, end]);
}

const zipped = (entries: { name: string; input: Uint8Array | string }[]) =>
  new Response(makeZip(entries)).blob();

test("a_zip64_archive_reads_by_its_zip64_fields", async () => {
  const eeg = fixture("fixture.eeg");
  const zip = handZip(
    [
      { name: "a/fixture.eeg", bytes: eeg },
      { name: "b.txt", bytes: new TextEncoder().encode("second") },
    ],
    true,
  );
  const entries = await zipEntries(zip, "big.zip");
  expect(entries.map(({ name, size, method }) => ({ name, size, method }))).toEqual([
    { name: "a/fixture.eeg", size: eeg.length, method: 0 },
    { name: "b.txt", size: 6, method: 0 },
  ]);
  const files = await unzip(new File([zip], "big.zip"));
  expect(await bytesOf(files.get("a/fixture.eeg"))).toEqual(eeg);
  expect(await files.get("b.txt")?.text()).toBe("second");
});

test("an_entry_must_be_where_the_directory_says", async () => {
  const bytes = await bytesOf(handZip([{ name: "manifest.json", bytes: new TextEncoder().encode("{}") }]));
  // The local header names another entry than the directory does.
  const renamed = bytes.slice();
  renamed[30] = "n".charCodeAt(0);
  await expect(zipEntries(new Blob([renamed]), "r.zip")).rejects.toThrow(/local header of manifest\.json/);
  // The directory gives the entry more bytes than lie before it.
  const view = new DataView(bytes.buffer);
  view.setUint32(view.getUint32(bytes.length - 22 + 16, true) + 20, 100, true);
  await expect(zipEntries(new Blob([bytes]), "o.zip")).rejects.toThrow(
    "o.zip is not a readable zip archive: manifest.json reaches into the central directory",
  );
});

test("a_directory_of_more_than_65535_entries_reads_by_its_size", async () => {
  // client-zip writes no ZIP64 record for the count alone: the end record says 65535.
  const many = Array.from({ length: 65_536 }, (_, i) => ({ name: `e${i}`, input: "x" }));
  const entries = await zipEntries(await zipped(many), "many.zip");
  expect(entries).toHaveLength(65_536);
  expect(entries.at(-1)?.name).toBe("e65535");
}, 60_000);

const ID = "0b4c1f6e-2a8d-4c3e-9f1a-5d6e7f8a9b0c";
const BATCH = "1c5d2a7f-3b9e-4d4f-8a2b-6e7f8a9b0c1d";
const SHA = "a".repeat(64);
const brainVision = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"];
const saved = {
  view: { t0: 2, t1: 12, firstChannel: 1, rowCount: 3, epochS: 10, sensitivityUvPerMm: 7, chosenOnly: true },
  selection: { t0: 3, t1: 4 },
  selectedChannels: [0, 2],
  shownResult: null,
  activeResultId: ID,
};

/** A project of the EDF fixture (with a result in a batch) and the BrainVision one, its document and its archive. */
async function project(edit: (document: Project) => void = () => {}) {
  const fingerprintOf = (names: string[]) =>
    fingerprintOfFiles(names.map((name) => ({ name, bytes: new Blob([fixture(name)]) })));
  const filesOf = (k: number, names: string[]) =>
    names.map((name) => ({
      path: `recordings/${k}/${name}`,
      name,
      size: fixture(name).length,
      sha256: SHA,
      last_modified: 1000,
    }));
  const edf = await fingerprintOf(["fixture.edf"]);
  const document: Project = {
    schema: SCHEMA,
    app_version: "2.1.0",
    engine_version: "2.1.0",
    git_commit: null,
    created_at_iso: "2026-10-26T12:00:00.000Z",
    recordings: [
      {
        fingerprint: edf,
        files: filesOf(0, ["fixture.edf"]),
        annotations: [{ id: "c2a1", onset_s: 1.5, duration_s: 0, label: "spike" }],
        saved: structuredClone(saved) as Project["recordings"][number]["saved"],
        channel_query: "Fp",
      },
      {
        fingerprint: await fingerprintOf(brainVision),
        files: filesOf(1, brainVision),
        annotations: [],
        saved: null,
      },
    ],
    active_tab: edf,
    results: [
      {
        path: `results/${ID}/`,
        record: {
          id: ID,
          fingerprint: edf,
          fileName: "fixture.edf",
          inputFiles: ["fixture.edf"],
          plan: { windows: 18, blocks: 1, workers: 2 },
          createdAt: 1,
          finishedAt: 2,
          batch: BATCH,
        },
      },
    ],
    batches: [
      {
        id: BATCH,
        createdAt: 1,
        root: "study",
        form: {
          expert: false,
          variants: ["ST"],
          windowLength: "200",
          windowStep: "100",
          delays: "7, 10",
          modelTerms: "1 2 10",
          dm: "4",
          order: "4",
          nrTau: "2",
        },
        channels: { kind: "signal" },
        interval: { kind: "whole" },
        paths: ["study/fixture.edf"],
        results: [{ path: "study/fixture.edf", status: "ok", resultId: ID, warnings: [] }],
        status: "complete",
      },
    ],
  };
  edit(document);
  const files = [
    { name: "recordings/0/fixture.edf", input: fixture("fixture.edf") },
    ...brainVision.map((name) => ({ name: `recordings/1/${name}`, input: fixture(name) })),
    { name: `results/${ID}/manifest.json`, input: "{}" },
    { name: "project.json", input: JSON.stringify(document) },
  ];
  return { document, zip: await zipped(files) };
}

test("a_project_reads_back_with_its_recordings_in_place", async () => {
  const { document, zip } = await project();
  const { project: read, entries } = await readProject(zip, "study.ddalab");
  expect(read).toEqual(document);
  for (const name of brainVision)
    expect(await bytesOf(entries.get(`recordings/1/${name}`))).toEqual(fixture(name));
  // Each entry is a byte range of the archive, which an opened project's recording reads.
  const edf = (await zipEntries(zip, "study.ddalab")).find((e) => e.name.endsWith(".edf"));
  const start = edf?.start ?? 0;
  expect(await bytesOf(zip.slice(start, start + (edf?.size ?? 0)))).toEqual(fixture("fixture.edf"));
});

test("an_entry_that_is_not_stored_is_refused", async () => {
  const text = new TextEncoder().encode("{}");
  const zip = handZip([
    { name: "project.json", bytes: new Uint8Array(deflateRawSync(text)), method: 8, size: 2 },
  ]);
  await expect(readProject(zip, "packed.ddalab")).rejects.toThrow(
    "project.json in packed.ddalab is compressed: DDALAB reads a project's files in place, so each is stored",
  );
});

test("a_newer_schema_asks_for_an_update", () => {
  expect(() => checkProject({ schema: "ddalab.project/2" }, "new.ddalab")).toThrow(
    "new.ddalab was written by a newer DDALAB (ddalab.project/2). Update DDALAB to open it.",
  );
  expect(() => checkProject({ schema: "ddalab.result/2" }, "r.ddalab")).toThrow(/not a DDALAB project/);
  expect(() => checkProject(null, "n.ddalab")).toThrow(/not a DDALAB project/);
});

// biome-ignore lint/suspicious/noExplicitAny: edits of a parsed document
type Edit = (d: any) => void;
test.each<[string, Edit]>([
  ["recordings[0].files[0].name", (d) => (d.recordings[0].files[0].name = "../fixture.edf")],
  ["recordings[1].files[2].path", (d) => (d.recordings[1].files[2].path = "recordings/0/fixture.vmrk")],
  ["recordings[1].files[1].name", (d) => (d.recordings[1].files[1] = { ...d.recordings[1].files[0] })],
  ["recordings[0].fingerprint", (d) => (d.recordings[0].fingerprint = "../../x")],
  ["recordings[1].fingerprint", (d) => (d.recordings[1].fingerprint = d.recordings[0].fingerprint)],
  ["recordings[0].annotations[0].id", (d) => (d.recordings[0].annotations[0].id = "file:0")],
  ["recordings[0].saved", (d) => (d.recordings[0].saved.view.extra = { nested: true })],
  ["recordings[0].saved", (d) => (d.recordings[0].saved.selectedChannels = [-1])],
  ["active_tab", (d) => (d.active_tab = "b".repeat(64))],
  ["results[0].path", (d) => (d.results[0].path = "results/../")],
  ["results[0].record.id", (d) => (d.results[0].record.id = "../results")],
  ["results[0].record.fingerprint", (d) => (d.results[0].record.fingerprint = "c".repeat(64))],
  ["batches[0].interval", (d) => (d.batches[0].interval = { kind: "range" })],
  ["batches", (d) => d.batches.push(d.batches[0])],
])("malformed_%s_is_named", async (field, edit) => {
  const { document } = await project();
  edit(document);
  expect(() => checkProject(document, "bad.ddalab")).toThrow(
    `bad.ddalab is not a DDALAB project (schema ${SCHEMA}): ${field} is missing or malformed`,
  );
});

test("what_the_app_does_not_read_stays_out", async () => {
  const { document } = await project((d) => {
    // biome-ignore lint/suspicious/noExplicitAny: fields a project from elsewhere may carry
    const loose = d as any;
    loose.recordings[0].saved.view.mmPerCssMm = 2;
    loose.results[0].record.status = "running";
    loose.results[0].record.manifest = { forged: true };
    loose.batches[0].handle = { kind: "directory" };
    loose.batches[0].status = "running";
  });
  const read = checkProject(JSON.parse(JSON.stringify(document)), "loose.ddalab");
  // The calibration belongs to the display; a viewer setting of another version rides along.
  expect(read.recordings[0].saved?.view).toEqual(saved.view);
  expect(read.results[0].record).not.toHaveProperty("manifest");
  expect(read.results[0].record).not.toHaveProperty("status");
  expect(read.batches[0]).not.toHaveProperty("handle");
  expect(read.batches[0].status).toBe("interrupted");
});

test("its_files_must_be_in_the_archive_with_their_fingerprint", async () => {
  const short = await project((d) => (d.recordings[0].files[0].size += 1));
  await expect(readProject(short.zip, "s.ddalab")).rejects.toThrow(
    `s.ddalab lacks recordings/0/fixture.edf of ${fixture("fixture.edf").length + 1} bytes`,
  );
  const other = await project((d) => {
    d.recordings[0].fingerprint = "d".repeat(64);
    d.active_tab = null;
    d.results = [];
    d.batches = [];
  });
  await expect(readProject(other.zip, "o.ddalab")).rejects.toThrow(
    "recordings/0/fixture.edf in o.ddalab is not the recording its project.json names",
  );
  const bare = await zipped([{ name: "recordings/0/fixture.edf", input: fixture("fixture.edf") }]);
  await expect(readProject(bare, "b.ddalab")).rejects.toThrow("b.ddalab holds no project.json");
});
