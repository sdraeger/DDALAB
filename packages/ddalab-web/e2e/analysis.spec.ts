// DDA runs in the browser: settings to request, the worker pool, results streamed to OPFS and equal to the CLI's.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleDir, WIDE } from "./global-setup";
import { expect, hasStorage, NO_STORAGE, type Page, scanned, test } from "./test";

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url));
const BRAINVISION = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"].map(fixturePath);
/**
 * Eight channels for two hours with 4,000-sample windows every 10 samples: a run of many seconds, whose blocks of
 * thousands of windows take seconds each.
 */
const LONG = { channels: 8, rateHz: 256, durationS: 2 * 3600, seed: 5 };

const settings = (page: Page) => page.getByRole("region", { name: "DDA settings" });
const runBar = (page: Page) => page.getByRole("region", { name: "Run" });
const history = (page: Page) => page.getByRole("region", { name: "History" });

async function openBrainVision(page: Page) {
  await page.getByLabel("Recording files").setInputFiles(BRAINVISION);
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
}

/** Types the run interval into the run bar, as a keyboard user does. */
async function interval(page: Page, start: string, end: string) {
  await runBar(page).getByLabel("Start", { exact: true }).fill(start);
  await runBar(page).getByLabel("End", { exact: true }).fill(end);
  await runBar(page).getByLabel("End", { exact: true }).press("Enter");
}

const lastRun = (page: Page) =>
  page.evaluate(() => {
    const { analyses, run } = window.__ddalab.store.getState();
    return { record: analyses[0], run };
  });

/** SHA-256 of each file under `/results/<id>` in OPFS, by path; `null` when the directory is gone. */
const storedDigests = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const results = await (await navigator.storage.getDirectory()).getDirectoryHandle("results", {
      create: true,
    });
    const root = await results.getDirectoryHandle(id).catch(() => null);
    if (!root) return null;
    const found: Record<string, string> = {};
    async function walk(directory: FileSystemDirectoryHandle, prefix: string) {
      for await (const [name, entry] of directory.entries()) {
        if (entry.kind === "directory") await walk(entry as FileSystemDirectoryHandle, `${prefix}${name}/`);
        else {
          const bytes = await (await (entry as FileSystemFileHandle).getFile()).arrayBuffer();
          const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
          found[prefix + name] = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
        }
      }
    }
    await walk(root, "");
    return found;
  }, id);

/** SHA-256 of each `.npy` file of a result in OPFS, by path. */
const storedArrays = async (page: Page, id: string) =>
  Object.fromEntries(
    Object.entries((await storedDigests(page, id)) ?? {}).filter(([path]) => path.endsWith(".npy")),
  );

/** SHA-256 of each `.npy` file of a CLI bundle, by path. */
function cliDigests(dir: string) {
  const found: Record<string, string> = {};
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".npy"))
        found[relative(dir, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(dir);
  return found;
}

/** Runs the chosen request and waits for it to complete; the result id. */
async function runToCompletion(page: Page) {
  await runBar(page).getByRole("button", { name: "Run DDA" }).click();
  await expect(runBar(page).getByText("Complete", { exact: true })).toBeVisible({ timeout: 60_000 });
  const { record } = await lastRun(page);
  expect(record.status).toBe("complete");
  return record.id;
}

/**
 * Reloads the page with a pool of `workers` DDA workers whatever the machine: block counts stay fixed, and the long
 * runs of tests in parallel do not starve each other's pages.
 */
async function withWorkers(page: Page, workers: number) {
  await page.addInitScript(
    (n) => Object.defineProperty(navigator, "hardwareConcurrency", { get: () => n }),
    workers + 1,
  );
  await page.reload();
}

/** Starts the long run and waits until its files exist and the history holds it as running; the result id. */
async function startLongRun(page: Page) {
  await withWorkers(page, 4);
  await page.evaluate((spec) => window.__ddalab.openSynthetic(spec), LONG);
  await page.getByRole("checkbox", { name: "Select group CH" }).check();
  await settings(page).getByLabel("Window", { exact: true }).fill("4000");
  await settings(page).getByLabel("Step", { exact: true }).fill("10");
  await interval(page, "0", String(LONG.durationS));
  await expect(runBar(page).getByText(/windows, [\d,]+ blocks?, \d+ workers?/)).toBeVisible();
  await runBar(page).getByRole("button", { name: "Run DDA" }).click();
  await expect.poll(async () => (await lastRun(page)).record?.status, { timeout: 30_000 }).toBe("running");
  return (await lastRun(page)).record.id;
}

/** Windows done so far by the run of the page. */
const windowsDone = async (page: Page) => (await lastRun(page)).run?.progress.windowsDone ?? 0;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await page.goto("/");
});

