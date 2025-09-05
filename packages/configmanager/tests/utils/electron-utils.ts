import { ElectronApplication, Page, _electron as electron } from 'playwright';
import { test } from '@playwright/test';
import path from 'path';
import { MockEnvironment } from '../setup/mock-environment';

// Declare window.electronAPI for TypeScript
declare global {
  interface Window {
    electronAPI: {
      quitApp: () => void;
    };
  }
}

export interface ElectronTestContext {
  electronApp: ElectronApplication;
  page: Page;
}

/**
 * Helper function to handle the quit confirmation dialog
 */
async function handleQuitConfirmation(page: Page): Promise<void> {
  try {
    // Wait for the quit confirmation modal to appear (with a longer timeout in CI)
    const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
    const modalTimeout = isCI ? 5000 : 3000;
    
    const quitModal = page.locator('.modal:has-text("Quit DDALAB ConfigManager")');
    await quitModal.waitFor({ timeout: modalTimeout });
    
    console.log('Quit confirmation modal detected, handling...');
    
    // The quit button is in the modal footer and contains an icon + "Quit" text
    // It's the primary button in the modal footer
    const quitButton = page.locator('.modal-footer button.btn-primary');
    
    // Wait for the button to be visible and enabled
    await quitButton.waitFor({ state: 'visible', timeout: 2000 });
    
    // Debug: log button details
    const buttonText = await quitButton.textContent();
    console.log(`Found quit button with text: "${buttonText}"`);
    
    // Make sure the button is not disabled
    const isDisabled = await quitButton.isDisabled();
    if (isDisabled) {
      console.log('Quit button is disabled, waiting...');
      await page.waitForTimeout(500);
    }
    
    // Try different click strategies
    try {
      // First try: regular click
      await quitButton.click({ force: true });
      console.log('Clicked quit button using regular click');
    } catch (clickError) {
      console.log('Regular click failed, trying alternative methods...');
      
      // Alternative: evaluate JavaScript click
      await page.evaluate(() => {
        const button = document.querySelector('.modal-footer button.btn-primary') as HTMLButtonElement;
        if (button) {
          button.click();
          console.log('Clicked button via JavaScript');
        }
      });
    }
    
    // Wait a bit for the quit process to complete
    await page.waitForTimeout(2000);
    
  } catch (error) {
    // If no quit dialog appears within the timeout, that's fine too
    console.log('No quit confirmation dialog appeared or could not handle it:', error instanceof Error ? error.message : String(error));
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
      
      // Trigger the app's quit flow through the API
      try {
        await mainWindow.evaluate(() => {
          if (window.electronAPI && window.electronAPI.quitApp) {
            console.log('Triggering app quit through electronAPI');
            window.electronAPI.quitApp();
          }
        });
        
        // Give the quit dialog time to appear
        await mainWindow.waitForTimeout(1000);
        
        // Now handle the quit confirmation dialog
        await handleQuitConfirmation(mainWindow);
        
        // Wait for the app to close
        await electronApp.waitForEvent('close', { timeout: 5000 }).catch(() => {
          console.log('App close event timeout - app might already be closed');
        });
        
        return;
      } catch (quitError) {
        console.log('Error using quitApp API, falling back to regular close');
      }
    }
    
    // Fallback: For Windows in CI, use a more aggressive close strategy
    if (isWindows && isCI) {
      // Don't wait for graceful close on Windows CI
      electronApp.close().catch(() => {});
      // Give it a longer moment to start closing
      await new Promise(resolve => setTimeout(resolve, 5000));
      return;
    }
    
    // Fallback: For other platforms, use normal close with timeout
    // Use longer timeout in CI environments (45s) vs local (15s)
    const closeTimeout = isCI ? 45000 : 15000;
    
    await Promise.race([
      electronApp.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), closeTimeout))
    ]);
    
  } catch (error) {
    console.log('Error during graceful close, forcing close:', error instanceof Error ? error.message : String(error));
    
    // In CI, don't force close - let the test framework handle cleanup
    // This prevents abrupt termination that might affect subsequent tests
    if (!isCI) {
      // Only force close in local development
      electronApp.close().catch(() => {});
    }
    
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
          console.log('Failed to get first window after all retries:', error instanceof Error ? error.message : String(error));
          throw error;
        }
        console.log(`First window attempt ${retryCount} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    if (!page) {
      throw new Error('Failed to get first window after all retries');
    }
    
    // Wait for the page to be ready
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    
    await use(page);
  },
});

export const expect = test.expect;