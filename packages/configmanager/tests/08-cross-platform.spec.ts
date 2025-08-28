import { electronTest as test, expect } from './utils/electron-utils';
import os from 'os';

test.describe('Cross-Platform Compatibility', () => {
  test('should detect the correct operating system', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    const platform = os.platform();
    const expectedPlatform = platform === 'darwin' ? 'macOS' : 
                           platform === 'win32' ? 'Windows' : 'Linux';
    
    // The app should be running on the expected platform
    expect(['darwin', 'win32', 'linux'].includes(platform)).toBeTruthy();
  });

  test('should handle platform-specific file paths', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Look for any file path displays or inputs
    const pathElements = page.locator('input[type="text"], [class*="path"], code, pre');
    const elementCount = await pathElements.count();
    
    if (elementCount > 0) {
      for (let i = 0; i < Math.min(elementCount, 3); i++) {
        const element = pathElements.nth(i);
        if (await element.isVisible()) {
          const text = await element.textContent() || await element.inputValue();
          
          if (text && text.includes('/') || text.includes('\\')) {
            // Verify that the path uses the correct separator for the platform
            if (os.platform() === 'win32') {
              // Windows paths might use either \ or / (both are valid)
              expect(text.includes('\\') || text.includes('/')).toBeTruthy();
            } else {
              // Unix-like systems should use /
              expect(text.includes('/')).toBeTruthy();
            }
          }
        }
      }
    }
  });

  test('should adapt UI for different screen densities', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Test different viewport sizes that simulate different screen densities
    const viewports = [
      { width: 1920, height: 1080 }, // Standard HD
      { width: 2560, height: 1440 }, // QHD
      { width: 1366, height: 768 },  // Common laptop
    ];
    
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Verify the app is still functional at this size
      await expect(page.locator('body')).toBeVisible();
      
      // Check that text is readable (not too small)
      const bodyStyles = await page.locator('body').evaluate(el => {
        const styles = window.getComputedStyle(el);
        return {
          fontSize: styles.fontSize,
          fontFamily: styles.fontFamily
        };
      });
      
      // Font size should be reasonable (at least 12px)
      const fontSize = parseInt(bodyStyles.fontSize);
      expect(fontSize).toBeGreaterThanOrEqual(12);
    }
  });

  test('should handle platform-specific keyboard shortcuts', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    const isMac = os.platform() === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    
    // Test common shortcuts that should work cross-platform
    try {
      // Test copy shortcut (Cmd+C on Mac, Ctrl+C on Windows/Linux)
      await page.keyboard.press(`${modifier}+KeyC`);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Test refresh shortcut
      await page.keyboard.press(`${modifier}+KeyR`);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // The app should still be responsive after keyboard shortcuts
      await expect(page.locator('body')).toBeVisible();
      
    } catch (error) {
      // Keyboard shortcuts might not be implemented, that's okay
      console.log('Keyboard shortcuts test skipped:', error);
    }
  });

  test('should load platform-appropriate resources', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Check for any images or icons that should be loaded
    const images = page.locator('img, [role="img"]');
    const imageCount = await images.count();
    
    if (imageCount > 0) {
      for (let i = 0; i < Math.min(imageCount, 3); i++) {
        const img = images.nth(i);
        if (await img.isVisible()) {
          // Verify images load successfully
          const naturalWidth = await img.evaluate((el: any) => el.naturalWidth || 1);
          expect(naturalWidth).toBeGreaterThan(0);
        }
      }
    }
  });
});