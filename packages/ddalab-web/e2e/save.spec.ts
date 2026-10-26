// Exports through the browser's Save dialog (Chromium's showSaveFilePicker) and through downloads where it has none.
// The dialog is replaced by a stub that answers with a file of the origin private file system, or with the AbortError a
// closed dialog gives; the bytes it receives must equal the bytes of the download path. Firefox and WebKit have no
// dialog and keep the download path, which history.spec.ts and annotations.spec.ts exercise.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "./test";

test.skip(({ browserName }) => browserName !== "chromium", "showSaveFilePicker is Chromium's");

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url));

type Options = { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] };
type Saves = {
  saveStub(options: Options): Promise<FileSystemFileHandle>;
  saved: Options[];
  cancel: boolean;
  failWrite: boolean;
};
const saves = (page: Page) => page.evaluate(() => (window as unknown as Saves).saved);

/** Whether Save dialogs are on (the stub) or off (no dialog, so downloads). */
const dialogs = (page: Page, on: boolean) =>
  page.evaluate((on) => {
    if (on) Object.assign(window, { showSaveFilePicker: (window as unknown as Saves).saveStub });
    else Reflect.deleteProperty(window, "showSaveFilePicker");
  }, on);

/** The bytes the stub's file `name` holds, or `null` while it has none. */
const savedBytes = (page: Page, name: string) =>
  page.evaluate(async (file) => {
    try {
      const handle = await (await navigator.storage.getDirectory()).getFileHandle(file);
      const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      return bytes.length > 0 ? Array.from(bytes) : null;
    } catch {
      return null;
    }
  }, name);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = { saved: [] as Options[], cancel: false, failWrite: false };
    Object.assign(window, state, {
      saveStub: async (options: Options) => {
        if ((window as unknown as Saves).cancel)
          throw new DOMException("The user aborted a request.", "AbortError");
        (window as unknown as Saves).saved.push(options);
        if ((window as unknown as Saves).failWrite)
          return {
            createWritable: async () => {
              throw new Error("The disk is full");
            },
          } as unknown as FileSystemFileHandle;
        const root = await navigator.storage.getDirectory();
        return root.getFileHandle(`saved-${options.suggestedName}`, { create: true });
      },
    });
    Object.assign(window, { showSaveFilePicker: (window as unknown as Saves).saveStub });
    Reflect.deleteProperty(window, "showOpenFilePicker");
  });
  await page.goto("/");
});

const runBar = (page: Page) => page.getByRole("region", { name: "Run" });
const exportPanel = (page: Page) => page.getByRole("dialog", { name: "Export result" });

