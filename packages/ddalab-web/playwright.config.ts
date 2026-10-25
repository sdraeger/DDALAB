import { defineConfig, devices } from "@playwright/test";

// The performance contracts (e2e/perf.spec.ts) depend on the machine: they run only with PERF=1
// (`npm run test:perf`), in Chromium, against a cross-origin isolated server (memory measurement needs it).
const perf = Boolean(process.env.PERF);

export default defineConfig({
  testDir: "e2e",
  // The CLI bundles e2e/analysis.spec.ts compares the browser's results with.
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: "http://localhost:5173" },
  webServer: perf
    ? {
        command: "npx vite --port 5174 --strictPort",
        url: "http://localhost:5174",
        env: { DDALAB_ISOLATE: "1" },
        reuseExistingServer: false,
      }
    : {
        command: "npx vite --port 5173 --strictPort",
        url: "http://localhost:5173",
        reuseExistingServer: true,
      },
  projects: perf
    ? [
        {
          name: "perf",
          testMatch: /perf\.spec\.ts/,
          // The full Chromium build draws WebGL on the GPU; the default headless shell renders it in software.
          use: {
            ...devices["Desktop Chrome"],
            channel: "chromium",
            deviceScaleFactor: 2,
            baseURL: "http://localhost:5174",
          },
        },
      ]
    : [
        { name: "chromium", use: devices["Desktop Chrome"], testIgnore: /perf\.spec\.ts/ },
        { name: "firefox", use: devices["Desktop Firefox"], testIgnore: /perf\.spec\.ts/ },
        { name: "webkit", use: devices["Desktop Safari"], testIgnore: /perf\.spec\.ts/ },
      ],
});
