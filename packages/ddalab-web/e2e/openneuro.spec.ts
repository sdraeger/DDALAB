// OpenNeuro in the library rail: search, browse, deep links and streaming. GraphQL is mocked with `page.route`; a
// local server stands in for S3 (which honors Range) and for OpenNeuro's object store (which ignores it), serving
// the BrainVision fixture under the demonstration's BIDS names. The @live test uses the real service: LIVE=1.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { DEMO } from "../src/features/openneuro/deepLink";
import { expect, hasStorage, NO_STORAGE, type Page, test } from "./test";

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url));
const RUN = "sub-pt01_ses-presurgery_task-ictal_acq-ecog_run-01";
const RUN_2 = RUN.replace("run-01", "run-02");
/** A fixture file whose header and marker references name the files of `run`. */
const renamed = (name: string, run: string) =>
  Buffer.from(
    readFileSync(fixturePath(name)).toString("latin1").replaceAll("fixture.", `${run}_ieeg.`),
    "latin1",
  );
const EVENTS = Buffer.from("onset\tduration\ttrial_type\n1.5\t0\tonset\n");
const EEG = readFileSync(fixturePath("fixture.eeg"));
/** The fixture's samples followed by zeros to 5 MiB: above what a server may send whole. */
const LARGE_EEG = Buffer.concat([EEG, Buffer.alloc(5 * 2 ** 20 - EEG.length)]);

/**
 * What the stand-in serves, by path: `/s3/` honors Range; `/objects/` answers every GET with the whole file and
 * refuses Range in a preflight, as OpenNeuro's object store does. Run 2's data file sits in the object store.
 */
const SERVED: Record<string, Buffer> = {
  [`/s3/${RUN}_ieeg.vhdr`]: renamed("fixture.vhdr", RUN),
  [`/s3/${RUN}_ieeg.eeg`]: EEG,
  [`/s3/${RUN}_ieeg.vmrk`]: renamed("fixture.vmrk", RUN),
  [`/objects/${RUN}_events.tsv`]: EVENTS,
  [`/s3/${RUN_2}_ieeg.vhdr`]: renamed("fixture.vhdr", RUN_2),
  [`/objects/${RUN_2}_ieeg.eeg`]: LARGE_EEG,
  [`/s3/${RUN_2}_ieeg.vmrk`]: renamed("fixture.vmrk", RUN_2),
};

let server: Server;
let origin: string;
/** Every GET the stand-in answered, with its Range header. */
let requests: { path: string; range?: string }[] = [];
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const store = path.startsWith("/objects/");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (!store) res.setHeader("Access-Control-Allow-Headers", "Range");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    requests.push({ path, range: req.headers.range });
    const bytes = SERVED[path];
    if (!bytes) return void res.writeHead(404).end();
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
    if (!range || store) return void res.writeHead(200).end(bytes);
    const [a, b] = [Number(range[1]), Math.min(Number(range[2]), bytes.length - 1)];
    res.writeHead(206, { "Content-Range": `bytes ${a}-${b}/${bytes.length}` }).end(bytes.subarray(a, b + 1));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => server.close());

// React's warning for a state update during another component's render fails any test (e2e/test.ts).
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
const recorded = JSON.parse(
  readFileSync(
    new URL("../src/features/openneuro/recorded/search-epilepsy-ieeg.json", import.meta.url),
    "utf8",
  ),
);
/**
 * The recorded search answer; the words "many" answer 30 datasets, 25 on the first page and 5 after cursor "p2", as
 * OpenNeuro pages them.
 */
const searchAnswer = (keyword: string | undefined, after: string | null) => {
  if (keyword !== "many") return recorded;
  const { node } = recorded.data.advancedSearch.edges[0];
  const ids = after === "p2" ? [25, 30] : [0, 25];
  const edges = Array.from({ length: ids[1] - ids[0] }, (_, i) => ({
    node: { ...node, id: `ds9000${10 + ids[0] + i}` },
  }));
  const pageInfo = { count: 30, hasNextPage: after !== "p2", endCursor: after === "p2" ? null : "p2" };
  return { data: { advancedSearch: { pageInfo, edges } } };
};
/** ds003029's description: two snapshots, its authors, license and DOI. */
const INFO = {
  data: {
    dataset: {
      snapshots: [
        { tag: "1.0.6", created: "2023-09-05T23:05:39.000Z" },
        { tag: "1.0.7", created: "2023-11-28T15:39:44.000Z" },
      ],
    },
    snapshot: {
      readme: "Fragility Multi-Center Retrospective Study",
      description: {
        Name: "Epilepsy-iEEG-Multicenter-Dataset",
        Authors: ["Adam Li", "Sara Inati", "Kareem Zaghloul", "Nathan Crone"],
        License: "CC0",
        DatasetDOI: "doi:10.18112/openneuro.ds003029.v1.0.7",
        HowToAcknowledge: "Please cite the fragility paper.",
      },
    },
  },
};
const CITATION =
  "Adam Li, Sara Inati, Kareem Zaghloul, Nathan Crone (2023). Epilepsy-iEEG-Multicenter-Dataset. OpenNeuro. [Dataset] doi:10.18112/openneuro.ds003029.v1.0.7";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" };

