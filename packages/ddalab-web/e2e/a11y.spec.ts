// Accessibility of the app's states as axe sees them (WCAG 2.2 A and AA, and axe's best practices), in both themes:
// empty with the About dialog, a recording open, a run in progress, and a result with the history, its provenance and
// the export panel.
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const BRAINVISION = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"].map((name) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url)),
);
/** Eight channels for two hours with 4,000-sample windows every 10 samples: a run of many seconds. */
const LONG = { channels: 8, rateHz: 256, durationS: 2 * 3600, seed: 5 };

// Playwright's WebKit has no OPFS (getDirectory throws UnknownError); Safari itself has.
const hasStorage = (page: Page) =>
  page.evaluate(() =>
    navigator.storage.getDirectory().then(
      () => true,
      () => false,
    ),
  );
const NO_STORAGE = "this browser window has no OPFS";

const runBar = (page: Page) => page.getByRole("region", { name: "Run" });
const settings = (page: Page) => page.getByRole("region", { name: "DDA settings" });

/** What axe finds on the page in the light and the dark theme: a line per rule with its impact and its elements. */
async function violations(page: Page) {
  const found: string[] = [];
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    // Colors that transition to the theme are measured once they arrive.
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => "replaced"))),
    );
    const { violations } = await new AxeBuilder({ page }).analyze();
    for (const v of violations) {
      const nodes = v.nodes.map((n) => n.target.join(" ")).join(", ");
      found.push(`${colorScheme}: ${v.id} (${v.impact}): ${v.help}; ${nodes}`);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  return found;
}

async function openBrainVision(page: Page) {
  await page.getByLabel("Recording files").setInputFiles(BRAINVISION);
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
  await expect(page.getByText("Overview 100%")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await page.goto("/");
  await expect(page.getByRole("status").first()).toHaveText(/^\d+\.\d+\.\d+/);
});

test("empty_state", async ({ page }) => {
  await expect(page.getByText("Open a recording from the library")).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await page.getByRole("button", { name: "About DDALAB" }).click();
  await expect(page.getByRole("dialog", { name: "About DDALAB" })).toContainText("Fabio Crameri");
  expect(await violations(page)).toEqual([]);
});

test("open_state", async ({ page }) => {
  await openBrainVision(page);
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  await expect(runBar(page).getByText(/^Plan /)).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("running_state", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  // Four DDA workers whatever the machine: the run stays long and leaves cores to the other tests.
  await page.addInitScript(() => Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 5 }));
  await page.reload();
  await page.evaluate((spec) => window.__ddalab.openSynthetic(spec), LONG);
  await page.getByRole("checkbox", { name: "Select group CH" }).check();
  await settings(page).getByLabel("Window", { exact: true }).fill("4000");
  await settings(page).getByLabel("Step", { exact: true }).fill("10");
  await runBar(page).getByLabel("Start", { exact: true }).fill("0");
  await runBar(page).getByLabel("End", { exact: true }).fill(String(LONG.durationS));
  await runBar(page).getByLabel("End", { exact: true }).press("Enter");
  await expect(runBar(page).getByText(/^Plan /)).toBeVisible();
  await runBar(page).getByRole("button", { name: "Run DDA" }).click();
  await expect(runBar(page).getByRole("button", { name: "Cancel run" })).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await runBar(page).getByRole("button", { name: "Cancel run" }).click();
  await expect(runBar(page).getByText("Cancelled", { exact: true })).toBeVisible({ timeout: 30_000 });
});

test("result_state", async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  await openBrainVision(page);
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  await page.getByRole("checkbox", { name: "Select Fp2" }).check();
  await runBar(page).getByLabel("Start", { exact: true }).fill("1");
  await runBar(page).getByLabel("End", { exact: true }).fill("5");
  await runBar(page).getByLabel("End", { exact: true }).press("Enter");
  await runBar(page).getByRole("button", { name: "Run DDA" }).click();
  await expect(runBar(page).getByText("Complete", { exact: true })).toBeVisible({ timeout: 60_000 });
  // The heatmap, its row plot and the history.
  const result = page.getByRole("region", { name: "Result" });
  await expect(result).toBeVisible();
  await page.evaluate(() => window.__ddalab.results.settled());
  await result.getByRole("button", { name: "Fp2", exact: true }).click();
  await expect(result.getByRole("img", { name: "Line plot of Fp2" })).toBeVisible();
  const history = page.getByRole("region", { name: "History" });
  await expect(history.getByRole("listitem")).toHaveCount(1);
  expect(await violations(page)).toEqual([]);
  // The provenance the history row opens, then its export panel.
  await history.getByRole("listitem").getByRole("button").click();
  const provenance = page.getByRole("region", { name: "Provenance" });
  await expect(provenance).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await provenance.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("dialog", { name: "Export result" })).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await provenance.getByRole("button", { name: "Delete" }).click();
  await expect(provenance.getByText("Delete this result and its files?")).toBeVisible();
  expect(await violations(page)).toEqual([]);
});
