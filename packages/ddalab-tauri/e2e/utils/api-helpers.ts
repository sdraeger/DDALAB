import { Page, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  DATA_DIRECTORY,
  GENERATED_FIXTURES,
  getFixtureFileName,
} from "./test-fixtures";

/**
 * API helpers for E2E tests
 * These helpers interact with the DDALAB API server for file operations and DDA analysis
 */

const CONNECTION_INFO_FILE = "/tmp/ddalab-api-server.json";
const LEGACY_API_SERVER_ENABLED = process.env.START_API_SERVER === "true";

function readConnectionInfo():
  | { url?: string; session_token?: string }
  | undefined {
  try {
    if (!fs.existsSync(CONNECTION_INFO_FILE)) {
      return undefined;
    }

    return JSON.parse(fs.readFileSync(CONNECTION_INFO_FILE, "utf8"));
  } catch {
    return undefined;
  }
}

export function getApiUrl(): string {
  return (
    process.env.API_URL || readConnectionInfo()?.url || "http://127.0.0.1:8765"
  );
}

function getSessionToken(required = false): string | undefined {
  const token =
    process.env.API_SESSION_TOKEN || readConnectionInfo()?.session_token;

  if (!token && required) {
    throw new Error(
      "API session token is unavailable. Start Playwright with START_API_SERVER=true.",
    );
  }

  return token;
}

function withAuthHeaders(
  headers: HeadersInit = {},
  requireToken = true,
): Headers {
  const mergedHeaders = new Headers(headers);
  const token = getSessionToken(requireToken);

  if (token) {
    mergedHeaders.set("Authorization", `Bearer ${token}`);
  }

  return mergedHeaders;
}

