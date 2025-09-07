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
  const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  
  // In CI environments, use faster quit handling but still try to click properly
  if (isCI) {
    try {
      // Quick check if modal is visible first
      const quitModal = page.locator('.modal:has-text("Quit DDALAB ConfigManager")');
      const isModalVisible = await quitModal.isVisible({ timeout: 1000 }).catch(() => false);
      
      if (!isModalVisible) {
        // No modal visible, skip handling
        return;
      }
      
      console.log('Quit confirmation modal detected in CI, handling...');
      
      // Try the most specific selector first
      try {
        const quitButton = page.locator('.modal-footer button.btn-primary').filter({ hasText: /Quit/ });
        if (await quitButton.isVisible({ timeout: 500 })) {
          await quitButton.click({ force: true });
          console.log('CI: Clicked quit button');
          await page.waitForTimeout(500);
          return;
        }
      } catch (error) {
        // Continue to fallback
      }
      
      // Fallback: JavaScript click
      try {
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const quitButton = buttons.find(btn => btn.textContent?.includes('Quit'));
          if (quitButton) {
            quitButton.click();
            return true;
          }
          return false;
        });
      } catch (error) {
        // Ignore JavaScript errors
      }
      
    } catch (error) {
      // Silently ignore all errors in CI
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
  const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  
  // In CI environments, use a more aggressive and faster close strategy
  if (isCI) {
    const isLinux = process.platform === 'linux';
    const ciTimeout = isLinux ? 5000 : 10000; // Even shorter timeout for Linux
    
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
        
        // Quick dialog handling with very short timeout for Linux
        try {
          await Promise.race([
            handleQuitConfirmation(mainWindow),
            new Promise(resolve => setTimeout(resolve, isLinux ? 1000 : 2000))
          ]);
        } catch (error) {
          // Ignore dialog handling errors in CI
        }
      }
      
      // Force close after very short timeout in CI, especially Linux
      await Promise.race([
        electronApp.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('CI close timeout')), ciTimeout))
      ]);
      
    } catch (error) {
      console.log(`CI: Fast close failed (${process.platform}), attempting force kill`);
      
      // On Linux, try to force kill the process if normal close fails
      if (isLinux) {
        try {
          const { execSync } = require('child_process');
          execSync('pkill -f electron || true', { stdio: 'ignore' });
        } catch (killError) {
          // Ignore kill errors
        }
      }
      
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
    const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true' || process.env.GITHUB_ACTIONS === 'true';
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
    
    // Launch Electron app with platform-specific adjustments
    const isLinux = process.platform === 'linux';
    const launchOptions = {
      args: [path.join(__dirname, '../../dist/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_IS_TESTING: 'true',
        ...mockEnvVars,
        CI: process.env.CI || 'false'
      },
      // Platform-specific timeouts - shorter for Linux to prevent hangs
      timeout: isCI ? (isWindows ? 60000 : isLinux ? 30000 : 45000) : 30000
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