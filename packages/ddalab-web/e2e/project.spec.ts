// Projects (.ddalab): a workspace of two recordings (one BrainVision) with annotations, chosen channels, views and a
// result is exported, and opened in a fresh browser context, where the same recording bytes, annotations, choices,
// views and result bundle come back. A plain zip reader reads the archive, every entry stored. A reload reattaches the
// tabs from the same project, and a run on a project's recording records the input hashes of the loose files. Open
// With hands the installed app a project's handle, which its tab keeps.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, hasStorage, NO_STORAGE, type Page, test } from "./test";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url));
const BRAINVISION = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"];
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const tabsOf = (page: Page) => page.getByRole("tablist", { name: "Open recordings" }).getByRole("tab");
const runBar = (page: Page) => page.getByRole("region", { name: "Run" });
const editor = (page: Page) => page.getByRole("dialog");

/** Pages without the browser's own pickers and Save dialog: files come from inputs, exports are downloads. */
async function start(page: Page) {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showOpenFilePicker");
    Reflect.deleteProperty(window, "showSaveFilePicker");
  });
  await page.goto("/");
}

/** Annotates the span `t0..t1` of the active recording with `label`, through Annotate and its editor. */
async function annotate(page: Page, t0: number, t1: number, label: string) {
  await page.evaluate((selection) => window.__ddalab.store.setState({ selection }), { t0, t1 });
  await page.getByRole("button", { name: "Annotate" }).click();
  await editor(page).getByLabel("Label").fill(label);
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeHidden();
}

/** Runs ST on the chosen channels from 1 s to 5 s; the result's input SHA-256 by file. */
async function run(page: Page) {
  await page.evaluate(() => window.__ddalab.store.setState({ selection: { t0: 1, t1: 5 } }));
  await expect(runBar(page).getByLabel("End", { exact: true })).toHaveValue("5");
  await expect(runBar(page).getByText(/^Plan /)).toBeVisible();
  await runBar(page).getByRole("button", { name: "Run DDA" }).click();
  await expect(runBar(page).getByText("Complete", { exact: true })).toBeVisible({ timeout: 60_000 });
  return page.evaluate(() => {
    const { analyses, run } = window.__ddalab.store.getState();
    return analyses.find((a) => a.id === run?.id)?.manifest?.reproduction.input_sha256;
  });
}

/** Exports the open tabs once the panel says it holds `holds`, as a download; the saved file's path. */
async function exportProject(page: Page, holds: RegExp) {
  await page.getByRole("button", { name: "Export project" }).click();
  const panel = page.getByRole("dialog", { name: "Export project" });
  await expect(panel.getByText(holds)).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    panel.getByRole("button", { name: "Save project" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^project-\d{4}-\d{2}-\d{2}\.ddalab$/);
  const path = join(mkdtempSync(join(tmpdir(), "ddalab-project-")), download.suggestedFilename());
  await download.saveAs(path);
  return path;
}

/**
 * What each tab shows, in order, and the selected one: the selected tab's view, selection and channels as the store has
 * them now, the others' as they saved them; the user's annotations of each; the complete results and their batches.
 */
const workspace = (page: Page) =>
  page.evaluate(() => {
    const s = window.__ddalab.store.getState();
    const tabs = s.tabs.map(({ fingerprint, name, saved }) => {
      const recording = Object.values(s.recordings).find((r) => r.fingerprint === fingerprint);
      const { mmPerCssMm: _, ...view } = s.view;
      const shown =
        fingerprint === s.activeTab
          ? { view, selection: s.selection, channels: recording?.selectedChannels }
          : { view: saved?.view, selection: saved?.selection, channels: saved?.selectedChannels };
      const annotations = [...(s.annotations[fingerprint] ?? [])].sort((a, b) => a.onset_s - b.onset_s);
      return { fingerprint, name, ...shown, annotations };
    });
    const results = s.analyses
      .filter((a) => a.status === "complete")
      .map(({ id, fingerprint, fileName, inputFiles }) => ({ id, fingerprint, fileName, inputFiles }));
    return { tabs, active: s.activeTab, results };
  });

/** The SHA-256 of every file of each open recording, by fingerprint, once the hash worker has them all. */
const hashes = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      Object.values(window.__ddalab.store.getState().recordings).map((r) => [
        r.fingerprint,
        r.scan.sha256 ?? {},
      ]),
    ),
  );

