// The batch run of an opened folder: every recording through the engine one at a time, a failure recorded and passed,
// progress in the Folder section and the command bar, the results grouped in the history, Cancel, Resume after a
// reload, and the combined export equal to the native CLI's `ddalab batch` manifest and `ddalab run --bundle` bundles.
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cliCommand } from "../src/core/cliCommand";
import { readSynthetic, syntheticEdfSize } from "../src/core/synthetic";
import { CLI } from "./global-setup";
import { expect, type Page, test } from "./test";

const DDA_RS = fileURLToPath(new URL("../../dda-rs/", import.meta.url));
const fixturePath = (name: string) => join(DDA_RS, "tests/fixtures", name);
const stem = (n: number) => `sub-0${n}_task-rest_eeg`;
/**
 * Two minutes of eight channels: with 4,000-sample windows every 10 samples on one DDA worker, a run of several
 * seconds, long enough to act while it runs.
 */
const SLOW = { channels: 8, rateHz: 256, durationS: 120 };

// Playwright's WebKit has no OPFS (getDirectory throws UnknownError); Safari itself has.
const hasStorage = (page: Page) =>
  page.evaluate(() =>
    navigator.storage.getDirectory().then(
      () => true,
      () => false,
    ),
  );
const NO_STORAGE = "this browser window has no OPFS";

/**
 * `fixtures/`: the EDF fixture, the truncated one (a warning) and 17 bytes that are no EDF (a failure), one per
 * subject folder as a BIDS dataset lays them out. `slow/`: three synthetic recordings, each a run of seconds.
 */
let root = "";
let fixtures = "";
let slow = "";
test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ddalab-batch-"));
  fixtures = join(root, "fixtures");
  const files = ["fixture.edf", "fixture_truncated.edf", null];
  for (const [i, source] of files.entries()) {
    const eeg = join(fixtures, `sub-0${i + 1}`, "eeg");
    mkdirSync(eeg, { recursive: true });
    const file = join(eeg, `${stem(i + 1)}.edf`);
    if (source) copyFileSync(fixturePath(source), file);
    else writeFileSync(file, "not an edf header");
  }
  slow = join(root, "slow");
  mkdirSync(slow);
  for (const seed of [1, 2, 3]) {
    const spec = { ...SLOW, seed };
    const bytes = new Uint8Array(syntheticEdfSize(spec));
    readSynthetic(spec, 0, bytes);
    writeFileSync(join(slow, `hour-${seed}.edf`), bytes);
  }
});
test.afterAll(() => rmSync(root, { recursive: true, force: true }));

const folder = (page: Page) => page.getByRole("region", { name: /^Folder/ });
const history = (page: Page) => page.getByRole("region", { name: "History" });
const progress = (page: Page) => page.getByRole("region", { name: "Batch progress" });
const state = (page: Page) =>
  page.evaluate(() => {
    const { analyses, batches, run } = window.__ddalab.store.getState();
    return { analyses, batches, run };
  });

/** Opens `dir` as the Folder section and starts a batch of its `n` recordings with the panel's defaults. */
async function startBatch(page: Page, dir: string, n: number) {
  await page.getByLabel("Recording folder").setInputFiles(dir);
  await folder(page)
    .getByRole("button", { name: `Run on all ${n}` })
    .click();
  const panel = page.getByRole("dialog", { name: `Run on all ${n} recordings` });
  await panel.getByRole("button", { name: "Start" }).click();
  await expect(panel).toHaveCount(0);
}

/** A page whose runs take one DDA worker and whose settings make each slow recording a run of seconds. */
async function slowly(page: Page) {
  await page.addInitScript(() => Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 2 }));
  await page.reload();
  await page.evaluate(() =>
    window.__ddalab.store.setState((s) => ({
      ddaForm: { ...s.ddaForm, windowLength: "4000", windowStep: "10" },
    })),
  );
}

