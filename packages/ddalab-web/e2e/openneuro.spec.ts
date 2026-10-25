// OpenNeuro in the library rail: search, browse, deep links and streaming. GraphQL is mocked with `page.route`; a
// local server stands in for S3 (which honors Range) and for OpenNeuro's object store (which ignores it), serving
// the BrainVision fixture under the demonstration's BIDS names. The @live test uses the real service: LIVE=1.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { DEMO } from "../src/features/openneuro/deepLink";

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url));
const RUN = "sub-pt01_ses-presurgery_task-ictal_acq-ecog_run-01";
/** A fixture file whose header and marker references name the demonstration's files. */
const renamed = (name: string) =>
  Buffer.from(
    readFileSync(fixturePath(name)).toString("latin1").replaceAll("fixture.", `${RUN}_ieeg.`),
    "latin1",
  );
const EVENTS = Buffer.from("onset\tduration\ttrial_type\n1.5\t0\tonset\n");

/** What the stand-in serves, by path: `/s3/` honors Range, `/objects/` answers every GET with the whole file. */
const SERVED: Record<string, Buffer> = {
  [`/s3/${RUN}_ieeg.vhdr`]: renamed("fixture.vhdr"),
  [`/s3/${RUN}_ieeg.eeg`]: readFileSync(fixturePath("fixture.eeg")),
  [`/s3/${RUN}_ieeg.vmrk`]: renamed("fixture.vmrk"),
  [`/objects/${RUN}_events.tsv`]: EVENTS,
};

let server: Server;
let origin: string;
/** Every GET the stand-in answered, with its Range header. */
let requests: { path: string; range?: string }[] = [];
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    const path = new URL(req.url ?? "/", "http://x").pathname;
    requests.push({ path, range: req.headers.range });
    const bytes = SERVED[path];
    if (!bytes) return void res.writeHead(404).end();
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
    if (!range || path.startsWith("/objects/")) return void res.writeHead(200).end(bytes);
    const [a, b] = [Number(range[1]), Math.min(Number(range[2]), bytes.length - 1)];
    res.writeHead(206, { "Content-Range": `bytes ${a}-${b}/${bytes.length}` }).end(bytes.subarray(a, b + 1));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => server.close());
test.beforeEach(() => {
  requests = [];
});

const directory = (filename: string) => ({
  id: `tree-${filename}`,
  filename,
  size: 0,
  directory: true,
  urls: [],
});
const file = (path: string) => ({
  id: path,
  filename: path.split("/").at(-1),
  size: SERVED[path].length,
  directory: false,
  urls: [origin + path],
});

/** The demonstration's folders down to its recording, as `listFiles` asks for them by tree. */
const tree = (): Record<string, unknown[]> => ({
  root: [directory("sub-pt01")],
  "tree-sub-pt01": [directory("ses-presurgery")],
  "tree-ses-presurgery": [directory("ieeg")],
  "tree-ieeg": Object.keys(SERVED).map(file),
});
const search = JSON.parse(
  readFileSync(
    new URL("../src/features/openneuro/recorded/search-epilepsy-ieeg.json", import.meta.url),
    "utf8",
  ),
);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" };

async function mockOpenNeuro(page: Page) {
  const listing = tree();
  await page.route("https://openneuro.org/crn/graphql", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const { variables } = route.request().postDataJSON();
    const json =
      "query" in variables ? search : { data: { snapshot: { files: listing[variables.tree ?? "root"] } } };
    await route.fulfill({ json, headers: CORS });
  });
}

const channels = (page: Page) =>
  page.getByRole("list", { name: "Channels" }).getByRole("listitem").locator("label");
const active = (page: Page) =>
  page.evaluate(() => {
    const state = window.__ddalab.store.getState();
    const recording = state.recordings[state.activeRecordingId as string];
    return {
      files: recording.info.input_files,
      sha256: Object.keys(recording.scan.sha256 ?? {}),
      annotations: recording.info.annotations.map(({ label, source }) => `${source}: ${label}`),
    };
  });

