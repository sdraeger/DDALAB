// Recording tabs: switching by click, keys and the quick switcher with each tab's view kept, no refetch of cached
// tiles on a switch back, reordering and closing, the open set across a reload, and reattaching by picker, through
// stored handles (Chromium) and by URL.
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSynthetic, syntheticEdfSize } from "../src/core/synthetic";
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
  const rows = switcher.getByRole("list", { name: "Matching recordings" }).getByRole("listitem");
  await expect(rows).toHaveText(["fixture.edf", "fixture.bdf", "fixture.vhdr"]);
  await switcher.getByRole("searchbox").fill("vhdr");
  await expect(rows).toHaveText(["fixture.vhdr"]);
  await page.keyboard.press("Enter");
  await expect(switcher).toBeHidden();
  await expect(tabs(page).nth(2)).toHaveAttribute("aria-selected", "true");
  // A shortcut typed into a text field stays text.
  await page.getByLabel("Search channels").focus();
  await page.keyboard.press("Alt+1");
  await expect(tabs(page).nth(2)).toHaveAttribute("aria-selected", "true");
});

test("reorder_by_keyboard_and_by_click", async ({ page }) => {
  await page.goto("/");
  await openThree(page);
  // Alt+Shift+[ moves the selected tab left and says where it is now.
  await page.getByRole("region", { name: "Waveforms" }).focus();
  await page.keyboard.press("Alt+Shift+BracketLeft");
  await expect(tabs(page)).toHaveText(["fixture.edf", "fixture.vhdr", "fixture.bdf"]);
  await expect(page.getByText("fixture.vhdr, position 2 of 3")).toBeAttached();
  await page.keyboard.press("Alt+Shift+BracketRight");
  await expect(tabs(page)).toHaveText(["fixture.edf", "fixture.bdf", "fixture.vhdr"]);
  // Move left and Move right in the menu of all tabs, by click.
  await page.getByRole("button", { name: "All tabs" }).click();
  const switcher = page.getByRole("dialog", { name: "Switch recording" });
  await expect(switcher.getByRole("button", { name: "Move fixture.edf left" })).toBeDisabled();
  await switcher.getByRole("button", { name: "Move fixture.edf right" }).click();
  await expect(tabs(page)).toHaveText(["fixture.bdf", "fixture.edf", "fixture.vhdr"]);
  await expect(switcher.getByText("fixture.edf, position 2 of 3")).toBeAttached();
  await switcher.getByRole("button", { name: "Move fixture.vhdr left" }).click();
  await expect(tabs(page)).toHaveText(["fixture.bdf", "fixture.vhdr", "fixture.edf"]);
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

/** An EDF of `name` above 128 KiB in `folder`: an edit in its middle is outside the fingerprint's first and last 64 KiB. */
function largeEdf(folder: string, name: string, seed: number) {
  const spec = { channels: 2, rateHz: 256, durationS: 300, seed };
  const bytes = new Uint8Array(syntheticEdfSize(spec));
  readSynthetic(spec, 0, bytes);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, name), bytes);
  return join(folder, name);
}

test("same_name_and_size_reattach_through_the_hash", async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), "ddalab-tabs-"));
  const [one, two] = [
    largeEdf(join(root, "first"), "one.edf", 1),
    largeEdf(join(root, "first"), "two.edf", 2),
  ];
  await page.goto("/");
  for (const path of [one, two]) await page.getByLabel("Recording files").setInputFiles(path);
  await expect(tabs(page)).toHaveText(["one.edf", "two.edf"]);
  // Each tab keeps its files' SHA-256 once hashed.
  const hashed = () => page.evaluate(() => window.__ddalab.store.getState().tabs.every((t) => t.sha256));
  await expect.poll(hashed, { timeout: 30_000 }).toBe(true);
  await flush(page);
  await page.reload();
  await expect(tabs(page)).toHaveText(["one.edf, detached", "two.edf, detached"]);

  // Another date: a byte-for-byte copy of one, and two with a byte changed in its middle, the size kept.
  const later = join(root, "later");
  mkdirSync(later);
  const copy = join(later, "one.edf");
  copyFileSync(one, copy);
  const edited = readFileSync(two);
  edited[edited.length >> 1] ^= 0xff;
  writeFileSync(join(later, "two.edf"), edited);
  const moved = new Date("2025-01-02T03:04:05Z");
  for (const path of [copy, join(later, "two.edf")]) utimesSync(path, moved, moved);
  await page.getByLabel("Reattach files").setInputFiles([copy, join(later, "two.edf")]);
  // The copy hashes the same and reattaches; the edit stays detached with the reason.
  await expect(tabs(page)).toHaveText(["one.edf", "two.edf, detached"], { timeout: 30_000 });
  await tabs(page).nth(1).click();
  await expect(page.getByRole("alert")).toHaveText("two.edf changed since it was opened");

  // The edit with its first date back attaches at once (name, size, date and fingerprint agree). The hash that
  // follows differs: a file the user picked stays open, with a warning.
  // Seconds with the fraction: browsers round the modification time to milliseconds.
  utimesSync(join(later, "two.edf"), moved, statSync(two).mtimeMs / 1000);
  await page.getByLabel("Reattach files").setInputFiles(join(later, "two.edf"));
  await expect(tabs(page)).toHaveText(["one.edf", "two.edf"]);
  await expect(page.getByRole("list", { name: "Warnings" })).toContainText(
    "two.edf differs from the file this tab had open before",
    { timeout: 30_000 },
  );
  await expect(tabs(page)).toHaveText(["one.edf", "two.edf"]);
});

