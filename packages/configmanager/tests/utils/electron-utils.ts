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
  const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
  
  // In CI environments, don't wait long for quit dialogs - they may not appear consistently
  if (isCI) {
    try {
      const quitModal = page.locator('.modal:has-text("Quit DDALAB ConfigManager")');
      const isVisible = await quitModal.isVisible();
      
      if (isVisible) {
        console.log('Quit confirmation modal detected in CI, handling quickly...');
        const quitButton = page.locator('.modal-footer button.btn-primary').filter({ hasText: /Quit/ });
        await quitButton.click({ force: true, timeout: 2000 });
        await page.waitForTimeout(1000); // Quick wait
      }
    } catch (error) {
      // In CI, silently continue if quit dialog handling fails
      console.log('CI: Quit dialog handling skipped or failed - proceeding with cleanup');
    }
    return;
  }

  // Local development - more thorough quit dialog handling
  try {
    const quitModal = page.locator('.modal:has-text("Quit DDALAB ConfigManager")');
    await quitModal.waitFor({ timeout: 3000 });
    
    console.log('Quit confirmation modal detected, handling...');
    
    const quitButton = page.locator('.modal-footer button.btn-primary').filter({ hasText: /Quit/ });
    await quitButton.waitFor({ state: 'visible', timeout: 2000 });
    
    const buttonText = await quitButton.textContent();
    console.log(`Found quit button with text: "${buttonText}"`);
    
    await quitButton.click({ force: true });
    await page.waitForTimeout(2000);
    
  } catch (error) {
    console.log('No quit confirmation dialog appeared or could not handle it:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Gracefully close the Electron app, handling quit confirmation if it appears
 */
async function gracefullyCloseElectronApp(electronApp: ElectronApplication): Promise<void> {
  const isWindows = process.platform === 'win32';
  const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
  
  // In CI environments, use a more aggressive and faster close strategy
  if (isCI) {
    try {
      // Try to get windows, but don't wait long
      const windows = electronApp.windows();
      
      if (windows.length > 0) {
        const mainWindow = windows[0];
        
        // Quick quit attempt without waiting for dialogs
        try {
          await mainWindow.evaluate(() => {
            if (window.electronAPI && window.electronAPI.quitApp) {
              window.electronAPI.quitApp();
            }
          });
        } catch (error) {
          // Ignore API errors in CI
        }
        
        // Quick dialog handling
        await handleQuitConfirmation(mainWindow);
      }
      
      // Force close after short timeout in CI
      await Promise.race([
        electronApp.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('CI close timeout')), 10000))
      ]);
      
    } catch (error) {
      console.log('CI: Fast close failed, app may already be closed');
      // Don't throw in CI - let tests continue
    }
    return;
  }

  // Local development - more thorough handling
  try {
    const windows = electronApp.windows();
    
    if (windows.length > 0) {
      const mainWindow = windows[0];
      
      try {
        await mainWindow.evaluate(() => {
          if (window.electronAPI && window.electronAPI.quitApp) {
            console.log('Triggering app quit through electronAPI');
            window.electronAPI.quitApp();
          }
        });
        
        await mainWindow.waitForTimeout(1000);
        await handleQuitConfirmation(mainWindow);
        
        await electronApp.waitForEvent('close', { timeout: 5000 }).catch(() => {
          console.log('App close event timeout - app might already be closed');
        });
        
        return;
      } catch (quitError) {
        console.log('Error using quitApp API, falling back to regular close');
      }
    }
    
    // Fallback close with reasonable timeout
    await Promise.race([
      electronApp.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 15000))
    ]);
    
  } catch (error) {
    console.log('Error during graceful close, forcing close:', error instanceof Error ? error.message : String(error));
    electronApp.close().catch(() => {});
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