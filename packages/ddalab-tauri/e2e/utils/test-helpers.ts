import { Page } from "@playwright/test";

/**
 * Test configuration
 */
export const TEST_CONFIG = {
  baseUrl: "http://localhost:3003",
  defaultTimeout: 5000,
  analysisTimeout: 30000,
};

/**
 * Wait for API call to complete
 */
export async function waitForApiCall(
  page: Page,
  urlPattern: string | RegExp,
  method: string = "GET",
): Promise<void> {
  await page.waitForResponse(
    (response) =>
      (typeof urlPattern === "string"
        ? response.url().includes(urlPattern)
        : urlPattern.test(response.url())) &&
      response.request().method() === method,
    { timeout: TEST_CONFIG.defaultTimeout },
  );
}

/**
 * Clear browser storage
 */
export async function clearLocalStorage(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear());
}

/**
 * Get item from local storage
 */
export async function getLocalStorageItem(
  page: Page,
  key: string,
): Promise<unknown> {
  return page.evaluate((k) => {
    const item = localStorage.getItem(k);
    return item ? JSON.parse(item) : null;
  }, key);
}

/**
 * Set item in local storage
 */
export async function setLocalStorageItem(
  page: Page,
  key: string,
  value: unknown,
): Promise<void> {
  await page.evaluate(
    ({ k, v }) => localStorage.setItem(k, JSON.stringify(v)),
    { k: key, v: value },
  );
}
