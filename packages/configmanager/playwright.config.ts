import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: process.env.CI ? 120000 : 60000, // 2 minutes for CI, 1 minute for local
  fullyParallel: true, // Enable parallel execution
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0, // Reduce retries to save time
  workers: process.env.CI ? 3 : 1, // Use 3 workers in CI for parallel execution
  // Increase teardown timeout for CI to handle slow electron cleanup
  expect: {
    timeout: 30000, // 30 seconds for expect assertions
  },
  // Disable worker teardown timeout to prevent CI failures
  teardown: {
    timeout: 0 // Disable timeout - let workers finish naturally
  },
  globalTeardown: process.env.CI ? require.resolve('./tests/setup/global-teardown.ts') : undefined,
  globalSetup: undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'test-results/results.xml' }],
    ['list']
  ],
  use: {
    baseURL: 'http://localhost:3000', // Not used for Electron tests but required
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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