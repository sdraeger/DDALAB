// The installable app on the production build: its manifest, and the service worker that keeps the app for offline use
// and offers an update. Chromium only (Playwright's Firefox and WebKit differ in worker and offline support). The
// worker is registered at the app's folder, under /~user/ddalab/ and under /DDALAB/ alike.
import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
// @ts-expect-error The build step of the worker is plain JavaScript without declarations.
import { bakeServiceWorker, precacheOf } from "../scripts/precache.mjs";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const SERVER = fileURLToPath(new URL("../scripts/serve-dist.mjs", import.meta.url));
const BRAINVISION = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"].map((name) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url)),
);

test.skip(({ browserName }) => browserName !== "chromium", "service workers are checked in Chromium");

/** Waits until the worker controls the page: it has installed (every file is cached) and activated. */
const controlled = (page: Page) =>
  expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null))
    .not.toBeNull();

type RunHold = { holdRun(): void; releaseRun(): void };

const text = (page: Page, url: string) => page.evaluate((u) => fetch(u).then((r) => r.text()), url);

test("the_manifest_is_linked_and_valid", async ({ page }) => {
  await page.goto("./");
  const link = await page.locator('link[rel="manifest"]').getAttribute("href");
  const url = new URL(link as string, page.url());
  const response = await page.request.get(url.href);
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: "DDALAB",
    short_name: "DDALAB",
    start_url: "./",
    scope: "./",
    display: "standalone",
    theme_color: "#F1F3F5",
    background_color: "#F1F3F5",
  });
  // No id: the app's identity is its start URL, the folder it is served from.
  expect(manifest).not.toHaveProperty("id");
  expect(manifest.launch_handler).toEqual({ client_mode: "focus-existing" });
  // The page's own folder is the start and the scope, whatever path it is served from.
  expect(new URL(manifest.start_url, url).href).toBe(new URL("./", page.url()).href);
  expect(new URL(manifest.scope, url).href).toBe(new URL("./", page.url()).href);
  expect(manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`)).toEqual([
    "192x192 any",
    "512x512 any",
    "512x512 maskable",
  ]);
  for (const icon of manifest.icons) {
    const image = await page.request.get(new URL(icon.src, url).href);
    expect(image.status()).toBe(200);
    const png = await image.body();
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
  }
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
});

test("the_worker_controls_the_page_after_the_first_load_at_the_apps_folder", async ({ page }, testInfo) => {
  await page.goto("./");
  await controlled(page);
  const folder = new URL("./", page.url()).href;
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${folder}sw.js`);
  const scope = await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.scope));
  expect(scope).toBe(folder);
  // Under /DDALAB/ (the pages-* projects) it is that folder; the other host is the userdir path.
  if (!process.env.DIST_URL)
    expect(scope).toMatch(
      testInfo.project.name.startsWith("pages-") ? /\/DDALAB\/$/ : /\/~user\/ddalab\/$/,
    );
  // The page's files now come from the worker's cache.
  const script = await page.locator('script[type="module"]').getAttribute("src");
  const served = page.waitForResponse((r) => r.url() === new URL(script as string, page.url()).href);
  await text(page, new URL(script as string, page.url()).href);
  expect((await served).fromServiceWorker()).toBe(true);
});

test("the_app_opens_a_recording_offline", async ({ page, context }) => {
  const failed: string[] = [];
  page.on("requestfailed", (request) => failed.push(request.url()));
  await page.goto("./");
  await controlled(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "DDALAB" })).toBeVisible();
  await page.getByLabel("Recording files").setInputFiles(BRAINVISION);
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(failed).toEqual([]);
});

test("other_origins_and_unlisted_files_are_not_served_from_the_cache", async ({ page }) => {
  let reached = 0;
  await page.route("https://openneuro.org/**", (route) =>
    route.fulfill({ body: `network ${++reached}`, headers: { "Access-Control-Allow-Origin": "*" } }),
  );
  await page.goto("./");
  await controlled(page);
  // A file of the build, asked for by another origin under the same path: the network answers, every time.
  const script = (await page.locator('script[type="module"]').getAttribute("src")) as string;
  const foreign = new URL(script, "https://openneuro.org/").href;
  expect(await text(page, foreign)).toBe("network 1");
  expect(await text(page, foreign)).toBe("network 2");
  // A file of this origin that is not in the build is not invented by the cache.
  const missing = await page.evaluate(() => fetch("./assets/not-in-the-build.js").then((r) => r.status));
  expect(missing).toBe(404);
});