test("deep_link_opens_recording", async ({ page }) => {
  await mockOpenNeuro(page);
  await page.goto(`/${DEMO}`);
  await expect(page.getByRole("heading", { name: `${RUN}_ieeg.vhdr` })).toBeVisible();
  await expect(channels(page)).toHaveText(["Fp1", "Fp2", "Cz", "Pz"]);
  // The events sidecar comes from the object store, which ignores Range.
  await expect.poll(async () => (await active(page)).annotations).toContain("events.tsv: onset");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("range_requests_only", async ({ page }) => {
  await mockOpenNeuro(page);
  await page.goto(`/${DEMO}`);
  await expect(page.getByRole("heading", { name: `${RUN}_ieeg.vhdr` })).toBeVisible();
  // Every file the recording uses is read whole by the hash worker once the scan is done.
  await expect
    .poll(async () => {
      const { files, sha256 } = await active(page);
      return files.every((name) => sha256.includes(name));
    })
    .toBe(true);
  expect(requests.filter(({ path }) => path.startsWith("/s3/")).length).toBeGreaterThan(0);
  expect(requests.filter(({ range }) => range === undefined)).toEqual([]);
});

test("search_browse_open", async ({ page }) => {
  await mockOpenNeuro(page);
  await page.goto("/");
  const box = page.getByRole("searchbox", { name: "Search OpenNeuro" });
  await box.fill("epilepsy ieeg");
  await box.press("Enter");
  await page.getByRole("button", { name: /Epilepsy-iEEG-Multicenter-Dataset/ }).click();
  for (const folder of ["sub-pt01", "ses-presurgery", "ieeg"]) {
    await page.getByRole("button", { name: folder, exact: true }).click();
  }
  // Sidecars are listed as a count; the recording opens.
  await expect(page.getByText("3 other files")).toBeVisible();
  await page.getByRole("button", { name: `${RUN}_ieeg.vhdr` }).click();
  await expect(channels(page)).toHaveText(["Fp1", "Fp2", "Cz", "Pz"]);
  // The trail leads back to the dataset's top folder and the results.
  await page.getByRole("button", { name: "ds003029" }).click();
  await expect(page.getByRole("button", { name: "sub-pt01", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Results" }).click();
  await expect(page.getByRole("button", { name: /HUP iEEG Epilepsy Dataset/ })).toBeVisible();
});

test("demo_link_opens_in_place", async ({ page }) => {
  await mockOpenNeuro(page);
  await page.goto("/");
  await page.getByRole("link", { name: "ds003029 seizure recording" }).click();
  await expect(page.getByRole("heading", { name: `${RUN}_ieeg.vhdr` })).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});

test("offline_shows_message_local_work_continues", async ({ page }) => {
  await page.route("https://openneuro.org/**", (route) => route.abort("internetdisconnected"));
  await page.goto("/");
  const box = page.getByRole("searchbox", { name: "Search OpenNeuro" });
  await box.fill("epilepsy");
  await box.press("Enter");
  await expect(page.getByRole("alert")).toHaveText(
    "OpenNeuro could not be reached. Recordings on this computer still open.",
  );
  await page.getByLabel("Recording files").setInputFiles(fixturePath("fixture.edf"));
  await expect(channels(page)).toHaveText(["Fp1", "Fp2"]);
});

// The demonstration link against the real service, with the production connect-src on every page and worker
// script (Chromium routes worker requests): a host missing from the CSP fails the open.
test("demo_link_streams_from_openneuro", { tag: "@live" }, async ({ page, browserName, baseURL }) => {
  test.skip(
    browserName !== "chromium",
    "the CSP is added to worker scripts through routing, which is Chromium's",
  );
  test.setTimeout(180_000);
  const csp = "connect-src 'self' https://openneuro.org https://s3.amazonaws.com";
  const routed: string[] = [];
  await page.route(`${baseURL}/**`, async (route) => {
    routed.push(route.request().url());
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp } });
  });
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) violations.push(message.text());
  });
  await page.goto(`/${DEMO}`);
  await expect(page.getByRole("heading", { name: `${RUN}_ieeg.vhdr` })).toBeVisible({ timeout: 120_000 });
  const opened = await page.evaluate(() => {
    const state = window.__ddalab.store.getState();
    const { info } = state.recordings[state.activeRecordingId as string];
    return { format: info.format, channels: info.channels.length, files: info.input_files };
  });
  expect(opened).toMatchObject({ channels: 98 });
  expect(opened.files).toContain(`${RUN}_events.tsv`);
  await expect
    .poll(async () => (await active(page)).annotations, { timeout: 120_000 })
    .toContain("events.tsv: onset");
  // The policy is in force: it refuses a host outside the list, and it reached the IO worker's script.
  const outside = await page.evaluate(() =>
    fetch("https://example.org").then(
      () => "connected",
      () => "refused",
    ),
  );
  expect(outside).toBe("refused");
  expect(routed.some((url) => url.includes("io.worker"))).toBe(true);
  expect(violations.filter((text) => !text.includes("example.org"))).toEqual([]);
});
