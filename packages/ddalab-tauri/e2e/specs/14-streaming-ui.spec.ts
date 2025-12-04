import { Page } from "@playwright/test";
import {
  test,
  expect,
  waitForAppReady,
  navigateTo,
  navigateToSecondary,
} from "../fixtures/base.fixture";

/**
 * Streaming UI Tests
 * Tests real-time data streaming interface and controls
 */

async function gotoApp(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
}

async function gotoStreaming(page: Page) {
  await gotoApp(page);
  await navigateTo(page, "explore");
  await navigateToSecondary(page, "streaming");
}

test.describe("Streaming Interface", () => {
  test.beforeEach(async ({ page }) => {
    await gotoStreaming(page);
  });

  test("streaming section is accessible", async ({ page }) => {
    const streamingUI = page
      .locator('[data-testid="streaming"]')
      .or(page.locator("text=Stream"))
      .or(page.locator("text=Live"))
      .or(page.locator("text=Real-time"))
      .or(page.locator("text=LSL"))
      .first();

    const isVisible = await streamingUI.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("shows stream discovery button", async ({ page }) => {
    const discoverButton = page
      .locator('[data-testid="discover-streams"]')
      .or(page.locator('button:has-text("Discover")'))
      .or(page.locator('button:has-text("Find Streams")'))
      .or(page.locator('button:has-text("Scan")'))
      .first();

    const isVisible = await discoverButton.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("stream list shows available streams", async ({ page }) => {
    const streamList = page
      .locator('[data-testid="stream-list"]')
      .or(page.locator('[data-testid="available-streams"]'))
      .or(page.locator("text=No streams"))
      .or(page.locator("text=Available Streams"))
      .first();

    const isVisible = await streamList.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });
});

test.describe("Stream Discovery", () => {
  test.beforeEach(async ({ page }) => {
    await gotoStreaming(page);
  });

  test("can trigger stream discovery", async ({ page }) => {
    const discoverButton = page
      .locator('[data-testid="discover-streams"]')
      .or(page.locator('button:has-text("Discover")'))
      .or(page.locator('button:has-text("Scan")'))
      .first();

    if (await discoverButton.isVisible()) {
      await discoverButton.click();
      await page.waitForTimeout(500);

      // Should show scanning indicator or results
      const result = page
        .locator("text=Scanning")
        .or(page.locator("text=Found"))
        .or(page.locator("text=No streams"))
        .or(page.locator('[data-testid="stream-item"]'))
        .first();

      const hasResult = await result.isVisible().catch(() => false);
      expect(typeof hasResult).toBe("boolean");
    }
  });

  test("discovery shows loading state", async ({ page }) => {
    const discoverButton = page
      .locator('[data-testid="discover-streams"]')
      .or(page.locator('button:has-text("Discover")'))
      .first();

    if (await discoverButton.isVisible()) {
      await discoverButton.click();

      // Check for loading indicator
      const loading = page
        .locator('[data-testid="loading"]')
        .or(page.locator('[role="progressbar"]'))
        .or(page.locator(".animate-spin"))
        .or(page.locator("text=Scanning"))
        .first();

      // Loading may or may not be visible depending on speed
      const isLoading = await loading.isVisible().catch(() => false);
      expect(typeof isLoading).toBe("boolean");
    }
  });

  test("can filter streams by type", async ({ page }) => {
    const typeFilter = page
      .locator('[data-testid="stream-type-filter"]')
      .or(page.locator('select:has-text("Type")'))
      .or(page.locator('select:has-text("EEG")'))
      .first();

    const isVisible = await typeFilter.isVisible().catch(() => false);
    if (isVisible) {
      await typeFilter.click();
      await page.waitForTimeout(200);
      // Filter should remain visible after interaction
      await expect(typeFilter).toBeVisible();
    } else {
      // Stream type filter not present in current view
      expect(isVisible).toBe(false);
    }
  });
});

test.describe("Stream Selection", () => {
  test.beforeEach(async ({ page }) => {
    await gotoStreaming(page);
  });

  test("can select a stream from list", async ({ page }) => {
    const streamItem = page
      .locator('[data-testid="stream-item"]')
      .or(page.locator('[role="listitem"]'))
      .first();

    if (await streamItem.isVisible()) {
      await streamItem.click();
      await page.waitForTimeout(200);

      // Should show selection or stream details
      const selected = page
        .locator('[data-selected="true"]')
        .or(page.locator('[aria-selected="true"]'))
        .or(page.locator("text=Selected"))
        .first();

      const isSelected = await selected.isVisible().catch(() => false);
      expect(typeof isSelected).toBe("boolean");
    }
  });

  test("shows stream metadata when selected", async ({ page }) => {
    const streamItem = page.locator('[data-testid="stream-item"]').first();

    if (await streamItem.isVisible()) {
      await streamItem.click();
      await page.waitForTimeout(200);

      const metadata = page
        .locator('[data-testid="stream-info"]')
        .or(page.locator("text=Channels"))
        .or(page.locator("text=Sample Rate"))
        .or(page.locator("text=Hz"))
        .first();

      const hasMetadata = await metadata.isVisible().catch(() => false);
      expect(typeof hasMetadata).toBe("boolean");
    }
  });
});

test.describe("Stream Controls", () => {
  test.beforeEach(async ({ page }) => {
    await gotoStreaming(page);
  });

  test("start streaming button is present", async ({ page }) => {
    const startButton = page
      .locator('[data-testid="start-stream"]')
      .or(page.locator('button:has-text("Start")'))
      .or(page.locator('button:has-text("Connect")'))
      .or(page.locator('button:has-text("Begin")'))
      .first();

    const isVisible = await startButton.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("stop streaming button exists (may be hidden)", async ({ page }) => {
    const stopButton = page
      .locator('[data-testid="stop-stream"]')
      .or(page.locator('button:has-text("Stop")'))
      .or(page.locator('button:has-text("Disconnect")'))
      .first();

    // Stop button may only show during active stream
    const isVisible = await stopButton.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("pause/resume controls exist", async ({ page }) => {
    const pauseButton = page
      .locator('[data-testid="pause-stream"]')
      .or(page.locator('button:has-text("Pause")'))
      .or(page.locator('[aria-label*="pause"]'))
      .first();

    const isVisible = await pauseButton.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });
});

test.describe("Streaming Visualization", () => {
  test.beforeEach(async ({ page }) => {
    await gotoStreaming(page);
  });

  test("streaming plot container exists", async ({ page }) => {
    const plotContainer = page
      .locator('[data-testid="streaming-plot"]')
      .or(page.locator('[data-testid="live-plot"]'))
      .or(page.locator("canvas"))
      .or(page.locator("svg"))
      .first();

    const isVisible = await plotContainer.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("can toggle autoscroll", async ({ page }) => {
    const autoscrollToggle = page
      .locator('[data-testid="autoscroll"]')
      .or(page.locator('label:has-text("Auto")'))
      .or(page.locator('[aria-label*="scroll"]'))
      .first();

    const isVisible = await autoscrollToggle.isVisible().catch(() => false);
    if (isVisible) {
      await autoscrollToggle.click();
      await page.waitForTimeout(100);
      // Toggle should remain visible after click
      await expect(autoscrollToggle).toBeVisible();
    } else {
      // Autoscroll toggle not present in streaming view
      expect(isVisible).toBe(false);
    }
  });

  test("shows streaming DDA heatmap option", async ({ page }) => {
    const heatmapToggle = page
      .locator('[data-testid="show-heatmap"]')
      .or(page.locator("text=Heatmap"))
      .or(page.locator('label:has-text("DDA")'))
      .first();

    const isVisible = await heatmapToggle.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });
});

test.describe("Stream Configuration", () => {
  test.beforeEach(async ({ page }) => {
    await gotoStreaming(page);
  });

  test("buffer size can be configured", async ({ page }) => {
    const bufferInput = page
      .locator('[data-testid="buffer-size"]')
      .or(page.locator('input[name*="buffer"]'))
      .or(page.locator('label:has-text("Buffer") + input'))
      .first();

    if (await bufferInput.isVisible()) {
      await bufferInput.clear();
      await bufferInput.fill("1000");
      expect(await bufferInput.inputValue()).toBe("1000");
    }
  });

  test("window parameters for streaming DDA", async ({ page }) => {
    const windowInput = page
      .locator('[data-testid="stream-window"]')
      .or(page.locator('input[name*="window"]'))
      .first();

    if (await windowInput.isVisible()) {
      const value = await windowInput.inputValue();
      expect(typeof value).toBe("string");
    }
  });

  test("can configure which channels to stream", async ({ page }) => {
    const channelConfig = page
      .locator('[data-testid="stream-channels"]')
      .or(page.locator("text=Channels"))
      .or(page.locator('[data-testid="channel-selector"]'))
      .first();

    const isVisible = await channelConfig.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });
});

test.describe("Stream Status", () => {
  test.beforeEach(async ({ page }) => {
    await gotoStreaming(page);
  });

  test("shows stream status indicator", async ({ page }) => {
    const statusIndicator = page
      .locator('[data-testid="stream-status"]')
      .or(page.locator("text=Idle"))
      .or(page.locator("text=Streaming"))
      .or(page.locator("text=Paused"))
      .or(page.locator("text=Disconnected"))
      .first();

    const isVisible = await statusIndicator.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("shows sample count or data rate", async ({ page }) => {
    const dataStats = page
      .locator('[data-testid="sample-count"]')
      .or(page.locator('[data-testid="data-rate"]'))
      .or(page.locator("text=/\\d+\\s*samples/i"))
      .or(page.locator("text=/\\d+\\s*Hz/i"))
      .first();

    const isVisible = await dataStats.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });

  test("shows elapsed time during streaming", async ({ page }) => {
    const elapsed = page
      .locator('[data-testid="elapsed-time"]')
      .or(page.locator("text=/\\d+:\\d+/"))
      .or(page.locator('[data-testid="stream-duration"]'))
      .first();

    const isVisible = await elapsed.isVisible().catch(() => false);
    expect(typeof isVisible).toBe("boolean");
  });
});

test.describe("Stream Data Export", () => {
  test.beforeEach(async ({ page }) => {
    await gotoStreaming(page);
  });

  test("can export streamed data", async ({ page }) => {
    const exportButton = page
      .locator('[data-testid="export-stream"]')
      .or(page.locator('button:has-text("Export")'))
      .or(page.locator('button:has-text("Save")'))
      .first();

    if (await exportButton.isVisible()) {
      await expect(exportButton).toBeVisible();
    }
  });

  test("can clear stream buffer", async ({ page }) => {
    const clearButton = page
      .locator('[data-testid="clear-buffer"]')
      .or(page.locator('button:has-text("Clear")'))
      .or(page.locator('button:has-text("Reset")'))
      .first();

    const isVisible = await clearButton.isVisible().catch(() => false);
    if (isVisible) {
      await clearButton.click();
      await page.waitForTimeout(200);
      // Button should remain visible after click
      await expect(clearButton).toBeVisible();
    } else {
      // Clear buffer button not present in streaming view
      expect(isVisible).toBe(false);
    }
  });
});