// Tabbing from Start commits it; the interval rests 200 ms later, which must leave the End being typed alone.
test("typed_interval_survives_the_resting_interval", async ({ page }) => {
  await openBrainVision(page);
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  const start = runBar(page).getByLabel("Start", { exact: true });
  const end = runBar(page).getByLabel("End", { exact: true });
  await start.click();
  await start.press("ControlOrMeta+a");
  const typed = Date.now();
  await page.keyboard.type("1");
  await page.keyboard.press("Tab"); // keyboard focus selects the End field's text
  await page.keyboard.type("5");
  expect(Date.now() - typed).toBeLessThan(200);
  await page.waitForTimeout(500);
  await expect(end).toHaveValue("5");
  await expect(start).toHaveValue("1");
  if (!(await hasStorage(page))) {
    await end.press("Enter");
    expect(await page.evaluate(() => window.__ddalab.store.getState().selection)).toEqual({ t0: 1, t1: 5 });
    return;
  }
  // Run takes the End field as it leaves it.
  await runToCompletion(page);
  expect((await lastRun(page)).record.request.time_range).toEqual({ start: 500, end: 2500 });
});

test("escape_puts_back_the_interval", async ({ page }) => {
  await openBrainVision(page);
  const end = runBar(page).getByLabel("End", { exact: true });
  await end.fill("4");
  await end.press("Escape");
  await expect(end).toHaveValue("6");
  expect(await page.evaluate(() => window.__ddalab.store.getState().selection)).toBeNull();
  // Escape right after Enter, before the interval has rested, takes the commit back: no field keeps its values.
  await end.fill("4");
  await end.press("Enter");
  await end.press("Escape");
  await expect(end).toHaveValue("6");
  expect(await page.evaluate(() => window.__ddalab.store.getState().selection)).toBeNull();
  await page.waitForTimeout(400);
  await expect(end).toHaveValue("6");
});

// Start typed, Enter, then Escape before the committed interval has rested (200 ms): Escape takes the commit back,
// and Start and End show the interval the run would take, then and after it rests.
test("escape_within_200_ms_of_enter_leaves_no_stale_interval", async ({ page }) => {
  await openBrainVision(page);
  const start = runBar(page).getByLabel("Start", { exact: true });
  const end = runBar(page).getByLabel("End", { exact: true });
  await expect(start).toHaveValue("0");
  await start.fill("2");
  // Enter and Escape from the page itself, a frame apart (the commit renders in between): a loaded machine cannot
  // stretch the gap between two presses sent from here.
  const gap = await start.evaluate(async (input) => {
    const press = (key: string) => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    press("Enter");
    const at = performance.now();
    await new Promise(requestAnimationFrame);
    press("Escape");
    return performance.now() - at;
  });
  expect(gap).toBeLessThan(200);
  /** The interval a run takes now (the selection, else the view), as the fields print it. */
  const committed = () =>
    page.evaluate(() => {
      const { selection, view } = window.__ddalab.store.getState();
      const { t0, t1 } = selection ?? view;
      return [t0, t1].map((t) => String(Number(t.toFixed(3))));
    });
  const fields = async () => [await start.inputValue(), await end.inputValue()];
  expect(await fields()).toEqual(await committed());
  expect(await fields()).toEqual(["0", "6"]);
  // Past the rest the fields still show it: nothing stale comes back.
  await page.waitForTimeout(400);
  expect(await fields()).toEqual(await committed());
  expect(await fields()).toEqual(["0", "6"]);
});

