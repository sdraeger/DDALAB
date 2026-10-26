// The engine behind the UI, through the test hook main.tsx installs in dev and e2e builds.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { instantiateCore } from "../src/core/abi";
import { expect, type Page, test } from "./test";

const EDF = fileURLToPath(new URL("../../dda-rs/tests/fixtures/fixture.edf", import.meta.url));
const bytes = readFileSync(EDF);

// A static server with Range support and CORS, standing in for OpenNeuro's S3.
let server: Server;
let url: string;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
    const [a, b] = range
      ? [Number(range[1]), Math.min(Number(range[2]), bytes.length - 1)]
      : [0, bytes.length - 1];
    res
      .writeHead(range ? 206 : 200, {
        "Content-Range": `bytes ${a}-${b}/${bytes.length}`,
        "Content-Length": b - a + 1,
      })
      .end(bytes.subarray(a, b + 1));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/fixture.edf`;
});
test.afterAll(() => server.close());

/** The first rows of fixture.edf as the Node core reads them. */
async function expectedRaw(rows: number) {
  const wasm = new WebAssembly.Module(readFileSync(new URL("../src/core/ddalab.wasm", import.meta.url)));
  const core = await instantiateCore(wasm, (_, offset, dst) =>
    dst.set(bytes.subarray(offset, offset + dst.length)),
  );
  const { handle } = core.open({
    primary: "fixture.edf",
    files: [{ name: "fixture.edf", file_id: 1, len: bytes.length }],
  });
  return Array.from(core.readRaw(handle, 0, rows));
}

const openFixture = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Recording files").setInputFiles(EDF);
  await expect(page.getByRole("list", { name: "Channels" }).getByRole("listitem")).toHaveCount(2);
};
const raw = (page: Page, rows: number) =>
  page.evaluate(async (n) => {
    const { engine, store } = window.__ddalab;
    const id = store.getState().activeRecordingId as string;
    return Array.from(await engine.raw(id, 0, n));
  }, rows);

test("raw_rows_match_the_core", async ({ page }) => {
  await openFixture(page);
  const rows = await raw(page, 4);
  expect(rows).toHaveLength(8);
  expect(rows).toEqual(await expectedRaw(4));
});

test("url_source_matches_the_file", async ({ page }) => {
  await page.goto("/");
  const opened = await page.evaluate(
    async ({ address, size }) => {
      const { engine } = window.__ddalab;
      const remote = await engine.open({
        kind: "url",
        files: [{ name: "fixture.edf", url: address, size }],
        primary: "fixture.edf",
      });
      const body = await (await fetch(address)).arrayBuffer();
      const local = await engine.open({
        kind: "files",
        files: [new File([body], "fixture.edf")],
        primary: "fixture.edf",
      });
      const labels = (info: { channels: { label: string }[] }) => info.channels.map((c) => c.label);
      return {
        remote: labels(remote.info),
        local: labels(local.info),
        same: remote.fingerprint === local.fingerprint,
      };
    },
    { address: url, size: bytes.length },
  );
  expect(opened.remote).toEqual(["Fp1", "Fp2", "Resp", "EDF Annotations"]);
  expect(opened.local).toEqual(opened.remote);
  // The same bytes have the same fingerprint, from a file or from ranges of a URL.
  expect(opened.same).toBe(true);
});

// Playwright intercepts the worker's script request in Chromium; elsewhere the failure cannot be staged.
test("a_worker_that_does_not_load_ends_in_a_clear_error", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "worker script requests are not interceptable here");
  await page.route(/io\.worker/, (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "Library" }).getByRole("status")).toHaveText(
    /^failed: The engine could not start/,
  );
});

test("trap_recreates_the_worker", async ({ page }) => {
  await openFixture(page);
  const before = await raw(page, 4);
  // The in-flight request fails with the trap's message ...
  const message = await page.evaluate(() =>
    window.__ddalab.engine.trap().then(
      () => "resolved",
      (e: Error) => e.message,
    ),
  );
  expect(message).toMatch(/unreachable/i);
  // ... and the next ones run in a fresh worker that holds the recording again.
  expect(await raw(page, 4)).toEqual(before);
  expect(await page.evaluate(async () => (await window.__ddalab.engine.version()).engine_version)).toMatch(
    /^\d+\./,
  );
});
