import { defineConfig, devices } from '@playwright/test';

// CI-specific configuration with optimized settings
export default defineConfig({
  testDir: './tests',
  // Exclude orchestrator E2E test (13) as it runs in dedicated jobs
  testIgnore: '**/13-orchestrator-e2e.spec.ts',
  timeout: 90000, // 1.5 minutes per test
  fullyParallel: true,
  forbidOnly: true,
  retries: 0, // No retries to save time
  workers: process.env.PLAYWRIGHT_WORKERS ? parseInt(process.env.PLAYWRIGHT_WORKERS) : 4,
  
  // Increase teardown timeout for CI environments
  teardown: {
    timeout: 180000 // 3 minutes for worker teardown
  },
  
  expect: {
    timeout: 20000, // 20 seconds for assertions
  },
  
  globalTeardown: require.resolve('./tests/setup/global-teardown.ts'),
  
  reporter: [
    ['list'],
    ['junit', { outputFile: 'test-results/results.xml' }],
  ],
  
  use: {
    trace: 'off', // Disable tracing to save time
    screenshot: 'only-on-failure',
    video: 'off', // Disable video to save time
  },

  projects: [
    {
      name: 'electron',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],

  outputDir: 'test-results/',
});