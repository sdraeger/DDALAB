import { Page } from "@playwright/test";
import {
  test,
  expect,
  waitForAppReady,
  navigateTo,
  navigateToSecondary,
} from "../fixtures/base.fixture";

/**
 * File Loading Tests
 * Tests that verify files are loaded from the API server and can be selected
 */

async function gotoTimeSeries(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await navigateTo(page, "explore");
  await navigateToSecondary(page, "timeseries");
}

test.describe("File Loading from API", () => {
  // Use longer timeout for these tests due to cold start of API server
  test.setTimeout(60000);

  test("file manager loads files from data directory", async ({ page }) => {
    await gotoTimeSeries(page);

    // Wait for the file manager to finish loading
    // First wait for "Loading directory" to appear (it may already be loading)
    await page
      .locator("text=Loading directory")
      .waitFor({ state: "visible", timeout: 5000 })
      .catch(() => {});

    // Then wait for it to disappear (loading complete) - first load can be slow
    await page
      .locator("text=Loading directory")
      .waitFor({ state: "hidden", timeout: 45000 });

    // Wait a bit for files to render
    await page.waitForTimeout(1000);

    // Look for ACTUAL files from the data directory - not just patterns that could match UI text
    // Known files: test_generator.edf, test_timeseries.csv, sensor_data.ascii
    // Known folders: edf, ds000001
    const hasTestGenerator = await page
      .locator("text=test_generator.edf")
      .isVisible()
      .catch(() => false);
    const hasTestTimeseries = await page
      .locator("text=test_timeseries.csv")
      .isVisible()
      .catch(() => false);
    const hasPatient1 = await page
      .locator("text=patient1")
      .isVisible()
      .catch(() => false);
    const hasDs000001 = await page
      .locator("text=ds000001")
      .isVisible()
      .catch(() => false);

    // Also check status bar shows online (not offline)
    const syncStatusRaw = await page
      .locator("text=Sync")
      .textContent()
      .catch(() => null);
    const syncStatus = syncStatusRaw ?? "";
    const isOnline = !syncStatus.includes("offline");

    console.log(
      `test_generator.edf: ${hasTestGenerator}, test_timeseries.csv: ${hasTestTimeseries}`,
    );
    console.log(
      `patient1 file: ${hasPatient1}, ds000001 folder: ${hasDs000001}`,
    );
    console.log(`Sync status: ${syncStatus}, online: ${isOnline}`);

    // We should see actual files from the data directory
    const hasActualFiles =
      hasTestGenerator || hasTestTimeseries || hasPatient1 || hasDs000001;
    expect(
      hasActualFiles,
      "Should see actual files from data directory, not just UI text",
    ).toBe(true);
  });

  test("can select a file and see its details", async ({ page }) => {
    await gotoTimeSeries(page);

    // Wait for file manager to load
    await page
      .locator("text=Loading directory")
      .waitFor({ state: "hidden", timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(500);

    // Find the patient1 EDF file (the original, not the cut version)
    // Files have role="button" and aria-label="File: filename. Press Shift+F10..."
    // Use exact match to avoid matching the _cut version
    let fileButton = page.locator(
      '[role="button"][aria-label*="patient1_S05__01_03 (1).edf"]',
    );

    // If not immediately visible, try scrolling to find it
    if (!(await fileButton.isVisible())) {
      // Log what files are visible
      const allFileButtons = page.locator(
        '[role="button"][aria-label^="File:"]',
      );
      const count = await allFileButtons.count();
      console.log(`Found ${count} file buttons, looking for patient1_S05...`);

      for (let i = 0; i < Math.min(count, 5); i++) {
        const label = await allFileButtons.nth(i).getAttribute("aria-label");
        console.log(`  File ${i}: ${label}`);
      }

      // Try scrolling down to find the file
      const fileList = page.locator('[role="tree"]').first();
      if (await fileList.isVisible()) {
        await fileList.evaluate((el) => (el.scrollTop = el.scrollHeight));
        await page.waitForTimeout(500);
      }

      // Re-check for the file
      fileButton = page.locator(
        '[role="button"][aria-label*="patient1_S05__01_03 (1).edf"]',
      );
    }

    if (await fileButton.isVisible()) {
      const ariaLabel = await fileButton.getAttribute("aria-label");
      console.log(`Clicking file with aria-label: ${ariaLabel}`);

      await fileButton.click();

      // Wait for file to load
      await page.waitForTimeout(2000);

      // After clicking a file, we should see either:
      // - Channel list or channel count
      // - Time series plot
      // - File info (duration, sample rate, etc.)
      const hasFileInfo = await page
        .locator("text=/channel|duration|sample|Hz/i")
        .first()
        .isVisible()
        .catch(() => false);

      const hasPlot = await page
        .locator("canvas")
        .first()
        .isVisible()
        .catch(() => false);

      console.log(
        `File info visible: ${hasFileInfo}, Plot visible: ${hasPlot}`,
      );

      // Either file info or plot should be visible
      expect(hasFileInfo || hasPlot).toBe(true);
    } else {
      console.log("Could not find patient1_S05 file after scrolling");
      // List what elements ARE visible for debugging
      const allButtons = await page.locator('[role="button"]').count();
      console.log(`Total elements with role=button: ${allButtons}`);
      // Take screenshot for debugging
      await page.screenshot({ path: "e2e-report/patient1-not-found.png" });
      throw new Error("patient1_S05 file not found in file list");
    }
  });

  test("can navigate into subdirectories", async ({ page }) => {
    await gotoTimeSeries(page);

    // Wait for file manager to load
    await page
      .locator("text=Loading directory")
      .waitFor({ state: "hidden", timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(500);

    // Look for the "edf" folder - it should be a clickable tree node
    // Tree nodes have the folder name as text content
    const edfFolder = page
      .getByRole("treeitem")
      .filter({ hasText: "edf" })
      .first();

    if (await edfFolder.isVisible()) {
      console.log("Found edf folder treeitem, clicking...");
      await edfFolder.click();
      await page.waitForTimeout(1000);

      // Wait for potential loading
      await page
        .locator("text=Loading directory")
        .waitFor({ state: "hidden", timeout: 10000 })
        .catch(() => {});

      // After clicking/expanding, we should see:
      // - EDF files in the expanded directory
      // - Or breadcrumb showing we navigated into edf folder
      const breadcrumb = page.locator("button:has-text('edf')");
      const hasEdfInBreadcrumb = await breadcrumb
        .isVisible()
        .catch(() => false);

      // Check for file buttons with .edf extension in their aria-label
      const edfFileButtons = page.locator(
        '[role="button"][aria-label*=".edf"]',
      );
      const edfCount = await edfFileButtons.count().catch(() => 0);

      console.log(
        `edf in breadcrumb: ${hasEdfInBreadcrumb}, EDF files found: ${edfCount}`,
      );

      expect(hasEdfInBreadcrumb || edfCount > 0).toBe(true);
    } else {
      // Try direct text match as fallback
      const edfText = page.locator("text=edf").first();
      if (await edfText.isVisible()) {
        console.log("Found edf text, clicking...");
        await edfText.click();
        await page.waitForTimeout(1000);
      }
    }
  });
});

test.describe("Time Series Visualization", () => {
  // Use longer timeout for visualization tests
  test.setTimeout(60000);

  test("selecting a file shows time series plot", async ({ page }) => {
    await gotoTimeSeries(page);

    // Wait for file manager to load
    await page
      .locator("text=Loading directory")
      .waitFor({ state: "hidden", timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(500);

    // Find the patient1 EDF file (the original, not the cut version)
    let fileButton = page.locator(
      '[role="button"][aria-label*="patient1_S05__01_03 (1).edf"]',
    );

    // If not immediately visible, try scrolling to find it
    if (!(await fileButton.isVisible())) {
      const allFileButtons = page.locator(
        '[role="button"][aria-label^="File:"]',
      );
      const count = await allFileButtons.count();
      console.log(
        `Found ${count} file buttons, looking for patient1_S05__01_03 (1).edf...`,
      );

      // Try scrolling down to find the file
      const fileList = page.locator('[role="tree"]').first();
      if (await fileList.isVisible()) {
        await fileList.evaluate((el) => (el.scrollTop = el.scrollHeight));
        await page.waitForTimeout(500);
      }

      // Re-check for the file
      fileButton = page.locator(
        '[role="button"][aria-label*="patient1_S05__01_03 (1).edf"]',
      );
    }

    if (await fileButton.isVisible()) {
      const ariaLabel = await fileButton.getAttribute("aria-label");
      console.log(`Clicking file: ${ariaLabel}`);
      await fileButton.click();

      // Wait for file loading
      await page.waitForTimeout(3000);

      // Check for plot canvas or file info
      const canvas = page.locator("canvas").first();
      const hasCanvas = await canvas.isVisible().catch(() => false);

      const hasFileInfo = await page
        .locator("text=/channel|duration|sample|Hz/i")
        .first()
        .isVisible()
        .catch(() => false);

      console.log(
        `Time series canvas visible: ${hasCanvas}, File info: ${hasFileInfo}`,
      );

      // Take a screenshot for debugging
      await page.screenshot({ path: "e2e-report/file-loaded-test.png" });

      // Expect either canvas or file info to be visible
      expect(hasCanvas || hasFileInfo).toBe(true);
    } else {
      console.log("Could not find patient1_S05 file");
      await page.screenshot({ path: "e2e-report/no-files-found.png" });
      throw new Error("patient1_S05 file not found in file list");
    }
  });
});
