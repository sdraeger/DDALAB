import { defineConfig, devices } from '@playwright/test';

// CI-specific configuration with optimized settings
export default defineConfig({
  testDir: './tests',
  timeout: 90000, // 1.5 minutes per test
  fullyParallel: true,
  forbidOnly: true,
  retries: 0, // No retries to save time
  workers: process.env.PLAYWRIGHT_WORKERS ? parseInt(process.env.PLAYWRIGHT_WORKERS) : 4,
  
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