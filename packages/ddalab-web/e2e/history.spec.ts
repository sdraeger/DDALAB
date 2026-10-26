// The history of results across reloads, their provenance and CLI command, exports equal to the CLI's own output,
// imports of CLI bundles, deletion, and the session a reload restores.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleDir } from "./global-setup";
import { showFixture } from "./resultFixture";
import { expect, type Page, test } from "./test";

const DDA_RS = fileURLToPath(new URL("../../dda-rs/", import.meta.url));
const fixturePath = (name: string) => join(DDA_RS, "tests/fixtures", name);
const BRAINVISION = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"];

// Playwright's WebKit has no OPFS (getDirectory throws UnknownError); Safari itself has.
const hasStorage = (page: Page) =>
  page.evaluate(() =>
    navigator.storage.getDirectory().then(
      () => true,
      () => false,
    ),
  );
const NO_STORAGE = "this browser window has no OPFS";

const runBar = (page: Page) => page.getByRole("region", { name: "Run" });
const history = (page: Page) => page.getByRole("region", { name: "History" });
const provenance = (page: Page) => page.getByRole("region", { name: "Provenance" });
const result = (page: Page) => page.getByRole("region", { name: "Result" });
const state = (page: Page) =>
  page.evaluate(() => {
    const { analyses, activeResultId, activeRecordingId, view, panels } = window.__ddalab.store.getState();
    return { analyses, activeResultId, activeRecordingId, view, panels };
  });

/** Runs `variants` on Fp1 and Fp2 of the BrainVision fixture from 1 s to 5 s; the result id. */
async function runBrainVision(page: Page, variants = ["ST"]) {
  await page.getByLabel("Recording files").setInputFiles(BRAINVISION.map(fixturePath));
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  await page.getByRole("checkbox", { name: "Select Fp2" }).check();
  const settings = page.getByRole("region", { name: "DDA settings" });
  for (const variant of ["ST", "CT", "CD", "DE", "SY"]) {
    await settings
      .getByRole("checkbox", { name: variant, exact: true })
      .setChecked(variants.includes(variant));
  }
  // The selection the run takes (analysis.spec.ts types it; here it is setup), once the run bar follows the store.
  await expect(runBar(page).getByText(/^Plan /)).toBeVisible();
  await page.evaluate(() => window.__ddalab.store.setState({ selection: { t0: 1, t1: 5 } }));
  await expect(runBar(page).getByLabel("End", { exact: true })).toHaveValue("5");
  await runBar(page).getByRole("button", { name: "Run DDA" }).click();
  await expect(runBar(page).getByText("Complete", { exact: true })).toBeVisible({ timeout: 60_000 });
  return (await state(page)).analyses[0].id;
}

/** Runs the provenance's CLI command in a fresh folder holding the BrainVision files; `replace` edits it first. */
function runCommand(command: string, replace?: [RegExp, string]) {
  const dir = mkdtempSync(join(tmpdir(), "ddalab-history-"));
  for (const name of BRAINVISION) copyFileSync(fixturePath(name), join(dir, name));
  execFileSync("sh", ["-c", replace ? command.replace(...replace) : command], {
    cwd: dir,
    env: { ...process.env, PATH: `${join(DDA_RS, "target/release")}:${process.env.PATH}` },
    stdio: "pipe",
  });
  return dir;
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

/** A result document or manifest without what belongs to one run or one build: its id, its time, the commit. */
// biome-ignore lint/suspicious/noExplicitAny: parsed JSON
const comparable = (document: any) => ({
  ...document,
  id: "",
  created_at_iso: "",
  reproduction: { ...document.reproduction, git_commit: null }, // the e2e CLI build has no DDALAB_GIT_COMMIT
});

/** Clicks `name` in the export panel of the active result and saves the download; its path. */
async function exportAs(page: Page, name: string) {
  await provenance(page).getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("dialog", { name: "Export result" }).getByRole("button", { name }).click(),
  ]);
  const path = join(mkdtempSync(join(tmpdir(), "ddalab-export-")), download.suggestedFilename());
  await download.saveAs(path);
  return path;
}

