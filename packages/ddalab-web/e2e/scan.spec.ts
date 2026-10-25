// The background scan: pyramid tiles in OPFS, resume after a reload, the quota message, hashes and annotations.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { instantiateCore } from "../src/core/abi";
import { pyramidBytes, tileSlot } from "../src/core/opfs";
import type { ScanState } from "../src/core/protocol";
import { readSynthetic, type SyntheticSpec, syntheticEdfSize } from "../src/core/synthetic";

const SPEC = { channels: 64, rateHz: 128, durationS: 2 * 3600, seed: 11 };
const ROWS = SPEC.rateHz * SPEC.durationS;
const fixture = (name: string) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url));

// The tiles the Node core builds straight from the same bytes, by SHA-256.
const wasm = new WebAssembly.Module(readFileSync(new URL("../src/core/ddalab.wasm", import.meta.url)));
const references = new Map<string, ReturnType<typeof referenceFor>>();
async function referenceFor(spec: SyntheticSpec) {
  const core = await instantiateCore(wasm, (_, offset, dst) => readSynthetic(spec, offset, dst));
  const opened = core.open({
    primary: "synthetic.edf",
    files: [{ name: "synthetic.edf", file_id: 1, len: syntheticEdfSize(spec) }],
  });
  return { core, handle: opened.handle };
}
async function expectedTile(level: number, index: number, spec = SPEC) {
  const key = JSON.stringify(spec);
  if (!references.has(key)) references.set(key, referenceFor(spec));
  const { core, handle } = await (references.get(key) as ReturnType<typeof referenceFor>);
  return createHash("sha256")
    .update(new Uint8Array(core.rawTile(handle, level, index)))
    .digest("hex");
}

const open = (page: Page) => page.evaluate((spec) => window.__ddalab.openSynthetic(spec), SPEC);
const tileDigest = (page: Page, id: string, level: number, index: number) =>
  page.evaluate(
    async ([id, level, index]) => {
      const tile = await window.__ddalab.engine.tile(id, level, index);
      if (!tile) return null;
      const digest = await crypto.subtle.digest("SHA-256", tile.bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    },
    [id, level, index] as const,
  );
const fingerprintOf = (page: Page, id: string) =>
  page.evaluate((id) => window.__ddalab.store.getState().recordings[id].fingerprint, id);
const scanOf = (page: Page, id: string) =>
  page.evaluate((id) => window.__ddalab.store.getState().recordings[id].scan, id);

// Playwright's WebKit has no OPFS (getDirectory throws UnknownError); Safari itself has.
const hasStorage = (page: Page) =>
  page.evaluate(() =>
    navigator.storage.getDirectory().then(
      () => true,
      () => false,
    ),
  );
const NO_STORAGE = "this browser window has no OPFS";

/** Records the scanned rows of every store update from now on. */
const watchProgress = (page: Page) =>
  page.evaluate(() => {
    const seen: number[] = [];
    Object.assign(window, { seen });
    window.__ddalab.store.subscribe((state) => {
      for (const { scan } of Object.values(state.recordings)) seen.push(scan.scannedRows);
    });
  });
const progress = (page: Page) => page.evaluate(() => (window as unknown as { seen: number[] }).seen);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await page.goto("/");
});

test("scan_progress_and_resume", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await watchProgress(page);
  const id = await open(page);
  await expect(page.getByText("Overview 100%")).toBeVisible({ timeout: 120_000 });
  const seen = await progress(page);
  expect(new Set(seen).size).toBeGreaterThan(2);
  expect(seen).toEqual([...seen].sort((a, b) => a - b));
  expect(seen.at(-1)).toBe(ROWS);
  // A full tile, a partial one and the top level, which only the sequential pass builds.
  for (const [level, index] of [
    [0, 0],
    [1, 3],
    [2, 0],
  ]) {
    expect(await tileDigest(page, id, level, index)).toBe(await expectedTile(level, index));
  }

  await page.reload();
  await watchProgress(page);
  const again = await open(page);
  await expect(page.getByText("Overview 100%")).toBeVisible({ timeout: 1000 });
  // The stored tiles are reused: the scan jumps from nothing to complete without a pass over the rows.
  expect((await progress(page)).filter((rows) => rows > 0 && rows < ROWS)).toEqual([]);
  // Level 2 spans the whole file, too much to build on demand: it comes from the stored tiles.
  expect(await tileDigest(page, again, 2, 0)).toBe(await expectedTile(2, 0));
});

