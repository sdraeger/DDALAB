import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: process.env.CI ? 180000 : 60000, // 3 minutes for CI, 1 minute for local
  fullyParallel: false, // Electron tests should run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for Electron tests
  // Increase teardown timeout for CI to handle slow electron cleanup
  expect: {
    timeout: 30000, // 30 seconds for expect assertions
  },
  // Increase worker teardown timeout to handle the cumulative cleanup of 47 tests
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