// Updates need a build to change: a copy of dist/ in a folder of its own, on a server of its own.
test.describe("updates", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      browserName !== "chromium" || testInfo.project.name !== "chromium" || Boolean(process.env.DIST_URL),
      "one run, against the local build",
    );
  });

  const freePort = () =>
    new Promise<number>((resolve) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as { port: number };
        probe.close(() => resolve(port));
      });
    });

  let folder: string;
  let server: ChildProcess;
  /** Serves a copy of dist/ at the root of a fresh origin. */
  async function serveCopy() {
    folder = mkdtempSync(join(tmpdir(), "ddalab-pwa-"));
    const site = join(folder, "site");
    cpSync(DIST, site, { recursive: true });
    const port = await freePort();
    server = spawn(process.execPath, [SERVER, String(port), "/"], {
      env: { ...process.env, DIST_DIR: site },
      stdio: "ignore",
    });
    const origin = `http://127.0.0.1:${port}`;
    await expect
      .poll(() =>
        fetch(origin).then(
          (r) => r.ok,
          () => false,
        ),
      )
      .toBe(true);
    return { origin, site };
  }
  test.afterEach(() => {
    server?.kill();
    if (folder) rmSync(folder, { recursive: true, force: true });
  });

  /** The entry style sheet of the build in `site`, as a path from its root. */
  const sheetOf = (site: string) =>
    /href="\.\/(assets\/[^"]+\.css)"/.exec(readFileSync(join(site, "index.html"), "utf8"))?.[1] as string;

  /**
   * Changes the entry style sheet of the build in `site` and bakes the worker again: a new build of the same app, whose
   * version is returned. With `drop`, the lazy chunks of the About panel are gone from it, as the files of an older
   * build are from a host after a deploy.
   */
  function rebuild(site: string, mark: string, drop = false) {
    const path = join(site, sheetOf(site));
    writeFileSync(path, `${readFileSync(path, "utf8")}\n/* ${mark} */`);
    if (drop)
      for (const name of readdirSync(join(site, "assets")).filter((n) => /^About-.*\.(js|css)$/.test(n)))
        rmSync(join(site, "assets", name));
    bakeServiceWorker(site);
    return precacheOf(site).version as string;
  }
  const updateCheck = (page: Page) =>
    page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
  /** The caches of the builds, in creation order. The marker cache that records the active build is left out. */
  const cacheNames = (page: Page) =>
    page
      .evaluate(() => caches.keys().then((names) => names.filter((name) => name.startsWith("ddalab:"))))
      .catch(() => null);

  const notice = (page: Page, text = "A new version of DDALAB is ready.") =>
    page.getByRole("status").filter({ hasText: text });

  test("a_new_build_shows_the_prompt_and_reload_switches_to_it", async ({ page }) => {
    const { origin, site } = await serveCopy();
    const sheet = `${origin}/${sheetOf(site)}`;
    const name = (version: string) => `ddalab:${origin}/:${version}`;
    const loads: string[] = [];
    page.on("load", () => loads.push(page.url()));
    await page.goto(`${origin}/`);
    await controlled(page);
    const a = precacheOf(site).version;
    expect(await cacheNames(page)).toEqual([name(a)]);
    expect(await text(page, sheet)).not.toContain("build B");
    await expect(page.getByText("A new version of DDALAB")).toHaveCount(0);

    const b = rebuild(site, "build B");
    await updateCheck(page);
    await expect(notice(page)).toBeVisible();
    // Until Reload the page keeps the files of the version it started with.
    expect(await text(page, sheet)).not.toContain("build B");

    const before = loads.length;
    await notice(page).getByRole("button", { name: "Reload" }).click();
    await expect.poll(() => loads.length - before).toBe(1);
    // The previous version's cache stays when a window was open as the new one took over.
    expect(await cacheNames(page)).toEqual([name(a), name(b)]);
    expect(await text(page, sheet)).toContain("build B");
    await expect(page.getByRole("heading", { name: "DDALAB" })).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(loads.length - before).toBe(1);

    // The next version takes over: the cache of the version before the previous one goes.
    const c = rebuild(site, "build C");
    await updateCheck(page);
    await notice(page).getByRole("button", { name: "Reload" }).click();
    await expect.poll(() => loads.length - before).toBe(2);
    expect(await cacheNames(page)).toEqual([name(b), name(c)]);
  });

  test("a_window_that_has_not_reloaded_keeps_working_and_is_offered_the_reload", async ({ context }) => {
    const { origin, site } = await serveCopy();
    const [first, second] = [await context.newPage(), await context.newPage()];
    for (const page of [first, second]) {
      await page.goto(`${origin}/`);
      await controlled(page);
    }
    // Set after the load: a reload would lose it.
    await second.evaluate(() => Object.assign(window, { sameDocument: true }));

    const b = rebuild(site, "build B", true);
    await updateCheck(first);
    await expect(notice(first)).toBeVisible();
    await expect(notice(second)).toBeVisible();
    await notice(first).getByRole("button", { name: "Reload" }).click();
    await expect.poll(() => cacheNames(first)).toContain(`ddalab:${origin}/:${b}`);
    await expect(first.getByRole("heading", { name: "DDALAB" })).toBeVisible();

    // The second window is still on the old page under the new worker. Its notice stays, it loads the About chunk that
    // left the build from the cache of the old version, and its Reload reloads it at once.
    await expect(notice(second)).toBeVisible();
    await second.getByRole("button", { name: "About DDALAB" }).click();
    await expect(second.getByRole("dialog", { name: "About DDALAB" })).toBeVisible();
    await expect(second.getByRole("alert")).toHaveCount(0);
    await second.keyboard.press("Escape");
    await notice(second).getByRole("button", { name: "Reload" }).click();
    await expect.poll(() => second.evaluate(() => "sameDocument" in window).catch(() => true)).toBe(false);
    await expect(second.getByRole("heading", { name: "DDALAB" })).toBeVisible();
    await expect(notice(second)).toHaveCount(0);
  });

  test("an_open_window_looks_for_a_new_version_every_hour", async ({ page }) => {
    const { origin, site } = await serveCopy();
    await page.clock.install();
    await page.goto(`${origin}/`);
    await controlled(page);
    rebuild(site, "build B");
    await page.clock.fastForward("01:00:05");
    await expect(notice(page)).toBeVisible();
  });

  test("reload_waits_for_a_run_to_end", async ({ page }) => {
    const { origin, site } = await serveCopy();
    // The IO worker's plan of a run is held back once holdRun() is called, until releaseRun(): the run stays in progress.
    await page.addInitScript(() => {
      const held: (() => void)[] = [];
      const post = Worker.prototype.postMessage;
      const state = { hold: false };
      Object.defineProperty(Worker.prototype, "postMessage", {
        writable: true,
        configurable: true,
        value(this: Worker, ...args: unknown[]) {
          const send = () => Reflect.apply(post, this, args);
          if (state.hold && (args[0] as { type?: string } | undefined)?.type === "plan") held.push(send);
          else send();
        },
      });
      Object.assign(window, {
        holdRun: () => {
          state.hold = true;
        },
        releaseRun: () => {
          state.hold = false;
          for (const send of held.splice(0)) send();
        },
      });
    });
    await page.goto(`${origin}/`);
    await controlled(page);
    // Set after the load: a reload would lose it.
    await page.evaluate(() => Object.assign(window, { sameDocument: true }));
    await page.getByLabel("Recording files").setInputFiles(BRAINVISION);
    await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
    const run = page.getByRole("region", { name: "Run" });
    await page.getByRole("checkbox", { name: "Select Fp1" }).check();
    await page.getByRole("checkbox", { name: "Select Fp2" }).check();
    await run.getByLabel("Start", { exact: true }).fill("1");
    await run.getByLabel("End", { exact: true }).fill("5");
    await run.getByLabel("End", { exact: true }).press("Enter");
    await page.evaluate(() => (window as unknown as RunHold).holdRun());
    await run.getByRole("button", { name: "Run DDA" }).click();

    const b = rebuild(site, "build B");
    await updateCheck(page);
    await expect(notice(page, "will be ready after the run")).toBeVisible();
    const reload = page.getByRole("status").getByRole("button", { name: "Reload" });
    await reload.click();
    await expect(notice(page, "reloads when the run ends")).toBeVisible();
    // The button stays, with the focus, and a second press does nothing.
    await expect(reload).toBeFocused();
    await page.keyboard.press("Enter");
    // The page and the old version stay while the run is under way.
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => "sameDocument" in window)).toBe(true);
    expect(await cacheNames(page)).toHaveLength(2);

    await page.evaluate(() => (window as unknown as RunHold).releaseRun());
    await expect.poll(() => page.evaluate(() => "sameDocument" in window).catch(() => true)).toBe(false);
    await expect(page.getByRole("heading", { name: "DDALAB" })).toBeVisible();
    expect(await cacheNames(page)).toContain(`ddalab:${origin}/:${b}`);
  });
});
