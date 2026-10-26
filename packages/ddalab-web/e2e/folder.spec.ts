import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "./test";

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url));
const STEM = "sub-pt01_ses-presurgery_task-ictal_acq-ecog_run-01";
const VHDR = `${STEM}_ieeg.vhdr`;
const EDF = "S04__05_02_screenprint.edf";
const CHAIN = "ds003029 / sub-pt01 / ses-presurgery / ieeg";

/**
 * The layout of the project's data/ folder, built from the fixtures: an EDF at the top and a BIDS dataset whose
 * BrainVision recording sits four folders down with its sidecars.
 */
function dataFolder(root: string) {
  const data = join(root, "data");
  const bids = join(data, "ds003029");
  const ieeg = join(bids, "sub-pt01/ses-presurgery/ieeg");
  mkdirSync(ieeg, { recursive: true });
  copyFileSync(fixturePath("fixture.edf"), join(data, EDF));
  writeFileSync(join(bids, "dataset_description.json"), '{"Name": "ds003029", "BIDSVersion": "1.4.0"}');
  writeFileSync(join(bids, "participants.tsv"), "participant_id\tage\nsub-pt01\tn/a\n");
  const header = readFileSync(fixturePath("fixture.vhdr"), "utf8").replaceAll("fixture.", `${STEM}_ieeg.`);
  writeFileSync(join(ieeg, VHDR), header);
  copyFileSync(fixturePath("fixture.eeg"), join(ieeg, `${STEM}_ieeg.eeg`));
  copyFileSync(fixturePath("fixture.vmrk"), join(ieeg, `${STEM}_ieeg.vmrk`));
  writeFileSync(join(ieeg, `${STEM}_ieeg.json`), '{"TaskName": "ictal", "SamplingFrequency": 500}');
  const rows = ["Fp1", "Fp2", "Cz", "Pz"].map((name) => `${name}\tEEG\tuV\tgood`);
  writeFileSync(join(ieeg, `${STEM}_channels.tsv`), ["name\ttype\tunits\tstatus", ...rows].join("\n"));
  writeFileSync(join(ieeg, `${STEM}_events.tsv`), "onset\tduration\ttrial_type\n1.0\t0\tseizure\n");
  return data;
}

/** Eight EDF recordings, seven of them one per subject folder. */
function studyFolder(root: string) {
  const study = join(root, "study");
  for (let n = 1; n <= 7; n++) {
    const eeg = join(study, `sub-0${n}`, "eeg");
    mkdirSync(eeg, { recursive: true });
    copyFileSync(fixturePath("fixture.edf"), join(eeg, `sub-0${n}_task-rest_eeg.edf`));
  }
  mkdirSync(join(study, "pilot"));
  copyFileSync(fixturePath("fixture.edf"), join(study, "pilot", "pilot.edf"));
  return study;
}

let root = "";
let data = "";
let study = "";
test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ddalab-folder-"));
  data = dataFolder(root);
  study = studyFolder(root);
});
test.afterAll(() => rmSync(root, { recursive: true, force: true }));

const channels = (page: Page) =>
  page.getByRole("list", { name: "Channels" }).getByRole("listitem").locator("label");