/**
 * Mocks GraphQL; the listing of tree `slow` answers after 1.5 s. Returns the trees answered so far, each with the
 * snapshot it was asked of, and the search variables sent.
 */
async function mockOpenNeuro(page: Page, slow?: string) {
  const listing = tree();
  const answered: string[] = [];
  const tags: string[] = [];
  const searches: { query: Record<string, unknown>; after: string | null }[] = [];
  await page.route("https://openneuro.org/crn/graphql", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const { query, variables } = route.request().postDataJSON();
    if (query.includes("advancedSearch")) {
      searches.push(variables);
      return route.fulfill({
        json: searchAnswer(variables.query.keywords?.[0], variables.after),
        headers: CORS,
      });
    }
    if (query.includes("snapshots")) return route.fulfill({ json: INFO, headers: CORS });
    const at = variables.tree ?? "root";
    if (at === slow) await new Promise((done) => setTimeout(done, 1500));
    await route.fulfill({ json: { data: { snapshot: { files: listing[at] } } }, headers: CORS });
    answered.push(at);
    tags.push(variables.tag);
  });
  return Object.assign(answered, { tags, searches });
}

async function searchFor(page: Page, query: string) {
  const box = page.getByRole("searchbox", { name: "Search OpenNeuro" });
  await box.fill(query);
  await box.press("Enter");
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
  // The events sidecar comes whole from the object store, which ignores Range and refuses it in a preflight.
  await expect.poll(async () => (await active(page)).annotations).toContain("events.tsv: onset");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("deep_link_preconnects_to_openneuro_and_s3", async ({ page }) => {
  await mockOpenNeuro(page);
  await page.goto(`/${DEMO}`);
  for (const host of ["https://openneuro.org", "https://s3.amazonaws.com"]) {
    await expect(page.locator(`link[rel="preconnect"][href="${host}"]`)).toHaveCount(1);
  }
  await expect(page.getByRole("heading", { name: `${RUN}_ieeg.vhdr` })).toBeVisible();
  // Without a deep link the page opens no connection it may not use.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "OpenNeuro" })).toBeVisible();
  await expect(page.locator('link[rel="preconnect"]')).toHaveCount(0);
});

test("range_requests_only", async ({ page }) => {
  await mockOpenNeuro(page);
  await page.goto(`/${DEMO}`);
  await expect(page.getByRole("heading", { name: `${RUN}_ieeg.vhdr` })).toBeVisible();
  // Nothing hashes a URL recording until a run asks for its digests; then the hash worker reads every file whole.
  expect((await active(page)).sha256).toEqual([]);
  await page.evaluate(() => {
    const { engine, store } = window.__ddalab;
    return engine.hashes(store.getState().activeRecordingId as string);
  });
  await expect
    .poll(async () => {
      const { files, sha256 } = await active(page);
      return files.every((name) => sha256.includes(name));
    })
    .toBe(true);
  expect(requests.filter(({ path }) => path.startsWith("/s3/")).length).toBeGreaterThan(0);
  expect(requests.filter(({ range }) => range === undefined)).toEqual([]);
});

test("data_file_without_range_fails", async ({ page }) => {
  await mockOpenNeuro(page);
  await page.goto(`/${DEMO.replace("run-01", "run-02")}`);
  await expect(page.getByRole("alert")).toContainText(`${new URL(origin).host} ignores Range requests`);
  await expect(page.getByRole("heading", { name: `${RUN_2}_ieeg.vhdr` })).toHaveCount(0);
});

test("search_browse_open", async ({ page }) => {
  await mockOpenNeuro(page);
  await page.goto("/");
  // The live region is in place before anything is announced.
  await expect(page.locator("search [aria-live='polite']")).toBeAttached();
  await searchFor(page, "epilepsy ieeg");
  await expect(page.getByText(/First 25 matches/)).toHaveCount(0);
  await page.getByRole("button", { name: /Epilepsy-iEEG-Multicenter-Dataset/ }).click();
  for (const folder of ["sub-pt01", "ses-presurgery", "ieeg"]) {
    await page.getByRole("button", { name: folder, exact: true }).click();
  }
  // Two runs are offered; their data, markers and sidecars are counted.
  await expect(page.getByRole("button", { name: /_ieeg\.vhdr/ })).toHaveCount(2);
  await expect(page.getByText("5 other files")).toBeVisible();
  await page.getByRole("button", { name: `${RUN}_ieeg.vhdr` }).click();
  await expect(channels(page)).toHaveText(["Fp1", "Fp2", "Cz", "Pz"]);
  // The trail leads back to the dataset's top folder and the results.
  await page.getByRole("button", { name: "ds003029" }).click();
  await expect(page.getByRole("button", { name: "sub-pt01", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Results" }).click();
  await expect(page.getByRole("button", { name: /HUP iEEG Epilepsy Dataset/ })).toBeVisible();
});

test("search_pages_and_filters", async ({ page }) => {
  const { searches } = await mockOpenNeuro(page);
  await page.goto("/");
  await searchFor(page, "many");
  const hits = page.getByRole("list", { name: "Datasets" }).getByRole("listitem");
  await expect(hits).toHaveCount(25);
  await expect(page.getByText("25 of 30 datasets")).toBeVisible();
  await page.getByRole("button", { name: "More datasets" }).click();
  await expect(hits).toHaveCount(30);
  await expect(page.getByText("30 datasets", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "More datasets" })).toHaveCount(0);
  expect(searches.map((s) => s.after)).toEqual([null, "p2"]);
  // A filter searches again from the first page with the same words.
  await page.getByRole("combobox", { name: "Modality" }).click();
  await page.getByRole("option", { name: "iEEG" }).click();
  await expect.poll(() => searches.length).toBe(3);
  expect(searches[2]).toEqual({
    query: { keywords: ["many"], modality: "ieeg", publicOnly: true, sortBy: "relevance" },
    after: null,
  });
  await page.getByRole("combobox", { name: "Order" }).click();
  await page.getByRole("option", { name: "Newest" }).click();
  await expect.poll(() => searches.at(-1)?.query.sortBy).toBe("newest");
});

test("a_dataset_shows_its_description_and_other_versions", async ({ page, context, browserName }) => {
  const { tags } = await mockOpenNeuro(page);
  await page.goto("/");
  await searchFor(page, "epilepsy ieeg");
  await page.getByRole("button", { name: /Epilepsy-iEEG-Multicenter-Dataset/ }).click();
  const about = page.getByRole("region", { name: "Dataset" });
  await expect(about).toContainText("Adam Li, Sara Inati, Kareem Zaghloul and 1 more");
  await expect(about).toContainText("CC0");
  await expect(about.getByRole("link", { name: "10.18112/openneuro.ds003029.v1.0.7" })).toHaveAttribute(
    "href",
    "https://doi.org/10.18112/openneuro.ds003029.v1.0.7",
  );
  await expect(about.getByText(CITATION)).toBeVisible();
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await about.getByRole("button", { name: "Copy the citation" }).click();
    await expect(about.getByRole("button", { name: "Citation copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CITATION);
  }
  // Another snapshot lists from its top folder.
  await about.getByRole("combobox", { name: "Version" }).click();
  await page.getByRole("option", { name: "1.0.6" }).click();
  await expect.poll(() => tags.at(-1)).toBe("1.0.6");
  await expect(about.getByRole("combobox", { name: "Version" })).toHaveText(/1\.0\.6/);
});

test("a_batch_runs_on_a_snapshot_folder_and_cites_the_dataset", async ({ page }) => {
  test.setTimeout(90_000);
  await mockOpenNeuro(page);
  await page.goto("/");
  await searchFor(page, "epilepsy ieeg");
  await page.getByRole("button", { name: /Epilepsy-iEEG-Multicenter-Dataset/ }).click();
  await page.getByRole("button", { name: "Find recordings to run on" }).click();
  // Both runs of the folder three levels down; run 2's data file ignores Range and fails as it does when opened.
  await page.getByRole("button", { name: "Run on all 2" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText(/^Batch finished: 1 of 2, 1 failed/)).toBeVisible({
    timeout: 60_000,
  });
  const history = page.getByRole("region", { name: "History" });
  await history.getByRole("button", { name: /on ds003029/ }).click();
  await history.getByRole("button", { name: new RegExp(`${RUN}_ieeg\\.vhdr`) }).click();
  const provenance = page.getByRole("region", { name: "Provenance" });
  await expect(provenance.getByText(CITATION)).toBeVisible();
  await expect(provenance).toContainText(
    `OpenNeuro ds003029, version 1.0.7: sub-pt01/ses-presurgery/ieeg/${RUN}_ieeg.vhdr`,
  );
});

test("a_late_listing_leaves_the_newer_view", async ({ page }) => {
  const answered = await mockOpenNeuro(page, "tree-sub-pt01");
  await page.goto("/");
  await searchFor(page, "epilepsy ieeg");
  await page.getByRole("button", { name: /Epilepsy-iEEG-Multicenter-Dataset/ }).click();
  await page.getByRole("button", { name: "sub-pt01", exact: true }).click();
  await page.getByRole("button", { name: "Results" }).click();
  // The listing of sub-pt01 arrives after the user went back to the results.
  await expect.poll(() => answered).toContain("tree-sub-pt01");
  await page.waitForTimeout(500);
  await expect(page.getByRole("list", { name: "Datasets" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Folder" })).toHaveCount(0);
  await expect(page.getByText("Listing sub-pt01")).toHaveCount(0);
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
  await searchFor(page, "epilepsy");
  await expect(page.getByRole("alert")).toHaveText(
    "OpenNeuro could not be reached. Recordings on this computer still open.",
  );
  await page.getByLabel("Recording files").setInputFiles(fixturePath("fixture.edf"));
  await expect(channels(page)).toHaveText(["Fp1", "Fp2"]);
});

test("a_kept_copy_opens_without_the_network", async ({ page }) => {
  await mockOpenNeuro(page);
  await page.goto(`/${DEMO}`);
  const heading = page.getByRole("heading", { name: `${RUN}_ieeg.vhdr` });
  await expect(heading).toBeVisible();
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  const writes = await page.evaluate(() => "createWritable" in FileSystemFileHandle.prototype);
  test.skip(!writes, "this browser writes no files into its private storage from a page");
  const inspector = page.getByRole("region", { name: "Inspector" });
  await expect(inspector.getByText("Streamed from OpenNeuro ds003029, version 1.0.7.")).toBeVisible();
  await inspector.getByRole("button", { name: /^Keep a copy on this device/ }).click();
  await expect(inspector.getByText("Kept on this device; it opens without the network.")).toBeVisible();
  // The tab comes back from the copy: the stand-in for S3 and the object store answers nothing.
  requests = [];
  await page.goto("/");
  await expect(heading).toBeVisible();
  await expect(channels(page)).toHaveText(["Fp1", "Fp2", "Cz", "Pz"]);
  await expect.poll(async () => (await active(page)).annotations).toContain("events.tsv: onset");
  expect(requests).toEqual([]);
  // Removed, the recording streams again.
  await inspector.getByRole("button", { name: "Remove the copy" }).click();
  await expect(inspector.getByRole("button", { name: /^Keep a copy on this device/ })).toBeVisible();
});

// The demonstration link against the real service. In Chromium, which routes worker requests, the production
// connect-src goes on every page and worker script: a host missing from the CSP fails the open there.
test("demo_link_streams_from_openneuro", { tag: "@live" }, async ({ page, browserName, baseURL }) => {
  test.setTimeout(180_000);
  const chromium = browserName === "chromium";
  const csp = "connect-src 'self' https://openneuro.org https://s3.amazonaws.com";
  const routed: string[] = [];
  if (chromium) {
    await page.route(`${baseURL}/**`, async (route) => {
      routed.push(route.request().url());
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp } });
    });
  }
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
  // The sidecars come from the object store, whose CORS allows no Range header: this needs Range safelisted.
  expect(opened.files).toContain(`${RUN}_events.tsv`);
  await expect
    .poll(async () => (await active(page)).annotations, { timeout: 120_000 })
    .toContain("events.tsv: onset");
  await expect(page.getByRole("alert")).toHaveCount(0);
  if (!chromium) return;
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
