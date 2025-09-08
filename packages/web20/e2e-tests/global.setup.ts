import { chromium, FullConfig } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

async function globalSetup(config: FullConfig) {
  console.log('🚀 Starting global setup for DDALAB E2E tests...');

  const { baseURL, storageState } = config.projects[0].use;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // Navigate to the base URL and handle potential SSL issues
    await page.goto(baseURL!);
    
    // Wait for initial page load, but with shorter timeout and more flexible approach
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
    
    // Wait for auth detection to complete (give it time to resolve)
    await page.waitForTimeout(3000);
    
    // Check if we're still in auth detection mode or if we have a working dashboard
    const authDetecting = await page.locator('text=Detecting authentication mode').isVisible().catch(() => false);
    
    if (authDetecting) {
      console.log('⏳ Auth mode detection in progress, waiting...');
      // Wait for it to resolve, but don't wait forever
      await page.waitForSelector('text=Detecting authentication mode', { state: 'hidden', timeout: 10000 }).catch(() => {
        console.log('⚠️ Auth detection timeout, continuing anyway...');
      });
    }
    
    // Check if we need to perform authentication
    const isLoginPage = await page.locator('[data-testid="login-form"]').isVisible().catch(() => false);
    
    if (isLoginPage) {
      console.log('🔐 Performing authentication setup...');
      const loginPage = new LoginPage(page);
      
      // Attempt login with default credentials
      // This assumes you have default test credentials - adjust as needed
      await loginPage.login('admin', 'admin');
      
      // Wait for successful login and redirect to main page
      await page.waitForURL('**/', { timeout: 15000 });
      console.log('✅ Authentication successful');
    } else {
      console.log('📊 App already authenticated or no auth required');
    }

    // Save authentication state for other tests
    if (storageState) {
      await page.context().storageState({ path: storageState as string });
      console.log('💾 Saved authentication state');
    }

  } catch (error) {
    console.error('❌ Global setup failed:', error);
    throw error;
  } finally {
    await browser.close();
  }

  console.log('✅ Global setup completed successfully');
}

export default globalSetup;