const tree = (page: Page) => page.getByRole("tree", { name: "Recordings in data" });
// A recording's accessible name is its shown label, then its file name.
const row = (page: Page, name: string) => tree(page).getByRole("treeitem", { name });
/** The background of `locator` once a hover fade has settled. */
const background = async (page: Page, locator: ReturnType<typeof row>) => {
  await page.waitForTimeout(300);
  return locator.evaluate((element) => getComputedStyle(element).backgroundColor);
};
const openCount = (page: Page) =>
  page.evaluate(() => Object.keys(window.__ddalab.store.getState().recordings).length);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("open_folder_lists_every_recording", async ({ page }) => {
  await page.getByLabel("Recording folder").setInputFiles(data);
  // The BIDS recording under its collapsed folder chain, the EDF at the top; no sidecar or table is a row.
  await expect(tree(page).getByRole("treeitem")).toHaveCount(3);
  await expect(row(page, CHAIN)).toHaveAttribute("aria-level", "1");
  await expect(row(page, VHDR)).toHaveAttribute("aria-level", "2");
  await expect(row(page, EDF)).toHaveAttribute("aria-level", "1");
  // Label in name: the accessible name starts with the shown words.
  await expect(row(page, VHDR)).toHaveAccessibleName(`task-ictal acq-ecog run-01, ${VHDR}`);
  await expect(row(page, EDF)).toHaveAccessibleName(`S04__05_02_screenprint, ${EDF}`);
  await expect(row(page, VHDR)).toContainText("task-ictal acq-ecog run-01");
  await expect(row(page, VHDR)).toContainText("BrainVision");
  await expect(row(page, EDF)).toContainText("EDF");
  // Nothing opens until a recording is chosen.
  expect(await openCount(page)).toBe(0);

  await row(page, VHDR).click();
  await expect(page.getByRole("heading", { name: VHDR })).toBeVisible();
  await expect(channels(page)).toHaveText(["Fp1", "Fp2", "Cz", "Pz"]);
  // The header's data and marker files and the BIDS sidecars came with it.
  const inputs = await page.evaluate(() =>
    Object.values(window.__ddalab.store.getState().recordings).map((r) => r.info.input_files),
  );
  expect(inputs).toEqual([
    [
      VHDR,
      `${STEM}_ieeg.eeg`,
      `${STEM}_ieeg.vmrk`,
      `${STEM}_channels.tsv`,
      `${STEM}_events.tsv`,
      `${STEM}_ieeg.json`,
    ],
  ]);
  await row(page, EDF).click();
  await expect(page.getByRole("heading", { name: EDF })).toBeVisible();
  await expect(channels(page)).toHaveText(["Fp1", "Fp2"]);
  // Both stay open. The shown one is selected and says so in words; the other carries the open marker.
  expect(await openCount(page)).toBe(2);
  await expect(row(page, EDF)).toHaveAttribute("aria-selected", "true");
  await expect(row(page, EDF)).toContainText("Viewing");
  await expect(row(page, EDF)).not.toContainText("Open");
  await expect(row(page, VHDR)).toHaveAttribute("aria-selected", "false");
  await expect(row(page, VHDR)).toContainText("Open");
  await expect(row(page, VHDR)).not.toContainText("Viewing");
  // Hover leaves the shown row's state in place.
  await page.mouse.move(800, 600);
  const shown = await background(page, row(page, EDF));
  await row(page, EDF).hover();
  expect(await background(page, row(page, EDF))).toBe(shown);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

// "sub-pt01 / ses-presurgery / ieeg" is wider than its row: it takes two lines and every name shows.
test("long_folder_chain_takes_two_lines", async ({ page }) => {
  await page.getByLabel("Recording folder").setInputFiles(join(data, "ds003029"));
  const chain = page
    .getByRole("tree", { name: "Recordings in ds003029" })
    .getByRole("treeitem", { name: "sub-pt01 / ses-presurgery / ieeg", exact: true });
  await expect(chain).toHaveCSS("height", "40px");
  const clipped = await chain.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll("span span"), (name) => name.getBoundingClientRect()).filter(
      (r) => r.width === 0 || r.top < box.top || r.bottom > box.bottom,
    ).length;
  });
  expect(clipped).toBe(0);
});

test("keyboard_moves_and_opens", async ({ page }) => {
  await page.getByLabel("Recording folder").setInputFiles(data);
  await row(page, CHAIN).focus();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, VHDR)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, EDF)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(row(page, CHAIN)).toBeFocused();
  await page.keyboard.press("End");
  await expect(row(page, EDF)).toBeFocused();
  // Typeahead goes by the shown names: "ta" finds task-ictal; after a pause, "s" starts over and finds the screenprint.
  await page.keyboard.type("ta");
  await expect(row(page, VHDR)).toBeFocused();
  await page.waitForTimeout(700);
  await page.keyboard.press("s");
  await expect(row(page, EDF)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: VHDR })).toBeVisible();
  await expect(row(page, VHDR)).toHaveAttribute("aria-selected", "true");
  // Arrows stay in the tree: they neither page the recording nor leave the row.
  const view = () => page.evaluate(() => window.__ddalab.store.getState().view.t0);
  const before = await view();
  await page.keyboard.press("ArrowLeft");
  await expect(row(page, CHAIN)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(row(page, CHAIN)).toHaveAttribute("aria-expanded", "false");
  await expect(row(page, VHDR)).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(row(page, VHDR)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(row(page, CHAIN)).toHaveAttribute("aria-expanded", "false");
  expect(await view()).toBe(before);
});

