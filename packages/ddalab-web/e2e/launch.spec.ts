// Files the system opens the installed app with. Playwright cannot start a real file-handler launch: that needs the
// installed app and its "Open with" entry. The page's launch queue is replaced by one that keeps the consumer the app
// sets, and the test calls it with handles of files in the origin private file system (reading them needs no prompt,
// and their folder answers `resolve` as a folder on disk does). What is checked: the consumer, the open through the
// existing path with handles, the missing-companions message with its folder action, and the search of a granted
// folder. What is not: that Chromium delivers a launch for the manifest's `file_handlers`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "./test";

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "FileSystemHandles and the launch queue are Chromium's",
);

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url))).toString(
    "base64",
  );

/** A text file of the BrainVision fixture as `second.*`, as base64: its header and marker file name each other. */
const second = (name: string) =>
  Buffer.from(Buffer.from(fixture(name), "base64").toString().replaceAll("fixture.", "second.")).toString(
    "base64",
  );

const channels = (page: Page) =>
  page.getByRole("list", { name: "Channels" }).getByRole("listitem").locator("label");

/** Replaces the launch queue and the folder picker, and writes the fixtures into `study/` of the private file system. */
async function prepare(page: Page) {
  await page.addInitScript(() => {
    const calls = { picks: 0 };
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      value: { setConsumer: (consumer: unknown) => Object.assign(window, { launch: consumer }) },
    });
    Object.assign(window, {
      calls,
      showDirectoryPicker: async () => {
        calls.picks++;
        return (await navigator.storage.getDirectory()).getDirectoryHandle("study");
      },
    });
  });
  await page.goto("/");
  await page.evaluate(
    async (files) => {
      const study = await (await navigator.storage.getDirectory()).getDirectoryHandle("study", {
        create: true,
      });
      for (const [name, base64] of Object.entries(files)) {
        const writable = await (await study.getFileHandle(name, { create: true })).createWritable();
        await writable.write(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
        await writable.close();
      }
    },
    {
      ...Object.fromEntries(
        ["fixture.vhdr", "fixture.eeg", "fixture.vmrk", "fixture.edf"].map((n) => [n, fixture(n)]),
      ),
      "second.vhdr": second("fixture.vhdr"),
      "second.vmrk": second("fixture.vmrk"),
      "second.eeg": fixture("fixture.eeg"),
    },
  );
}

/** One launch of the files named `names` of `study/`. */
const launch = (page: Page, ...names: string[]) =>
  page.evaluate(async (list) => {
    const study = await (await navigator.storage.getDirectory()).getDirectoryHandle("study");
    const files = await Promise.all(list.map((name) => study.getFileHandle(name)));
    (window as unknown as { launch(params: { files: unknown[] }): void }).launch({ files });
  }, names);

const picks = (page: Page) =>
  page.evaluate(() => (window as unknown as { calls: { picks: number } }).calls.picks);

test("a_launched_edf_opens_and_its_tab_reattaches_through_the_launched_handle", async ({ page }) => {
  await prepare(page);
  await launch(page, "fixture.edf");
  await expect(channels(page)).toHaveText(["Fp1", "Fp2"]);
  await expect(page.getByRole("button", { name: "Reopen fixture.edf" })).toBeVisible();
  await page.reload();
  await expect(channels(page)).toHaveText(["Fp1", "Fp2"]);
});

test("the_files_of_one_launch_open_as_one_recording", async ({ page }) => {
  await prepare(page);
  await launch(page, "fixture.vhdr", "fixture.eeg", "fixture.vmrk");
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a_launched_header_alone_offers_the_folder_and_opens_from_it", async ({ page }) => {
  await prepare(page);
  await launch(page, "fixture.vhdr");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("fixture.vhdr names fixture.eeg, which is not among the opened files");
  await expect(channels(page)).toHaveCount(0);
  await alert.getByRole("button", { name: "Open the folder that contains it." }).click();
  // The folder holds the header: its companions come with it, with no tree to choose from.
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("tree")).toHaveCount(0);
  expect(await picks(page)).toBe(1);
});

test("a_launched_header_next_to_a_folder_already_granted_opens_without_asking", async ({ page }) => {
  await prepare(page);
  await launch(page, "fixture.vhdr");
  await page.getByRole("alert").getByRole("button", { name: "Open the folder that contains it." }).click();
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();

  // Another header of the same folder, alone: the open tab's folder is granted and holds it.
  await launch(page, "second.vhdr");
  await expect(page.getByRole("heading", { name: "second.vhdr" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await picks(page)).toBe(1); // the open tab's folder held the file: no second picker
});
