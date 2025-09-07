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
  
  // Global timeout for the entire test run - much shorter since tests should be fast
  globalTimeout: isCI ? 300000 : 180000, // 5min CI, 3min local
  
  // Timeout for individual tests - shorter since we're just testing UI
  timeout: isCI ? 60000 : 30000, // 1min CI, 30s local
  
  // Expect timeout for assertions - faster for UI tests
  expect: {
    timeout: isCI ? 15000 : 10000 // 15s CI, 10s local
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
  
  // Global test setup only - skip teardown to prevent timeout issues
  globalSetup: path.resolve(__dirname, 'tests/setup/orchestrator-global-setup.ts'),
  
  // Output directories
  outputDir: `test-results/orchestrator-${platform}`,
  
  // Use the existing Electron test setup
  use: {
    // Base URL for any web requests
    baseURL: process.env.DDALAB_BASE_URL || 'https://localhost',
    
    // Faster timeouts for UI testing
    actionTimeout: isCI ? 15000 : 10000, // 15s CI, 10s local
    navigationTimeout: isCI ? 30000 : 20000, // 30s CI, 20s local
    
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

  // Single project configuration - run all tests once
  projects: [
    {
      name: `orchestrator-${platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux'}`,
      testDir: './tests',
      testMatch: '**/13-orchestrator-e2e.spec.ts',
      use: {
        ...devices['Desktop Chrome'], // Use Chrome-like settings for Electron
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