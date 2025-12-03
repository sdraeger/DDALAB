import { test as base, Page, expect } from "@playwright/test";

// Test data file path (relative to project root)
export const TEST_EDF_PATH =
  "/Users/simon/Desktop/DDALAB/data/patient1_S05__01_03 (1).edf";

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
 * Navigate to a section of the app
 */
export async function navigateTo(
  page: Page,
  section: "data" | "analyze" | "settings",
) {
  const navButton = page.locator(`[data-nav="${section}"]`).first();
  await navButton.click();
  await page.waitForTimeout(200);
}

/**
 * Extended test fixture with helpers
 */
export const test = base.extend<{
  appReady: void;
}>({
  appReady: async ({ page }, use) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await use();
  },
});

export { expect } from "@playwright/test";
