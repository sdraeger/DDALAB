// Recording tabs: switching by click, keys and the quick switcher with each tab's view kept, no refetch of cached
// tiles on a switch back, reordering and closing, the open set across a reload, and reattaching by picker, through
// stored handles (Chromium) and by URL.
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "./test";

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url));
const BRAINVISION = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"];

const tabs = (page: Page) => page.getByRole("tablist", { name: "Open recordings" }).getByRole("tab");
const heading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });
const view = (page: Page) => page.evaluate(() => window.__ddalab.store.getState().view);
const flush = (page: Page) => page.evaluate(() => window.__ddalab.tabs.flush());

/** A folder of three recordings, each in a folder of its own: a/fixture.edf, b/fixture.bdf, c/fixture.vhdr. */
function recordingsFolder() {
  const folder = join(mkdtempSync(join(tmpdir(), "ddalab-tabs-")), "recordings");
  const sets: [string, string[]][] = [
    ["a", ["fixture.edf"]],
    ["b", ["fixture.bdf"]],
    ["c", BRAINVISION],
  ];
  for (const [sub, names] of sets) {
    mkdirSync(join(folder, sub), { recursive: true });
    for (const name of names) copyFileSync(fixturePath(name), join(folder, sub, name));
  }
  return folder;
}

async function openThree(page: Page) {
  const files = page.getByLabel("Recording files");
  await files.setInputFiles(fixturePath("fixture.edf"));
  await expect(heading(page, "fixture.edf")).toBeVisible();
  await files.setInputFiles(fixturePath("fixture.bdf"));
  await expect(heading(page, "fixture.bdf")).toBeVisible();
  await files.setInputFiles(BRAINVISION.map(fixturePath));
  await expect(heading(page, "fixture.vhdr")).toBeVisible();
  await expect(tabs(page)).toHaveText(["fixture.edf", "fixture.bdf", "fixture.vhdr"]);
}

test.beforeEach(async ({ page }) => {
  // Playwright drives no browser picker: every project takes the <input> paths.
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showOpenFilePicker");
    Reflect.deleteProperty(window, "showDirectoryPicker");
  });
});

test("tabs_switch_and_keep_their_view", async ({ page }) => {
  // Requests to the engine's workers for tiles and samples, counted.
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage as (this: Worker, ...args: unknown[]) => void;
    Object.assign(window, { fetched: 0 });
    Worker.prototype.postMessage = function (this: Worker, ...args: unknown[]) {
      const type = (args[0] as { type?: string } | null)?.type;
      if (type === "tile" || type === "raw" || type === "resultTile") {
        (window as unknown as { fetched: number }).fetched++;
      }
      post.apply(this, args);
    } as Worker["postMessage"];
  });
  await page.goto("/");
  await openThree(page);
  await expect(tabs(page).nth(2)).toHaveAttribute("aria-selected", "true");

  // The first tab: a page on, a channel chosen, the channel list filtered.
  await tabs(page).nth(0).click();
  await expect(heading(page, "fixture.edf")).toBeVisible();
  await page.keyboard.press("PageDown");
  await expect.poll(() => view(page)).toMatchObject({ t0: 10, t1: 20 });
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  await page.getByLabel("Search channels").fill("Fp");
  await expect(page.getByText("Overview 100%")).toBeVisible();
  await page.evaluate(() => window.__ddalab.viewer.settled());

  // Alt+3: the third tab, at its own view.
  await page.getByRole("region", { name: "Waveforms" }).focus();
  await page.keyboard.press("Alt+3");
  await expect(tabs(page).nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(heading(page, "fixture.vhdr")).toBeVisible();
  expect(await view(page)).toMatchObject({ t0: 0 });
  await page.evaluate(() => window.__ddalab.viewer.settled());

  // Back to the first: its view, channel and search return, drawn from what the caches hold.
  await page.evaluate(() => Object.assign(window, { fetched: 0 }));
  await page.keyboard.press("Alt+1");
  await expect(heading(page, "fixture.edf")).toBeVisible();
  expect(await view(page)).toMatchObject({ t0: 10, t1: 20 });
  await expect(page.getByRole("checkbox", { name: "Select Fp1" })).toBeChecked();
  await expect(page.getByLabel("Search channels")).toHaveValue("Fp");
  const frame = await page.evaluate(() => window.__ddalab.viewer.settled());
  expect(frame.complete).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { fetched: number }).fetched)).toBe(0);

  // Alt+] and Alt+[ step through the tabs.
  await page.keyboard.press("Alt+BracketRight");
  await expect(heading(page, "fixture.bdf")).toBeVisible();
  await page.keyboard.press("Alt+BracketLeft");
  await expect(heading(page, "fixture.edf")).toBeVisible();

  // In the strip the arrow keys move the focus and Enter activates; they do not page the recording.
  await tabs(page).nth(0).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs(page).nth(1)).toBeFocused();
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
  expect(await view(page)).toMatchObject({ t0: 10 });
  await page.keyboard.press("Enter");
  await expect(heading(page, "fixture.bdf")).toBeVisible();

  // The quick switcher: type to filter, Enter switches.
  await page.keyboard.press("Alt+k");
  const switcher = page.getByRole("dialog", { name: "Switch recording" });
  await expect(switcher.getByRole("option")).toHaveText(["fixture.edf", "fixture.bdf", "fixture.vhdr"]);
  await switcher.getByRole("combobox").fill("vhdr");
  await expect(switcher.getByRole("option")).toHaveText(["fixture.vhdr"]);
  await page.keyboard.press("Enter");
  await expect(switcher).toBeHidden();
  await expect(tabs(page).nth(2)).toHaveAttribute("aria-selected", "true");
  // A shortcut typed into a text field stays text.
  await page.getByLabel("Search channels").focus();
  await page.keyboard.press("Alt+1");
  await expect(tabs(page).nth(2)).toHaveAttribute("aria-selected", "true");
});

