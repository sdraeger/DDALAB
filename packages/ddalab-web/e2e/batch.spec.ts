// The batch run of an opened folder: every recording through the engine one at a time, a failure recorded and passed,
// progress in the Folder section and the command bar, the results grouped in the history, Cancel, Resume after a
// reload, the keyboard's way through, and the combined export equal to what the native `ddalab batch --bids-dir
// --output-dir dda` writes for the same dataset.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { readSynthetic, syntheticEdfSize } from "../src/core/synthetic";
import { CLI } from "./global-setup";
import { expect, hasStorage, NO_STORAGE, type Page, test } from "./test";

const DDA_RS = fileURLToPath(new URL("../../dda-rs/", import.meta.url));
const fixturePath = (name: string) => join(DDA_RS, "tests/fixtures", name);
/** The recordings `ddalab batch --bids-dir fixtures` finds, in its order (src/core/golden/batch-manifest.json). */
const RUN_10 = "sub-01_task-rest_run-10_eeg";
const RUN_2 = "sub-01_task-rest_run-2_eeg";
const stem = (n: number) => `sub-0${n}_task-rest_eeg`;
/**
 * Two minutes of eight channels: with 4,000-sample windows every 10 samples on one DDA worker, a run of several
 * seconds, long enough to act while it runs.
 */
const SLOW = { channels: 8, rateHz: 256, durationS: 120 };

/**
 * `fixtures/`: a BIDS dataset (src/core/golden/batch-manifest.json says what the CLI makes of it): two runs of the EDF
 * fixture, the truncated one (a warning), 17 bytes that are no EDF and a header without its data file (two failures),
 * and a stray EDF and a derivative the CLI does not count. `slow/`: three synthetic recordings, each a run of seconds.
 */
let root = "";
let fixtures = "";
let slow = "";
test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ddalab-batch-"));
  fixtures = join(root, "fixtures");
  const at = (path: string) => {
    mkdirSync(join(fixtures, path, ".."), { recursive: true });
    return join(fixtures, path);
  };
  writeFileSync(at("dataset_description.json"), '{"Name": "fixtures", "BIDSVersion": "1.8.0"}');
  copyFileSync(fixturePath("fixture.edf"), at("notes.edf"));
  copyFileSync(fixturePath("fixture.edf"), at(`derivatives/sub-01/eeg/${stem(1)}.edf`));
  copyFileSync(fixturePath("fixture.edf"), at(`sub-01/eeg/${RUN_2}.edf`));
  copyFileSync(fixturePath("fixture.edf"), at(`sub-01/eeg/${RUN_10}.edf`));
  copyFileSync(fixturePath("fixture_truncated.edf"), at(`sub-02/eeg/${stem(2)}.edf`));
  writeFileSync(at(`sub-03/eeg/${stem(3)}.edf`), "not an edf header");
  const header = readFileSync(fixturePath("fixture.vhdr"), "utf8").replaceAll("fixture.", `${stem(4)}.`);
  writeFileSync(at(`sub-04/eeg/${stem(4)}.vhdr`), header);
  copyFileSync(fixturePath("fixture.vmrk"), at(`sub-04/eeg/${stem(4)}.vmrk`));
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

/** The paths under `dir` with each digest of a `<stem>.<sha8>.dda.json` name masked. */
const maskedNames = (paths: string[]) =>
  paths.map((p) => p.replace(/\.[0-9a-f]{8}\.dda\.json$/, ".<sha8>.dda.json")).sort();
// biome-ignore lint/suspicious/noExplicitAny: parsed JSON
const maskedManifest = (m: any) => ({
  ...m,
  // biome-ignore lint/suspicious/noExplicitAny: parsed JSON
  results: m.results.map((r: any) => ({ ...r, outputPath: r.outputPath && maskedNames([r.outputPath])[0] })),
});