const unzip = (zip: string) => {
  const dir = mkdtempSync(join(tmpdir(), "ddalab-unzip-"));
  execFileSync("python3", [
    "-c",
    "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
    zip,
    dir,
  ]);
  return dir;
};

const commandOf = async (page: Page) => (await provenance(page).locator("pre").textContent()) ?? "";

test.beforeEach(async ({ page }) => {
  // No native dialogs: the exports save as downloads (save.spec.ts covers the Save dialog).
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showOpenFilePicker");
    Reflect.deleteProperty(window, "showSaveFilePicker");
  });
  await page.goto("/");
});

test("history_survives_reload", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  const id = await runBrainVision(page);
  // The finished result opens with its provenance.
  await expect(provenance(page)).toBeVisible();
  await page.reload();
  const row = history(page).getByRole("listitem").filter({ hasText: "ST on fixture.vhdr" });
  await expect(row).toContainText("Complete");
  await row.getByRole("button", { name: /^ST on fixture\.vhdr/ }).click();
  await expect.poll(async () => (await state(page)).activeResultId).toBe(id);
  const sha = createHash("sha256")
    .update(readFileSync(fixturePath("fixture.eeg")))
    .digest("hex");
  await expect(provenance(page).getByText(sha)).toBeVisible();
  await expect(provenance(page)).toContainText("Fp1, Fp2");
  expect(await commandOf(page)).toBe(
    "ddalab run --file=fixture.vhdr --channels 0 1 --variants ST --wl 200 --ws 100 --delays 7 10 --model 1 2 10 " +
      "--dm 4 --order 4 --nr-tau 2 --start-sample 500 --end-sample 2500 --bundle=fixture.dda",
  );
  const { analyses } = await state(page);
  expect(analyses[0]).toMatchObject({ id, status: "complete", plan: { windows: 18 } });
  expect(analyses[0].manifest?.reproduction.input_sha256["fixture.eeg"]).toBe(sha);
  // Closing the result puts the keyboard back on its history row.
  await provenance(page).getByRole("button", { name: "Close" }).click();
  await expect(provenance(page)).toHaveCount(0);
  await expect(row.getByRole("button", { name: /^ST on fixture\.vhdr/ })).toBeFocused();
});

test("export_bundle_zip_matches_cli", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await runBrainVision(page);
  const exported = filesUnder(unzip(await exportAs(page, "Bundle")));
  const cli = filesUnder(join(runCommand(await commandOf(page)), "fixture.dda"));
  expect(Object.keys(exported).sort()).toEqual(Object.keys(cli).sort());
  for (const path of Object.keys(cli).filter((p) => p.endsWith(".npy"))) {
    expect(exported[path].equals(cli[path]), path).toBe(true);
  }
  expect(comparable(JSON.parse(exported["manifest.json"].toString()))).toEqual(
    comparable(JSON.parse(cli["manifest.json"].toString())),
  );
});

test("export_json_matches_cli", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await runBrainVision(page, ["ST", "CT", "CD", "DE", "SY"]);
  const exported = JSON.parse(readFileSync(await exportAs(page, "Document"), "utf8"));
  const dir = runCommand(await commandOf(page), [/--bundle=\S+$/, "--output=document.json"]);
  const cli = JSON.parse(readFileSync(join(dir, "document.json"), "utf8"));
  expect(exported.variants.map((v: { id: string }) => v.id)).toEqual(["ST", "CT", "CD", "DE", "SY"]);
  expect(comparable(exported)).toEqual(comparable(cli));
});

/** A deflated zip of the CLI's ST bundle, as an archiver makes one. */
function stZip() {
  const zip = join(mkdtempSync(join(tmpdir(), "ddalab-import-")), "st.dda.zip");
  execFileSync("python3", [
    "-c",
    "import os, sys, zipfile\n" +
      "with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:\n" +
      "  for d, _, names in os.walk(sys.argv[2]):\n" +
      "    for n in names: z.write(os.path.join(d, n), os.path.relpath(os.path.join(d, n), sys.argv[2]))",
    zip,
    bundleDir("st"),
  ]);
  return zip;
}