/** Runs ST on Fp1 and Fp2 of the BrainVision fixture, 1 s to 5 s, and opens its export panel. */
async function openExport(page: Page) {
  await page
    .getByLabel("Recording files")
    .setInputFiles(["vhdr", "eeg", "vmrk"].map((e) => fixture(`fixture.${e}`)));
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  await page.getByRole("checkbox", { name: "Select Fp2" }).check();
  for (const variant of ["ST", "CT", "CD", "DE", "SY"]) {
    await page
      .getByRole("region", { name: "DDA settings" })
      .getByRole("checkbox", { name: variant, exact: true })
      .setChecked(variant === "ST");
  }
  await expect(runBar(page).getByText(/^Plan /)).toBeVisible();
  await page.evaluate(() => window.__ddalab.store.setState({ selection: { t0: 1, t1: 5 } }));
  await expect(runBar(page).getByLabel("End", { exact: true })).toHaveValue("5");
  await runBar(page).getByRole("button", { name: "Run DDA" }).click();
  await expect(runBar(page).getByText("Complete", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("region", { name: "Provenance" }).getByRole("button", { name: "Export" }).click();
  await expect(exportPanel(page)).toBeVisible();
}

test("a_result_saves_through_the_dialog_with_the_bytes_of_a_download", async ({ page }) => {
  await openExport(page);
  const formats: [button: string, file: string, type: string, extension: string][] = [
    ["Bundle", "fixture.dda.zip", "application/zip", ".zip"],
    ["Document", "fixture.dda.json", "application/json", ".json"],
    ["CSV of ST", "fixture.ST.csv", "text/csv", ".csv"],
  ];
  for (const [button, file, type, extension] of formats) {
    await dialogs(page, false);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      exportPanel(page).getByRole("button", { name: button }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(file);
    const expected = Array.from(readFileSync(await download.path()));

    await dialogs(page, true);
    await exportPanel(page).getByRole("button", { name: button }).click();
    await expect.poll(() => savedBytes(page, `saved-${file}`)).toEqual(expected);
    const asked = (await saves(page)).at(-1);
    expect(asked?.suggestedName).toBe(file);
    expect(asked?.types).toHaveLength(1);
    expect(Object.keys(asked?.types[0].accept ?? {})).toEqual([type]);
    expect(asked?.types[0].accept[type]).toEqual([extension]);
  }
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the_annotation_exports_save_through_the_dialog", async ({ page }) => {
  await page.getByLabel("Recording files").setInputFiles(fixture("fixture.edf"));
  await expect(
    page.getByRole("list", { name: "Annotations" }).getByRole("button", { name: /^spike/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Export annotations" }).click();
  await page.getByRole("button", { name: /BIDS events\.tsv/ }).click();
  await expect
    .poll(async () => Buffer.from((await savedBytes(page, "saved-fixture_events.tsv")) ?? []).toString())
    .toBe("onset\tduration\ttrial_type\n2.5\t1\teyes closed\n20\t0\tspike\n");
  expect((await saves(page)).at(-1)?.types[0].accept).toEqual({ "text/tab-separated-values": [".tsv"] });

  await page.getByRole("button", { name: /^JSON/ }).click();
  await expect
    .poll(async () =>
      JSON.parse(
        Buffer.from((await savedBytes(page, "saved-fixture_annotations.json")) ?? []).toString() || "null",
      ),
    )
    .toEqual([
      { onset: 2.5, duration: 1, trial_type: "eyes closed" },
      { onset: 20, duration: 0, trial_type: "spike" },
    ]);
});

test("a_cancelled_dialog_does_nothing_and_shows_no_error", async ({ page }) => {
  await openExport(page);
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await page.evaluate(() => Object.assign(window, { cancel: true }));
  await exportPanel(page).getByRole("button", { name: "Bundle" }).click();
  await page.waitForTimeout(500);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Preparing the file")).toHaveCount(0);
  await expect(exportPanel(page).getByRole("button", { name: "Bundle" })).toBeEnabled();
  expect(downloads).toEqual([]);
  expect(await saves(page)).toEqual([]);

  // The dialog still works afterwards.
  await page.evaluate(() => Object.assign(window, { cancel: false }));
  await exportPanel(page).getByRole("button", { name: "Bundle" }).click();
  await expect
    .poll(async () => (await savedBytes(page, "saved-fixture.dda.zip"))?.length ?? 0)
    .toBeGreaterThan(0);
  expect(downloads).toEqual([]);
});

test("a_failed_write_of_an_annotation_export_shows_its_error", async ({ page }) => {
  await page.getByLabel("Recording files").setInputFiles(fixture("fixture.edf"));
  await expect(
    page.getByRole("list", { name: "Annotations" }).getByRole("button", { name: /^spike/ }),
  ).toBeVisible();
  await page.evaluate(() => Object.assign(window, { failWrite: true }));
  await page.getByRole("button", { name: "Export annotations" }).click();
  await page.getByRole("button", { name: /BIDS events\.tsv/ }).click();
  await expect(page.getByRole("alert")).toHaveText("The disk is full");
  // The next export starts from a clean panel.
  await page.evaluate(() => Object.assign(window, { failWrite: false }));
  await page.getByRole("button", { name: /^JSON/ }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect.poll(() => savedBytes(page, "saved-fixture_annotations.json")).not.toBeNull();
});