test("reorder_by_drag_and_close", async ({ page }) => {
  await page.goto("/");
  await openThree(page);
  // The first tab dragged past the third.
  const first = await tabs(page).nth(0).boundingBox();
  const third = await tabs(page).nth(2).boundingBox();
  if (!first || !third) throw new Error("no tab boxes");
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2 + 20, first.y + 10, { steps: 4 });
  await page.mouse.move(third.x + third.width - 4, third.y + 10, { steps: 8 });
  await page.mouse.up();
  await expect(tabs(page)).toHaveText(["fixture.bdf", "fixture.vhdr", "fixture.edf"]);

  // A middle click closes a tab; the recording stays in the recent list.
  await tabs(page).nth(0).click({ button: "middle" });
  await expect(tabs(page)).toHaveText(["fixture.vhdr", "fixture.edf"]);
  await expect(page.getByRole("button", { name: "Forget fixture.bdf" })).toBeVisible();
  // Delete closes the focused tab, and the next one becomes active.
  await tabs(page).nth(0).click();
  await page.keyboard.press("Delete");
  await expect(tabs(page)).toHaveText(["fixture.edf"]);
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(heading(page, "fixture.edf")).toBeVisible();
  // Close all, from the menu of all tabs.
  await page.getByRole("button", { name: "All tabs" }).click();
  await page
    .getByRole("dialog", { name: "Switch recording" })
    .getByRole("button", { name: "Close all" })
    .click();
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.getByText("Open a recording from the library")).toBeVisible();
  // Closed tabs leave the remembered set.
  await flush(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "Forget fixture.edf" })).toBeVisible();
  await expect(tabs(page)).toHaveCount(0);
});

test("reload_returns_detached_tabs_and_one_folder_reattaches_them", async ({ page }) => {
  const folder = recordingsFolder();
  await page.goto("/");
  const pick = page.getByLabel("Recording folder");
  for (const sub of ["a", "b", "c"]) await pick.setInputFiles(join(folder, sub));
  await expect(tabs(page)).toHaveText(["fixture.edf", "fixture.bdf", "fixture.vhdr"]);
  // The 30 s EDF on its second page.
  await tabs(page).nth(0).click();
  await page.keyboard.press("PageDown");
  await expect.poll(() => view(page)).toMatchObject({ t0: 10 });
  await flush(page);

  await page.reload();
  // The files of an <input> cannot be read again without the user: every tab comes back detached.
  await expect(tabs(page)).toHaveText([
    "fixture.edf, detached",
    "fixture.bdf, detached",
    "fixture.vhdr, detached",
  ]);
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/Choose the folder that holds fixture\.edf/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Channels" })).toHaveCount(0);

  // The folder of all three reattaches all three; the active tab comes back at its view.
  await page.getByLabel("Reattach folder").setInputFiles(folder);
  await expect(tabs(page)).toHaveText(["fixture.edf", "fixture.bdf", "fixture.vhdr"]);
  await expect(heading(page, "fixture.edf")).toBeVisible();
  await expect.poll(() => view(page)).toMatchObject({ t0: 10 });
  await expect(page.getByRole("button", { name: "Reattach" })).toHaveCount(0);
});

test("a_changed_file_stays_detached_with_its_reason", async ({ page }) => {
  const folder = recordingsFolder();
  await page.goto("/");
  const pick = page.getByLabel("Recording folder");
  await pick.setInputFiles(join(folder, "a"));
  await pick.setInputFiles(join(folder, "b"));
  await expect(tabs(page)).toHaveCount(2);
  await flush(page);
  await page.reload();
  await expect(tabs(page)).toHaveText(["fixture.edf, detached", "fixture.bdf, detached"]);
  appendFileSync(join(folder, "b", "fixture.bdf"), Buffer.alloc(16));
  await page.getByLabel("Reattach folder").setInputFiles(folder);
  // The unchanged one reattaches; the changed one stays detached and says why.
  await expect(tabs(page)).toHaveText(["fixture.edf", "fixture.bdf, detached"]);
  await tabs(page).nth(1).click();
  await expect(page.getByRole("alert")).toHaveText("fixture.bdf changed since it was opened");
});

