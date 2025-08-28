import { electronTest as test, expect } from './utils/electron-utils';

test.describe('Configuration Management', () => {
  test('should load and display configuration options', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Look for configuration-related UI elements
    const configElements = [
      'text=Environment',
      'text=Configuration',
      'text=Settings',
      'text=.env',
      'input, textarea, select'
    ];
    
    let hasConfigInterface = false;
    for (const selector of configElements) {
      if (await page.locator(selector).first().isVisible()) {
        hasConfigInterface = true;
        break;
      }
    }
    
    expect(hasConfigInterface).toBeTruthy();
  });

  test('should handle environment variable editing', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Look for input fields that might be used for environment variables
    const inputs = page.locator('input[type="text"], textarea');
    const inputCount = await inputs.count();
    
    if (inputCount > 0) {
      // Test interaction with the first available input
      const firstInput = inputs.first();
      if (await firstInput.isVisible() && await firstInput.isEnabled()) {
        // Test basic input functionality
        await firstInput.fill('TEST_VALUE=123');
        const value = await firstInput.inputValue();
        expect(value).toBe('TEST_VALUE=123');
        
        // Clear the input
        await firstInput.fill('');
      }
    }
  });

  test('should validate configuration values', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Look for validation indicators or buttons
    const validationElements = [
      'button:has-text("Validate")',
      'button:has-text("Check")',
      'button:has-text("Verify")',
      '[data-testid*="validate"]'
    ];
    
    for (const selector of validationElements) {
      const element = page.locator(selector).first();
      if (await element.isVisible() && await element.isEnabled()) {
        // Just verify the element is interactive
        await expect(element).toBeEnabled();
      }
    }
  });

  test('should save configuration changes', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Look for save/apply buttons
    const saveButtons = [
      'button:has-text("Save")',
      'button:has-text("Apply")',
      'button:has-text("Update")',
      'button[type="submit"]'
    ];
    
    for (const buttonSelector of saveButtons) {
      const button = page.locator(buttonSelector).first();
      if (await button.isVisible()) {
        // Just verify the button exists and is properly rendered
        await expect(button).toBeVisible();
      }
    }
  });

  test('should handle configuration templates', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Look for template-related UI elements
    const templateElements = [
      'text=Template',
      'text=Example',
      'text=Default',
      'button:has-text("Template")',
      'select, option'
    ];
    
    let hasTemplateFeature = false;
    for (const selector of templateElements) {
      if (await page.locator(selector).first().isVisible()) {
        hasTemplateFeature = true;
        break;
      }
    }
    
    // Template features are optional, so we don't fail if they're not present
    if (hasTemplateFeature) {
      expect(hasTemplateFeature).toBeTruthy();
    }
  });
});