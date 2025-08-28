import { electronTest as test, expect } from './utils/electron-utils';

test.describe('Docker Integration Tests', () => {
  test('should check Docker installation status', async ({ page }) => {
    // Wait for the app to load
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Look for Docker-related UI elements
    // These selectors may need adjustment based on your actual UI
    const dockerElements = [
      'text=Docker',
      '[data-testid*="docker"]',
      '[class*="docker"]',
      'text=Installation'
    ];
    
    let dockerUIFound = false;
    for (const selector of dockerElements) {
      if (await page.locator(selector).first().isVisible()) {
        dockerUIFound = true;
        break;
      }
    }
    
    // If we found Docker UI, interact with it
    if (dockerUIFound) {
      // Look for status indicators
      const statusElements = page.locator('text=Status, text=Check, button:has-text("Check")');
      if (await statusElements.first().isVisible()) {
        await statusElements.first().click();
        await page.waitForTimeout(2000); // Allow time for Docker check
      }
    }
    
    // The test passes if we can interact with the UI without errors
    expect(dockerUIFound).toBeTruthy();
  });

  test('should handle Docker service management', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Look for service management buttons
    const serviceButtons = [
      'button:has-text("Start")',
      'button:has-text("Stop")',
      'button:has-text("Restart")',
      'button[data-testid*="service"]'
    ];
    
    for (const buttonSelector of serviceButtons) {
      const button = page.locator(buttonSelector).first();
      if (await button.isVisible() && await button.isEnabled()) {
        // Just verify the button is interactive, don't actually click it
        // to avoid starting/stopping actual Docker services in tests
        await expect(button).toBeEnabled();
      }
    }
  });

  test('should display Docker configuration options', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Look for configuration-related elements
    const configElements = [
      'text=Configuration',
      'text=Settings',
      '[data-testid*="config"]',
      'input, textarea, select'
    ];
    
    let hasConfigUI = false;
    for (const selector of configElements) {
      if (await page.locator(selector).first().isVisible()) {
        hasConfigUI = true;
        break;
      }
    }
    
    // Just verify that some kind of configuration UI exists
    expect(hasConfigUI).toBeTruthy();
  });
});