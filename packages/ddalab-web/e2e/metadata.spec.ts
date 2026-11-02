// The metadata editor: an edited copy of a recording, saved through the downloads (no Save dialog here), opens with
// the edited label; the editor refuses a label its format cannot hold. The writers themselves are tested in dda-rs
// (tests/io_edit.rs).
import { fileURLToPath } from "node:url";
import { expect, test } from "./test";

const EDF = fileURLToPath(new URL("../../dda-rs/tests/fixtures/fixture.edf", import.meta.url));
const VHDR = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"].map((name) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url)),
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showOpenFilePicker");
    Reflect.deleteProperty(window, "showSaveFilePicker");
  });
  await page.goto("/");
});

test("an_edited_copy_opens_with_the_new_label", async ({ page }) => {
  await page.getByLabel("Recording files").setInputFiles(EDF);
  await page.getByRole("button", { name: "Edit metadata" }).click();
  const editor = page.getByRole("dialog", { name: "Metadata of fixture.edf" });
  const label = editor.getByLabel("Label of channel 1");
  await label.fill("a label of seventeen");
  await expect(editor.getByText("At most 16 characters")).toBeVisible();
  await expect(editor.getByRole("button", { name: "Save copy" })).toBeDisabled();
  await label.fill("Fp1-Ref");
  await editor.getByLabel("Patient").fill("X X X Anon");
  const download = page.waitForEvent("download");
  await editor.getByRole("button", { name: "Save copy" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("fixture-edited.edf");
  await expect(editor).toBeHidden();
  await page.getByLabel("Recording files").setInputFiles({
    name: "fixture-edited.edf",
    mimeType: "application/octet-stream",
    buffer: await saved.createReadStream().then(async (stream) => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    }),
  });
  await expect(page.getByRole("list", { name: "Channels" }).getByText("Fp1-Ref")).toBeVisible();
});

test("a_brainvision_copy_saves_as_a_zip", async ({ page }) => {
  await page.getByLabel("Recording files").setInputFiles(VHDR);
  await page.getByRole("button", { name: "Edit metadata" }).click();
  const editor = page.getByRole("dialog", { name: "Metadata of fixture.vhdr" });
  await editor.getByLabel("Label of channel 1").fill("Fp1, left");
  const download = page.waitForEvent("download");
  await editor.getByRole("button", { name: "Save copy" }).click();
  expect((await download).suggestedFilename()).toBe("fixture-edited.zip");
});