/** The heatmap's next complete frame and the share of its pixels that are data (opaque over the transparent ground). */
const heatmapDrawn = (page: Page) =>
  page.evaluate(async () => {
    const { results } = window.__ddalab;
    const frame = await results.settled();
    const { data } = results.pixels();
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
    return { frame, drawn: opaque / (data.length / 4) };
  });

test("import_cli_bundle_shows_heatmap_without_recording", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  const manifest = JSON.parse(readFileSync(join(bundleDir("st"), "manifest.json"), "utf8"));
  await page.getByLabel("Result file").setInputFiles(stZip());
  const row = history(page).getByRole("listitem").filter({ hasText: "ST on fixture.vhdr" });
  await expect(row).toContainText("Complete");
  await expect(provenance(page)).toBeVisible();
  const { analyses, activeResultId, activeRecordingId } = await state(page);
  expect(activeRecordingId).toBeNull();
  expect(activeResultId).toBe(analyses[0].id);
  expect(analyses[0].manifest?.variants.map((v) => v.id)).toEqual(["ST"]);
  expect(analyses[0].manifest?.id).toBe(manifest.id);
  expect(analyses[0].plan?.windows).toBe(manifest.window_centers_seconds.length);
  await expect(provenance(page).getByText(manifest.reproduction.input_sha256["fixture.eeg"])).toBeVisible();
  // The heatmap draws with no recording open, on the result's own interval.
  await expect(result(page)).toContainText("fixture.vhdr is not open");
  const { frame, drawn } = await heatmapDrawn(page);
  expect(frame).toMatchObject({
    resultId: activeResultId,
    variant: "ST",
    array: "q",
    rows: 2,
    complete: true,
  });
  expect(drawn).toBeGreaterThan(0.5);
});

test("import_with_another_recording_open_shows_alone", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await page.getByLabel("Recording files").setInputFiles(fixturePath("fixture.edf"));
  await expect(page.getByRole("heading", { name: "fixture.edf" })).toBeVisible();
  await page.getByLabel("Result file").setInputFiles(stZip());
  const row = history(page).getByRole("listitem").filter({ hasText: "ST on fixture.vhdr" });
  await expect(row).toContainText("Complete");
  // No open recording made the result: none stays active, and the result takes the center with a note.
  await expect(result(page)).toContainText("fixture.vhdr is not open");
  const { activeResultId, activeRecordingId } = await state(page);
  expect(activeRecordingId).toBeNull();
  await expect(page.locator("canvas[data-traces]")).toHaveCount(0);
  const { frame, drawn } = await heatmapDrawn(page);
  expect(frame).toMatchObject({ resultId: activeResultId, variant: "ST", rows: 2, complete: true });
  expect(drawn).toBeGreaterThan(0.5);
});

test("history_row_activates_its_recording", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  const id = await runBrainVision(page);
  // Another recording becomes the active one; the result of the first one waits in the history.
  await page.getByLabel("Recording files").setInputFiles(fixturePath("fixture.edf"));
  await expect(page.getByRole("heading", { name: "fixture.edf" })).toBeVisible();
  await expect(result(page)).toHaveCount(0);
  await history(page)
    .getByRole("listitem")
    .filter({ hasText: "ST on fixture.vhdr" })
    .getByRole("button", { name: /^ST on fixture\.vhdr/ })
    .click();
  // Its recording is active again, and the result shows under its waveform.
  await expect(page.getByRole("heading", { name: "fixture.vhdr", exact: true })).toBeVisible();
  await expect(result(page)).toBeVisible();
  await expect(result(page)).not.toContainText("is not open");
  expect((await state(page)).activeResultId).toBe(id);
  expect((await heatmapDrawn(page)).frame).toMatchObject({ resultId: id, complete: true });
});