test("batch_runs_the_datasets_recordings_into_the_history_and_the_clis_layout", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await page.getByLabel("Recording folder").setInputFiles(fixtures);
  // The CLI's five: the stray EDF and the derivative stay out, the header without its data file is in.
  const run = folder(page).getByRole("button", { name: "Run on all 5" });
  // By keyboard: the range fields stay out of the way, and Start runs the whole recordings.
  await run.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Run on all 5 recordings" });
  await expect(panel.getByRole("definition").first()).toHaveText("ST");
  await expect(panel.getByRole("radio", { name: /^Signal channels/ })).toBeChecked();
  await expect(panel.getByRole("radio", { name: "Whole recording" })).toBeChecked();
  await expect(panel.getByRole("textbox", { name: "Start in seconds" })).toBeDisabled();
  await expect(panel.getByRole("textbox", { name: "End in seconds" })).toBeDisabled();
  await expect(panel).toContainText("Open a recording to change them in the inspector.");
  const start = panel.getByRole("button", { name: "Start" });
  for (let tab = 0; tab < 12 && !(await start.evaluate((e) => e === document.activeElement)); tab++)
    await page.keyboard.press("Tab");
  await expect(start).toBeFocused();
  await page.keyboard.press("Enter");
  // The failures are recorded and the batch goes on; the words say how each recording ended.
  await expect(folder(page).getByText("Batch finished: 3 of 5, 2 failed.")).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  const tree = folder(page).getByRole("tree");
  // A row is named by its shown label, then its file name.
  const row = (name: string) => tree.getByRole("treeitem", { name: new RegExp(`, ${name}\\.`) });
  for (const [name, mark] of [
    [RUN_10, "Done"],
    [RUN_2, "Done"],
    [stem(2), "Done"],
    [stem(3), "Failed"],
    [stem(4), "Failed"],
  ]) {
    await expect(row(name)).toContainText(mark);
  }
  await expect(row("notes")).not.toContainText(/Done|Failed/);
  // No tab opened.
  expect(await page.evaluate(() => Object.keys(window.__ddalab.store.getState().recordings))).toEqual([]);

  // One history entry for the batch, opened to its three results and the failures with their reasons.
  const entry = history(page).getByRole("button", { name: /^ST on fixtures/ });
  await expect(entry).toContainText("3 of 5, 2 failed");
  await expect(entry).toContainText("signal channels, whole recordings");
  await expect(entry).toHaveAttribute("aria-expanded", "false");
  await entry.click();
  const results = history(page).getByRole("list", { name: "Results of ST on fixtures" });
  await expect(results.getByRole("listitem")).toHaveCount(3);
  await expect(history(page).getByRole("list", { name: "Failed recordings" })).toContainText(
    `${stem(3)}.edf`,
  );
  const { analyses, batches } = await state(page);
  expect(batches).toHaveLength(1);
  const [batch] = batches;
  expect(batch).toMatchObject({ status: "complete", root: "fixtures", interval: { kind: "whole" } });
  expect(analyses.filter((a) => a.batch === batch.id && a.status === "complete")).toHaveLength(3);
  // A result opens as any other, with its provenance.
  await results.getByRole("button", { name: new RegExp(`^ST on ${stem(2)}\\.edf`) }).click();
  await expect(page.getByRole("region", { name: "Provenance" })).toBeVisible();
  // A click on a range field chooses the range.
  await run.click();
  await expect(panel.getByRole("radio", { name: "Whole recording" })).toBeChecked();
  // Playwright waits for an aria-disabled field to turn enabled before it clicks; a pointer reaches it at once.
  await panel.getByRole("textbox", { name: "Start in seconds" }).click({ force: true });
  await expect(panel.getByRole("radio", { name: /^From start to end/ })).toBeChecked();
  await expect(panel.getByRole("textbox", { name: "Start in seconds" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // The combined export holds what `ddalab batch --bids-dir fixtures --output-dir dda` writes beside the dataset.
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
  const native = spawnSync(
    CLI,
    [
      "batch",
      "--bids-dir",
      "fixtures",
      "--continue-on-error",
      "--output-dir",
      "dda",
      "--model",
      "1",
      "2",
      "10",
    ],
    { cwd: root, encoding: "utf8" },
  );
  expect(native.status, native.stderr).toBe(4); // some failed
  const cli = { ...filesUnder(join(root, "dda")), "batch_manifest.json": Buffer.from(native.stdout) };
  const cliFiles = Object.fromEntries(
    Object.entries(cli).map(([p, b]) => [p.startsWith("batch") ? p : `dda/${p}`, b]),
  );
  // The same tree and names, but the digest: the CLI hashes the absolute path, the page the dataset's path.
  expect(maskedNames(Object.keys(exported))).toEqual(maskedNames(Object.keys(cliFiles)));
  const manifest = JSON.parse(exported["batch_manifest.json"].toString());
  const theirs = JSON.parse(native.stdout);
  expect(JSON.stringify(maskedManifest(manifest))).toBe(JSON.stringify(maskedManifest(theirs)));
  for (const result of manifest.results.filter((r: { status: string }) => r.status === "ok")) {
    const sha8 = createHash("sha1").update(result.inputPath).digest("hex").slice(0, 8);
    expect(result.outputPath).toMatch(new RegExp(`^dda/[\\w.-]+\\.${sha8}\\.dda\\.json$`));
    // The result documents of `ddalab batch` (and `ddalab run --output`), their run's id, time and commit aside.
    const stemOf = (path: string) => path.split("/").at(-1)?.split(".")[0];
    const counterpart = Object.keys(cliFiles).find(
      (p) => p.startsWith("dda/") && stemOf(p) === stemOf(result.outputPath),
    );
    if (!counterpart) throw new Error(`the CLI wrote no document for ${result.inputPath}`);
    // Laid out as the CLI's: serde_json's pretty printer, two spaces a level, no newline after the last brace.
    const text = exported[result.outputPath].toString();
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
    expect(comparable(JSON.parse(text))).toEqual(comparable(JSON.parse(cliFiles[counterpart].toString())));
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
  await progress(page).getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Enter");
  const ended = folder(page).getByText("Batch stopped: cancelled after 1 of 3.");
  await expect(ended).toBeVisible();
  // The keyboard lands on the line that replaced Cancel.
  await expect(
    folder(page).locator("p", { hasText: "Batch stopped: cancelled after 1 of 3." }),
  ).toBeFocused();
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
  // A batch's opens make no overview scan: no tiles are stored for its recordings.
  const tiled = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const tiles = await root.getDirectoryHandle("tiles").catch(() => null);
    const names: string[] = [];
    if (tiles) for await (const name of tiles.keys()) names.push(name);
    return names;
  });
  expect(tiled.filter((name) => analyses.some((a) => a.fingerprint === name))).toEqual([]);
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
  await history(page).getByRole("button", { name: "Resume" }).focus();
  await page.keyboard.press("Enter");
  // The same button now asks for the folder, and keeps the keyboard.
  await expect(history(page).getByRole("button", { name: "Choose the folder again" })).toBeFocused();
  await expect(history(page)).toContainText(`Choose slow again to run its ${3 - done} remaining recordings.`);
  await page.getByLabel("Folder of ST on slow").setInputFiles(slow);
  await expect(entry).toBeFocused();
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
  await expect(entry).toBeFocused();
  await expect(folder(page).getByText("Batch finished: 3 of 3.")).toBeVisible({ timeout: 120_000 });
  await expect(history(page).getByRole("button", { name: "Choose the folder again" })).toHaveCount(0);
});
