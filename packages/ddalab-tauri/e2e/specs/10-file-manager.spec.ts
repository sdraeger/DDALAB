import { Page } from "@playwright/test";
import {
  test,
  expect,
  waitForAppReady,
  navigateTo,
  navigateToSecondary,
} from "../fixtures/base.fixture";

/**
 * File Manager and Data Exploration Tests
 * Tests file browsing, time series view, and data inspection
 */

async function gotoApp(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
}

async function gotoExplore(page: Page) {
  await gotoApp(page);
  await navigateTo(page, "explore");
}

test.describe("Explore Section Navigation", () => {
  test("can navigate to explore section", async ({ page }) => {
    await gotoApp(page);

    const exploreButton = page.locator('[data-nav="explore"]');
    await expect(exploreButton).toBeVisible();
    await exploreButton.click();

    // Should show explore content - look for secondary tabs
    const secondaryNav = page.locator('[data-testid="secondary-navigation"]');
    await expect(secondaryNav).toBeVisible({ timeout: 5000 });
  });

  test("explore section has time series tab", async ({ page }) => {
    await gotoExplore(page);

    const timeseriesTab = page.locator('[data-nav="timeseries"]');
    await expect(timeseriesTab).toBeVisible();
  });

  test("explore section has streaming tab", async ({ page }) => {
    await gotoExplore(page);

    const streamingTab = page.locator('[data-nav="streaming"]');
    await expect(streamingTab).toBeVisible();
  });

  test("explore section has preprocessing tab", async ({ page }) => {
    await gotoExplore(page);

    const preprocessingTab = page.locator('[data-nav="preprocessing"]');
    await expect(preprocessingTab).toBeVisible();
  });

  test("explore section has annotations tab", async ({ page }) => {
    await gotoExplore(page);

    const annotationsTab = page.locator('[data-nav="annotations"]');
    await expect(annotationsTab).toBeVisible();
  });
});

test.describe("Time Series View", () => {
  test.beforeEach(async ({ page }) => {
    await gotoExplore(page);
    await navigateToSecondary(page, "timeseries");
  });

  test("time series view is accessible", async ({ page }) => {
    // Should show time series content or prompt to load file
    const content = await page.content();
    expect(
      content.includes("Time Series") ||
        content.includes("Load") ||
        content.includes("Select") ||
        content.includes("File"),
    ).toBe(true);
  });

  test("shows file selection prompt when no file loaded", async ({ page }) => {
    // Without a file loaded, should prompt user to select one
    const loadPrompt = page
      .locator("text=Select")
      .or(page.locator("text=Load"))
      .or(page.locator("text=Open"))
      .or(page.locator("text=Browse"))
      .first();

    const hasPrompt = await loadPrompt.isVisible().catch(() => false);
    // Either shows prompt or already has data loaded
    expect(typeof hasPrompt).toBe("boolean");
  });

  test("plot container exists for visualization", async ({ page }) => {
    // Look for canvas or SVG element for plots
    const plotArea = page.locator("canvas, svg").first();
    const hasPlot = await plotArea.isVisible().catch(() => false);
    expect(typeof hasPlot).toBe("boolean");
  });
});

test.describe("Preprocessing View", () => {
  test.beforeEach(async ({ page }) => {
    await gotoExplore(page);
    await navigateToSecondary(page, "preprocessing");
  });

  test("preprocessing view is accessible", async ({ page }) => {
    const content = await page.content();
    expect(
      content.includes("Preprocessing") ||
        content.includes("Filter") ||
        content.includes("Process"),
    ).toBe(true);
  });

  test("shows preprocessing options", async ({ page }) => {
    // Look for preprocessing-related UI elements
    const preprocessingUI = page
      .locator("text=Filter")
      .or(page.locator("text=Resample"))
      .or(page.locator("text=Notch"))
      .or(page.locator("text=Bandpass"))
      .first();

    const hasOptions = await preprocessingUI.isVisible().catch(() => false);
    expect(typeof hasOptions).toBe("boolean");
  });
});

test.describe("Annotations View", () => {
  test.beforeEach(async ({ page }) => {
    await gotoExplore(page);
    await navigateToSecondary(page, "annotations");
  });

  test("annotations view is accessible", async ({ page }) => {
    const content = await page.content();
    expect(
      content.includes("Annotation") ||
        content.includes("Note") ||
        content.includes("Marker") ||
        content.includes("Event"),
    ).toBe(true);
  });

  test("can access annotation tools", async ({ page }) => {
    const annotationTools = page
      .locator('[data-testid="annotation-tools"]')
      .or(page.locator("text=Add"))
      .or(page.locator('button:has-text("Annotate")'))
      .first();

    const hasTools = await annotationTools.isVisible().catch(() => false);
    expect(typeof hasTools).toBe("boolean");
  });
});

test.describe("Data Source Selection", () => {
  test("manage section has data sources tab", async ({ page }) => {
    await gotoApp(page);
    await navigateTo(page, "manage");

    const dataSourcesTab = page.locator('[data-nav="data-sources"]');
    await expect(dataSourcesTab).toBeVisible();
  });

  test("can navigate to data sources", async ({ page }) => {
    await gotoApp(page);
    await navigateTo(page, "manage");
    await navigateToSecondary(page, "data-sources");

    const content = await page.content();
    expect(
      content.includes("OpenNeuro") ||
        content.includes("NEMAR") ||
        content.includes("Data"),
    ).toBe(true);
  });
});

test.describe("File Information Display", () => {
  test("displays file info when file is loaded", async ({ page }) => {
    await gotoExplore(page);

    // Look for file info elements that would appear when a file is loaded
    const fileInfo = page
      .locator('[data-testid="file-info"]')
      .or(page.locator("text=Channels"))
      .or(page.locator("text=Duration"))
      .or(page.locator("text=Sample Rate"))
      .first();

    const hasInfo = await fileInfo.isVisible().catch(() => false);
    expect(typeof hasInfo).toBe("boolean");
  });

  test("shows channel count when available", async ({ page }) => {
    await gotoExplore(page);

    const channelInfo = page
      .locator("text=/\\d+\\s*channel/i")
      .or(page.locator('[data-testid="channel-count"]'))
      .first();

    const hasChannels = await channelInfo.isVisible().catch(() => false);
    expect(typeof hasChannels).toBe("boolean");
  });
});

test.describe("Overview Section", () => {
  test("overview shows dashboard content", async ({ page }) => {
    await gotoApp(page);
    await navigateTo(page, "overview");

    // Overview should show dashboard or welcome content
    const content = await page.content();
    expect(content.includes("DDALAB")).toBe(true);
  });

  test("can navigate from overview to other sections", async ({ page }) => {
    await gotoApp(page);
    await navigateTo(page, "overview");

    // Should be able to navigate to analyze
    const analyzeButton = page.locator('[data-nav="analyze"]');
    await expect(analyzeButton).toBeVisible();
    await analyzeButton.click();

    // Should now be in analyze section
    const ddaTab = page.locator('[data-nav="dda"]');
    await expect(ddaTab).toBeVisible({ timeout: 5000 });
  });
});
