import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "./test";

const EDF = fileURLToPath(new URL("../../dda-rs/tests/fixtures/fixture.edf", import.meta.url));

test.skip(({ browserName }) => browserName !== "chromium", "FileSystemHandles persist only in Chromium");

// The picker is stubbed with a real handle from the origin private file system: IndexedDB can store it and,
// unlike a handle to a file on disk, reading it needs no permission prompt.
test("reopen_through_a_stored_handle", async ({ page }) => {
  await page.addInitScript((base64) => {
    Object.assign(window, {
      showOpenFilePicker: async () => {
        const handle = await (await navigator.storage.getDirectory()).getFileHandle("fixture.edf", {
          create: true,
        });
        const writable = await handle.createWritable();
        await writable.write(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
        await writable.close();
        return [handle];
      },
    });
  }, readFileSync(EDF).toString("base64"));
  const channels = page.getByRole("list", { name: "Channels" }).getByRole("listitem").locator("label");

  await page.goto("/");
  await page.getByRole("button", { name: "Open files" }).click();
  await expect(channels).toHaveText(["Fp1", "Fp2"]);
  await expect(page.getByRole("button", { name: "Forget fixture.edf" })).toBeVisible(); // stored before the reload

  await page.reload();
  await expect(channels).toHaveCount(0);
  // No "Locate": the entry holds a handle.
  await expect(page.getByText("Select the file again to reopen it.")).toHaveCount(0);
  await page.getByRole("button", { name: "Reopen fixture.edf" }).click();
  await expect(channels).toHaveText(["Fp1", "Fp2"]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