/** The bytes of every file under `dir`, by path. */
function filesUnder(dir: string) {
  const found: Record<string, Buffer> = {};
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(at, entry.name));
      else found[relative(dir, join(at, entry.name))] = readFileSync(join(at, entry.name));
    }
  };
  walk(dir);
  return found;
}

/** A manifest without what belongs to one run or one build: its id, its time, the commit. */
// biome-ignore lint/suspicious/noExplicitAny: parsed JSON
const comparable = (document: any) => ({
  ...document,
  id: "",
  created_at_iso: "",
  reproduction: { ...document.reproduction, git_commit: null }, // the e2e CLI build has no DDALAB_GIT_COMMIT
});

test.beforeEach(async ({ page }) => {
  // The native pickers have no Playwright driver: the folder comes through the <input>, the zip as a download.
  await page.addInitScript(() => {
    for (const name of ["showOpenFilePicker", "showDirectoryPicker", "showSaveFilePicker"])
      Reflect.deleteProperty(window, name);
  });
  await page.goto("/");
});

test("batch_runs_every_recording_into_the_history_and_one_export", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await page.getByLabel("Recording folder").setInputFiles(fixtures);
  await folder(page).getByRole("button", { name: "Run on all 3" }).click();
  const panel = page.getByRole("dialog", { name: "Run on all 3 recordings" });
  // The settings it takes, read-only, and the rules it applies to each recording.
  await expect(panel.getByRole("definition").first()).toHaveText("ST");
  await expect(panel.getByRole("radio", { name: /^Signal channels/ })).toBeChecked();
  await expect(panel.getByRole("radio", { name: "Whole recording" })).toBeChecked();
  await expect(panel).toContainText("Open a recording to change them in the inspector.");
  await panel.getByRole("button", { name: "Start" }).click();
  // The failure is recorded and the batch goes on; the words say how each recording ended.
  await expect(folder(page).getByText("Batch finished: 2 of 3, 1 failed.")).toBeVisible({ timeout: 60_000 });
  const tree = folder(page).getByRole("tree");
  for (const [n, mark] of [
    [1, "Done"],
    [2, "Done"],
    [3, "Failed"],
  ] as const) {
    await expect(tree.getByRole("treeitem", { name: new RegExp(`^${stem(n)},`) })).toContainText(mark);
  }
  // No tab opened; the engine holds no recording of the batch.
  expect(await page.evaluate(() => Object.keys(window.__ddalab.store.getState().recordings))).toEqual([]);

  // One history entry for the batch, opened to its two results and the failure with its reason.
  const entry = history(page).getByRole("button", { name: /^ST on fixtures/ });
  await expect(entry).toContainText("2 of 3, 1 failed");
  await expect(entry).toContainText("signal channels, whole recordings");
  await expect(entry).toHaveAttribute("aria-expanded", "false");
  await entry.click();
  const results = history(page).getByRole("list", { name: "Results of ST on fixtures" });
  await expect(results.getByRole("listitem")).toHaveCount(2);
  await expect(history(page).getByRole("list", { name: "Failed recordings" })).toContainText(
    `${stem(3)}.edf`,
  );
  const { analyses, batches } = await state(page);
  expect(batches).toHaveLength(1);
  const [batch] = batches;
  expect(batch).toMatchObject({ status: "complete", root: "fixtures" });
  expect(analyses.filter((a) => a.batch === batch.id && a.status === "complete")).toHaveLength(2);
  // A result opens as any other, with its provenance.
  await results.getByRole("button", { name: new RegExp(`^ST on ${stem(1)}\\.edf`) }).click();
  await expect(page.getByRole("region", { name: "Provenance" })).toBeVisible();
  expect((await page.evaluate(() => window.__ddalab.store.getState().activeResultId)) ?? "").toBe(
    batch.results[0].resultId,
  );

  // The combined export: the CLI's batch manifest, and each result's bundle as `ddalab run --bundle` writes it.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    history(page).getByRole("button", { name: "Export batch" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("fixtures.batch.zip");
  const zip = join(mkdtempSync(join(tmpdir(), "ddalab-batch-zip-")), "batch.zip");
  await download.saveAs(zip);
  const unzipped = mkdtempSync(join(tmpdir(), "ddalab-batch-unzip-"));
  execFileSync("python3", [
    "-c",
    "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
    zip,
    unzipped,
  ]);
  const exported = filesUnder(unzipped);
  const manifest = JSON.parse(exported["batch.json"].toString());
  const native = spawnSync(
    CLI,
    ["batch", "--bids-dir", "fixtures", "--continue-on-error", "--output-dir", "out", "--quiet"],
    { cwd: root, encoding: "utf8" },
  );
  expect(native.status, native.stderr).toBe(4); // some failed
  const cli = JSON.parse(native.stdout);
  // The same keys in the same order, and the same values but where the outputs go and how the error is worded.
  const keys = (m: typeof cli) => [Object.keys(m), ...m.results.map((r: object) => Object.keys(r))];
  expect(keys(manifest)).toEqual(keys(cli));
  const values = (m: typeof cli) => ({
    ...m,
    // biome-ignore lint/suspicious/noExplicitAny: parsed JSON
    results: m.results.map(({ outputPath: _, error: __, ...rest }: any) => rest),
  });
  expect(values(manifest)).toEqual(values(cli));

  for (const result of batch.results.filter((r) => r.status === "ok")) {
    const record = analyses.find((a) => a.id === result.resultId);
    if (!record) throw new Error(`no record of ${result.path}`);
    const dir = mkdtempSync(join(tmpdir(), "ddalab-batch-cli-"));
    copyFileSync(join(root, result.path), join(dir, record.fileName));
    execFileSync("sh", ["-c", cliCommand(record.request, record.fileName)], {
      cwd: dir,
      env: { ...process.env, PATH: `${join(DDA_RS, "target/release")}:${process.env.PATH}` },
      stdio: "pipe",
    });
    const bundle = filesUnder(join(dir, record.fileName.replace(/\.edf$/, ".dda")));
    const prefix = `${manifest.results.find((r: { inputPath: string }) => r.inputPath === result.path).outputPath}/`;
    const ours = Object.fromEntries(
      Object.entries(exported)
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, bytes]) => [path.slice(prefix.length), bytes]),
    );
    expect(Object.keys(ours).sort()).toEqual(Object.keys(bundle).sort());
    for (const path of Object.keys(bundle).filter((p) => p.endsWith(".npy"))) {
      expect(ours[path].equals(bundle[path]), `${result.path}: ${path}`).toBe(true);
    }
    expect(comparable(JSON.parse(ours["manifest.json"].toString()))).toEqual(
      comparable(JSON.parse(bundle["manifest.json"].toString())),
    );
  }
});

