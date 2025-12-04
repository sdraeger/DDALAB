import { Page, expect } from "@playwright/test";

/**
 * API helpers for E2E tests
 * These helpers interact with the DDALAB API server for file operations and DDA analysis
 */

// Default API URL - can be overridden by environment
export const API_URL = process.env.API_URL || "http://127.0.0.1:8765";

/**
 * File info returned by the API
 */
export interface FileInfo {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  modified: string;
  extension?: string;
}

/**
 * List files in a directory via the API
 */
export async function listFiles(directory?: string): Promise<FileInfo[]> {
  const url = directory
    ? `${API_URL}/api/files/list?path=${encodeURIComponent(directory)}`
    : `${API_URL}/api/files/list`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to list files: ${response.statusText}`);
  }

  const data = await response.json();
  return data.files || [];
}

/**
 * Get file info via the API
 */
export async function getFileInfo(filePath: string): Promise<any> {
  const response = await fetch(
    `${API_URL}/api/files/${encodeURIComponent(filePath)}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to get file info: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get EDF file info via the API
 */
export async function getEdfInfo(filePath: string): Promise<any> {
  const response = await fetch(
    `${API_URL}/api/edf/info?path=${encodeURIComponent(filePath)}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to get EDF info: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Load a file in the app via the API
 * This navigates to the file and loads it in the frontend
 */
export async function loadFileViaUI(
  page: Page,
  filePath: string,
): Promise<void> {
  // Navigate to explore > timeseries
  const exploreNav = page.locator('[data-nav="explore"]');
  await exploreNav.click();
  await page.waitForTimeout(300);

  const timeseriesNav = page.locator('[data-nav="timeseries"]');
  if (await timeseriesNav.isVisible()) {
    await timeseriesNav.click();
    await page.waitForTimeout(200);
  }

  // The file manager should be visible in the sidebar
  // Look for the file by name
  const fileName = filePath.split("/").pop() || filePath;

  // First, try clicking on the file in the file list
  const fileItem = page
    .locator(`[data-testid="file-item"]:has-text("${fileName}")`)
    .or(page.locator(`text="${fileName}"`))
    .first();

  if (await fileItem.isVisible({ timeout: 5000 }).catch(() => false)) {
    await fileItem.click();
    await page.waitForTimeout(500);

    // Wait for file to load (look for channel list or plot)
    await page
      .locator(
        '[data-testid="channel-list"], canvas, [data-testid="timeseries-plot"]',
      )
      .first()
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => {});
  }
}

/**
 * Select channels in the UI
 */
export async function selectChannels(
  page: Page,
  channelIndices: number[],
): Promise<void> {
  // Find channel checkboxes
  const channelCheckboxes = page.locator(
    '[data-testid="channel-checkbox"], [data-channel] input[type="checkbox"]',
  );

  const count = await channelCheckboxes.count();
  if (count === 0) {
    console.log("No channel checkboxes found");
    return;
  }

  // First, deselect all
  const deselectButton = page
    .locator('[data-testid="deselect-all"]')
    .or(page.locator('button:has-text("Deselect All")'))
    .first();

  if (await deselectButton.isVisible().catch(() => false)) {
    await deselectButton.click();
    await page.waitForTimeout(200);
  }

  // Then select the specified channels
  for (const idx of channelIndices) {
    if (idx < count) {
      await channelCheckboxes.nth(idx).check();
      await page.waitForTimeout(100);
    }
  }
}

/**
 * Run DDA analysis via the UI
 */
export async function runDDAAnalysis(page: Page): Promise<void> {
  // Navigate to analyze > dda
  const analyzeNav = page.locator('[data-nav="analyze"]');
  await analyzeNav.click();
  await page.waitForTimeout(300);

  const ddaNav = page.locator('[data-nav="dda"]');
  if (await ddaNav.isVisible()) {
    await ddaNav.click();
    await page.waitForTimeout(200);
  }

  // Click run button
  const runButton = page
    .locator('[data-testid="run-analysis"]')
    .or(page.locator('button:has-text("Run")'))
    .or(page.locator('button:has-text("Analyze")'))
    .first();

  if (await runButton.isVisible()) {
    await runButton.click();

    // Wait for analysis to complete (look for results or loading indicator)
    await page.waitForTimeout(500);

    // Wait for either results or error
    await Promise.race([
      page
        .locator('[data-testid="dda-results"], [data-testid="heatmap"]')
        .first()
        .waitFor({ state: "visible", timeout: 60000 }),
      page
        .locator("text=/error|failed/i")
        .first()
        .waitFor({ state: "visible", timeout: 60000 }),
    ]).catch(() => {});
  }
}

/**
 * Check if the API server is running
 */
export async function isApiServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for the API server to be ready
 */
export async function waitForApiServer(
  maxAttempts = 30,
  delayMs = 1000,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isApiServerRunning()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

/**
 * Test data file paths (relative to data directory)
 */
export const TEST_FILES = {
  // Small EDF file for quick tests
  SMALL_EDF: "test_generator.edf",
  // Larger EDF file for comprehensive tests
  LARGE_EDF: "patient1_S05__01_03 (1)_cut.edf",
  // BrainVision format
  BRAINVISION: "01_header.vhdr",
  // CSV file
  CSV: "no_header_data.csv",
  // ASCII file
  ASCII: "sensor_data.ascii",
};

/**
 * Get the full path to a test file
 */
export function getTestFilePath(fileName: string): string {
  // The data directory is configured in the API server
  return fileName;
}