test("session_restores_view", async ({ page }) => {
  // The scale settings sit in the bar from 1400 px with the inspector open (Shell.module.css).
  await page.setViewportSize({ width: 1440, height: 720 });
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  const id = await runBrainVision(page);
  // The 30 s EDF at 20 s epochs, on its second page, which ends at the end of the recording.
  await page.getByLabel("Recording files").setInputFiles(fixturePath("fixture.edf"));
  await expect(page.getByRole("heading", { name: "fixture.edf" })).toBeVisible();
  await page.getByRole("combobox", { name: "Epoch" }).click();
  await page.getByRole("option", { name: "20 s" }).click();
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByRole("button", { name: "Inspector" }).click();
  await expect(page.getByRole("button", { name: "Inspector" })).toHaveAttribute("aria-pressed", "false");
  expect((await state(page)).view).toMatchObject({ t0: 10, t1: 30, epochS: 20 });
  await page.reload();
  // The panels at once; the result comes back with its tab once the history has loaded.
  await expect(page.getByRole("button", { name: "Inspector" })).toHaveAttribute("aria-pressed", "false");
  await expect(history(page).getByRole("button", { name: /^ST on fixture\.vhdr/ })).toBeVisible();
  await page.getByRole("tab", { name: /^fixture\.vhdr/ }).click();
  await expect.poll(async () => (await state(page)).activeResultId).toBe(id);
  // The view comes back when the recording opens again.
  await page.getByLabel("Recording files").setInputFiles(fixturePath("fixture.edf"));
  await expect.poll(async () => (await state(page)).view).toMatchObject({ t0: 10, t1: 30, epochS: 20 });
});

test("delete_removes_opfs_files", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  const id = await runBrainVision(page);
  const exists = () =>
    page.evaluate(async (id) => {
      const results = await (await navigator.storage.getDirectory()).getDirectoryHandle("results");
      return results.getDirectoryHandle(id).then(
        () => true,
        () => false,
      );
    }, id);
  expect(await exists()).toBe(true);
  const row = history(page).getByRole("listitem").filter({ hasText: "ST on fixture.vhdr" });
  await row.getByRole("button", { name: /^ST on fixture\.vhdr/ }).click();
  // Deleting asks once more; Keep is focused.
  await provenance(page).getByRole("button", { name: "Delete" }).click();
  await expect(provenance(page).getByRole("button", { name: "Keep" })).toBeFocused();
  await provenance(page).getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);
  // The row is gone: the keyboard lands on the history's heading.
  await expect(history(page).getByRole("heading", { name: /^History/ })).toBeFocused();
  expect(await exists()).toBe(false);
  const { analyses, activeResultId } = await state(page);
  expect(analyses.map((a) => a.id)).not.toContain(id);
  expect(activeResultId).toBeNull();
});

/**
 * Records of results `ids` in IndexedDB, on files `<id>.edf`, with `status`. A complete one also gets a manifest in
 * OPFS: what pointing at its row reads.
 */
const seedResults = (page: Page, ids: string[], status: "complete" | "failed") =>
  page.evaluate(
    async ({ ids, status }) => {
      const results = await (await navigator.storage.getDirectory()).getDirectoryHandle("results", {
        create: true,
      });
      const db: IDBDatabase = await new Promise((opened, failed) => {
        const request = indexedDB.open("ddalab");
        request.onsuccess = () => opened(request.result);
        request.onerror = () => failed(request.error);
      });
      for (const [i, id] of ids.entries()) {
        const request = {
          file_path: `${id}.edf`,
          channels: [0],
          time_range: { start: 0, end: 1000 },
          preprocessing_options: { highpass: null, lowpass: null },
          algorithm_selection: { enabled_variants: ["ST"] },
          window_parameters: { window_length: 200, window_step: 100 },
          delay_parameters: { delays: [7, 10] },
        };
        const record = { id, fingerprint: "f", fileName: `${id}.edf`, request, createdAt: i + 1, status };
        await new Promise((done) => {
          const put = db.transaction("analyses", "readwrite");
          put.objectStore("analyses").put(record);
          put.oncomplete = done;
        });
        if (status !== "complete") continue;
        const directory = await results.getDirectoryHandle(id, { create: true });
        for (const [name, text] of [
          ["manifest.json", JSON.stringify({ id, variants: [], window_centers_seconds: [0.5] })],
          ["status", "complete"],
        ]) {
          const file = await (await directory.getFileHandle(name, { create: true })).createWritable();
          await file.write(text);
          await file.close();
        }
      }
      db.close();
    },
    { ids, status },
  );

