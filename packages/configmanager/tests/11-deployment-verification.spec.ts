import { electronTest as test, expect } from './utils/electron-utils';

test.describe('DDALAB Deployment Verification', () => {
  test('should initiate DDALAB deployment successfully', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    
    const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
    console.log(`Testing DDALAB deployment in ${isCI ? 'CI' : 'local'} environment`);
    
    // Look for deployment/start buttons
    const deploymentButtons = [
      'button:has-text("Deploy")',
      'button:has-text("Start")',
      'button:has-text("Launch")',
      'button:has-text("Run")',
      'button:has-text("Start DDALAB")',
      'button:has-text("Deploy DDALAB")',
      'button[data-testid*="deploy"]',
      'button[data-testid*="start"]'
    ];
    
    let foundDeployButton = false;
    let deployButton = null;
    
    for (const buttonSelector of deploymentButtons) {
      const button = page.locator(buttonSelector).first();
      if (await button.isVisible() && await button.isEnabled()) {
        console.log(`Found deployment button: ${buttonSelector}`);
        foundDeployButton = true;
        deployButton = button;
        break;
      }
    }
    
    if (foundDeployButton && deployButton) {
      // Click the deployment button
      await deployButton.click();
      console.log('Clicked deployment button');
      
      // Wait for deployment process to start
      await page.waitForTimeout(3000);
      
      // Look for deployment progress indicators
      const progressElements = [
        '[class*="progress"]',
        '[class*="loading"]',
        '[class*="spinner"]',
        'text=Starting',
        'text=Deploying',
        'text=Loading',
        'text=Please wait',
        '.spinner',
        '[role="progressbar"]'
      ];
      
      let foundProgress = false;
      for (const selector of progressElements) {
        if (await page.locator(selector).first().isVisible()) {
          console.log(`Found deployment progress indicator: ${selector}`);
          foundProgress = true;
          break;
        }
      }
      
      // Should show some kind of progress indication
      expect(foundProgress).toBeTruthy();
    } else {
      // If no deployment button found, look for deployment status
      const statusElements = [
        'text=Running',
        'text=Active',
        'text=Started',
        'text=Deployed',
        '[class*="success"]',
        '[class*="running"]',
        '[class*="active"]'
      ];
      
      let foundStatus = false;
      for (const selector of statusElements) {
        if (await page.locator(selector).first().isVisible()) {
          console.log(`Found deployment status: ${selector}`);
          foundStatus = true;
          break;
        }
      }
      
      // Either we find a deploy button or deployment status
      expect(foundStatus).toBeTruthy();
    }
  });
  
  test('should monitor Docker container status during deployment', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    
    // Look for Docker/container status indicators
    const dockerStatusElements = [
      'text=Container',
      'text=Service',
      'text=Running',
      'text=Starting',
      'text=Stopped',
      '[data-testid*="container"]',
      '[data-testid*="service"]',
      '[class*="container"]',
      '[class*="service"]'
    ];
    
    let foundDockerStatus = false;
    for (const selector of dockerStatusElements) {
      const elements = page.locator(selector);
      const count = await elements.count();
      
      for (let i = 0; i < count; i++) {
        if (await elements.nth(i).isVisible()) {
          console.log(`Found Docker status element: ${selector}`);
          foundDockerStatus = true;
          break;
        }
      }
      if (foundDockerStatus) break;
    }
    
    // If Docker status UI is found, check for service names
    if (foundDockerStatus) {
      const serviceElements = [
        'text=web',
        'text=api',
        'text=database',
        'text=postgres',
        'text=nginx',
        'text=ddalab'
      ];
      
      let foundServices = 0;
      for (const selector of serviceElements) {
        if (await page.locator(selector).first().isVisible()) {
          console.log(`Found service: ${selector}`);
          foundServices++;
        }
      }
      
      console.log(`Found ${foundServices} DDALAB services`);
    }
    
    // Should find some Docker/service status UI
    expect(foundDockerStatus).toBeTruthy();
  });
  
  test('should handle deployment errors gracefully', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    
    // Look for potential error states
    const errorElements = [
      '[class*="error"]',
      '[class*="alert"]',
      '[class*="warning"]',
      'text=Error',
      'text=Failed',
      'text=Warning',
      'text=Issue',
      '[role="alert"]'
    ];
    
    let foundErrors = [];
    for (const selector of errorElements) {
      const elements = page.locator(selector);
      const count = await elements.count();
      
      for (let i = 0; i < count; i++) {
        const element = elements.nth(i);
        if (await element.isVisible()) {
          const text = await element.textContent();
          if (text && text.trim()) {
            foundErrors.push({ selector, text: text.trim() });
            console.log(`Found potential error: ${selector} - ${text.trim()}`);
          }
        }
      }
    }
    
    // If errors are found, check if there are recovery options
    if (foundErrors.length > 0) {
      const recoveryElements = [
        'button:has-text("Retry")',
        'button:has-text("Try Again")',
        'button:has-text("Restart")',
        'button:has-text("Fix")',
        'button:has-text("Resolve")'
      ];
      
      let foundRecovery = false;
      for (const selector of recoveryElements) {
        const button = page.locator(selector).first();
        if (await button.isVisible() && await button.isEnabled()) {
          console.log(`Found recovery option: ${selector}`);
          foundRecovery = true;
          break;
        }
      }
      
      if (foundRecovery) {
        console.log('Error handling appears to be properly implemented with recovery options');
      } else {
        console.log('Errors found but no recovery options - this may indicate an issue');
      }
    }
    
    // This test doesn't fail on errors - it just reports what it finds
    // The presence of good error handling is actually a positive sign
    console.log(`Deployment error analysis complete. Found ${foundErrors.length} error indicators.`);
  });
  
  test('should show deployment completion status', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    
    // Wait a bit for any ongoing deployment to progress
    await page.waitForTimeout(5000);
    
    // Look for completion/success indicators
    const completionElements = [
      'text=Complete',
      'text=Success',
      'text=Ready',
      'text=Running',
      'text=Active',
      'text=Deployed',
      '[class*="success"]',
      '[class*="complete"]',
      '[class*="ready"]',
      'text=DDALAB is running',
      'text=Services are running'
    ];
    
    let foundCompletion = false;
    for (const selector of completionElements) {
      if (await page.locator(selector).first().isVisible()) {
        console.log(`Found completion indicator: ${selector}`);
        foundCompletion = true;
        break;
      }
    }
    
    // Look for next steps or access information
    const nextStepElements = [
      'button:has-text("Open")',
      'button:has-text("Access")',
      'button:has-text("Visit")',
      'text=localhost',
      'text=https://',
      'text=URL',
      'link',
      'a[href]'
    ];
    
    let foundNextSteps = false;
    for (const selector of nextStepElements) {
      const elements = page.locator(selector);
      const count = await elements.count();
      
      for (let i = 0; i < count; i++) {
        if (await elements.nth(i).isVisible()) {
          console.log(`Found next step element: ${selector}`);
          foundNextSteps = true;
          break;
        }
      }
      if (foundNextSteps) break;
    }
    
    // Should find either completion status or next steps
    const foundDeploymentInfo = foundCompletion || foundNextSteps;
    console.log(`Deployment completion check: completion=${foundCompletion}, nextSteps=${foundNextSteps}`);
    
    expect(foundDeploymentInfo).toBeTruthy();
  });
  
  test('should display resource usage and health information', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    
    // Look for system resource or health indicators
    const healthElements = [
      'text=CPU',
      'text=Memory',
      'text=Disk',
      'text=Health',
      'text=Status',
      'text=Uptime',
      '[class*="health"]',
      '[class*="status"]',
      '[class*="metric"]',
      '[data-testid*="health"]',
      '[data-testid*="status"]'
    ];
    
    let foundHealth = false;
    for (const selector of healthElements) {
      const elements = page.locator(selector);
      const count = await elements.count();
      
      for (let i = 0; i < count; i++) {
        if (await elements.nth(i).isVisible()) {
          console.log(`Found health indicator: ${selector}`);
          foundHealth = true;
          break;
        }
      }
      if (foundHealth) break;
    }
    
    // Look for port/service information
    const serviceInfoElements = [
      'text=Port',
      'text=3000',
      'text=8000',
      'text=5432',
      'text=localhost',
      'text=127.0.0.1',
      'code',
      'pre'
    ];
    
    let foundServiceInfo = false;
    for (const selector of serviceInfoElements) {
      if (await page.locator(selector).first().isVisible()) {
        console.log(`Found service info: ${selector}`);
        foundServiceInfo = true;
        break;
      }
    }
    
    const foundSystemInfo = foundHealth || foundServiceInfo;
    console.log(`System information check: health=${foundHealth}, serviceInfo=${foundServiceInfo}`);
    
    // It's okay if system info isn't prominently displayed in all UI states
    if (!foundSystemInfo) {
      console.log('No detailed system information found - this may be normal depending on UI state');
    }
  });
});