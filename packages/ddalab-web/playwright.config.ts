import { defineConfig, devices } from "@playwright/test";

// The performance contracts (e2e/perf.spec.ts) depend on the machine: they run only with PERF=1
// (`npm run test:perf`), in Chromium, against a cross-origin isolated server (memory measurement needs it).
const perf = Boolean(process.env.PERF);
// Each run starts its own server on its port (DDALAB_E2E_PORT, 5173 by default) and fails when the port is taken: a
// server already there may serve another worktree.
const port = Number(process.env.DDALAB_E2E_PORT ?? (perf ? 5174 : 5173));
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  // The CLI bundles e2e/analysis.spec.ts compares the browser's results with.
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: origin },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: origin,
    env: perf ? { DDALAB_ISOLATE: "1" } : {},
    reuseExistingServer: false,
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
          },
        },
      ]
    : [
        { name: "chromium", use: devices["Desktop Chrome"], testIgnore: /perf\.spec\.ts/ },
        { name: "firefox", use: devices["Desktop Firefox"], testIgnore: /perf\.spec\.ts/ },
        { name: "webkit", use: devices["Desktop Safari"], testIgnore: /perf\.spec\.ts/ },
      ],
});
