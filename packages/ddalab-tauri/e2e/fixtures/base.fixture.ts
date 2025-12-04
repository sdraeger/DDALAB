import { test as base, Page, expect } from "@playwright/test";
import { startCoverage, stopCoverage } from "../utils/coverage";
import {
  isApiServerRunning,
  loadFileViaUI,
  selectChannels,
  runDDAAnalysis,
  TEST_FILES,
  API_URL,
} from "../utils/api-helpers";

// Test data file path (relative to monorepo root)
export const TEST_EDF_PATH = "../../data/patient1_S05__01_03 (1).edf";

// Re-export API helpers for convenience
export {
  isApiServerRunning,
  loadFileViaUI,
  selectChannels,
  runDDAAnalysis,
  TEST_FILES,
  API_URL,
};

const COLLECT_COVERAGE = process.env.COVERAGE === "true";

/**
 * Wait for the app to be ready (basic DOM ready, main content exists)
 */
export async function waitForAppReady(page: Page) {
  // Wait for the page to be fully loaded
  await page.waitForLoadState("domcontentloaded");

  // Wait for main content OR nav to be visible (either indicates app loaded)
  await page
    .locator("main, nav, [data-nav]")
    .first()
    .waitFor({ state: "visible", timeout: 15000 });

  // Give React a moment to hydrate
  await page.waitForTimeout(500);
}

/**
 * Primary navigation tabs in the app
 */
export type PrimaryNav =
  | "overview"
  | "explore"
  | "analyze"
  | "manage"
  | "notifications";

/**
 * Secondary navigation tabs
 */
export type SecondaryNav =
  | "timeseries"
  | "preprocessing"
  | "annotations"
  | "streaming"
  | "dda"
  | "ica"
  | "settings"
  | "data-sources"
  | "jobs";

/**
 * Navigate to a primary section of the app
 */
export async function navigateTo(page: Page, section: PrimaryNav) {
  const navButton = page.locator(`[data-nav="${section}"]`).first();
  await navButton.click();
  await page.waitForTimeout(300);
}

/**
 * Navigate to a secondary tab within the current primary section
 */
export async function navigateToSecondary(page: Page, tab: SecondaryNav) {
  const tabButton = page.locator(`[data-nav="${tab}"]`).first();
  if (await tabButton.isVisible()) {
    await tabButton.click();
    await page.waitForTimeout(200);
  }
}

/**
 * Extended test fixture with coverage collection and helpers.
 * Override the page fixture to automatically collect coverage when COVERAGE=true.
 */
export const test = base.extend<{
  appReady: void;
  apiAvailable: boolean;
  withTestFile: void;
}>({
  page: async ({ page }, use) => {
    if (COLLECT_COVERAGE) {
      await startCoverage(page);
    }
    await use(page);
    if (COLLECT_COVERAGE) {
      await stopCoverage(page);
    }
  },
  appReady: async ({ page }, use) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await use();
  },
  apiAvailable: async ({}, use) => {
    const available = await isApiServerRunning();
    await use(available);
  },
  withTestFile: async ({ page, apiAvailable }, use) => {
    // This fixture loads a test file if the API is available
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);

    if (apiAvailable) {
      // Load the small test EDF file
      await loadFileViaUI(page, TEST_FILES.SMALL_EDF);
    }

    await use();
  },
});

export { expect } from "@playwright/test";
