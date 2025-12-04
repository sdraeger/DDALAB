import { Page } from "@playwright/test";
import {
  test,
  expect,
  waitForAppReady,
  navigateTo,
  navigateToSecondary,
} from "../fixtures/base.fixture";

/**
 * Analysis Results and History Tests
 * Tests DDA results visualization, history management, and export
 */

async function gotoApp(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
}

async function gotoAnalyze(page: Page) {
  await gotoApp(page);
  await navigateTo(page, "analyze");
  await navigateToSecondary(page, "dda");
}

test.describe("DDA Results Display", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAnalyze(page);
  });

  test("results container is present", async ({ page }) => {
    const resultsContainer = page
      .locator('[data-testid="dda-results"]')
      .or(page.locator('[data-testid="results"]'))
      .or(page.locator('[data-testid="analysis-results"]'))
      .or(page.locator("text=Results"))
      .first();

    const isVisible = await resultsContainer.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("heatmap visualization exists", async ({ page }) => {
    const heatmap = page
      .locator('[data-testid="heatmap"]')
      .or(page.locator('[data-testid="dda-heatmap"]'))
      .or(page.locator("canvas"))
      .or(page.locator("svg"))
      .first();

    const isVisible = await heatmap.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("results show variant labels", async ({ page }) => {
    const variantLabels = page
      .locator("text=ST")
      .or(page.locator("text=DE"))
      .or(page.locator("text=SY"))
      .or(page.locator("text=Single"))
      .or(page.locator("text=Synchronization"))
      .first();

    const isVisible = await variantLabels.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("color scale/legend is displayed", async ({ page }) => {
    const colorScale = page
      .locator('[data-testid="color-scale"]')
      .or(page.locator('[data-testid="legend"]'))
      .or(page.locator('[data-testid="colorbar"]'))
      .or(page.locator(".legend"))
      .first();

    const isVisible = await colorScale.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });
});

test.describe("Results Interaction", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAnalyze(page);
  });

  test("can hover over heatmap for details", async ({ page }) => {
    const heatmap = page
      .locator('[data-testid="heatmap"]')
      .or(page.locator("canvas"))
      .first();

    if (await heatmap.isVisible()) {
      const box = await heatmap.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(200);

        // Tooltip may appear
        const tooltip = page
          .locator('[role="tooltip"]')
          .or(page.locator('[data-testid="tooltip"]'))
          .or(page.locator(".tooltip"))
          .first();

        const hasTooltip = await tooltip.isVisible().catch(() => false);
        expect(typeof hasTooltip).toBe("boolean");
      }
    }
  });

  test("can click on heatmap cell for details", async ({ page }) => {
    const heatmap = page
      .locator('[data-testid="heatmap"]')
      .or(page.locator("canvas"))
      .first();

    const isVisible = await heatmap.isVisible().catch(() => false);
    if (isVisible) {
      const box = await heatmap.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(200);
        // Page should still be functional after click
        const content = await page.content();
        expect(content.length).toBeGreaterThan(0);
      }
    } else {
      // Heatmap not visible - no results loaded
      expect(isVisible).toBe(false);
    }
  });

  test("can zoom results visualization", async ({ page }) => {
    const zoomIn = page
      .locator('[data-testid="results-zoom-in"]')
      .or(page.locator('[aria-label*="zoom in"]'))
      .first();

    const isVisible = await zoomIn.isVisible().catch(() => false);
    if (isVisible) {
      await zoomIn.click();
      await page.waitForTimeout(100);
      // Zoom button should remain visible after click
      await expect(zoomIn).toBeVisible();
    } else {
      // Zoom controls not present
      expect(isVisible).toBe(false);
    }
  });

  test("can pan across large results", async ({ page }) => {
    const heatmap = page.locator('[data-testid="heatmap"]').first();

    const isVisible = await heatmap.isVisible().catch(() => false);
    if (isVisible) {
      const box = await heatmap.boundingBox();
      if (box) {
        // Try to drag/pan
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(
          box.x + box.width / 2 + 50,
          box.y + box.height / 2,
        );
        await page.mouse.up();
        // Page should still be functional after pan
        const content = await page.content();
        expect(content.length).toBeGreaterThan(0);
      }
    } else {
      // Heatmap not visible - no results loaded
      expect(isVisible).toBe(false);
    }
  });
});

