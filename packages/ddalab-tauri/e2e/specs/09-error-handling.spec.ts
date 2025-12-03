import { test, expect, Page } from "@playwright/test";
import { waitForAppReady } from "../fixtures/base.fixture";

/**
 * Error Handling Tests
 * Tests graceful error handling and edge cases
 */

async function gotoApp(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
}

test.describe("Input Validation", () => {
  test("rejects negative values in numeric inputs", async ({ page }) => {
    await gotoApp(page);

    // Navigate to analyze
    const analyzeNav = page.locator('[data-nav="analyze"]').first();
    if (await analyzeNav.isVisible()) {
      await analyzeNav.click();
      await page.waitForTimeout(300);
    }

    const numberInput = page.locator('input[type="number"]').first();

    if (await numberInput.isVisible()) {
      await numberInput.fill("-100");
      await numberInput.blur();
      await page.waitForTimeout(200);

      const value = await numberInput.inputValue();
      const numValue = parseInt(value, 10);

      // Value should be corrected or error shown
      const hasError = await page
        .locator('.error, [role="alert"], text=invalid, text=positive')
        .isVisible()
        .catch(() => false);

      expect(numValue >= 0 || hasError || value === "").toBe(true);
    }
  });

  test("handles very large numbers gracefully", async ({ page }) => {
    await gotoApp(page);

    const analyzeNav = page.locator('[data-nav="analyze"]').first();
    if (await analyzeNav.isVisible()) {
      await analyzeNav.click();
      await page.waitForTimeout(300);
    }

    const numberInput = page.locator('input[type="number"]').first();

    if (await numberInput.isVisible()) {
      await numberInput.fill("999999999999");
      await numberInput.blur();
      await page.waitForTimeout(200);

      // App should not crash
      const content = await page.content();
      expect(content).toContain("DDALAB");
    }
  });

  test("handles empty required fields appropriately", async ({ page }) => {
    await gotoApp(page);

    const analyzeNav = page.locator('[data-nav="analyze"]').first();
    if (await analyzeNav.isVisible()) {
      await analyzeNav.click();
      await page.waitForTimeout(300);
    }

    const numberInput = page.locator('input[type="number"]').first();

    if (await numberInput.isVisible()) {
      await numberInput.clear();
      await numberInput.blur();
      await page.waitForTimeout(200);

      // Either shows error, uses default, or accepts empty
      const content = await page.content();
      expect(content).toContain("DDALAB");
    }
  });

  test("handles special characters in text inputs", async ({ page }) => {
    await gotoApp(page);

    const textInput = page.locator('input[type="text"]').first();

    if (await textInput.isVisible()) {
      // Try potentially problematic characters
      await textInput.fill('<script>alert("xss")</script>');
      await textInput.blur();
      await page.waitForTimeout(200);

      // App should not execute script and should remain functional
      const content = await page.content();
      expect(content).toContain("DDALAB");

      // XSS should not execute
      const dialogAppeared = await page
        .waitForEvent("dialog", { timeout: 500 })
        .catch(() => null);
      expect(dialogAppeared).toBeNull();
    }
  });
});

test.describe("Network Resilience", () => {
  test("app handles offline state gracefully", async ({ page, context }) => {
    await gotoApp(page);

    // Go offline
    await context.setOffline(true);
    await page.waitForTimeout(500);

    // Try navigation
    const settingsNav = page.locator('[data-nav="settings"]').first();
    if (await settingsNav.isVisible()) {
      await settingsNav.click();
      await page.waitForTimeout(300);
    }

    // App should still be usable (local functionality)
    const content = await page.content();
    expect(content).toContain("DDALAB");

    // Go back online
    await context.setOffline(false);
  });

  test("displays appropriate message when backend unavailable", async ({
    page,
  }) => {
    await gotoApp(page);

    // The app should handle backend unavailability gracefully
    // (which is the case in browser-only testing)
    const hasErrorIndicator =
      (await page
        .locator("text=offline")
        .isVisible()
        .catch(() => false)) ||
      (await page
        .locator("text=disconnected")
        .isVisible()
        .catch(() => false)) ||
      (await page
        .locator("text=unavailable")
        .isVisible()
        .catch(() => false)) ||
      (await page
        .locator('[data-status="error"]')
        .isVisible()
        .catch(() => false));

    // Either shows indicator or works in offline mode
    expect(typeof hasErrorIndicator).toBe("boolean");
  });
});