test("batch_progress_and_cancel_keep_the_finished_results", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  test.setTimeout(180_000);
  await slowly(page);
  await startBatch(page, slow, 3);
  await expect(progress(page).getByText("Recording 1 of 3")).toBeVisible();
  await expect(progress(page)).toContainText("hour-1.edf");
  // The command bar carries the batch's status; a single run waits for it.
  await expect(page.getByRole("banner").getByText(/^Batch 1 of 3, \d+%$/)).toBeVisible();
  await expect(folder(page).getByRole("treeitem", { name: /^hour-1,/ })).toContainText("Running");
  await expect(progress(page).getByText("Recording 2 of 3")).toBeVisible({ timeout: 60_000 });
  await expect(progress(page)).toContainText("1 finished, 0 failed");
  await expect(progress(page).getByText(/^\d+%$/)).toBeVisible();
  await progress(page).getByRole("button", { name: "Cancel" }).click();
  await expect(folder(page).getByText("Batch stopped: cancelled after 1 of 3.")).toBeVisible();
  await expect(folder(page).getByRole("treeitem", { name: /^hour-1,/ })).toContainText("Done");
  await expect(folder(page).getByRole("treeitem", { name: /^hour-2,/ })).not.toContainText("Running");
  const { analyses, batches, run } = await state(page);
  expect(run).toBeNull();
  expect(batches[0]).toMatchObject({
    status: "cancelled",
    results: [{ path: "slow/hour-1.edf", status: "ok" }],
  });
  // The finished result stays; the one cancelled leaves no record.
  expect(analyses.map((a) => [a.batch, a.status])).toEqual([[batches[0].id, "complete"]]);
  const entry = history(page).getByRole("button", { name: /^ST on slow/ });
  await expect(entry).toContainText("Cancelled after 1 of 3");
  await entry.click();
  await expect(history(page).getByRole("button", { name: "Resume" })).toBeEnabled();
});