async function apiRequest<T>(
  endpoint: string,
  init?: RequestInit,
  expectedStatus = 200,
): Promise<T> {
  const response = await fetch(`${getApiUrl()}${endpoint}`, init);

  if (response.status !== expectedStatus) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Request to ${endpoint} failed with ${response.status}: ${errorBody || response.statusText}`,
    );
  }

  return response.json() as Promise<T>;
}

// Default API URL - can be overridden by environment
export const API_URL = getApiUrl();

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
    ? `${getApiUrl()}/api/files/list?path=${encodeURIComponent(directory)}`
    : `${getApiUrl()}/api/files/list`;

  const response = await fetch(url, {
    headers: withAuthHeaders(),
  });
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
  return apiRequest(`/api/files/${encodeURIComponent(filePath)}`, {
    headers: withAuthHeaders(),
  });
}

/**
 * Get EDF file info via the API
 */
export async function getEdfInfo(filePath: string): Promise<any> {
  return apiRequest(`/api/edf/info?path=${encodeURIComponent(filePath)}`, {
    headers: withAuthHeaders(),
  });
}

export interface ProtectedFileInfo {
  file_path: string;
  file_name: string;
  file_size: number;
  duration?: number;
  sample_rate: number;
  total_samples?: number;
  channels: string[];
  start_time: string;
  end_time: string;
}

export interface DDAExecutionRequest {
  file_path: string;
  channels?: number[];
  time_range: {
    start: number;
    end: number;
  };
  preprocessing_options: {
    highpass: number | null;
    lowpass: number | null;
  };
  algorithm_selection: {
    enabled_variants: string[];
    select_mask: string | null;
  };
  window_parameters: {
    window_length: number;
    window_step: number;
    ct_window_length?: number | null;
    ct_window_step?: number | null;
  };
  scale_parameters: {
    delay_list: number[];
  };
}

export interface DDAVariantResult {
  variant_id: string;
  variant_name: string;
  dda_matrix: Record<string, number[]>;
  error_values?: number[];
}

export interface DDAExecutionResult {
  id: string;
  file_path: string;
  channels: string[];
  status: string;
  results: {
    summary: {
      total_windows: number;
      processed_windows: number;
      mean_complexity: number;
      std_complexity: number;
      num_channels: number;
    };
    scales?: number[];
    error_values?: number[];
    variants: DDAVariantResult[];
  };
}

export interface FileChunkResponse {
  data: number[][];
  channelLabels: string[];
  samplingFrequency: number;
  chunkSize: number;
  chunkStart: number;
  totalSamples?: number;
}

export async function runDDAAnalysisViaApi(
  request: DDAExecutionRequest,
): Promise<DDAExecutionResult> {
  return apiRequest("/api/dda/analyze", {
    method: "POST",
    headers: withAuthHeaders(
      {
        "Content-Type": "application/json",
      },
      true,
    ),
    body: JSON.stringify(request),
  });
}

export async function getFileChunk(
  filePath: string,
  startTime: number,
  duration: number,
  channels?: string[],
): Promise<FileChunkResponse> {
  const query = new URLSearchParams({
    start_time: String(startTime),
    duration: String(duration),
  });

  if (channels && channels.length > 0) {
    query.set("channels", JSON.stringify(channels));
  }

  return apiRequest(
    `/api/files/${encodeURIComponent(filePath)}/chunk?${query.toString()}`,
    {
      headers: withAuthHeaders(),
    },
  );
}

export function buildDDARequestFromFileInfo(
  fileInfo: ProtectedFileInfo,
  filePath: string,
  overrides: Partial<DDAExecutionRequest> = {},
): DDAExecutionRequest {
  const channelCount = Math.min(3, fileInfo.channels.length);
  if (channelCount < 2) {
    throw new Error(
      `Expected at least 2 channels in ${fileInfo.file_name}, got ${fileInfo.channels.length}`,
    );
  }

  const totalSamples =
    fileInfo.total_samples ??
    Math.max(
      1,
      Math.round((fileInfo.duration ?? 0) * Math.max(fileInfo.sample_rate, 1)),
    );
  const safetyMargin = Math.min(256, Math.floor(totalSamples / 10));
  const safeSamples = Math.max(8, totalSamples - safetyMargin);
  const preferredWindowLength = fileInfo.sample_rate >= 32 ? 64 : 8;
  const windowLength = Math.min(
    preferredWindowLength,
    Math.max(4, safeSamples - 1),
  );
  const windowStep = Math.max(1, Math.floor(windowLength / 2));
  const safeDuration = Number(
    (safeSamples / Math.max(fileInfo.sample_rate, 1)).toFixed(3),
  );
  const baseRequest: DDAExecutionRequest = {
    file_path: filePath,
    channels: Array.from({ length: channelCount }, (_, index) => index),
    time_range: {
      start: 0,
      end: safeDuration,
    },
    preprocessing_options: {
      highpass: null,
      lowpass: null,
    },
    algorithm_selection: {
      enabled_variants: ["single_timeseries"],
      select_mask: null,
    },
    window_parameters: {
      window_length: windowLength,
      window_step: windowStep,
      ct_window_length: null,
      ct_window_step: null,
    },
    scale_parameters: {
      delay_list: [1, 2, 3, 4],
    },
  };

  return {
    ...baseRequest,
    ...overrides,
    time_range: {
      ...baseRequest.time_range,
      ...overrides.time_range,
    },
    preprocessing_options: {
      ...baseRequest.preprocessing_options,
      ...overrides.preprocessing_options,
    },
    algorithm_selection: {
      ...baseRequest.algorithm_selection,
      ...overrides.algorithm_selection,
    },
    window_parameters: {
      ...baseRequest.window_parameters,
      ...overrides.window_parameters,
    },
    scale_parameters: {
      ...baseRequest.scale_parameters,
      ...overrides.scale_parameters,
    },
  };
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
  if (!LEGACY_API_SERVER_ENABLED) {
    return false;
  }

  try {
    const response = await fetch(`${getApiUrl()}/api/health`, {
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
  if (!LEGACY_API_SERVER_ENABLED) {
    return false;
  }

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
  SMALL_EDF: GENERATED_FIXTURES.SMALL_EDF,
  CSV: GENERATED_FIXTURES.CSV,
  ASCII: GENERATED_FIXTURES.ASCII,
};

/**
 * Get the full path to a test file
 */
export function getTestFilePath(fileName: string): string {
  if (path.isAbsolute(fileName)) {
    return fileName;
  }

  return path.join(DATA_DIRECTORY, fileName);
}

export { getFixtureFileName };