test("filter_keeps_the_folders_of_matches", async ({ page }) => {
  await page.getByLabel("Recording folder").setInputFiles(study);
  const rows = page.getByRole("tree", { name: "Recordings in study" }).getByRole("treeitem");
  await expect(rows).toHaveCount(16);
  const filter = page.getByLabel("Filter recordings");
  await filter.fill("sub-03");
  await expect(rows).toHaveCount(2);
  const names = () => rows.evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")));
  await expect.poll(names).toEqual(["sub-03 / eeg", "sub-03_task-rest_eeg, sub-03_task-rest_eeg.edf"]);
  // Both filters match two rows: the count alone passes before the tree has changed.
  await filter.fill("pilot");
  await expect.poll(names).toEqual(["pilot", "pilot, pilot.edf"]);
  await rows.nth(1).click();
  await expect(page.getByRole("heading", { name: "pilot.edf" })).toBeVisible();
  // The opened folder's own name is in every path and matches none.
  await filter.fill("study");
  await expect(rows).toHaveCount(0);
  await filter.fill("nothing like it");
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("No recording matches.")).toBeVisible();
  await filter.fill("");
  await expect(rows).toHaveCount(16);
});

// Playwright cannot drop a real folder: the drop carries a stubbed directory entry over a header whose data file is
// not beside it.
test("folder_drop_lists_its_recordings", async ({ page }) => {
  const header = readFileSync(fixturePath("fixture.vhdr"), "utf8");
  await page.evaluate((text) => {
    const file = {
      name: "x.vhdr",
      isFile: true,
      isDirectory: false,
      file: (ok: (f: File) => void) => ok(new File([text], "x.vhdr")),
    };
    // Each reader lists the folder once, then answers with no more entries.
    const reader = () => {
      let listed = false;
      return {
        readEntries: (ok: (entries: unknown[]) => void) => {
          ok(listed ? [] : [file]);
          listed = true;
        },
      };
    };
    const folder = { name: "dropped", isFile: false, isDirectory: true, createReader: reader };
    const entry = DataTransferItem.prototype.webkitGetAsEntry;
    DataTransferItem.prototype.webkitGetAsEntry = function (this: DataTransferItem) {
      return this.getAsFile()?.name === "dropped" ? (folder as unknown as FileSystemEntry) : entry.call(this);
    };
    const data = new DataTransfer();
    data.items.add(new File([], "dropped"));
    document.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  }, header);
  const rows = page.getByRole("tree", { name: "Recordings in dropped" }).getByRole("treeitem");
  await expect(rows).toHaveCount(1);
  // The row names what is missing and does not open.
  await expect(rows).toHaveAttribute("aria-disabled", "true");
  await expect(rows).toContainText("Missing data file fixture.eeg");
  await rows.click({ force: true }); // Playwright waits for an aria-disabled row to be enabled
  await page.keyboard.press("Enter");
  expect(await openCount(page)).toBe(0);
});

// The header's data file is listed, then deleted before the recording opens: the core cannot read it, and the error
// shows in the Folder section beside the tree.
test("open_error_shows_beside_the_tree", async ({ page }) => {
  const parts = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"].map((name) => ({
    name,
    base64: readFileSync(fixturePath(name)).toString("base64"),
  }));
  const writable = await page.evaluate(async (files) => {
    if (!("createWritable" in FileSystemFileHandle.prototype)) return false;
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("vanishing", {
      create: true,
    });
    for (const { name, base64 } of files) {
      const stream = await (await folder.getFileHandle(name, { create: true })).createWritable();
      await stream.write(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
      await stream.close();
    }
    Object.assign(window, { showDirectoryPicker: async () => folder });
    return true;
  }, parts);
  test.skip(!writable, "this browser cannot write to its private file system");
  await page.getByRole("button", { name: "Open folder" }).click();
  const folder = page.getByRole("region", { name: /^Folder/ });
  const row = folder.getByRole("treeitem", { name: "fixture.vhdr" });
  await expect(row).toBeVisible();
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    await (await root.getDirectoryHandle("vanishing")).removeEntry("fixture.eeg");
  });
  await row.click();
  await expect(folder.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("region", { name: "Drop zone" }).getByRole("alert")).toHaveCount(0);
  expect(await openCount(page)).toBe(0);
});