test("a_run_that_ends_in_another_tab_shows_there", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Recording files").setInputFiles(fixturePath("fixture.edf"));
  await expect(heading(page, "fixture.edf")).toBeVisible();
  await page.evaluate(() =>
    window.__ddalab.openSynthetic({ channels: 2, rateHz: 256, durationS: 60, seed: 3 }),
  );
  await expect(tabs(page)).toHaveText(["fixture.edf", "synthetic.edf"]);
  await page.getByRole("checkbox", { name: "Select group CH" }).check();
  const runBar = page.getByRole("region", { name: "Run" });
  await expect(runBar.getByText(/^Plan /)).toBeVisible();
  // Run, and switch to the EDF's tab in the same task: the run ends while that tab is shown.
  const status = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("section[aria-label='Run'] button"));
    buttons.find((button) => button.textContent?.includes("Run DDA"))?.click();
    document.querySelector<HTMLElement>("[role='tab']")?.click();
    return window.__ddalab.store.getState().run?.status;
  });
  expect(status).toBe("running");
  const last = () => page.evaluate(() => window.__ddalab.store.getState().analyses[0]?.status);
  await expect.poll(last, { timeout: 60_000 }).toBe("complete");
  await expect(heading(page, "fixture.edf")).toBeVisible();
  // The EDF's tab shows nothing of the run's result.
  await expect(page.getByRole("region", { name: "Provenance" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Result" })).toHaveCount(0);
  // Back on its own tab the result is there.
  await tabs(page).nth(1).click();
  await expect(page.getByRole("region", { name: "Result" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Provenance" })).toBeVisible();
});

test("a_result_opened_on_a_detached_tab_shows_alone", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Recording files").setInputFiles(BRAINVISION.map(fixturePath));
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  const runBar = page.getByRole("region", { name: "Run" });
  await expect(runBar.getByText(/^Plan /)).toBeVisible();
  await runBar.getByRole("button", { name: "Run DDA" }).click();
  await expect(runBar.getByText("Complete", { exact: true })).toBeVisible({ timeout: 60_000 });
  // Nothing shown when the page reloads: the tab comes back detached and empty.
  await page.evaluate(() => window.__ddalab.store.setState({ shownResult: null, activeResultId: null }));
  await flush(page);
  await page.reload();
  await expect(tabs(page)).toHaveText(["fixture.vhdr, detached"]);
  await expect(page.getByRole("region", { name: "Result" })).toHaveCount(0);
  // The result from the history shows alone, under one line that keeps Reattach at hand.
  const history = page.getByRole("region", { name: "History" });
  await history.getByRole("button", { name: /^ST on fixture\.vhdr/ }).click();
  await expect(page.getByRole("region", { name: "Result" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reattach", exact: true })).toBeVisible();
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
});

/**
 * Chromium only: FileSystemHandles persist only there. Picked files are stood in for by a real folder handle from the
 * origin private file system (`recordings`, holding a/fixture.edf and b/copy.edf), which IndexedDB stores like any
 * other and whose read permission the browser grants. `answer` simulates the state of a folder handle on a later
 * visit: queryPermission answers "prompt" until requestPermission, which is counted, answers `answer`.
 */
async function stubFolderPicker(page: Page, answer?: "granted" | "denied") {
  await page.addInitScript(
    ({ base64, answer }) => {
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
      if (!answer) return;
      type Asking = { queryPermission(): Promise<string>; requestPermission(): Promise<string> };
      const handle = FileSystemHandle.prototype as unknown as Asking;
      let state = "prompt";
      handle.queryPermission = async () => state;
      handle.requestPermission = async () => {
        (window as unknown as { requested: number }).requested++;
        state = answer;
        return answer;
      };
    },
    { base64: readFileSync(fixturePath("fixture.edf")).toString("base64"), answer },
  );
}

test("granted_handles_reattach_on_their_own_and_one_grant_covers_a_folder", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "FileSystemHandles persist only in Chromium");
  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await stubFolderPicker(page);
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

  // Access lapsed: both come back detached. One click asks once, for the folder of the selected tab, and both
  // reattach, since the folder holds both.
  await stubFolderPicker(page, "granted");
  await page.reload();
  await expect(tabs(page)).toHaveText(["fixture.edf, detached", "copy.edf, detached"]);
  await expect(page.getByText("Reattach to let the browser read copy.edf again.")).toBeVisible();
  await expect(page.getByText("1 more to reattach")).toBeVisible();
  await page.getByRole("button", { name: "Reattach", exact: true }).click();
  await expect(tabs(page)).toHaveText(["fixture.edf", "copy.edf"]);
  expect(await page.evaluate(() => (window as unknown as { requested: number }).requested)).toBe(1);

  // Refused: the tab stays detached with the reason and its Reattach button; no picker opens.
  await stubFolderPicker(page, "denied");
  await page.reload();
  await expect(tabs(page)).toHaveText(["fixture.edf, detached", "copy.edf, detached"]);
  let chooser = false;
  page.on("filechooser", () => {
    chooser = true;
  });
  await page.getByRole("button", { name: "Reattach", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Permission not granted");
  await expect(page.getByRole("button", { name: "Reattach", exact: true })).toBeVisible();
  await expect(tabs(page)).toHaveText(["fixture.edf, detached", "copy.edf, detached"]);
  expect(chooser).toBe(false);
});
