import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url));
const fixture = (name: string) => readFileSync(fixturePath(name));
const upload = (name: string, buffer: Buffer) => ({ name, mimeType: "application/octet-stream", buffer });

const files = (page: Page) => page.getByLabel("Recording files");
const channels = (page: Page) => page.getByRole("list", { name: "Channels" }).getByRole("listitem");
const recentButton = (page: Page, name: string) => page.getByRole("button", { name });

test.beforeEach(async ({ page }) => {
  // Playwright cannot drive showOpenFilePicker (and its handles are Chromium-only): every project takes the
  // <input> path. The handle path is covered by recent.test.ts and handle.spec.ts.
  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await page.goto("/");
});

test("open_edf_by_picker", async ({ page }) => {
  await files(page).setInputFiles(fixturePath("fixture.edf"));
  await expect(channels(page)).toHaveText(["Fp1", "Fp2"]);
  await expect(
    page.getByRole("region", { name: "Inspector" }).getByText("30 s", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

// The core lists the channels at the recording's rate as display channels; Resp (64 Hz) is not one of them.
test("analysis_channels_carry_through", async ({ page }) => {
  await files(page).setInputFiles(fixturePath("fixture.edf"));
  await expect(channels(page)).toHaveText(["Fp1", "Fp2"]);
  await expect(page.getByRole("list", { name: "Not analyzed" }).getByRole("listitem")).toHaveText([
    "Resp (64 Hz)",
  ]);
  const golden = JSON.parse(
    readFileSync(new URL("../src/core/golden/inspect-fixture-edf.json", import.meta.url), "utf8"),
  );
  const stored = await page.evaluate(() => {
    const { recordings, activeRecordingId } = window.__ddalab.store.getState();
    return recordings[activeRecordingId as string].analysis_channels;
  });
  expect(golden.analysis_channels).toEqual([0, 1]);
  expect(stored).toEqual(golden.analysis_channels);
});

// Tiles and hashes are kept per fingerprint: a second engine recording of the same content would only compete.
test("the_same_recording_opens_once", async ({ page }) => {
  const state = () =>
    page.evaluate(() => {
      const { recordings, activeRecordingId } = window.__ddalab.store.getState();
      return { open: Object.keys(recordings).length, active: activeRecordingId };
    });
  await files(page).setInputFiles(fixturePath("fixture.edf"));
  await expect(channels(page)).toHaveCount(2);
  const edf = await state();
  await page.getByLabel("Recording folder").setInputFiles(fixturePath(""));
  await expect(channels(page)).toHaveCount(4);
  expect(await state()).toMatchObject({ open: 2 });
  await files(page).setInputFiles(fixturePath("fixture.edf"));
  await expect(channels(page)).toHaveCount(2);
  expect(await state()).toEqual({ open: 2, active: edf.active });
});

test("drop_brainvision_folder", async ({ page }) => {
  const parts = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"].map((name) => ({
    name,
    base64: fixture(name).toString("base64"),
  }));
  await page.getByRole("region", { name: "Drop zone" }).evaluate((zone, dropped) => {
    const data = new DataTransfer();
    for (const { name, base64 } of dropped) {
      data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name));
    }
    zone.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  }, parts);
  await expect(channels(page)).toHaveText(["Fp1", "Fp2", "Cz", "Pz"]);
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
});

// The folder holds EDF, BDF, CSV and BrainVision files: BrainVision wins and its data file comes with it.
test("open_folder_prefers_brainvision", async ({ page }) => {
  await page.getByLabel("Recording folder").setInputFiles(fixturePath(""));
  await expect(channels(page)).toHaveText(["Fp1", "Fp2", "Cz", "Pz"]);
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
});

test("vhdr_without_eeg_errors", async ({ page }) => {
  const vhdr = fixture("fixture.vhdr").toString().replaceAll("fixture.", "sub-01_ieeg.");
  await files(page).setInputFiles(upload("sub-01_ieeg.vhdr", Buffer.from(vhdr)));
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(
    "sub-01_ieeg.vhdr names sub-01_ieeg.eeg, which is not among the opened files",
  );
  await expect(alert.getByRole("button", { name: "Open the folder that contains it." })).toBeVisible();
  await expect(channels(page)).toHaveCount(0);
});

test("unsupported_format_reason", async ({ page }) => {
  await files(page).setInputFiles(upload("scan.fif", Buffer.from("not a recording")));
  await expect(page.getByRole("alert")).toHaveText(
    "FIFF files are not supported yet; DDALAB reads EDF, BDF, BrainVision and delimited text",
  );
});

test("corrupt_edf_reason", async ({ page }) => {
  await files(page).setInputFiles(upload("broken.edf", fixture("fixture.edf").subarray(0, 100)));
  await expect(page.getByRole("alert")).toHaveText(
    "Unsupported file type: broken.edf holds 100 bytes, fewer than the 256-byte EDF header",
  );
});

test("several_recordings_ask", async ({ page }) => {
  const edf = fixture("fixture.edf");
  await files(page).setInputFiles([upload("a.edf", edf), upload("b.edf", edf)]);
  const choice = page.getByRole("group", { name: "Several recordings found" });
  await choice.getByRole("button", { name: "b.edf" }).click();
  await expect(channels(page)).toHaveText(["Fp1", "Fp2"]);
  await expect(page.getByRole("heading", { name: "b.edf" })).toBeVisible();
});

// Files opened through an <input> have no FileSystemHandle in any browser: every project re-picks.
test("reopen_requires_repick_without_handle", async ({ page }) => {
  await files(page).setInputFiles(fixturePath("fixture.edf"));
  await expect(channels(page)).toHaveCount(2);
  await page.reload();
  await expect(channels(page)).toHaveCount(0);
  await expect(page.getByText("Select the file again to reopen it.")).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    recentButton(page, "Locate fixture.edf").click(),
  ]);
  await chooser.setFiles(fixturePath("fixture.edf"));
  await expect(channels(page)).toHaveText(["Fp1", "Fp2"]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("wrong_file_on_repick_warns", async ({ page }) => {
  await files(page).setInputFiles(fixturePath("fixture.edf"));
  await expect(channels(page)).toHaveCount(2);
  await page.reload();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    recentButton(page, "Locate fixture.edf").click(),
  ]);
  await chooser.setFiles(fixturePath("fixture.bdf"));
  await expect(page.getByRole("alert")).toHaveText("This file differs from the recording you opened before");
  await expect(channels(page)).not.toHaveCount(0);
});