// The startup sweep runs beside the IO worker's queue: the history needs neither the engine's wasm nor its compile.
test("history_lists_before_the_engine_compiles", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the worker's wasm request is interceptable in Chromium only");
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await seedResults(page, ["held"], "failed");
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The module itself; the dev server also serves `ddalab.wasm?url`, a script the worker imports.
  await page.route(/\.wasm$/, async (route) => {
    await held;
    await route.continue();
  });
  await page.reload();
  await expect(history(page).getByRole("listitem").filter({ hasText: "ST on held.edf" })).toContainText(
    "Failed",
  );
  await expect(page.getByRole("status")).toHaveText("loading");
  release();
  await expect(page.getByRole("status")).toHaveText(/^\d+\.\d+\.\d+/);
});

/** Logs, from the next load on, what the page asks of its workers (`ask`) and the serials they answer (`reply`). */
const logWorkers = (page: Page) =>
  page.addInitScript(() => {
    const log: [string, unknown][] = [];
    Object.assign(window, { workerLog: log });
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", ({ data }) => log.push(["reply", data?.n]));
      }
      postMessage(
        message: { type?: string; n?: number },
        transfer?: Transferable[] | StructuredSerializeOptions,
      ) {
        log.push(["ask", message?.type === "sweepResults" ? `sweepResults ${message.n}` : message?.type]);
        super.postMessage(message, transfer as Transferable[]);
      }
    };
  });
const workerLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { workerLog: [string, unknown][] }).workerLog);

const asked = async (page: Page, what: string) =>
  (await workerLog(page)).filter(([kind, type]) => kind === "ask" && type === what).length;

test("pointing_at_a_result_reads_its_manifest_before_the_click", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await runBrainVision(page);
  await page.evaluate(() => window.__ddalab.store.setState({ activeResultId: null, shownResult: null }));
  await logWorkers(page);
  await page.reload();
  const row = history(page).getByRole("button", { name: /^ST on fixture\.vhdr/ });
  await row.hover();
  await expect.poll(() => asked(page, "resultManifest")).toBe(1);
  // The arrays wait for the click: a pointer passes over rows it does not open.
  await page.waitForTimeout(300);
  expect(await asked(page, "resultArray")).toBe(0);
  await row.click();
  await expect(result(page)).toBeVisible();
  expect((await heatmapDrawn(page)).frame).toMatchObject({ complete: true });
  // The click found the manifest read: it was read once.
  expect(await asked(page, "resultManifest")).toBe(1);
  expect(await asked(page, "resultArray")).toBe(1);
});

test("pointing_keeps_the_last_three_manifests_and_the_shown_result", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  // The BrainVision result stays shown across the reload; four more results come with their manifests.
  await runBrainVision(page);
  await seedResults(page, ["r1", "r2", "r3", "r4"], "complete");
  await logWorkers(page);
  await page.reload();
  await expect(result(page)).toBeVisible();
  expect((await heatmapDrawn(page)).frame).toMatchObject({ complete: true });
  const arrays = await asked(page, "resultArray");
  const manifests = await asked(page, "resultManifest");
  const point = async (id: string, reads: number) => {
    await page.locator(`[data-result="${id}"]`).hover();
    await expect.poll(() => asked(page, "resultManifest")).toBe(manifests + reads);
  };
  for (const [i, id] of ["r1", "r2", "r3", "r4"].entries()) await point(id, i + 1);
  // r2 to r4 are kept and read no more; r1, the fourth from last, was dropped and is read again.
  await page.locator('[data-result="r2"]').hover();
  await page.locator('[data-result="r4"]').hover();
  await page.waitForTimeout(300);
  expect(await asked(page, "resultManifest")).toBe(manifests + 4);
  await point("r1", 5);
  // The shown result kept its reads through all of it.
  const shown = await page.evaluate(() => window.__ddalab.store.getState().shownResult?.id as string);
  await page.locator(`[data-result="${shown}"]`).hover();
  await page.waitForTimeout(300);
  expect(await asked(page, "resultManifest")).toBe(manifests + 5);
  // No array was read for a row pointed at.
  expect(await asked(page, "resultArray")).toBe(arrays);
});

