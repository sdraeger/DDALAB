import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for DDALAB e2e tests.
 *
 * Fast, focused tests that test actual app behavior with a real backend.
 *
 * Run tests with:
 *   npm run test:e2e         - Run all e2e tests
 *   npm run test:e2e:ui      - Run with interactive UI
 *   npm run test:e2e:headed  - Run in headed mode (visible browser)
 */
export default defineConfig({
  testDir: "./e2e/specs",
  testMatch: "**/*.spec.ts",
  testIgnore: ["**/node_modules/**", "**/src/**"],
  fullyParallel: false, // Sequential for predictable state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["html", { outputFolder: "e2e-report" }], ["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:3003",
    trace: "on-first-retry",
    screenshot: "on", // Capture screenshot at end of every test
    video: "retain-on-failure",
    actionTimeout: 5000,
    navigationTimeout: 10000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Start the Next.js dev server automatically
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3003",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    stdout: "pipe",
    stderr: "pipe",
  },
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
});
