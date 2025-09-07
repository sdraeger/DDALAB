import { defineConfig, devices } from '@playwright/test';
import path from 'path';

// Get platform-specific configuration
const platform = process.env.DDALAB_E2E_PLATFORM || process.platform;
const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';

// Platform-specific settings
const platformConfig = {
  darwin: {
    name: 'macOS',
    timeout: 180000, // macOS can be slower with Electron
    retries: isCI ? 2 : 1,
    workers: isCI ? 1 : 2,
  },
  win32: {
    name: 'Windows',
    timeout: 240000, // Windows typically slower
    retries: isCI ? 3 : 1,
    workers: isCI ? 1 : 1, // Windows can have more issues with parallel execution
  },
  linux: {
    name: 'Linux',
    timeout: isCI ? 180000 : 120000, // Increase timeout in CI
    retries: isCI ? 2 : 1,
    workers: isCI ? 1 : 2, // Reduce workers in CI to prevent resource issues
  }
};

const currentPlatformConfig = platformConfig[platform] || platformConfig.linux;

export default defineConfig({
  testDir: './tests',
  
  // Only run the orchestrator E2E tests
  testMatch: '**/13-orchestrator-e2e.spec.ts',
  
  // Global timeout for the entire test run
  globalTimeout: isCI ? 900000 : 300000, // 15min CI (Windows needs more time), 5min local
  
  // Timeout for individual tests
  timeout: currentPlatformConfig.timeout,
  
  // Expect timeout for assertions
  expect: {
    timeout: 30000
  },
  
  // Test configuration
  fullyParallel: false, // Orchestrator tests should run sequentially
  forbidOnly: isCI,
  retries: isCI ? 1 : currentPlatformConfig.retries, // Reduce retries in CI to save memory
  workers: isCI ? 1 : Math.min(currentPlatformConfig.workers, 2), // Limit workers in CI
  
  // Reporter configuration
  reporter: [
    ['html', { outputFolder: `playwright-report/orchestrator-${platform}` }],
    ['json', { outputFile: `test-results/orchestrator-${platform}-results.json` }],
    ['junit', { outputFile: `test-results/orchestrator-${platform}-junit.xml` }],
    ['line']
  ],
  
  // Global test setup and teardown
  globalSetup: path.resolve(__dirname, 'tests/setup/orchestrator-global-setup.ts'),
  globalTeardown: path.resolve(__dirname, 'tests/setup/orchestrator-global-teardown.ts'),
  
  // Output directories
  outputDir: `test-results/orchestrator-${platform}`,
  
  // Use the existing Electron test setup
  use: {
    // Base URL for any web requests
    baseURL: process.env.DDALAB_BASE_URL || 'https://localhost',
    
    // Global test timeout
    actionTimeout: 30000,
    navigationTimeout: 60000,
    
    // Capture screenshots and videos on failure
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    
    // Custom test context
    contextOptions: {
      // Ignore HTTPS certificate errors for self-signed certificates
      ignoreHTTPSErrors: true,
      
      // Set viewport for consistency
      viewport: { width: 1280, height: 720 },
      
      // Locale
      locale: 'en-US',
      
      // Timezone
      timezoneId: 'America/New_York',
    }
  },

  // Project configuration for different test scenarios
  projects: [
    {
      name: `orchestrator-${platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux'}`,
      testDir: './tests',
      testMatch: '**/13-orchestrator-e2e.spec.ts',
      use: {
        ...devices['Desktop Chrome'], // Use Chrome-like settings for Electron
      },
    },
    
    // Platform-specific installation test
    {
      name: `installation-${platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux'}`,
      testDir: './tests',
      testMatch: '**/13-orchestrator-e2e.spec.ts',
      grep: /should guide through the initial setup process|should provide OS-specific installation instructions/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    
    // Docker integration test
    {
      name: `docker-integration-${platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux'}`,
      testDir: './tests',
      testMatch: '**/13-orchestrator-e2e.spec.ts',
      grep: /should validate Docker installation|should initiate DDALAB deployment|should successfully deploy and verify DDALAB services/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    
    // Connectivity verification test
    {
      name: `connectivity-${platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux'}`,
      testDir: './tests',
      testMatch: '**/13-orchestrator-e2e.spec.ts',
      grep: /should verify DDALAB web interface is accessible/,
      use: {
        ...devices['Desktop Chrome'],
      },
    }
  ],

  // Web server configuration (if needed)
  webServer: process.env.DDALAB_START_SERVER ? {
    command: 'npm run dev',
    port: 3000,
    timeout: 120000,
    reuseExistingServer: !isCI,
  } : undefined,
});

// Export platform information for use in tests
export const testPlatform = {
  name: currentPlatformConfig.name,
  platform,
  isCI,
  timeout: currentPlatformConfig.timeout,
};