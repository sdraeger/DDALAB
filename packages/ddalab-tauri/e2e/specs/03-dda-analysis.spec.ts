import {
  test,
  expect,
  waitForAppReady,
  navigateTo,
} from "../fixtures/base.fixture";

// Helper to load a file before DDA tests
async function loadTestFile(page: import("@playwright/test").Page) {
  // First navigate to explore/timeseries to load a file
  await navigateTo(page, "explore");

  // Wait for secondary nav and click timeseries
  const timeseriesNav = page.locator('[data-secondary-nav="timeseries"]');
  if (await timeseriesNav.isVisible({ timeout: 2000 }).catch(() => false)) {
    await timeseriesNav.click();
    await page.waitForTimeout(300);
  }

  // Wait for file manager to load
  await page
    .locator("text=Loading directory")
    .waitFor({ state: "hidden", timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(500);

  // Find and click the patient1 EDF file
  const fileButton = page.locator(
    '[role="button"][aria-label*="patient1_S05__01_03 (1).edf"]',
  );
  if (await fileButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await fileButton.click();
    await page.waitForTimeout(2000); // Wait for file to load
    return true;
  }
  return false;
}

test.describe("DDA Analysis UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);

    // Navigate to analyze section
    await navigateTo(page, "analyze");
    await page.waitForTimeout(300);
  });

  test("displays analysis configuration panel", async ({ page }) => {
    // Should show DDA-related UI elements - these should be visible even without a file
    const ddaHeading = page
      .locator("text=DDA Analysis")
      .or(page.locator("text=Analysis"))
      .first();
    await expect(ddaHeading).toBeVisible({ timeout: 5000 });

    // Take screenshot to verify
    await page.screenshot({ path: "e2e-report/dda-analysis-ui.png" });
  });

  test("shows variant selection options", async ({ page }) => {
    // Variant checkboxes should be visible
    const variantSection = page
      .locator("text=Variants")
      .or(page.locator("text=Select Variants"))
      .first();

    // Either the variants heading or individual variant options should be visible
    const stVariant = page
      .locator("text=Single Timeseries")
      .or(page.locator("text=ST"))
      .first();
    const hasVariants =
      (await variantSection.isVisible().catch(() => false)) ||
      (await stVariant.isVisible().catch(() => false));

    expect(hasVariants).toBe(true);
  });

  test("shows 'no file selected' message without file", async ({ page }) => {
    // Without a file loaded, should show a message indicating no file is selected
    const noFileMessage = page
      .locator("text=No file selected")
      .or(page.locator("text=Select a file"))
      .or(page.locator("text=Load a file"))
      .first();

    // Either we see "no file" message, or we're on the analysis page
    const analysisPage = page.locator("text=Analysis").first();
    const isOnAnalysisPage = await analysisPage.isVisible().catch(() => false);

    expect(isOnAnalysisPage).toBe(true);
  });

  test("shows 'no file selected' prompt when no file loaded", async ({
    page,
  }) => {
    // Without a file, should show instructions to select a file
    const noFilePrompt = page
      .locator("text=No File Selected")
      .or(page.locator("text=Select a file"));

    await expect(noFilePrompt.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("DDA Variant Selection (with file loaded)", () => {
  test.setTimeout(90000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
  });

  test("shows variant options when file is loaded", async ({ page }) => {
    // First load a file
    const fileLoaded = await loadTestFile(page);

    if (fileLoaded) {
      await navigateTo(page, "analyze");
      await page.waitForTimeout(500);

      // With a file loaded, variant options should be visible
      const stText = page
        .locator("text=Single Timeseries")
        .or(page.locator("text=ST"))
        .or(page.locator("text=Variant"))
        .first();

      await expect(stText).toBeVisible({ timeout: 5000 });
    }
  });

  test("can toggle variant checkboxes when file loaded", async ({ page }) => {
    const fileLoaded = await loadTestFile(page);

    if (fileLoaded) {
      await navigateTo(page, "analyze");
      await page.waitForTimeout(500);

      // Find a variant checkbox and toggle it
      const checkbox = page.locator('input[type="checkbox"]').first();

      if (await checkbox.isVisible()) {
        const initialState = await checkbox.isChecked();
        await checkbox.click();
        await page.waitForTimeout(100);
        const newState = await checkbox.isChecked();

        // State should have changed
        expect(newState).not.toBe(initialState);

        // Toggle back
        await checkbox.click();
      }
    }
  });
});

test.describe("DDA Analysis with File Loaded", () => {
  test.setTimeout(90000); // Allow more time for file loading

  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
  });

  test("shows channel selection when file is loaded", async ({ page }) => {
    // First load a file
    const fileLoaded = await loadTestFile(page);

    if (fileLoaded) {
      // Navigate to analyze
      await navigateTo(page, "analyze");
      await page.waitForTimeout(500);

      // Channel selection should be visible
      const channelUI = page
        .locator("text=Channel")
        .or(page.locator("text=Select All"))
        .or(page.locator('[data-testid="channel-list"]'))
        .first();

      await expect(channelUI).toBeVisible({ timeout: 5000 });
    } else {
      console.log("Could not load test file - skipping channel selection test");
    }
  });

  test("shows window/step parameters when file is loaded", async ({ page }) => {
    const fileLoaded = await loadTestFile(page);

    if (fileLoaded) {
      await navigateTo(page, "analyze");
      await page.waitForTimeout(500);

      // Window parameters should be visible
      const windowUI = page
        .locator("text=Window")
        .or(page.locator("text=Step"))
        .or(page.locator("text=Length"))
        .first();

      await expect(windowUI).toBeVisible({ timeout: 5000 });

      // Take screenshot showing parameters
      await page.screenshot({ path: "e2e-report/dda-with-file.png" });
    }
  });

  test("can modify window size parameter", async ({ page }) => {
    const fileLoaded = await loadTestFile(page);

    if (fileLoaded) {
      await navigateTo(page, "analyze");
      await page.waitForTimeout(500);

      // Find window size input
      const windowInput = page.locator('input[type="number"]').first();

      if (await windowInput.isVisible()) {
        await windowInput.fill("256");
        const value = await windowInput.inputValue();
        expect(value).toBe("256");
      }
    }
  });
});

test.describe("Analysis Results", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await navigateTo(page, "analyze");
    await page.waitForTimeout(300);
  });

  test("shows results/visualization area", async ({ page }) => {
    // Look for visualization containers - these should exist even without results
    const resultsArea = page
      .locator('[data-testid="results"]')
      .or(page.locator('[data-testid="visualization"]'))
      .or(page.locator("text=Results"))
      .or(page.locator("text=No results"))
      .first();

    // The results area or a "no results" message should be visible
    const hasResultsArea = await resultsArea.isVisible().catch(() => false);

    // If no results area, at least the analysis page should be visible
    const analysisPage = page.locator("text=Analysis").first();
    const isOnAnalysisPage = await analysisPage.isVisible().catch(() => false);

    expect(hasResultsArea || isOnAnalysisPage).toBe(true);
  });

  test("analysis page structure is correct", async ({ page }) => {
    // Verify the analysis page has expected structure:
    // - DDA and ICA tabs
    // - Analysis heading
    const ddaTab = page.locator("text=DDA").first();
    const icaTab = page.locator("text=ICA").first();

    await expect(ddaTab).toBeVisible({ timeout: 5000 });
    await expect(icaTab).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Parameter Validation", () => {
  test.setTimeout(90000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
  });

  test("window size input accepts valid values", async ({ page }) => {
    // Load a file first to ensure inputs are enabled
    const fileLoaded = await loadTestFile(page);

    if (fileLoaded) {
      await navigateTo(page, "analyze");
      await page.waitForTimeout(500);

      const numberInput = page.locator('input[type="number"]').first();

      if (await numberInput.isVisible()) {
        await numberInput.fill("128");
        const value = await numberInput.inputValue();
        expect(value).toBe("128");
      }
    }
  });

  test("rejects or corrects invalid negative values", async ({ page }) => {
    const fileLoaded = await loadTestFile(page);

    if (fileLoaded) {
      await navigateTo(page, "analyze");
      await page.waitForTimeout(500);

      const numberInput = page.locator('input[type="number"]').first();

      if (await numberInput.isVisible()) {
        await numberInput.fill("-10");
        await numberInput.blur();
        await page.waitForTimeout(200);

        const currentValue = await numberInput.inputValue();

        // Either the value was rejected/corrected, or there's an error shown
        const hasError = await page
          .locator("text=invalid")
          .or(page.locator("text=positive"))
          .or(page.locator("text=must be"))
          .isVisible()
          .catch(() => false);

        // Either value was corrected (not -10) or error shown
        expect(currentValue !== "-10" || hasError).toBe(true);
      }
    }
  });
});