test("visible_tile_before_scan", async ({ page }) => {
  test.setTimeout(120_000);
  const id = await open(page);
  expect(await tileDigest(page, id, 2, 0)).toBeNull();
  // A fine tile is built from the file at once, long before the sequential pass reaches it.
  expect(await tileDigest(page, id, 0, 12)).toBe(await expectedTile(0, 12));
  expect((await scanOf(page, id)).scannedRows).toBeLessThan(ROWS);
});

// Stored tiles are served only when their header names this recording's level, index and channel count.
test("a_stored_slot_of_another_shape_is_rebuilt", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  const id = await open(page);
  await expect(page.getByText("Overview 100%")).toBeVisible({ timeout: 120_000 });
  const fingerprint = await fingerprintOf(page, id);
  await page.evaluate((closing) => window.__ddalab.engine.close(closing), id);
  // The slot of tile 0 of level 0 now says it holds 2 channels, as another recording's would.
  await page.evaluate(async (print) => {
    const tiles = await (await navigator.storage.getDirectory()).getDirectoryHandle("tiles");
    const directory = await tiles.getDirectoryHandle(print);
    const writable = await (await directory.getFileHandle("L0.ddt")).createWritable({
      keepExistingData: true,
    });
    await writable.write({ type: "write", position: 16, data: new Uint8Array([2, 0, 0, 0]) });
    await writable.close();
  }, fingerprint);
  const again = await open(page);
  await expect(page.getByText("Overview 100%")).toBeVisible({ timeout: 1000 });
  expect(await tileDigest(page, again, 0, 0)).toBe(await expectedTile(0, 0));
  // The next slot is untouched and served as stored.
  expect(await tileDigest(page, again, 0, 1)).toBe(await expectedTile(0, 1));
});

test("quota_error_message", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  // One full level 0 tile (262,176 bytes) fits; the next write fails.
  await page.evaluate(() => window.__ddalab.engine.quota(300_000));
  const id = await open(page);
  const gb = (pyramidBytes(ROWS, SPEC.channels, "I16") / 1e9).toLocaleString("en", {
    maximumSignificantDigits: 2,
  });
  await expect(page.getByRole("alert")).toContainText(`needs about ${gb} GB of browser storage`);
  const scan = await scanOf(page, id);
  expect(scan.scannedRows).toBeLessThan(ROWS);
  expect(scan.error).toContain(`${gb} GB`);
  // The file holds the tile that was written, header first; the one that did not fit left no header.
  const slot = tileSlot(SPEC.channels, "I16");
  const magic = await page.evaluate(
    async ([fingerprint, ...at]) => {
      const tiles = await (await navigator.storage.getDirectory()).getDirectoryHandle("tiles");
      const directory = await tiles.getDirectoryHandle(fingerprint as string);
      const file = await (await directory.getFileHandle("L0.ddt")).getFile();
      return Promise.all(
        at.map(async (start) =>
          new TextDecoder().decode(await file.slice(start as number, (start as number) + 4).arrayBuffer()),
        ),
      );
    },
    [await fingerprintOf(page, id), 0, slot],
  );
  expect(magic).toEqual(["DDT1", ""]);
  expect(await tileDigest(page, id, 0, 0)).toBe(await expectedTile(0, 0));
});

// Where the window has no storage the inspector says so, nothing is scanned, and the plot still gets the tiles
// built from the file.
test("storage_unavailable_message", async ({ page }) => {
  test.skip(await hasStorage(page), "this browser window has OPFS");
  const id = await open(page);
  await expect(page.getByText("Browser storage is not available in this window")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await scanOf(page, id)).scannedRows).toBe(0);
  expect(await tileDigest(page, id, 0, 12)).toBe(await expectedTile(0, 12));
});

const BRAINVISION = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"];

const activeScan = (page: Page) =>
  page.evaluate(() => {
    const state = window.__ddalab.store.getState();
    const { fingerprint, scan } = state.recordings[state.activeRecordingId as string];
    return { fingerprint, sha256: scan.sha256 ?? {} };
  });

/** Opens the BrainVision fixture and waits for the digest of each of its files. */
async function openBrainVision(page: Page) {
  await page.getByLabel("Recording files").setInputFiles(BRAINVISION.map(fixture));
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
  await expect
    .poll(async () => Object.keys((await activeScan(page)).sha256).sort())
    .toEqual([...BRAINVISION].sort());
  return activeScan(page);
}

const shasum = (name: string) =>
  execFileSync("shasum", ["-a", "256", fixture(name)], { encoding: "utf8" }).split(" ")[0];

