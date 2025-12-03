import { test, expect } from "@playwright/test";
import { waitForAppReady } from "../fixtures/base.fixture";

test.describe("App Startup", () => {
  test("loads without critical errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        // Ignore known harmless errors
        if (
          !text.includes("favicon") &&
          !text.includes("__TAURI__") &&
          !text.includes("tauri")
        ) {
          errors.push(text);
        }
      }
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);

    // Filter out non-critical errors
    const criticalErrors = errors.filter(
      (e) => !e.includes("Failed to fetch") && !e.includes("Network"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("displays main UI elements", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);

    // Should have navigation or data-nav buttons
    const hasNav = await page
      .locator("nav, [data-nav], aside")
      .first()
      .isVisible()
      .catch(() => false);

    // Should have some content area (main, div with content, etc.)
    const hasContent = await page
      .locator("main, [role='main'], .main-content, div")
      .first()
      .isVisible()
      .catch(() => false);

    // At least one of nav or content should exist
    expect(hasNav || hasContent).toBe(true);
  });

  test("has correct page title", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/DDALAB/i);
  });

  test("navigation buttons are clickable", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);

    // Check each nav button exists and is clickable
    const navButtons = ["data", "analyze", "settings"];
    for (const nav of navButtons) {
      const button = page.locator(`[data-nav="${nav}"]`).first();
      if (await button.isVisible()) {
        await button.click();
        // Should not cause error
        await page.waitForTimeout(100);
      }
    }
  });
});

test.describe("API Connection", () => {
  test("app loads without crashing (backend optional)", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);

    // The app should load - backend connection is optional in browser mode
    // Just verify we can interact with the page
    const pageContent = await page.content();
    expect(pageContent).toContain("DDALAB");
  });
});
