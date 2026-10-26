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
  // With the focus on the tab, the tab keeps it as it moves.
  await tabs(page).nth(1).focus();
  await page.keyboard.press("Alt+Shift+BracketRight");
  await expect(tabs(page)).toHaveText(["fixture.edf", "fixture.bdf", "fixture.vhdr"]);
  await expect(tabs(page).nth(2)).toBeFocused();
  // Move left and Move right in the menu of all tabs, by click; the button pressed keeps the focus, and at an end
  // the focus goes to the row's other Move button.
  await page.getByRole("button", { name: "All tabs" }).click();
  const switcher = page.getByRole("dialog", { name: "Switch recording" });
  const move = (name: string) => switcher.getByRole("button", { name });
  await expect(move("Move fixture.edf left")).toBeDisabled();
  await move("Move fixture.edf right").click();
  await expect(tabs(page)).toHaveText(["fixture.bdf", "fixture.edf", "fixture.vhdr"]);
  await expect(switcher.getByText("fixture.edf, position 2 of 3")).toBeAttached();
  await expect(move("Move fixture.edf right")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tabs(page)).toHaveText(["fixture.bdf", "fixture.vhdr", "fixture.edf"]);
  await expect(move("Move fixture.edf right")).toBeDisabled();
  await expect(move("Move fixture.edf left")).toBeFocused();
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

test("a_tab_closed_while_its_files_are_checked_stays_closed", async ({ page }) => {
  const one = largeEdf(mkdtempSync(join(tmpdir(), "ddalab-tabs-")), "one.edf", 1);
  await page.goto("/");
  await page.getByLabel("Recording files").setInputFiles(one);
  const hashed = () => page.evaluate(() => window.__ddalab.store.getState().tabs.every((t) => t.sha256));
  await expect.poll(hashed, { timeout: 30_000 }).toBe(true);
  await flush(page);
  await page.reload();
  await expect(tabs(page)).toHaveText(["one.edf, detached"]);
  // A copy of another date is picked, which starts its check, and the tab is closed in the same task.
  const verifying = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const picked = new DataTransfer();
    picked.items.add(new File([bytes], "one.edf", { lastModified: Date.UTC(2025, 0, 2) }));
    const input = document.querySelector("input[aria-label='Reattach files']") as HTMLInputElement;
    input.files = picked.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const checking = window.__ddalab.store.getState().tabs[0]?.verifying;
    (document.querySelector("[title='Close one.edf']") as HTMLElement).click();
    return checking;
  }, readFileSync(one).toString("base64"));
  expect(verifying).toBe(true);
  // The check ends without a tab to attach to: none comes back.
  await page.waitForTimeout(1500);
  await expect(tabs(page)).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(window.__ddalab.store.getState().recordings))).toEqual([]);
});

