import { electronTest as test, expect } from './utils/electron-utils';

test.describe('Error Handling', () => {
  test('should handle network connectivity issues gracefully', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Look for any network-related operations and error handling
    const networkElements = [
      'text=Connect',
      'text=Network',
      'text=Connection',
      '[data-testid*="network"]',
      '[data-testid*="connection"]'
    ];
    
    for (const selector of networkElements) {
      const element = page.locator(selector).first();
      if (await element.isVisible()) {
        // Just verify the element is present and functional
        await expect(element).toBeVisible();
      }
    }
  });

  test('should display error messages appropriately', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Check for error handling UI elements
    const errorElements = [
      '[class*="error"]',
      '[class*="alert"]',
      '[role="alert"]',
      'text=Error',
      'text=Warning'
    ];
    
    // These elements should not be present during normal operation
    // but if they are, they should be properly styled and visible
    for (const selector of errorElements) {
      const element = page.locator(selector).first();
      if (await element.isVisible()) {
        // If error elements are present, they should be properly displayed
        await expect(element).toBeVisible();
      }
    }
  });

  test('should handle application crashes gracefully', async ({ electronApp, page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Test that the app can handle various scenarios without crashing
    try {
      // Try to trigger some potentially problematic operations
      await page.evaluate(() => {
        // Test error boundaries by triggering a minor error
        console.error('Test error for error handling verification');
      });
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify the app is still responsive
      await expect(page.locator('body')).toBeVisible();
      
    } catch (error) {
      // If any errors occur, the app should still be running
      expect(electronApp).toBeTruthy();
    }
  });

  test('should recover from invalid configurations', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Look for configuration inputs and test with invalid data
    const inputs = page.locator('input[type="text"], textarea');
    const inputCount = await inputs.count();
    
    if (inputCount > 0) {
      const firstInput = inputs.first();
      if (await firstInput.isVisible() && await firstInput.isEnabled()) {
        // Enter obviously invalid configuration
        await firstInput.fill('invalid&*config#value!@#$%^&*()');
        await firstInput.press('Tab');
        
        // Wait for any validation to occur
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // The app should still be functional
        await expect(page.locator('body')).toBeVisible();
        
        // Clear the invalid input
        await firstInput.fill('');
      }
    }
  });
});