test("a_restored_result_is_read_while_the_history_lists", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await runBrainVision(page);
  await logWorkers(page);
  await page.reload();
  await expect(result(page)).toBeVisible();
  const log = await workerLog(page);
  const sweep = log.find(([kind, what]) => kind === "ask" && String(what).startsWith("sweepResults"));
  const swept = log.findIndex(([kind, n]) => kind === "reply" && `sweepResults ${n}` === sweep?.[1]);
  // The manifest is asked for before the sweep, which the history waits for, has answered.
  expect(log.findIndex(([, what]) => what === "resultManifest")).toBeLessThan(swept);
});

test("a_finished_run_reads_its_manifest_once", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await logWorkers(page);
  await page.reload();
  const id = await runBrainVision(page);
  await expect(result(page)).toBeVisible();
  expect((await heatmapDrawn(page)).frame).toMatchObject({ resultId: id, complete: true });
  // The run's read of the manifest for its record is the one the result view uses.
  expect((await workerLog(page)).filter(([, what]) => what === "resultManifest")).toHaveLength(1);
  expect((await state(page)).analyses[0]).toMatchObject({ id, status: "complete" });
});

test("a_run_whose_manifest_read_fails_shows_on_its_request", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  // The run's own read of its manifest fails; the view's read after it succeeds.
  await page.evaluate(() => {
    const { engine } = window.__ddalab;
    const read = engine.resultManifest.bind(engine);
    let failed = false;
    engine.resultManifest = (id: string) => {
      if (failed) return read(id);
      failed = true;
      return Promise.reject(new Error("unreadable"));
    };
  });
  const id = await runBrainVision(page);
  // Samples 500 to 2500 at 500 Hz.
  expect(await page.evaluate(() => window.__ddalab.store.getState().shownResult)).toMatchObject({
    id,
    interval: { t0: 1, t1: 5 },
  });
  expect((await state(page)).analyses[0].manifest).toBeUndefined();
  await expect(result(page)).toBeVisible();
  expect((await heatmapDrawn(page)).frame).toMatchObject({ resultId: id, complete: true });
});

// Each tab shows its own result again after a switch, from the reads it made: the loader cache keeps what the tabs show.
test("a_tab_switch_shows_its_own_result_read_once", async ({ page }) => {
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await logWorkers(page);
  await page.reload();
  /** A recording with a result of its own, which it shows; the result's record is complete. */
  const openWith = async (seed: number, id: string) => {
    await page.evaluate(
      (seed) => window.__ddalab.openSynthetic({ channels: 4, rateHz: 256, durationS: 60, seed }),
      seed,
    );
    await page.evaluate(() => window.__ddalab.viewer.settled());
    await page.evaluate((id) => {
      const { store } = window.__ddalab;
      const s = store.getState();
      const { fingerprint } = s.recordings[s.activeRecordingId as string];
      const request = {
        file_path: "synthetic.edf",
        channels: [0],
        time_range: { start: 0, end: 1000 },
        preprocessing_options: { highpass: null, lowpass: null },
        algorithm_selection: { enabled_variants: ["ST"] },
        window_parameters: { window_length: 200, window_step: 100 },
        delay_parameters: { delays: [7, 10] },
      };
      const record = {
        id,
        fingerprint,
        fileName: "synthetic.edf",
        request,
        createdAt: Date.now(),
        status: "complete",
      };
      store.setState({ analyses: [record as never, ...s.analyses] });
    }, id);
    await showFixture(page, { id, windows: 100, rows: 4, first: 0.5, step: 0.25, values: [] });
    expect((await heatmapDrawn(page)).frame).toMatchObject({ resultId: id, complete: true });
  };
  await openWith(1, "ra");
  await openWith(2, "rb");
  const tabs = page.getByRole("tablist", { name: "Open recordings" }).getByRole("tab");
  for (const [tab, id] of [
    [0, "ra"],
    [1, "rb"],
    [0, "ra"],
  ] as const) {
    await tabs.nth(tab).click();
    await expect.poll(() => page.evaluate(() => window.__ddalab.store.getState().shownResult?.id)).toBe(id);
    expect((await heatmapDrawn(page)).frame).toMatchObject({ resultId: id, complete: true });
  }
  expect(await asked(page, "resultManifest")).toBe(2);
});