test("walk_shows_its_count_and_cancels", async ({ page }) => {
  // A directory that lists one file and a folder that never answers.
  await page.evaluate(() => {
    const file = { kind: "file", name: "a.edf", getFile: async () => new File(["x"], "a.edf") };
    const stuck = {
      kind: "directory",
      name: "stuck",
      async *values() {
        await new Promise(() => {});
      },
    };
    const slow = {
      kind: "directory",
      name: "slow",
      async *values() {
        yield file;
        yield stuck;
      },
    };
    Object.assign(window, { showDirectoryPicker: async () => slow });
  });
  await page.getByRole("button", { name: "Open folder" }).click();
  const folder = page.getByRole("region", { name: /^Folder/ });
  await expect(folder.getByRole("status")).toHaveText("Reading the folder");
  await expect(folder).toContainText("Reading the folder 1 file");
  await folder.getByRole("button", { name: "Cancel" }).click();
  await expect(folder).toHaveCount(0);
});

// 5,000 files: 714 subjects with two runs (an EDF with its channels and events tables each) and a scans table, and
// the dataset's description and participants. The walk, the classification and the tree may not hold the page for
// more than 200 ms at a time.
test("walk_of_5000_files_keeps_the_page_responsive", async ({ page }) => {
  test.setTimeout(180_000);
  const made = await page.evaluate(async () => {
    const big = await (await navigator.storage.getDirectory()).getDirectoryHandle("big", { create: true });
    const top = ["dataset_description.json", "participants.tsv"];
    await Promise.all(top.map((name) => big.getFileHandle(name, { create: true })));
    let count = top.length;
    for (let s = 1; s <= 714; s++) {
      const sub = `sub-${String(s).padStart(3, "0")}`;
      const folder = await big.getDirectoryHandle(sub, { create: true });
      const eeg = await folder.getDirectoryHandle("eeg", { create: true });
      const names = [1, 2].flatMap((run) =>
        ["eeg.edf", "channels.tsv", "events.tsv"].map((end) => `${sub}_task-rest_run-${run}_${end}`),
      );
      await Promise.all(names.map((name) => eeg.getFileHandle(name, { create: true })));
      await folder.getFileHandle(`${sub}_scans.tsv`, { create: true });
      count += names.length + 1;
    }
    Object.assign(window, { showDirectoryPicker: async () => big });
    return count;
  });
  expect(made).toBe(5000);
  // The longest gap between timer tasks while the folder opens.
  await page.evaluate(() => {
    const probe = { gap: 0, stop: false };
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      probe.gap = Math.max(probe.gap, now - last);
      last = now;
      if (!probe.stop) setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
    Object.assign(window, { gapProbe: probe });
  });
  await page.getByRole("button", { name: "Open folder" }).click();
  const tree = page.getByRole("tree", { name: "Recordings in big" });
  await expect(tree).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Folder 1428" })).toBeVisible();
  const gap = await page.evaluate(() => {
    const { gapProbe } = window as unknown as { gapProbe: { gap: number; stop: boolean } };
    gapProbe.stop = true;
    return gapProbe.gap;
  });
  expect(gap).toBeLessThan(200);
  // 714 expanded folders hold 2,142 rows: only those in view are rendered.
  const rendered = await tree.getByRole("treeitem").count();
  expect(rendered).toBeGreaterThan(5);
  expect(rendered).toBeLessThan(80);
  await tree.getByRole("treeitem").first().focus();
  await page.keyboard.press("End");
  await expect(tree.getByRole("treeitem", { name: "sub-714_task-rest_run-2_eeg.edf" })).toBeFocused();
});
