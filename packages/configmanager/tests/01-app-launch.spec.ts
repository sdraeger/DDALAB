import { electronTest as test, expect } from './utils/electron-utils';

test.describe('ConfigManager App Launch', () => {
  test('should launch the application successfully', async ({ electronApp, page }) => {
    // Verify the app launched
    expect(electronApp).toBeTruthy();
    
    // Check that we have a window
    expect(page).toBeTruthy();
    
    // Wait for the app to be ready
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Check window title
    const title = await page.title();
    expect(title).toContain('ConfigManager');
  });

  test('should display the welcome screen', async ({ page }) => {
    // Look for welcome elements that should be present
    await expect(page.locator('text=Welcome')).toBeVisible({ timeout: 10000 });
  });

  test('should have proper window dimensions', async ({ electronApp, page }) => {
    // For Electron apps, we need to get the actual window bounds rather than viewport size
    const window = await electronApp.firstWindow();
    const boundingBox = await window.evaluate(() => {
      return {
        width: window.outerWidth,
        height: window.outerHeight
      };
    });
    
    expect(boundingBox.width).toBeGreaterThan(600);
    expect(boundingBox.height).toBeGreaterThan(400);
  });

  test('should not show any console errors on startup', async ({ page }) => {
    const errors: string[] = [];
    
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    // Wait a bit to catch any errors
    await page.waitForTimeout(3000);
    
    // Filter out common acceptable errors
    const filteredErrors = errors.filter(error => 
      !error.includes('DevTools') && 
      !error.includes('Extension')
    );
    
    expect(filteredErrors).toHaveLength(0);
  });
});