test("hash_matches_cli", async ({ page }) => {
  const { sha256 } = await openBrainVision(page);
  for (const name of BRAINVISION) expect(sha256[name]).toBe(shasum(name));
});

// The fingerprint does not pin every byte of a file: a digest kept under it could belong to other bytes.
test("stored_digests_are_not_reused", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  const { fingerprint } = await openBrainVision(page);
  await page.getByRole("button", { name: "Close recording" }).click();
  // The record an earlier version kept next to the tiles, with digests of other bytes.
  await page.evaluate(
    async ([print, names]) => {
      const tiles = await (await navigator.storage.getDirectory()).getDirectoryHandle("tiles");
      const directory = await tiles.getDirectoryHandle(print as string, { create: true });
      const file = await directory.getFileHandle("sha256.json", { create: true });
      const writable = await file.createWritable();
      await writable.write(
        JSON.stringify(Object.fromEntries((names as string[]).map((n) => [n, "0".repeat(64)]))),
      );
      await writable.close();
    },
    [fingerprint, BRAINVISION],
  );
  const { sha256 } = await openBrainVision(page);
  for (const name of BRAINVISION) expect(sha256[name]).toBe(shasum(name));
});

test("annotations_reach_the_store", async ({ page }) => {
  await page.getByLabel("Recording files").setInputFiles(fixture("fixture.edf"));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = window.__ddalab.store.getState();
        return state.recordings[state.activeRecordingId as string]?.info.annotations.map((a) => a.label);
      }),
    )
    .toEqual(["eyes closed", "spike"]);
});

// The annotation list of an EDF+ is a pass over the whole file. It runs in a worker of its own: a tile asked for
// after it is answered first.
test("annotations_do_not_block_tiles", async ({ page }) => {
  test.setTimeout(120_000);
  const spec = { channels: 64, rateHz: 256, durationS: 4 * 3600, seed: 2, annotations: true };
  const result = await page.evaluate(async (s) => {
    const { engine } = window.__ddalab;
    const { id } = await engine.open({ kind: "synthetic", spec: s });
    const order: string[] = [];
    const annotations = engine.annotations(id).then((found) => {
      order.push("annotations");
      return found;
    });
    await engine.tile(id, 0, 5).then(() => order.push("tile"));
    return { order, found: await annotations };
  }, spec);
  expect(result.order).toEqual(["tile", "annotations"]);
  // One spike every 97 s, from the first one at 97 s.
  expect(result.found.annotations).toHaveLength(Math.ceil(spec.durationS / 97) - 1);
  expect(result.found.annotations[0]).toMatchObject({ onset_s: 97, label: "spike" });
  expect(result.found.warnings).toEqual([]);
});

// 10 h of 64 channels at 256 Hz is 1.2 GB, served by ranges as OpenNeuro's S3 would: above the 1 GiB the scan covers.
test("remote_above_1_gib_builds_tiles_on_demand", async ({ page }) => {
  const spec = { channels: 64, rateHz: 256, durationS: 10 * 3600, seed: 5 };
  const size = syntheticEdfSize(spec);
  expect(size).toBeGreaterThan(2 ** 30);
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    if (!range) return void res.writeHead(416).end();
    const [from, to] = [Number(range[1]), Math.min(Number(range[2]), size - 1)];
    const body = Buffer.alloc(to - from + 1);
    readSynthetic(spec, from, body);
    res
      .writeHead(206, { "Content-Range": `bytes ${from}-${to}/${size}`, "Content-Length": body.length })
      .end(body);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/synthetic.edf`;
    const { id, scan } = await page.evaluate(
      async (remote) => {
        const { engine } = window.__ddalab;
        const input = { kind: "url" as const, files: [remote], primary: remote.name };
        const { id } = await engine.open(input);
        await new Promise((done) => setTimeout(done, 500));
        let scan: unknown;
        engine.onScan(id, (state) => {
          scan = state;
        });
        return { id, scan: scan as ScanState };
      },
      { name: "synthetic.edf", url, size },
    );
    expect(scan.notice).toContain("above 1 GiB");
    expect(scan).toMatchObject({ scannedRows: 0, sha256: {} });
    expect(await tileDigest(page, id, 1, 0)).toBe(await expectedTile(1, 0, spec));
    // Too coarse to read from the file on demand.
    expect(await tileDigest(page, id, 2, 0)).toBeNull();
  } finally {
    server.close();
  }
});