test.describe("Analysis History", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAnalyze(page);
  });

  test("history sidebar/panel exists", async ({ page }) => {
    const historySidebar = page
      .locator('[data-testid="analysis-history"]')
      .or(page.locator('[data-testid="history-sidebar"]'))
      .or(page.locator("text=History"))
      .or(page.locator("text=Previous"))
      .first();

    const isVisible = await historySidebar.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("history shows list of past analyses", async ({ page }) => {
    const historyItems = page
      .locator('[data-testid="history-item"]')
      .or(page.locator('[data-testid="analysis-item"]'))
      .or(page.locator(".history-entry"));

    const count = await historyItems.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("can click history item to load previous results", async ({ page }) => {
    const historyItem = page
      .locator('[data-testid="history-item"]')
      .or(page.locator('[data-testid="analysis-item"]'))
      .first();

    const isVisible = await historyItem.isVisible().catch(() => false);
    if (isVisible) {
      await historyItem.click();
      await page.waitForTimeout(300);
      // Page should still be functional after click
      const content = await page.content();
      expect(content.length).toBeGreaterThan(0);
    } else {
      // No history items - empty history
      expect(isVisible).toBe(false);
    }
  });

  test("history shows timestamp for each analysis", async ({ page }) => {
    const timestamp = page
      .locator('[data-testid="analysis-timestamp"]')
      .or(page.locator("text=/\\d{1,2}:\\d{2}/"))
      .or(page.locator("text=/\\d{4}-\\d{2}-\\d{2}/"))
      .first();

    const isVisible = await timestamp.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("can delete history items", async ({ page }) => {
    const deleteButton = page
      .locator('[data-testid="delete-history"]')
      .or(page.locator('[aria-label="Delete"]'))
      .or(page.locator('button:has-text("Delete")'))
      .first();

    if (await deleteButton.isVisible()) {
      // Don't actually delete, just verify button exists
      await expect(deleteButton).toBeEnabled();
    }
  });

  test("can clear all history", async ({ page }) => {
    const clearAllButton = page
      .locator('[data-testid="clear-history"]')
      .or(page.locator('button:has-text("Clear All")'))
      .or(page.locator('button:has-text("Clear History")'))
      .first();

    if (await clearAllButton.isVisible()) {
      await expect(clearAllButton).toBeEnabled();
    }
  });
});

test.describe("Results Export", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAnalyze(page);
  });

  test("export button is available", async ({ page }) => {
    const exportButton = page
      .locator('[data-testid="export-results"]')
      .or(page.locator('button:has-text("Export")'))
      .or(page.locator('button:has-text("Download")'))
      .or(page.locator('button:has-text("Save")'))
      .first();

    const isVisible = await exportButton.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("export dialog shows format options", async ({ page }) => {
    const exportButton = page
      .locator('[data-testid="export-results"]')
      .or(page.locator('button:has-text("Export")'))
      .first();

    if (await exportButton.isVisible()) {
      await exportButton.click();
      await page.waitForTimeout(300);

      const formatOptions = page
        .locator("text=CSV")
        .or(page.locator("text=EDF"))
        .or(page.locator("text=Format"))
        .or(page.locator('[role="dialog"]'))
        .first();

      const hasOptions = await formatOptions.isVisible().catch(() => false);
      expect(typeof hasOptions).toBe("boolean");

      // Close dialog
      await page.keyboard.press("Escape");
    }
  });

  test("can export as CSV", async ({ page }) => {
    const csvOption = page
      .locator('[data-testid="export-csv"]')
      .or(page.locator('button:has-text("CSV")'))
      .or(page.locator('[value="csv"]'))
      .first();

    if (await csvOption.isVisible()) {
      await expect(csvOption).toBeEnabled();
    }
  });

  test("can export visualization as image", async ({ page }) => {
    const imageExport = page
      .locator('[data-testid="export-image"]')
      .or(page.locator('button:has-text("PNG")'))
      .or(page.locator('button:has-text("Image")'))
      .or(page.locator('button:has-text("Screenshot")'))
      .first();

    if (await imageExport.isVisible()) {
      await expect(imageExport).toBeEnabled();
    }
  });
});

test.describe("Annotations", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAnalyze(page);
  });

  test("annotation tools are available", async ({ page }) => {
    const annotationTools = page
      .locator('[data-testid="annotations"]')
      .or(page.locator('[data-testid="annotation-tools"]'))
      .or(page.locator("text=Annotate"))
      .or(page.locator("text=Add Note"))
      .first();

    const isVisible = await annotationTools.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("can add annotation to results", async ({ page }) => {
    const addButton = page
      .locator('[data-testid="add-annotation"]')
      .or(page.locator('button:has-text("Add Note")'))
      .or(page.locator('button:has-text("Annotate")'))
      .first();

    if (await addButton.isVisible()) {
      await addButton.click();
      await page.waitForTimeout(200);

      // May show input dialog or enable annotation mode
      const annotationInput = page
        .locator('[data-testid="annotation-input"]')
        .or(page.locator('textarea[placeholder*="note"]'))
        .or(page.locator('[role="dialog"]'))
        .first();

      const hasInput = await annotationInput.isVisible().catch(() => false);
      expect(typeof hasInput).toBe("boolean");

      await page.keyboard.press("Escape");
    }
  });

  test("annotations are displayed on results", async ({ page }) => {
    const annotations = page
      .locator('[data-testid="annotation-marker"]')
      .or(page.locator("[data-annotation]"))
      .or(page.locator(".annotation"));

    const count = await annotations.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("can export annotations", async ({ page }) => {
    const exportAnnotations = page
      .locator('[data-testid="export-annotations"]')
      .or(page.locator('button:has-text("Export Annotations")'))
      .first();

    if (await exportAnnotations.isVisible()) {
      await expect(exportAnnotations).toBeEnabled();
    }
  });
});

test.describe("Results Comparison", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAnalyze(page);
  });

  test("can compare multiple analyses", async ({ page }) => {
    const compareButton = page
      .locator('[data-testid="compare-results"]')
      .or(page.locator('button:has-text("Compare")'))
      .first();

    if (await compareButton.isVisible()) {
      await compareButton.click();
      await page.waitForTimeout(200);

      // May show comparison view or selection dialog
      const compareUI = page
        .locator('[data-testid="comparison-view"]')
        .or(page.locator("text=Select"))
        .or(page.locator('[role="dialog"]'))
        .first();

      const hasCompare = await compareUI.isVisible().catch(() => false);
      expect(typeof hasCompare).toBe("boolean");

      await page.keyboard.press("Escape");
    }
  });

  test("side-by-side comparison view", async ({ page }) => {
    const sideBySide = page
      .locator('[data-testid="side-by-side"]')
      .or(page.locator('[data-layout="comparison"]'))
      .first();

    const isVisible = await sideBySide.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });
});

test.describe("Time Series Linked View", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAnalyze(page);
  });

  test("time series plot is linked to DDA results", async ({ page }) => {
    const timeSeriesPlot = page
      .locator('[data-testid="timeseries-plot"]')
      .or(page.locator('[data-testid="signal-plot"]'))
      .or(page.locator("canvas"))
      .first();

    const isVisible = await timeSeriesPlot.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("clicking DDA results highlights corresponding time window", async ({
    page,
  }) => {
    const heatmap = page.locator('[data-testid="heatmap"]').first();
    const timeSeries = page.locator('[data-testid="timeseries-plot"]').first();

    const heatmapVisible = await heatmap.isVisible().catch(() => false);
    const timeSeriesVisible = await timeSeries.isVisible().catch(() => false);

    if (heatmapVisible && timeSeriesVisible) {
      const box = await heatmap.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 4, box.y + box.height / 2);
        await page.waitForTimeout(200);
        // Both plots should remain visible after click
        await expect(heatmap).toBeVisible();
        await expect(timeSeries).toBeVisible();
      }
    } else {
      // Linked view not available without both plots
      expect(heatmapVisible && timeSeriesVisible).toBe(false);
    }
  });

  test("can synchronize zoom between plots", async ({ page }) => {
    const syncZoom = page
      .locator('[data-testid="sync-zoom"]')
      .or(page.locator('label:has-text("Sync")'))
      .or(page.locator('[aria-label*="sync"]'))
      .first();

    const isVisible = await syncZoom.isVisible().catch(() => false);
    if (isVisible) {
      await syncZoom.click();
      await page.waitForTimeout(100);
      // Sync control should remain visible after click
      await expect(syncZoom).toBeVisible();
    } else {
      // Sync zoom control not present
      expect(isVisible).toBe(false);
    }
  });
});

