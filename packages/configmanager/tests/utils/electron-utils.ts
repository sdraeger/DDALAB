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
  try {
    // Get all windows before closing
    const windows = electronApp.windows();
    
    if (windows.length > 0) {
      const mainWindow = windows[0];
      
      // Set up a handler for the quit confirmation dialog
      const handleQuitPromise = handleQuitConfirmation(mainWindow);
      
      // Try to close the app
      const closePromise = electronApp.close();
      
      // Wait for either the close to complete or the quit handler to finish
      await Promise.race([
        closePromise,
        handleQuitPromise.then(() => {
          // After handling the dialog, give the app a moment to close naturally
          return new Promise(resolve => setTimeout(resolve, 2000));
        })
      ]);
    } else {
      // No windows, just close directly
      await electronApp.close();
    }
    
  } catch (error) {
    console.log('Error during graceful close, forcing close:', error.message);
    
    // If graceful close fails, try to force close
    try {
      await electronApp.close();
    } catch (forceError) {
      console.log('Force close also failed:', forceError.message);
      // The app might already be closed, which is fine
    }
  }
}

export const electronTest = test.extend<ElectronTestContext>({
  electronApp: async ({}, use) => {
    const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
    let mockEnvVars = {};
    
    // Only use virtualized environment when running locally (not in CI)
    if (!isCI) {
      console.log('Running locally - initializing virtualized test environment');
      await MockEnvironment.initialize();
      mockEnvVars = MockEnvironment.getEnvironmentVariables();
    } else {
      console.log('Running in CI - using real environment without virtualization');
    }
    
    // Launch Electron app
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '../../dist/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_IS_TESTING: 'true',
        ...mockEnvVars,
        CI: process.env.CI || 'false'
      }
    });

    await use(electronApp);
    
    // Use our graceful close function
    await gracefullyCloseElectronApp(electronApp);
    
    // Cleanup the mock environment only if it was initialized
    if (!isCI) {
      await MockEnvironment.cleanup();
    }
  },

  page: async ({ electronApp }, use) => {
    // Get the main window
    const page = await electronApp.firstWindow();
    
    // Wait for the page to be ready
    await page.waitForLoadState('domcontentloaded');
    
    await use(page);
  },
});

export const expect = test.expect;