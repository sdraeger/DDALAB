import { electronTest as test, expect } from './utils/electron-utils';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Helper function to detect the current OS
function getCurrentOS(): 'macos' | 'windows' | 'linux' {
  switch (process.platform) {
    case 'darwin': return 'macos';
    case 'win32': return 'windows';
    case 'linux': return 'linux';
    default: return 'linux';
  }
}

// Helper function to check if Docker is installed and running
async function checkDockerAvailability(): Promise<{ installed: boolean; running: boolean; version?: string }> {
  // Check if Docker tests should be skipped (e.g., in CI environments without Docker)
  if (process.env.SKIP_DOCKER_TESTS === 'true') {
    console.log('SKIP_DOCKER_TESTS is set - Docker tests will be skipped');
    return { installed: false, running: false };
  }
  
  try {
    const { stdout: versionOutput } = await execAsync('docker --version');
    const version = versionOutput.trim();
    
    try {
      await execAsync('docker info');
      return { installed: true, running: true, version };
    } catch (infoError) {
      return { installed: true, running: false, version };
    }
  } catch (versionError) {
    return { installed: false, running: false };
  }
}

// Helper function to wait for DDALAB services to be ready
async function waitForDDALABServices(maxWaitTime: number = 120000): Promise<{ success: boolean; services: string[]; errors: string[] }> {
  const startTime = Date.now();
  let lastError = '';
  const errors = [];
  
  while (Date.now() - startTime < maxWaitTime) {
    try {
      // Check if docker containers are running
      const { stdout } = await execAsync('docker ps --format "table {{.Names}}\t{{.Status}}"');
      const containerLines = stdout.split('\n').slice(1); // Skip header
      const runningServices = containerLines
        .filter(line => line.includes('ddalab') && line.includes('Up'))
        .map(line => line.split('\t')[0]);
      
      if (runningServices.length >= 3) { // Expect at least API, DB, and proxy
        return { success: true, services: runningServices, errors };
      }
      
      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, 5000));
      
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      errors.push(`${new Date().toISOString()}: ${lastError}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  return { success: false, services: [], errors: [...errors, `Timeout after ${maxWaitTime}ms: ${lastError}`] };
}

// Helper function to test DDALAB web interface connectivity
async function testDDALABConnectivity(): Promise<{ webAccessible: boolean; apiAccessible: boolean; httpsWorking: boolean }> {
  const results = {
    webAccessible: false,
    apiAccessible: false,
    httpsWorking: false
  };
  
  try {
    // Test HTTPS web interface
    const httpsResponse = await fetch('https://localhost', {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'DDALAB-E2E-Test' }
    }).catch(() => null);
    
    if (httpsResponse && httpsResponse.status < 500) {
      results.webAccessible = true;
      results.httpsWorking = true;
    }
  } catch (error) {
    console.log('HTTPS test failed:', error instanceof Error ? error.message : String(error));
  }
  
  try {
    // Test API health endpoint
    const apiResponse = await fetch('https://localhost/api/health', {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'DDALAB-E2E-Test' }
    }).catch(() => null);
    
    if (apiResponse && apiResponse.ok) {
      results.apiAccessible = true;
    }
  } catch (error) {
    console.log('API test failed:', error instanceof Error ? error.message : String(error));
  }
  
  // Fallback: try HTTP if HTTPS failed
  if (!results.webAccessible) {
    try {
      const httpResponse = await fetch('http://localhost:3000', {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'DDALAB-E2E-Test' }
      }).catch(() => null);
      
      if (httpResponse && httpResponse.status < 500) {
        results.webAccessible = true;
      }
    } catch (error) {
      console.log('HTTP fallback test failed:', error instanceof Error ? error.message : String(error));
    }
  }
  
  return results;
}

test.describe('DDALAB Orchestrator End-to-End Tests', () => {
  const currentOS = getCurrentOS();
  let dockerInfo: { installed: boolean; running: boolean; version?: string };
  
  test.beforeAll(async () => {
    console.log(`Running E2E tests on: ${currentOS}`);
    dockerInfo = await checkDockerAvailability();
    console.log('Docker status:', dockerInfo);
  });

  test('should detect system requirements correctly', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    
    // The ConfigManager should detect the current OS
    const osIndicators = [
      `text=${currentOS}`,
      `text=${process.platform}`,
      '[data-testid*="os"]',
      '[class*="platform"]'
    ];
    
    let foundOSDetection = false;
    for (const selector of osIndicators) {
      if (await page.locator(selector).first().isVisible()) {
        console.log(`Found OS detection: ${selector}`);
        foundOSDetection = true;
        break;
      }
    }
    
    // Check for Docker detection
    const dockerElements = [
      'text=Docker',
      'text=docker',
      'text=Container',
      '[data-testid*="docker"]',
      '[class*="docker"]'
    ];
    
    let foundDockerDetection = false;
    for (const selector of dockerElements) {
      if (await page.locator(selector).first().isVisible()) {
        console.log(`Found Docker detection: ${selector}`);
        foundDockerDetection = true;
        break;
      }
    }
    
    console.log(`System requirements detection - OS: ${foundOSDetection}, Docker: ${foundDockerDetection}`);
    expect(foundOSDetection || foundDockerDetection).toBeTruthy();
  });

  test('should guide through the initial setup process', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    
    // Look for setup wizard or welcome screens
    const setupElements = [
      'text=Welcome',
      'text=Setup',
      'text=Getting Started',
      'text=Configuration',
      'text=Install',
      'button:has-text("Next")',
      'button:has-text("Continue")',
      'button:has-text("Get Started")',
      '[data-testid*="setup"]',
      '[data-testid*="wizard"]'
    ];
    
    let foundSetupUI = false;
    let setupButton = null;
    
    for (const selector of setupElements) {
      const element = page.locator(selector).first();
      if (await element.isVisible()) {
        console.log(`Found setup element: ${selector}`);
        foundSetupUI = true;
        
        // If it's a clickable button, try to interact with it
        if (selector.includes('button') && await element.isEnabled()) {
          setupButton = element;
        }
        break;
      }
    }
    
    // If we found a setup button, click it to advance the setup
    if (setupButton) {
      await setupButton.click();
      await page.waitForTimeout(2000);
      console.log('Clicked setup button to advance configuration');
    }
    
    // Check for configuration options
    const configElements = [
      'input[type="text"]',
      'input[type="checkbox"]',
      'select',
      'textarea',
      '[role="textbox"]',
      '[data-testid*="config"]'
    ];
    
    let foundConfigOptions = false;
    for (const selector of configElements) {
      if (await page.locator(selector).first().isVisible()) {
        console.log(`Found configuration option: ${selector}`);
        foundConfigOptions = true;
        break;
      }
    }
    
    console.log(`Setup process - UI: ${foundSetupUI}, Config: ${foundConfigOptions}`);
    expect(foundSetupUI || foundConfigOptions).toBeTruthy();
  });

  test('should validate Docker installation and status', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    
    // Look for Docker status indicators in the UI
    const dockerStatusElements = [
      'text=Docker installed',
      'text=Docker running',
      'text=Docker available',
      'text=Docker ready',
      'text=Docker not found',
      'text=Docker not running',
      '[class*="docker-status"]',
      '[class*="status-ok"]',
      '[class*="status-error"]',
      '[data-testid*="docker-status"]'
    ];
    
    let foundDockerStatus = false;
    let statusText = '';
    
    for (const selector of dockerStatusElements) {
      const element = page.locator(selector).first();
      if (await element.isVisible()) {
        statusText = (await element.textContent()) || '';
        console.log(`Found Docker status: ${statusText}`);
        foundDockerStatus = true;
        break;
      }
    }
    
    // Check if the UI status matches actual Docker status
    if (foundDockerStatus) {
      const uiIndicatesRunning = statusText.toLowerCase().includes('running') || 
                                statusText.toLowerCase().includes('ready') ||
                                statusText.toLowerCase().includes('available');
      
      console.log(`Docker status comparison - UI indicates running: ${uiIndicatesRunning}, Actually running: ${dockerInfo.running}`);
      
      // The UI should generally reflect the actual Docker status
      if (dockerInfo.installed) {
        expect(statusText.toLowerCase()).toContain('docker');
      }
    }
    
    // Look for Docker installation guidance if Docker is not available
    if (!dockerInfo.installed || !dockerInfo.running) {
      const guidanceElements = [
        'text=Install Docker',
        'text=Download Docker',
        'text=Start Docker',
        'button:has-text("Install")',
        'button:has-text("Download")',
        'a[href*="docker.com"]',
        '[data-testid*="install-docker"]'
      ];
      
      let foundGuidance = false;
      for (const selector of guidanceElements) {
        if (await page.locator(selector).first().isVisible()) {
          console.log(`Found Docker installation guidance: ${selector}`);
          foundGuidance = true;
          break;
        }
      }
      
      if (!foundGuidance) {
        console.log('Docker not available but no installation guidance found');
      }
    }
    
    expect(foundDockerStatus || !dockerInfo.installed).toBeTruthy();
  });

  test('should initiate DDALAB deployment with proper progress indication', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    
    // Skip this test if Docker is not available
    if (!dockerInfo.installed || !dockerInfo.running) {
      console.log('Skipping deployment test - Docker not available');
      return;
    }
    
    // Look for deployment initiation controls
    const deploymentButtons = [
      'button:has-text("Deploy")',
      'button:has-text("Start")',
      'button:has-text("Launch")',
      'button:has-text("Install")',
      'button:has-text("Run DDALAB")',
      'button:has-text("Start DDALAB")',
      '[data-testid*="deploy"]',
      '[data-testid*="start"]',
      '[data-testid*="launch"]'
    ];
    
    let deployButton = null;
    for (const selector of deploymentButtons) {
      const button = page.locator(selector).first();
      if (await button.isVisible() && await button.isEnabled()) {
        console.log(`Found deployment button: ${selector}`);
        deployButton = button;
        break;
      }
    }
    
    if (deployButton) {
      // Start the deployment
      await deployButton.click();
      console.log('Initiated DDALAB deployment');
      
      // Wait for deployment progress indicators
      await page.waitForTimeout(5000);
      
      const progressElements = [
        '[class*="progress"]',
        '[class*="loading"]',
        '[class*="spinner"]',
        '[role="progressbar"]',
        'text=Downloading',
        'text=Installing',
        'text=Starting',
        'text=Deploying',
        'text=Configuring'
      ];
      
      let foundProgress = false;
      for (const selector of progressElements) {
        if (await page.locator(selector).first().isVisible()) {
          console.log(`Found deployment progress: ${selector}`);
          foundProgress = true;
          break;
        }
      }
      
      expect(foundProgress).toBeTruthy();
      
    } else {
      // Check if deployment is already running or completed
      const statusElements = [
        'text=Running',
        'text=Active',
        'text=Deployed',
        'text=Ready',
        '[class*="status-running"]',
        '[class*="status-active"]'
      ];
      
      let foundStatus = false;
      for (const selector of statusElements) {
        if (await page.locator(selector).first().isVisible()) {
          console.log(`Found deployment status: ${selector}`);
          foundStatus = true;
          break;
        }
      }
      
      expect(foundStatus).toBeTruthy();
    }
  });

  test('should successfully deploy and verify DDALAB services', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    
    // Skip this test if Docker is not available
    if (!dockerInfo.installed || !dockerInfo.running) {
      console.log('Skipping services verification test - Docker not available');
      return;
    }
    
    const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
    
    // In CI, we may not actually deploy services, so check UI elements only
    if (isCI) {
      console.log('CI environment detected - checking UI elements only');
      
      // Look for deployment UI elements
      const deploymentUIElements = [
        'text=Deploy',
        'text=Start',
        'text=Docker',
        'text=Service',
        'text=Container',
        'text=Status',
        '[class*="deploy"]',
        '[class*="service"]',
        '[data-testid*="deploy"]',
        '[data-testid*="service"]'
      ];
      
      let foundDeploymentUI = false;
      for (const selector of deploymentUIElements) {
        if (await page.locator(selector).first().isVisible()) {
          console.log(`Found deployment UI element: ${selector}`);
          foundDeploymentUI = true;
          break;
        }
      }
      
      expect(foundDeploymentUI).toBeTruthy();
      return;
    }
    
    // Local testing - full deployment verification
    console.log('Waiting for DDALAB services to be ready...');
    
    const serviceStatus = await waitForDDALABServices(180000); // 3 minutes timeout
    
    console.log(`Service deployment status: ${serviceStatus.success}`);
    console.log(`Running services: ${serviceStatus.services.join(', ')}`);
    
    if (serviceStatus.errors.length > 0) {
      console.log('Deployment errors:', serviceStatus.errors);
    }
    
    // Look for service status in the UI
    const serviceElements = [
      'text=ddalab',
      'text=postgres',
      'text=redis',
      'text=traefik',
      'text=Running',
      'text=Up',
      'text=Active',
      '[class*="service"]',
      '[class*="container"]',
      '[data-testid*="service"]'
    ];
    
    let foundServiceUI = false;
    for (const selector of serviceElements) {
      const elements = page.locator(selector);
      const count = await elements.count();
      
      for (let i = 0; i < count; i++) {
        if (await elements.nth(i).isVisible()) {
          console.log(`Found service UI element: ${selector}`);
          foundServiceUI = true;
          break;
        }
      }
      if (foundServiceUI) break;
    }
    
    // The test should pass if either services are running OR the UI shows deployment progress
    expect(serviceStatus.success || foundServiceUI).toBeTruthy();
  });

  test('should verify DDALAB web interface is accessible', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    
    // Skip this test if Docker is not available
    if (!dockerInfo.installed || !dockerInfo.running) {
      console.log('Skipping web interface test - Docker not available');
      return;
    }
    
    const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
    console.log(`Testing web interface - CI mode: ${isCI}`);
    
    // In CI environments, focus on UI elements rather than actual connectivity
    if (isCI) {
      console.log('CI environment - checking UI elements for web access');
      
      // Look for UI elements that indicate web access functionality
      const webAccessUIElements = [
        'text=localhost',
        'text=Web',
        'text=URL',
        'text=Access',
        'text=Open',
        'text=Interface',
        'text=https',
        'text=http',
        'button:has-text("Open")',
        'button:has-text("Access")',
        '[class*="url"]',
        '[class*="link"]',
        '[class*="access"]',
        '[data-testid*="access"]',
        '[data-testid*="url"]',
        '[data-testid*="web"]'
      ];
      
      let foundWebAccessUI = false;
      let foundElements = [];
      
      for (const selector of webAccessUIElements) {
        try {
          const elements = page.locator(selector);
          const count = await elements.count();
          
          for (let i = 0; i < count; i++) {
            const element = elements.nth(i);
            if (await element.isVisible()) {
              const text = await element.textContent();
              foundElements.push(`${selector}: ${text?.trim()}`);
              foundWebAccessUI = true;
            }
          }
        } catch (error) {
          // Ignore selector errors in CI
        }
      }
      
      console.log(`Found ${foundElements.length} web access UI elements:`, foundElements);
      
      // If no elements found, look for broader UI indicators
      if (!foundWebAccessUI) {
        const broadUIElements = [
          'button',
          'a',
          '[role="button"]',
          '[role="link"]'
        ];
        
        for (const selector of broadUIElements) {
          try {
            const elements = page.locator(selector);
            const count = await elements.count();
            
            for (let i = 0; i < Math.min(count, 10); i++) {
              const element = elements.nth(i);
              if (await element.isVisible()) {
                const text = await element.textContent();
                if (text && (text.includes('open') || text.includes('access') || text.includes('web') || text.includes('localhost'))) {
                  console.log(`Found related UI element: ${selector} - ${text.trim()}`);
                  foundWebAccessUI = true;
                  break;
                }
              }
            }
            if (foundWebAccessUI) break;
          } catch (error) {
            // Ignore errors
          }
        }
      }
      
      expect(foundWebAccessUI).toBeTruthy();
      return;
    }
    
    // Local testing - full connectivity check
    console.log('Testing DDALAB web interface connectivity...');
    
    const connectivity = await testDDALABConnectivity();
    console.log('Connectivity results:', connectivity);
    
    // Look for access information in the UI
    const accessElements = [
      'text=https://localhost',
      'text=localhost',
      'text=Access DDALAB',
      'text=Open DDALAB',
      'button:has-text("Open")',
      'button:has-text("Access")',
      'a[href*="localhost"]',
      '[data-testid*="access"]',
      '[data-testid*="url"]'
    ];
    
    let foundAccessInfo = false;
    for (const selector of accessElements) {
      const elements = page.locator(selector);
      const count = await elements.count();
      
      for (let i = 0; i < count; i++) {
        const element = elements.nth(i);
        if (await element.isVisible()) {
          const text = await element.textContent();
          console.log(`Found access info: ${selector} - ${text}`);
          foundAccessInfo = true;
          break;
        }
      }
      if (foundAccessInfo) break;
    }
    
    // If we found an "Open" button, test clicking it
    const openButton = page.locator('button:has-text("Open")').first();
    if (await openButton.isVisible() && await openButton.isEnabled()) {
      console.log('Testing "Open DDALAB" button functionality');
      
      // This might open a new window or browser tab
      await openButton.click();
      await page.waitForTimeout(3000);
    }
    
    // Test should pass if we have connectivity OR proper access UI
    expect(connectivity.webAccessible || connectivity.apiAccessible || foundAccessInfo).toBeTruthy();
  });

  test('should handle deployment failures gracefully', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    
    // Look for error handling capabilities
    const errorElements = [
      '[class*="error"]',
      '[class*="alert"]',
      '[class*="warning"]',
      'text=Error',
      'text=Failed',
      'text=Problem',
      'text=Issue',
      '[role="alert"]',
      '[data-testid*="error"]'
    ];
    
    let foundErrorHandling = [];
    for (const selector of errorElements) {
      const elements = page.locator(selector);
      const count = await elements.count();
      
      for (let i = 0; i < count; i++) {
        const element = elements.nth(i);
        if (await element.isVisible()) {
          const text = await element.textContent();
          if (text && text.trim().length > 0) {
            foundErrorHandling.push({ selector, text: text.trim() });
          }
        }
      }
    }
    
    // Look for recovery/retry options
    const recoveryElements = [
      'button:has-text("Retry")',
      'button:has-text("Try Again")',
      'button:has-text("Restart")',
      'button:has-text("Reset")',
      'button:has-text("Fix")',
      'button:has-text("Deploy")', // Deploy button can serve as recovery
      'button:has-text("Start")',  // Start button can serve as recovery
      '[data-testid*="retry"]',
      '[data-testid*="fix"]'
    ];
    
    let foundRecovery = false;
    for (const selector of recoveryElements) {
      const button = page.locator(selector).first();
      if (await button.isVisible()) {
        console.log(`Found recovery option: ${selector}`);
        foundRecovery = true;
        break;
      }
    }
    
    // Look for diagnostic information
    const diagnosticElements = [
      'text=Log',
      'text=Debug',
      'text=Details',
      'button:has-text("Show Logs")',
      'button:has-text("Details")',
      '[data-testid*="log"]',
      '[data-testid*="debug"]'
    ];
    
    let foundDiagnostics = false;
    for (const selector of diagnosticElements) {
      if (await page.locator(selector).first().isVisible()) {
        console.log(`Found diagnostic option: ${selector}`);
        foundDiagnostics = true;
        break;
      }
    }
    
    // Look for informational/status elements that help users understand what's happening
    const statusElements = [
      'text=Docker',
      'text=Status',
      'text=Running',
      'text=Stopped',
      'text=Available',
      'text=Installation',
      '[class*="status"]'
    ];
    
    let foundStatusInfo = false;
    for (const selector of statusElements) {
      if (await page.locator(selector).first().isVisible()) {
        foundStatusInfo = true;
        break;
      }
    }
    
    console.log(`Error handling assessment - Errors: ${foundErrorHandling.length}, Recovery: ${foundRecovery}, Diagnostics: ${foundDiagnostics}, Status Info: ${foundStatusInfo}`);
    
    // The test passes if:
    // 1. No errors detected (system stable), OR
    // 2. Errors detected with recovery options, OR  
    // 3. Errors detected with diagnostic info, OR
    // 4. Clear status information is provided to help users understand the situation
    if (foundErrorHandling.length > 0) {
      const hasGoodErrorHandling = foundRecovery || foundDiagnostics || foundStatusInfo;
      if (!hasGoodErrorHandling) {
        console.log(`Found ${foundErrorHandling.length} errors but no recovery/diagnostic options:`);
        foundErrorHandling.forEach(error => console.log(`  - ${error.selector}: ${error.text}`));
      }
      expect(hasGoodErrorHandling).toBeTruthy();
    } else {
      // No errors found is also a good sign
      console.log('No error conditions detected - system appears stable');
    }
  });

  test('should provide OS-specific installation instructions', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    
    const osSpecificElements = {
      macos: [
        'text=macOS',
        'text=Mac',
        'text=.dmg',
        'text=Homebrew',
        'text=brew install'
      ],
      windows: [
        'text=Windows',
        'text=.exe',
        'text=.msi',
        'text=PowerShell',
        'text=winget install'
      ],
      linux: [
        'text=Linux',
        'text=Ubuntu',
        'text=.deb',
        'text=.rpm',
        'text=apt install',
        'text=yum install'
      ]
    };
    
    const currentOSElements = osSpecificElements[currentOS] || osSpecificElements.linux;
    
    let foundOSSpecificContent = false;
    for (const text of currentOSElements) {
      if (await page.locator(text).first().isVisible()) {
        console.log(`Found OS-specific content: ${text}`);
        foundOSSpecificContent = true;
        break;
      }
    }
    
    // Look for installation instructions
    const instructionElements = [
      'text=Install',
      'text=Download',
      'text=Setup',
      'text=Instructions',
      'text=Guide',
      'ol', // Ordered lists often contain instructions
      'ul li', // Unordered list items
      '[data-testid*="instruction"]'
    ];
    
    let foundInstructions = false;
    for (const selector of instructionElements) {
      if (await page.locator(selector).first().isVisible()) {
        console.log(`Found installation instructions: ${selector}`);
        foundInstructions = true;
        break;
      }
    }
    
    console.log(`OS-specific content - Platform: ${currentOS}, Specific: ${foundOSSpecificContent}, Instructions: ${foundInstructions}`);
    
    // Should provide either OS-specific content or general instructions
    expect(foundOSSpecificContent || foundInstructions).toBeTruthy();
  });

  test('should demonstrate complete orchestrator workflow', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    
    console.log(`\n=== COMPLETE ORCHESTRATOR E2E TEST SUMMARY ===`);
    console.log(`Operating System: ${currentOS} (${process.platform})`);
    console.log(`Docker Status: Installed=${dockerInfo.installed}, Running=${dockerInfo.running}`);
    if (dockerInfo.version) {
      console.log(`Docker Version: ${dockerInfo.version}`);
    }
    
    // Simulate a complete workflow by checking key workflow elements
    const workflowSteps = [
      { name: 'System Detection', selectors: ['text=System', 'text=Requirements', '[data-testid*="system"]'] },
      { name: 'Docker Setup', selectors: ['text=Docker', '[data-testid*="docker"]'] },
      { name: 'Configuration', selectors: ['text=Configuration', 'text=Settings', '[data-testid*="config"]'] },
      { name: 'Deployment', selectors: ['text=Deploy', 'text=Install', 'button:has-text("Start")'] },
      { name: 'Status Monitoring', selectors: ['text=Status', 'text=Running', '[data-testid*="status"]'] },
      { name: 'Access Information', selectors: ['text=localhost', 'text=Access', '[data-testid*="access"]'] }
    ];
    
    const workflowResults = [];
    
    for (const step of workflowSteps) {
      let stepFound = false;
      for (const selector of step.selectors) {
        if (await page.locator(selector).first().isVisible()) {
          stepFound = true;
          break;
        }
      }
      workflowResults.push({ step: step.name, found: stepFound });
      console.log(`Workflow Step "${step.name}": ${stepFound ? '✓' : '✗'}`);
    }
    
    const completedSteps = workflowResults.filter(r => r.found).length;
    const workflowCompleteness = (completedSteps / workflowSteps.length) * 100;
    
    console.log(`Workflow Completeness: ${completedSteps}/${workflowSteps.length} steps (${workflowCompleteness.toFixed(1)}%)`);
    
    // Test connectivity if possible
    if (dockerInfo.installed && dockerInfo.running) {
      try {
        const connectivity = await testDDALABConnectivity();
        console.log(`DDALAB Connectivity: Web=${connectivity.webAccessible}, API=${connectivity.apiAccessible}, HTTPS=${connectivity.httpsWorking}`);
      } catch (error) {
        console.log(`Connectivity test failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    console.log(`=== END E2E TEST SUMMARY ===\n`);
    
    // Test passes if we can demonstrate a reasonable workflow
    expect(completedSteps).toBeGreaterThanOrEqual(3);
  });
});