test("url_tabs_reattach_without_a_prompt", async ({ page }) => {
  const bytes = readFileSync(fixturePath("fixture.edf"));
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
    if (!range) return void res.writeHead(200).end(bytes);
    const [a, b] = [Number(range[1]), Math.min(Number(range[2]), bytes.length - 1)];
    res.writeHead(206, { "Content-Range": `bytes ${a}-${b}/${bytes.length}` }).end(bytes.subarray(a, b + 1));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/remote.edf`;
    await page.goto("/");
    const remote = { name: "remote.edf", url, size: bytes.length };
    await page.evaluate((r) => window.__ddalab.open({ kind: "url", files: [r], primary: r.name }), remote);
    await page.getByLabel("Recording files").setInputFiles(fixturePath("fixture.bdf"));
    await expect(tabs(page)).toHaveText(["remote.edf", "fixture.bdf"]);
    await tabs(page).nth(0).click();
    await flush(page);
    await page.reload();
    // The URL recording opens again by itself; the picked file waits for its picker.
    await expect(tabs(page)).toHaveText(["remote.edf", "fixture.bdf, detached"]);
    await expect(heading(page, "remote.edf")).toBeVisible();
    await expect(page.getByRole("list", { name: "Channels" }).getByRole("listitem")).toHaveCount(2);
  } finally {
    server.close();
  }
});

/**
 * Chromium only: FileSystemHandles persist only there. Picked files are stood in for by a real folder handle from the
 * origin private file system (`recordings`, holding a/fixture.edf and b/copy.edf), which IndexedDB stores like any
 * other and whose read permission the browser grants. `prompt` simulates the state of a folder handle on a later
 * visit: queryPermission answers "prompt" until requestPermission, which is counted, is called.
 */
async function stubFolderPicker(page: Page, prompt: boolean) {
  await page.addInitScript(
    ({ base64, prompt }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      // Written once: a file written again would have changed since it was opened.
      const write = async (folder: FileSystemDirectoryHandle, name: string) => {
        if ((await (await folder.getFileHandle(name, { create: true })).getFile()).size > 0) return;
        const writable = await (await folder.getFileHandle(name)).createWritable();
        await writable.write(bytes);
        await writable.close();
      };
      Object.assign(window, {
        requested: 0,
        showDirectoryPicker: async () => {
          const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("recordings", {
            create: true,
          });
          await write(await root.getDirectoryHandle("a", { create: true }), "fixture.edf");
          await write(await root.getDirectoryHandle("b", { create: true }), "copy.edf");
          return root;
        },
      });
      if (!prompt) return;
      type Asking = { queryPermission(): Promise<string>; requestPermission(): Promise<string> };
      const handle = FileSystemHandle.prototype as unknown as Asking;
      let granted = false;
      handle.queryPermission = async () => (granted ? "granted" : "prompt");
      handle.requestPermission = async () => {
        (window as unknown as { requested: number }).requested++;
        granted = true;
        return "granted";
      };
    },
    { base64: readFileSync(fixturePath("fixture.edf")).toString("base64"), prompt },
  );
}

test("granted_handles_reattach_on_their_own_and_one_grant_covers_a_folder", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "FileSystemHandles persist only in Chromium");
  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await stubFolderPicker(page, false);
  await page.goto("/");
  const choose = page.getByRole("group", { name: "Several recordings found" });
  for (const path of ["recordings/a/fixture.edf", "recordings/b/copy.edf"]) {
    await page.getByRole("button", { name: "Open folder" }).click();
    await choose.getByRole("button", { name: path }).click();
    await expect(heading(page, path.split("/").at(-1) as string)).toBeVisible();
  }
  await expect(tabs(page)).toHaveText(["fixture.edf", "copy.edf"]);
  await flush(page);

  // Read access still granted: both reattach with no prompt.
  await page.reload();
  await expect(tabs(page)).toHaveText(["fixture.edf", "copy.edf"]);
  await expect(heading(page, "copy.edf")).toBeVisible();

  // Access lapsed: both come back detached, and one Reattach asks once for the folder that holds both.
  await stubFolderPicker(page, true);
  await page.reload();
  await expect(tabs(page)).toHaveText(["fixture.edf, detached", "copy.edf, detached"]);
  await expect(page.getByText(/It asks once for each folder/)).toBeVisible();
  await page.getByRole("button", { name: "Reattach" }).first().click();
  await expect(tabs(page)).toHaveText(["fixture.edf", "copy.edf"]);
  expect(await page.evaluate(() => (window as unknown as { requested: number }).requested)).toBe(1);
});
