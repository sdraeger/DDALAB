import { test as base, Page } from '@playwright/test';
import { DashboardPage } from '../pages/DashboardPage';

type TestFixtures = {
  dashboardPage: DashboardPage;
  readyPage: Page;
};

export const test = base.extend<TestFixtures>({
  // Custom page fixture that handles auth detection issues
  readyPage: async ({ page }, use) => {
    // Navigate to the dashboard
    await page.goto('/');
    
    // Handle the NextJS hydration/auth detection issue
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      // Check if we're stuck on auth detection
      const authDetecting = await page.locator('text=Detecting authentication mode').isVisible().catch(() => false);
      
      if (authDetecting) {
        console.log(`Attempt ${attempts}: Auth detection issue detected, reloading...`);
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000); // Give it time to hydrate
        continue;
      }
      
      // Check if dashboard elements are visible
      const saveButton = page.locator('button:has-text("Save Layout")').first();
      const isReady = await saveButton.isVisible().catch(() => false);
      
      if (isReady) {
        console.log(`✅ Dashboard ready after ${attempts} attempt(s)`);
        break;
      }
      
      if (attempts < maxAttempts) {
        console.log(`Attempt ${attempts}: Dashboard not ready, reloading...`);
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000);
      }
    }
    
    // Final check - if still not ready, we'll let the test fail with proper error
    const finalCheck = await page.locator('button:has-text("Save Layout")').first().isVisible().catch(() => false);
    if (!finalCheck) {
      console.log('❌ Dashboard still not ready after all attempts');
    }
    
    await use(page);
  },
  
  // Dashboard page fixture that uses the ready page
  dashboardPage: async ({ readyPage }, use) => {
    const dashboardPage = new DashboardPage(readyPage);
    await use(dashboardPage);
  },
});