test("st_result_equals_cli_bundle", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await openBrainVision(page);
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  await page.getByRole("checkbox", { name: "Select Fp2" }).check();
  await expect(settings(page).getByRole("checkbox", { name: "ST", exact: true })).toBeChecked();
  await interval(page, "1", "5");
  // The plan is shown before the run starts.
  await expect(runBar(page).getByText(/^Plan [\d,]+ windows, [\d,]+ blocks?, \d+ workers?$/)).toBeVisible();
  const id = await runToCompletion(page);
  const expected = cliDigests(bundleDir("st"));
  expect(Object.keys(expected).sort()).toEqual(["ST/coefficients.npy", "ST/fit_error.npy", "ST/q.npy"]);
  expect(await storedArrays(page, id)).toEqual(expected);
  // The chosen channels stand out in the waveform gutter.
  const gutter = page.getByRole("list", { name: "Channel rows" });
  await expect(gutter.getByText("Fp1, chosen")).toBeAttached();
  await expect(gutter.getByText("Cz, chosen")).toHaveCount(0);
});

test("ct_cd_de_sy_equal_cli", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await openBrainVision(page);
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  await page.getByRole("checkbox", { name: "Select Fp2" }).check();
  await settings(page).getByRole("checkbox", { name: "ST", exact: true }).uncheck();
  for (const variant of ["CT", "CD", "DE", "SY"]) {
    await settings(page).getByRole("checkbox", { name: variant, exact: true }).check();
  }
  await interval(page, "1", "5");
  const id = await runToCompletion(page);
  const expected = cliDigests(bundleDir("ct_cd_de_sy"));
  for (const variant of ["CT", "CD", "DE", "SY"]) {
    expect(Object.keys(expected).some((path) => path.startsWith(`${variant}/`))).toBe(true);
  }
  expect(await storedArrays(page, id)).toEqual(expected);
});

// Blocks of the browser's own size: the arrays they write at their offsets equal the CLI's, which writes one block.
test("multi_block_result_equals_cli_bundle", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  // With eight workers, 0 to 30 s plan five blocks at the 1 MiB floor.
  await withWorkers(page, 8);
  await page.evaluate((spec) => window.__ddalab.openSynthetic(spec), WIDE);
  await page.getByRole("checkbox", { name: "Select group CH" }).check();
  await interval(page, "0", "30");
  const id = await runToCompletion(page);
  expect((await lastRun(page)).run?.progress.blocks).toBeGreaterThanOrEqual(3);
  const expected = cliDigests(bundleDir("multi_block"));
  expect(Object.keys(expected)).toHaveLength(3);
  expect(await storedArrays(page, id)).toEqual(expected);
});

// The lock of a result another tab writes keeps the sweep away, also while none of its files is open.
test("a_result_another_tab_writes_survives_the_sweep", async ({ page, context }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  const exists = (on: Page) =>
    on.evaluate(async () => {
      const results = await (await navigator.storage.getDirectory()).getDirectoryHandle("results");
      return results.getDirectoryHandle("elsewhere").then(
        () => true,
        () => false,
      );
    });
  // The lock first, as the IO worker takes it: this page's own startup sweep may still be on its way.
  await page.evaluate(async () => {
    await new Promise<void>((held) =>
      navigator.locks.request("ddalab-result:elsewhere", () => {
        held();
        return new Promise(() => {}); // held while this tab is open
      }),
    );
    const results = await (await navigator.storage.getDirectory()).getDirectoryHandle("results", {
      create: true,
    });
    const directory = await results.getDirectoryHandle("elsewhere", { create: true });
    const status = await (await directory.getFileHandle("status", { create: true })).createWritable();
    await status.write("running");
    await status.close();
  });
  const other = await context.newPage();
  await other.goto("/");
  expect(await other.evaluate(() => window.__ddalab.engine.sweepInterrupted())).toEqual([]);
  expect(await exists(other)).toBe(true);
  await page.close(); // its lock goes with it
  await expect
    .poll(() => other.evaluate(() => window.__ddalab.engine.sweepInterrupted()))
    .toEqual(["elsewhere"]);
  expect(await exists(other)).toBe(false);
});

test("cancel_mid_run", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  const id = await startLongRun(page);
  await runBar(page).getByRole("button", { name: "Cancel run" }).click();
  await expect(runBar(page).getByText("Canceled", { exact: true })).toBeVisible({ timeout: 30_000 });
  const stopped = await windowsDone(page);
  await page.waitForTimeout(1000);
  expect(await windowsDone(page)).toBe(stopped);
  expect(await storedDigests(page, id)).toBeNull();
  expect(
    await page.evaluate(() => window.__ddalab.store.getState().analyses.map((a) => a.status)),
  ).not.toContain("complete");
});