test("resume_after_a_reload_runs_only_the_remaining_recordings", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  test.setTimeout(180_000);
  await slowly(page);
  await startBatch(page, slow, 3);
  await expect(progress(page).getByText("Recording 2 of 3")).toBeVisible({ timeout: 60_000 });
  const [first] = (await state(page)).analyses;
  await page.reload();
  const entry = history(page).getByRole("button", { name: /^ST on slow/ });
  await expect(entry).toContainText(/Interrupted after [12] of 3/);
  const { batches } = await state(page);
  const done = batches[0].results.length;
  await entry.click();
  // A folder opened through its <input> has no handle to read again: the user chooses it once more.
  await history(page).getByRole("button", { name: "Resume" }).click();
  await expect(history(page).getByRole("button", { name: "Choose the folder again" })).toBeVisible();
  await expect(history(page)).toContainText(`Choose slow again to run its ${3 - done} remaining recordings.`);
  await page.getByLabel("Folder of ST on slow").setInputFiles(slow);
  await expect(folder(page).getByText("Batch finished: 3 of 3.")).toBeVisible({ timeout: 120_000 });
  const after = await state(page);
  expect(after.batches[0]).toMatchObject({ status: "complete" });
  expect(after.batches[0].results.map((r) => r.path)).toEqual([
    "slow/hour-1.edf",
    "slow/hour-2.edf",
    "slow/hour-3.edf",
  ]);
  const ran = after.analyses.filter((a) => a.batch === after.batches[0].id);
  // The result before the reload is kept as it was; only the rest ran.
  expect(ran.map((a) => a.status)).toEqual(["complete", "complete", "complete"]);
  expect(ran.map((a) => a.id)).toContain(first.id);
  await expect(entry).toContainText("3 of 3");
});

// Chromium keeps a picked folder's handle with the batch: Resume reads the folder through it, with no picker. An OPFS
// folder stands in for the picked one, which Playwright cannot pick.
test("resume_reattaches_through_the_folder_handle", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium keeps directory handles");
  test.setTimeout(180_000);
  await page.addInitScript(() =>
    Object.assign(window, {
      showDirectoryPicker: async () => (await navigator.storage.getDirectory()).getDirectoryHandle("slow"),
    }),
  );
  await slowly(page);
  const files = readdirSync(slow).map((name) => [name, readFileSync(join(slow, name)).toString("base64")]);
  await page.evaluate(async (files) => {
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("slow", {
      create: true,
    });
    for (const [name, base64] of files) {
      const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
      await writable.write(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
      await writable.close();
    }
  }, files);
  await page.getByRole("button", { name: "Open folder" }).click();
  await folder(page).getByRole("button", { name: "Run on all 3" }).click();
  await page
    .getByRole("dialog", { name: "Run on all 3 recordings" })
    .getByRole("button", { name: "Start" })
    .click();
  await expect(progress(page).getByText("Recording 2 of 3")).toBeVisible({ timeout: 60_000 });
  await page.reload();
  const entry = history(page).getByRole("button", { name: /^ST on slow/ });
  await expect(entry).toContainText(/Interrupted after [12] of 3/);
  await entry.click();
  await history(page).getByRole("button", { name: "Resume" }).click();
  await expect(folder(page).getByText("Batch finished: 3 of 3.")).toBeVisible({ timeout: 120_000 });
  await expect(history(page).getByRole("button", { name: "Choose the folder again" })).toHaveCount(0);
});