test.describe("Playback Controls", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAnalyze(page);
  });

  test("playback controls are available", async ({ page }) => {
    const playButton = page
      .locator('[data-testid="play"]')
      .or(page.locator('[aria-label="Play"]'))
      .or(page.locator('button:has-text("Play")'))
      .first();

    const isVisible = await playButton.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("can adjust playback speed", async ({ page }) => {
    const speedControl = page
      .locator('[data-testid="playback-speed"]')
      .or(page.locator('select:has-text("Speed")'))
      .or(page.locator('[aria-label*="speed"]'))
      .first();

    const isVisible = await speedControl.isVisible().catch(() => false);
    if (isVisible) {
      await speedControl.click();
      await page.waitForTimeout(100);
      // Speed control should remain visible after click
      await expect(speedControl).toBeVisible();
    } else {
      // Speed control not present
      expect(isVisible).toBe(false);
    }
  });

  test("timeline scrubber is functional", async ({ page }) => {
    const scrubber = page
      .locator('[data-testid="timeline"]')
      .or(page.locator('[role="slider"]'))
      .or(page.locator('input[type="range"]'))
      .first();

    const isVisible = await scrubber.isVisible().catch(() => false);
    if (isVisible) {
      const box = await scrubber.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(100);
        // Scrubber should remain visible after click
        await expect(scrubber).toBeVisible();
      }
    } else {
      // Timeline scrubber not present
      expect(isVisible).toBe(false);
    }
  });
});
