import { ElectronApplication, Page, _electron as electron } from 'playwright';
import { test } from '@playwright/test';
import path from 'path';
import { MockEnvironment } from '../setup/mock-environment';

export interface ElectronTestContext {
  electronApp: ElectronApplication;
  page: Page;
}

/**
 * Helper function to handle the quit confirmation dialog
 */
async function handleQuitConfirmation(page: Page): Promise<void> {
  try {
    // Wait for the quit confirmation modal to appear (with a short timeout)
    const quitModal = page.locator('.modal:has-text("Quit DDALAB ConfigManager")');
    await quitModal.waitFor({ timeout: 2000 });
    
    console.log('Quit confirmation modal detected, handling...');
    
    // Click the "Quit" button to confirm
    const quitButton = page.locator('button:has-text("Quit")').last();
    await quitButton.click();
    
    // Wait a bit for the quit process to complete
    await page.waitForTimeout(1000);
    
  } catch (error) {
    // If no quit dialog appears within the timeout, that's fine too
    console.log('No quit confirmation dialog appeared or could not handle it:', error.message);
  }
}

/**
 * Gracefully close the Electron app, handling quit confirmation if it appears
 */
async function gracefullyCloseElectronApp(electronApp: ElectronApplication): Promise<void> {
  const isWindows = process.platform === 'win32';
  const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
  
  try {
    // Get all windows before closing
    const windows = electronApp.windows();
    
    if (windows.length > 0) {
      const mainWindow = windows[0];
      
      // Handle quit confirmation dialog first, then close
      await handleQuitConfirmation(mainWindow);
    }
    
    // For Windows in CI, use a more aggressive close strategy
    if (isWindows && isCI) {
      // Don't wait for graceful close on Windows CI
      electronApp.close().catch(() => {});
      // Give it a moment to start closing
      await new Promise(resolve => setTimeout(resolve, 2000));
      return;
    }
    
    // For other platforms, use normal close with timeout
    await Promise.race([
      electronApp.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 15000))
    ]);
    
  } catch (error) {
    console.log('Error during graceful close, forcing close:', error.message);
    
    // Just log and continue - the app might already be closed
    return;
  }
}

export const electronTest = test.extend<ElectronTestContext>({
  electronApp: async ({}, use) => {
    const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
    const isWindows = process.platform === 'win32';
    let mockEnvVars = {};
    
    // Only use virtualized environment when running locally (not in CI)
    if (!isCI) {
      console.log('Running locally - initializing virtualized test environment');
      await MockEnvironment.initialize();
      mockEnvVars = MockEnvironment.getEnvironmentVariables();
    } else {
      console.log('Running in CI - using real environment without virtualization');
    }
    
    // Launch Electron app with Windows-specific adjustments
    const launchOptions = {
      args: [path.join(__dirname, '../../dist/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_IS_TESTING: 'true',
        ...mockEnvVars,
        CI: process.env.CI || 'false'
      },
      // Windows CI may need longer timeout
      timeout: isCI && isWindows ? 60000 : 30000
    };
    
    console.log(`Launching Electron app (CI: ${isCI}, Windows: ${isWindows}, timeout: ${launchOptions.timeout}ms)`);
    const electronApp = await electron.launch(launchOptions);

    await use(electronApp);
    
    // Use our graceful close function
    await gracefullyCloseElectronApp(electronApp);
    
    // Cleanup the mock environment only if it was initialized
    if (!isCI) {
      await MockEnvironment.cleanup();
    }
  },

  page: async ({ electronApp }, use) => {
    // Get the main window with increased timeout for Windows CI and retry logic
    let page;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        console.log(`Attempting to get first window (attempt ${retryCount + 1}/${maxRetries})`);
        page = await electronApp.firstWindow({ timeout: 60000 });
        break;
      } catch (error) {
        retryCount++;
        if (retryCount >= maxRetries) {
          console.log('Failed to get first window after all retries:', error.message);
          throw error;
        }
        console.log(`First window attempt ${retryCount} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Wait for the page to be ready
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    
    await use(page);
  },
});

export const expect = test.expect;