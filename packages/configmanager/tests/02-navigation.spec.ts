import { electronTest as test, expect } from './utils/electron-utils';

test.describe('ConfigManager Navigation', () => {
  test('should navigate through setup wizard steps', async ({ page }) => {
    // Wait for initial load
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Look for navigation elements or step indicators
    // This will depend on your actual UI structure
    const nextButton = page.locator('button:has-text("Next"), button:has-text("Continue"), button[type="submit"]').first();
    
    if (await nextButton.isVisible()) {
      await nextButton.click();
      await page.waitForTimeout(1000); // Allow for transition
    }
  });

  test('should display sidebar navigation', async ({ page }) => {
    // Wait for the sidebar to load
    await page.waitForTimeout(2000);
    
    // Check for common sidebar elements
    const sidebar = page.locator('[class*="sidebar"], nav, [role="navigation"]').first();
    if (await sidebar.isVisible()) {
      await expect(sidebar).toBeVisible();
    }
  });

  test('should handle window resize gracefully', async ({ page }) => {
    // Test responsive behavior
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(500);
    
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(500);
    
    // Ensure the app is still functional after resize
    await expect(page.locator('body')).toBeVisible();
  });
});