test("reload_mid_run_marks_interrupted", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  const id = await startLongRun(page);
  await page.reload();
  await expect(history(page).getByRole("listitem").filter({ hasText: "Interrupted" })).toHaveCount(1);
  expect((await lastRun(page)).record).toMatchObject({ id, status: "interrupted" });
  await expect.poll(() => storedDigests(page, id)).toBeNull();
});

test("hidden_tab_keeps_running", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await startLongRun(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = await windowsDone(page);
  await page.waitForTimeout(5000);
  // Progress counts whole blocks, which take seconds each here: they go on finishing while the page stays hidden.
  await expect.poll(() => windowsDone(page), { timeout: 120_000 }).toBeGreaterThan(before);
  const later = await windowsDone(page);
  await expect.poll(() => windowsDone(page), { timeout: 120_000 }).toBeGreaterThan(later);
  expect(await page.evaluate(() => document.visibilityState)).toBe("hidden");
});

test("command_bar_run_speaks_while_the_inspector_is_hidden", async ({ page }) => {
  test.setTimeout(150_000);
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  const banner = page.getByRole("banner");
  const inspector = page.getByRole("button", { name: "Inspector" });
  await withWorkers(page, 4);
  await page.evaluate((spec) => window.__ddalab.openSynthetic(spec), LONG);
  await inspector.click();
  await expect(banner.getByText("Choose at least one channel")).toBeVisible();
  await inspector.click();
  await page.getByRole("checkbox", { name: "Select group CH" }).check();
  await settings(page).getByLabel("Window", { exact: true }).fill("4000");
  await settings(page).getByLabel("Step", { exact: true }).fill("10");
  await interval(page, "0", String(LONG.durationS));
  await inspector.click();
  await banner.getByRole("button", { name: "Run", exact: true }).click();
  await expect(banner.getByText(/^(Starting|Running, \d+%)$/)).toBeVisible();
  await expect(banner.getByText(/^Running, [1-9]\d?%$/)).toBeVisible({ timeout: 120_000 });
});

test("run_with_512_channels", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await page.evaluate((spec) => window.__ddalab.openSynthetic(spec), {
    channels: 512,
    rateHz: 256,
    durationS: 60,
    seed: 2,
  });
  await page.getByRole("checkbox", { name: "Select group CH" }).check();
  await interval(page, "0", "30");
  const id = await runToCompletion(page);
  const { record } = await lastRun(page);
  expect(record.request.channels).toHaveLength(512);
  const shape = await page.evaluate(async (id) => {
    const results = await (await navigator.storage.getDirectory()).getDirectoryHandle("results");
    const st = await (await results.getDirectoryHandle(id)).getDirectoryHandle("ST");
    const head = await (await (await st.getFileHandle("q.npy")).getFile()).slice(0, 128).text();
    return /'shape': \((\d+), (\d+)\)/.exec(head)?.slice(1).map(Number);
  }, id);
  expect(shape?.[1]).toBe(512);
});

// Where the window has no OPFS (Playwright's WebKit here, a private window in Safari) a run fails at once and says why
// in place of the browser's "unknown transient reason".
test("a_run_without_storage_says_why", async ({ page }) => {
  test.skip(await hasStorage(page), "this browser window has OPFS");
  await openBrainVision(page);
  // The scan's notice takes the place of its progress line, above the channels, and moves them: a click before
  // then can miss.
  await expect(scanned(page)).toBeVisible();
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  await runBar(page).getByRole("button", { name: "Run DDA" }).click();
  await expect(runBar(page).getByRole("alert")).toHaveText(
    "The run failed: Browser storage, where overviews and results are kept, is not available in this window; " +
      "private browsing can cause this. Open DDALAB in a regular window.",
  );
});

test("quota_during_result_write", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await openBrainVision(page);
  await expect(page.getByText("Overview 100%")).toBeVisible();
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  await interval(page, "0", "6");
  // The headers and the status file fit; the first block's arrays do not.
  await page.evaluate(() => window.__ddalab.engine.quota(600));
  await runBar(page).getByRole("button", { name: "Run DDA" }).click();
  await expect(runBar(page).getByRole("alert")).toContainText("browser storage");
  const { record } = await lastRun(page);
  expect(record.status).toBe("failed");
  expect(record.error).toMatch(/browser storage/);
  expect(await storedDigests(page, record.id)).toBeNull();
});