test("a_copy_with_no_digest_attaches_with_a_warning", async ({ page }) => {
  const folder = mkdtempSync(join(tmpdir(), "ddalab-tabs-"));
  const edf = join(folder, "fixture.edf");
  copyFileSync(fixturePath("fixture.edf"), edf);
  await page.goto("/");
  await page.getByLabel("Recording files").setInputFiles(edf);
  await expect(heading(page, "fixture.edf")).toBeVisible();
  // A tab whose files were never hashed (closed too soon, say) keeps no digest: here it is dropped once the scan
  // and the hash are over.
  await expect(page.getByText("Overview 100%")).toBeVisible();
  const hashed = () => page.evaluate(() => window.__ddalab.store.getState().tabs.every((t) => t.sha256));
  await expect.poll(hashed).toBe(true);
  await page.evaluate(() =>
    window.__ddalab.store.setState((s) => ({ tabs: s.tabs.map((t) => ({ ...t, sha256: undefined })) })),
  );
  await flush(page);
  await page.reload();
  const moved = new Date("2025-01-02T03:04:05Z");
  utimesSync(edf, moved, moved);
  await page.getByLabel("Reattach files").setInputFiles(edf);
  // The fingerprint agrees: it attaches, and says that its contents went unchecked.
  await expect(tabs(page)).toHaveText(["fixture.edf"]);
  await expect(page.getByRole("list", { name: "Warnings" })).toContainText(
    "Contents could not be verified; earlier results may not match.",
  );
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
 * Chromium only: FileSystemHandles persist only there. Picked files are stood in for by real handles from the origin
 * private file system, which IndexedDB stores like any other and whose read permission the browser grants: the folder
 * picker gives `recordings`, the file picker every file of `loose`. `files` holds each file's path there and its bytes
 * (base64). `answer` simulates the handles of a later visit: queryPermission answers "prompt" for a handle until
 * requestPermission, which is counted, answers `answer` for it.
 */
async function stubPickers(page: Page, files: Record<string, string>, answer?: "granted" | "denied") {
  await page.addInitScript(
    ({ files, answer }) => {
      const folder = async (path: string[]) => {
        let dir = await navigator.storage.getDirectory();
        for (const name of path) dir = await dir.getDirectoryHandle(name, { create: true });
        return dir;
      };
      // Written once: a file written again would have changed since it was opened.
      const written = (async () => {
        for (const [path, base64] of Object.entries(files)) {
          const parts = path.split("/");
          const name = parts.pop() as string;
          const handle = await (await folder(parts)).getFileHandle(name, { create: true });
          if ((await handle.getFile()).size > 0) continue;
          const writable = await handle.createWritable();
          await writable.write(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
          await writable.close();
        }
      })();
      type Listing = { values(): AsyncIterable<FileSystemFileHandle> };
      Object.assign(window, {
        requested: 0,
        showDirectoryPicker: async () => {
          await written;
          return folder(["recordings"]);
        },
        showOpenFilePicker: async () => {
          await written;
          const handles: FileSystemFileHandle[] = [];
          for await (const handle of ((await folder(["loose"])) as unknown as Listing).values())
            handles.push(handle);
          return handles;
        },
      });
      if (!answer) return;
      type Asking = FileSystemHandle & {
        queryPermission(): Promise<string>;
        requestPermission(): Promise<string>;
      };
      const prototype = FileSystemHandle.prototype as unknown as Asking;
      const allowed = new Set<string>();
      prototype.queryPermission = async function (this: Asking) {
        return allowed.has(this.name) ? "granted" : "prompt";
      };
      prototype.requestPermission = async function (this: Asking) {
        (window as unknown as { requested: number }).requested++;
        if (answer === "granted") allowed.add(this.name);
        return answer;
      };
    },
    { files, answer },
  );
}

const base64Of = (path: string) => readFileSync(path).toString("base64");
const requested = (page: Page) => page.evaluate(() => (window as unknown as { requested: number }).requested);
const hashedTabs = (page: Page) =>
  page.evaluate(() => window.__ddalab.store.getState().tabs.every((t) => t.sha256));

test("granted_handles_reattach_on_their_own_and_one_grant_covers_a_folder", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "FileSystemHandles persist only in Chromium");
  const edf = base64Of(fixturePath("fixture.edf"));
  const files = { "recordings/a/fixture.edf": edf, "recordings/b/copy.edf": edf };
  await stubPickers(page, files);
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
  await stubPickers(page, files, "granted");
  await page.reload();
  await expect(tabs(page)).toHaveText(["fixture.edf, detached", "copy.edf, detached"]);
  await expect(page.getByText("Reattach to let the browser read copy.edf again.")).toBeVisible();
  await expect(page.getByText("1 click left to reattach it. 1 other recording is detached")).toBeVisible();
  await page.getByRole("button", { name: "Reattach", exact: true }).click();
  await expect(tabs(page)).toHaveText(["fixture.edf", "copy.edf"]);
  expect(await requested(page)).toBe(1);

  // Refused: the tab stays detached with the reason and its Reattach button; no picker opens.
  await stubPickers(page, files, "denied");
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

test("loose_files_take_a_click_each", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "FileSystemHandles persist only in Chromium");
  const files = Object.fromEntries(BRAINVISION.map((name) => [`loose/${name}`, base64Of(fixturePath(name))]));
  await stubPickers(page, files);
  await page.goto("/");
  await page.getByRole("button", { name: "Open files" }).click();
  await expect(heading(page, "fixture.vhdr")).toBeVisible();
  await flush(page);
  // Each of the three files asks on a click of its own; the note counts the clicks left.
  await stubPickers(page, files, "granted");
  await page.reload();
  await expect(tabs(page)).toHaveText(["fixture.vhdr, detached"]);
  const left = page.getByText(/left to reattach it/);
  const reattach = page.getByRole("button", { name: "Reattach", exact: true });
  await expect(left).toHaveText("3 clicks left to reattach it");
  await reattach.click();
  await expect(left).toHaveText("2 clicks left to reattach it");
  await reattach.click();
  await expect(left).toHaveText("1 click left to reattach it");
  await reattach.click();
  await expect(tabs(page)).toHaveText(["fixture.vhdr"]);
  expect(await requested(page)).toBe(3);
});

test("a_reattach_refused_on_load_leaves_an_open_from_the_library_open", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "FileSystemHandles persist only in Chromium");
  const big = largeEdf(mkdtempSync(join(tmpdir(), "ddalab-tabs-")), "big.edf", 4);
  await stubPickers(page, { "recordings/a/big.edf": base64Of(big) });
  await page.goto("/");
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(heading(page, "big.edf")).toBeVisible();
  await expect.poll(() => hashedTabs(page), { timeout: 30_000 }).toBe(true);
  await flush(page);
  // Written again with one byte changed in the middle: name, size and fingerprint stay and the date moves (the
  // private file system keeps a file's date through writes in place, and its dates may be whole seconds).
  await page.waitForTimeout(1100);
  const dates = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const folder = await (await root.getDirectoryHandle("recordings")).getDirectoryHandle("a");
    const file = await (await folder.getFileHandle("big.edf")).getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    bytes[bytes.length >> 1] ^= 0xff;
    await folder.removeEntry("big.edf");
    const writable = await (await folder.getFileHandle("big.edf", { create: true })).createWritable();
    await writable.write(bytes);
    await writable.close();
    return [file.lastModified, (await (await folder.getFileHandle("big.edf")).getFile()).lastModified];
  });
  expect(dates[1]).not.toBe(dates[0]);
  // On load the handle is readable: the check finds another SHA-256 and the tab stays detached.
  await page.reload();
  await expect(page.getByRole("alert")).toHaveText("big.edf changed since it was opened", {
    timeout: 30_000,
  });
  await expect(tabs(page)).toHaveText(["big.edf, detached"]);
  // The user opens the file from the library: it attaches to its tab and stays open, with a warning.
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.getByRole("list", { name: "Warnings" })).toContainText(
    "big.edf differs from the file this tab had open before",
    { timeout: 30_000 },
  );
  await expect(tabs(page)).toHaveText(["big.edf"]);
});