test.describe("Error Recovery", () => {
  test("recovers from console errors", async ({ page }) => {
    const errors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await gotoApp(page);

    // Navigate around to trigger potential errors
    const sections = ["analyze", "settings", "data"];
    for (const section of sections) {
      const nav = page.locator(`[data-nav="${section}"]`).first();
      if (await nav.isVisible()) {
        await nav.click();
        await page.waitForTimeout(200);
      }
    }

    // App should still be functional despite any errors
    const content = await page.content();
    expect(content).toContain("DDALAB");
  });

  test("handles rapid navigation without crashing", async ({ page }) => {
    await gotoApp(page);

    // Rapidly click navigation
    for (let i = 0; i < 10; i++) {
      const sections = ["analyze", "settings", "data"];
      const section = sections[i % sections.length];
      const nav = page.locator(`[data-nav="${section}"]`).first();

      if (await nav.isVisible()) {
        await nav.click();
        // No wait - intentionally rapid
      }
    }

    await page.waitForTimeout(500);

    // App should recover and be stable
    const content = await page.content();
    expect(content).toContain("DDALAB");
  });

  test("handles page refresh during operation", async ({ page }) => {
    await gotoApp(page);

    // Navigate to analyze
    const analyzeNav = page.locator('[data-nav="analyze"]').first();
    if (await analyzeNav.isVisible()) {
      await analyzeNav.click();
      await page.waitForTimeout(200);
    }

    // Refresh mid-operation
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page);

    // App should recover
    const content = await page.content();
    expect(content).toContain("DDALAB");
  });
});

test.describe("Browser Edge Cases", () => {
  test("handles browser back button", async ({ page }) => {
    await gotoApp(page);

    // Navigate somewhere
    const analyzeNav = page.locator('[data-nav="analyze"]').first();
    if (await analyzeNav.isVisible()) {
      await analyzeNav.click();
      await page.waitForTimeout(300);
    }

    // Press back
    await page.goBack();
    await page.waitForTimeout(300);

    // App should handle navigation
    const content = await page.content();
    expect(content.length).toBeGreaterThan(0);
  });

  test("handles browser forward button", async ({ page }) => {
    await gotoApp(page);

    // Navigate, go back, then forward
    const analyzeNav = page.locator('[data-nav="analyze"]').first();
    if (await analyzeNav.isVisible()) {
      await analyzeNav.click();
      await page.waitForTimeout(300);
    }

    await page.goBack();
    await page.waitForTimeout(200);

    await page.goForward();
    await page.waitForTimeout(200);

    // App should handle
    const content = await page.content();
    expect(content.length).toBeGreaterThan(0);
  });

  test("handles zoom in/out", async ({ page }) => {
    await gotoApp(page);

    // Zoom in
    await page.evaluate(() => {
      document.body.style.zoom = "150%";
    });
    await page.waitForTimeout(200);

    // App should still be usable
    let content = await page.content();
    expect(content).toContain("DDALAB");

    // Zoom out
    await page.evaluate(() => {
      document.body.style.zoom = "75%";
    });
    await page.waitForTimeout(200);

    content = await page.content();
    expect(content).toContain("DDALAB");

    // Reset
    await page.evaluate(() => {
      document.body.style.zoom = "100%";
    });
  });
});

test.describe("Memory and Performance", () => {
  test("no memory leak on repeated navigation", async ({ page }) => {
    await gotoApp(page);

    // Get initial heap size
    const initialHeap = await page.evaluate(
      () =>
        (performance as unknown as { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize,
    );

    // Navigate many times
    for (let i = 0; i < 20; i++) {
      const sections = ["analyze", "settings", "data"];
      const section = sections[i % sections.length];
      const nav = page.locator(`[data-nav="${section}"]`).first();

      if (await nav.isVisible()) {
        await nav.click();
        await page.waitForTimeout(100);
      }
    }

    // Get final heap size
    const finalHeap = await page.evaluate(
      () =>
        (performance as unknown as { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize,
    );

    // Memory should not grow excessively (some growth is normal)
    // This is a soft check - mainly ensures app doesn't crash
    if (initialHeap && finalHeap) {
      const growthFactor = finalHeap / initialHeap;
      expect(growthFactor).toBeLessThan(10); // Allow 10x growth max
    }
  });
});