/** The SHA-256 of each file of the stored bundle of result `id`, by its path in the bundle. */
const bundle = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("results");
    const folder = await root.getDirectoryHandle(id);
    const read = async (path: string) => {
      let at = folder;
      const names = path.split("/");
      for (const name of names.slice(0, -1)) at = await at.getDirectoryHandle(name);
      return (await (await at.getFileHandle(names[names.length - 1])).getFile()).arrayBuffer();
    };
    const manifest = JSON.parse(new TextDecoder().decode(await read("manifest.json")));
    const paths: string[] = [
      "manifest.json",
      ...manifest.variants.flatMap((v: { arrays: string[] }) => v.arrays),
    ];
    const found: Record<string, string> = {};
    for (const path of paths) {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await read(path)));
      found[path] = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
    }
    return found;
  }, id);

test("a_project_opens_elsewhere_as_it_was_exported", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await start(page);
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  const files = page.getByLabel("Recording files");

  // The EDF fixture: a channel chosen, a span annotated, a view of its own.
  await files.setInputFiles(fixture("fixture.edf"));
  await expect(page.getByRole("heading", { name: "fixture.edf" })).toBeVisible();
  await page
    .getByRole("list", { name: "Channels" })
    .getByRole("checkbox", { name: /^Select / })
    .last()
    .check();
  await annotate(page, 3, 4, "spindle");
  await page.evaluate(() => window.__ddalab.store.setState((s) => ({ view: { ...s.view, t0: 10, t1: 20 } })));

  // The BrainVision fixture: Fp1 and Fp2 chosen, a point annotated, an ST run on them.
  await files.setInputFiles(BRAINVISION.map(fixture));
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  await page.getByRole("checkbox", { name: "Select Fp2" }).check();
  const settings = page.getByRole("region", { name: "DDA settings" });
  for (const variant of ["ST", "CT", "CD", "DE", "SY"]) {
    await settings.getByRole("checkbox", { name: variant, exact: true }).setChecked(variant === "ST");
  }
  await annotate(page, 2.5, 2.5, "artifact");
  const inputs = await run(page);
  const before = await workspace(page);
  expect(before.tabs.map((t) => t.name)).toEqual(["fixture.edf", "fixture.vhdr"]);
  expect(before.results).toHaveLength(1);

  const path = await exportProject(page, /^2 recordings, 1 result: /);
  const name = basename(path);

  // A plain zip reader: every entry stored, the recordings and the bundle as they were, project.json naming them.
  const listing = JSON.parse(
    execFileSync("python3", [
      "-c",
      "import json, sys, zipfile\n" +
        "z = zipfile.ZipFile(sys.argv[1])\n" +
        "print(json.dumps({i.filename: [i.compress_type, z.read(i).hex()] for i in z.infolist()}))",
      path,
    ]).toString(),
  ) as Record<string, [number, string]>;
  expect(Object.values(listing).every(([method]) => method === 0)).toBe(true);
  const unpacked = (name: string) => Buffer.from(listing[name][1], "hex");
  expect(unpacked("recordings/0/fixture.edf").equals(readFileSync(fixture("fixture.edf")))).toBe(true);
  for (const name of BRAINVISION) {
    expect(unpacked(`recordings/1/${name}`).equals(readFileSync(fixture(name))), name).toBe(true);
  }
  const id = before.results[0].id;
  const stored = await bundle(page, id);
  for (const [name, digest] of Object.entries(stored)) {
    expect(sha256(unpacked(`results/${id}/${name}`)), name).toBe(digest);
  }
  const project = JSON.parse(unpacked("project.json").toString());
  expect(project).toMatchObject({ schema: "ddalab.project/1", active_tab: before.active });
  expect(project.recordings[1].files.map((f: { sha256: string }) => f.sha256)).toEqual(
    BRAINVISION.map((name) => sha256(readFileSync(fixture(name)))),
  );

  // A fresh browser context opens it: tabs, annotations, choices, views, the result and its bundle.
  const elsewhere = await browser.newContext();
  const other = await elsewhere.newPage();
  await start(other);
  await other.getByLabel("Recording files").setInputFiles(path);
  await expect(tabsOf(other)).toHaveCount(2);
  const expected = Object.fromEntries(
    before.tabs.map((t, k) => [
      t.fingerprint,
      Object.fromEntries(
        project.recordings[k].files.map((f: { name: string }) => [
          f.name,
          sha256(readFileSync(fixture(f.name))),
        ]),
      ),
    ]),
  );
  await expect.poll(() => hashes(other), { timeout: 30_000 }).toEqual(expected);
  // A recording reads its annotations from IndexedDB once it has opened: what it shows settles after its hashes.
  await expect.poll(() => workspace(other)).toEqual(before);
  expect(await bundle(other, id)).toEqual(stored);

  // Opened again, it adds nothing twice: the same tabs, annotations and result. The library says Opening until it is.
  await other.evaluate(() => {
    const opened = new Promise<void>((resolve) => {
      let seen = false;
      new MutationObserver((_, observer) => {
        const shown = [...document.querySelectorAll("p[aria-live]")].some((p) => p.textContent === "Opening");
        seen ||= shown;
        if (seen && !shown) {
          observer.disconnect();
          resolve();
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    Object.assign(window, { opened });
  });
  await other.getByLabel("Recording files").setInputFiles(path);
  await other.evaluate(() => (window as unknown as { opened: Promise<void> }).opened);
  expect(await workspace(other)).toEqual(before);

  // A reload finds the tabs detached; choosing the same project reattaches both.
  await other.reload();
  await expect(tabsOf(other)).toHaveCount(2);
  await expect(
    other.getByText(`Choose ${name}, the project that holds fixture.vhdr, to reattach it.`),
  ).toBeVisible();
  await other.getByLabel("Reattach files").setInputFiles(path);
  await expect.poll(() => hashes(other), { timeout: 30_000 }).toEqual(expected);
  await expect.poll(() => workspace(other)).toEqual(before);

  // A run on the project's recording records the digests of the loose files.
  expect(await run(other)).toEqual(inputs);

  // A copy saved over the project with more in it and its recordings in another order: after a reload, choosing it
  // reattaches both tabs, each finding its recording by its content.
  await annotate(other, 6, 7, "updated");
  await other.evaluate(() => window.__ddalab.store.setState((s) => ({ tabs: [...s.tabs].reverse() })));
  const after = await workspace(other);
  expect(after.results).toHaveLength(2);
  copyFileSync(await exportProject(other, /^2 recordings, 2 results: /), path);
  await other.reload();
  await expect(tabsOf(other)).toHaveCount(2);
  await other.getByLabel("Reattach files").setInputFiles(path);
  await expect.poll(() => hashes(other), { timeout: 30_000 }).toEqual(expected);
  await expect.poll(() => workspace(other)).toEqual(after);
  await elsewhere.close();
});

/** The recordings open now. */
const opened = (page: Page) =>
  page.evaluate(() => Object.keys(window.__ddalab.store.getState().recordings).length);

// Open With hands the installed app the project's handle (the launch queue, replaced here by one the test calls, as in
// launch.spec.ts); the tab keeps it, and a reload reattaches through it without a picker.
test("a_launched_project_reattaches_through_its_handle", async ({ page, browser, browserName }) => {
  test.skip(browserName !== "chromium", "FileSystemHandles and the launch queue are Chromium's");
  await start(page);
  await page.getByLabel("Recording files").setInputFiles(fixture("fixture.edf"));
  await expect(page.getByRole("heading", { name: "fixture.edf" })).toBeVisible();
  const path = await exportProject(page, /^1 recording, 0 results: /);
  const elsewhere = await browser.newContext();
  const other = await elsewhere.newPage();
  await other.addInitScript(() =>
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      value: { setConsumer: (consumer: unknown) => Object.assign(window, { launch: consumer }) },
    }),
  );
  await start(other);
  await other.waitForFunction(() => "launch" in window);
  await other.evaluate(async (base64) => {
    const root = await navigator.storage.getDirectory();
    const writable = await (await root.getFileHandle("study.ddalab", { create: true })).createWritable();
    await writable.write(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
    await writable.close();
    const launch = (window as unknown as { launch(params: { files: FileSystemHandle[] }): void }).launch;
    launch({ files: [await root.getFileHandle("study.ddalab")] });
  }, readFileSync(path).toString("base64"));
  await expect(tabsOf(other)).toHaveCount(1);
  await expect.poll(() => opened(other)).toBe(1);
  await other.evaluate(() => window.__ddalab.tabs.flush());
  await other.reload();
  await expect(tabsOf(other)).toHaveCount(1);
  await expect.poll(() => opened(other)).toBe(1);
  await elsewhere.close();
});

/** `path`'s project with the bytes `data` of its entry `entry` changed by the Python lines `edit`, stored; its path. */
function rewritten(path: string, entry: string, edit: string) {
  const crafted = join(mkdtempSync(join(tmpdir(), "ddalab-crafted-")), basename(path));
  const lines = edit
    .split("\n")
    .map((line) => `      ${line}\n`)
    .join("");
  execFileSync("python3", [
    "-c",
    "import json, sys, zipfile\n" +
      "with zipfile.ZipFile(sys.argv[1]) as a, zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_STORED) as b:\n" +
      "  for i in a.infolist():\n" +
      "    data = a.read(i)\n" +
      "    if i.filename == sys.argv[3]:\n" +
      lines +
      "    b.writestr(i.filename, data)",
    path,
    crafted,
    entry,
  ]);
  return crafted;
}

/** `path`'s project with its project.json `p` changed by the Python expression `edit`; its path. */
const reworded = (path: string, edit: string) =>
  rewritten(path, "project.json", `p = json.loads(data)\n${edit}\ndata = json.dumps(p).encode()`);

/** `path`'s project with the SHA-256 its project.json lists for its first file replaced; its path. */
const misdigested = (path: string) => reworded(path, "p['recordings'][0]['files'][0]['sha256'] = '0' * 64");

/** `path`'s project with one digit in the middle of its entry `entry` changed, its size and edges kept; its path. */
const altered = (path: string, entry: string) =>
  rewritten(
    path,
    entry,
    "k = len(data) // 2\n" +
      "while not data[k:k + 1].isdigit(): k += 1\n" +
      "data = data[:k] + (b'1' if data[k:k + 1] != b'1' else b'2') + data[k + 1:]",
  );

/** A text recording longer than the fingerprint's two 64 KiB edges, in a folder of its own; its path. */
function longCsv() {
  const rows = Array.from({ length: 20_000 }, (_, i) => `${(i / 250).toFixed(3)},${i % 100}.5,${i % 37}.5`);
  const path = join(mkdtempSync(join(tmpdir(), "ddalab-long-")), "long.csv");
  writeFileSync(path, `time,A,B\n${rows.join("\n")}\n`);
  return path;
}

const chosenOnly = (page: Page) => page.getByRole("button", { name: "Show chosen channels only" });

// 2.0.1's "Show chosen channels only" is part of a tab's view: it goes along with a project and comes back on. A
// project written before it has no such field, and its tabs show every channel, whatever the tab left showed.
test("chosen_only_travels_with_a_project", async ({ page, browser }) => {
  await start(page);
  await page.getByLabel("Recording files").setInputFiles(fixture("fixture.edf"));
  await expect(page.getByRole("heading", { name: "fixture.edf" })).toBeVisible();
  await page
    .getByRole("list", { name: "Channels" })
    .getByRole("checkbox", { name: /^Select / })
    .last()
    .check();
  await chosenOnly(page).click();
  await expect(chosenOnly(page)).toHaveAttribute("aria-pressed", "true");
  const path = await exportProject(page, /^1 recording, 0 results: /);

  const elsewhere = await browser.newContext();
  const other = await elsewhere.newPage();
  await start(other);
  await other.getByLabel("Recording files").setInputFiles(path);
  await expect(other.getByRole("heading", { name: "fixture.edf" })).toBeVisible();
  await expect(chosenOnly(other)).toHaveAttribute("aria-pressed", "true");
  await elsewhere.close();

  const before = await browser.newContext();
  const older = await before.newPage();
  await start(older);
  await older.getByLabel("Recording files").setInputFiles(BRAINVISION.map(fixture));
  await expect(older.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
  await older.getByRole("checkbox", { name: "Select Fp1" }).check();
  await chosenOnly(older).click();
  await expect(chosenOnly(older)).toHaveAttribute("aria-pressed", "true");
  const views = "[r['saved']['view'].pop('chosenOnly') for r in p['recordings'] if r['saved']]";
  await older.getByLabel("Recording files").setInputFiles(reworded(path, views));
  await expect(older.getByRole("heading", { name: "fixture.edf" })).toBeVisible();
  await expect(chosenOnly(older)).toHaveAttribute("aria-pressed", "false");
  await before.close();
});

// A project whose copy of a recording has the fingerprint of the user's (the name, the size and both 64 KiB edges) and
// even lists the user's SHA-256, over other bytes in the middle: the project's bytes are hashed before anything joins,
// and with the user's tab open or detached, the tab, its source and its annotations stay as they are, nothing of that
// recording is added, and the user reads what happened and what to do. Without a tab here, a project whose listed
// SHA-256 its bytes do not have opens, and the hash then detaches it as damaged or altered.
test("a_project_never_takes_a_recording_whose_files_differ", async ({ page, browser }) => {
  const csv = longCsv();
  await start(page);
  await page.getByLabel("Recording files").setInputFiles(csv);
  await expect(page.getByRole("heading", { name: "long.csv" })).toBeVisible();
  await annotate(page, 3, 4, "theirs");
  const path = await exportProject(page, /^1 recording, 0 results: /);
  const crafted = altered(path, "recordings/0/long.csv");
  const fingerprint = await page.evaluate(() => window.__ddalab.store.getState().tabs[0].fingerprint);

  const mine = await browser.newContext();
  const here = await mine.newPage();
  await start(here);
  await here.getByLabel("Recording files").setInputFiles(csv);
  await expect.poll(() => hashes(here)).toEqual({ [fingerprint]: { "long.csv": sha256(readFileSync(csv)) } });
  const refusal =
    `long.csv was not opened from ${basename(crafted)}: it has the name, size, start and end of the long.csv ` +
    "already in a tab here, but other contents. The project's annotations and results for it were not added. To " +
    "use the project's copy instead, close the tab of long.csv and open the project again.";
  const state = () =>
    here.evaluate((fp) => {
      const s = window.__ddalab.store.getState();
      return {
        sources: s.tabs.map((t) => t.source?.kind),
        open: Object.keys(s.recordings).length,
        annotations: s.annotations[fp] ?? [],
      };
    }, fingerprint);
  for (const open of [1, 0]) {
    await here.getByLabel("Recording files").setInputFiles(crafted);
    await expect(here.getByRole("alert").filter({ hasText: "was not opened" })).toHaveText(refusal);
    expect(await state()).toEqual({ sources: ["files"], open, annotations: [] });
    // Next the user's tab is detached, as after a reload where its file is not readable yet.
    await here.evaluate(() => window.__ddalab.tabs.flush());
    await here.reload();
    await expect(tabsOf(here)).toHaveCount(1);
  }
  await mine.close();

  const fresh = await browser.newContext();
  const there = await fresh.newPage();
  await start(there);
  const listed = misdigested(path);
  await there.getByLabel("Recording files").setInputFiles(listed);
  await expect(
    there.getByText(
      `long.csv in ${basename(listed)} does not have the SHA-256 that the project lists for it: ` +
        "the project is damaged or was altered",
    ),
  ).toBeVisible({ timeout: 30_000 });
  expect(await opened(there)).toBe(0);
  await fresh.close();
});
