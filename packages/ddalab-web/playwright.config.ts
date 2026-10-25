import { defineConfig, devices } from "@playwright/test";

// The performance contracts (e2e/perf.spec.ts) and the benchmark (e2e/bench.spec.ts) depend on the machine: they run
// only with PERF=1 (`npm run test:perf`, `npm run bench`), in Chromium, against a cross-origin isolated server (memory
// measurement needs it).
const perf = Boolean(process.env.PERF);
// Each run starts its own server on its port (DDALAB_E2E_PORT, 5173 by default) and fails when the port is taken: a
// server already there may serve another worktree.
const port = Number(process.env.DDALAB_E2E_PORT ?? (perf ? 5174 : 5173));
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  retries: process.env.CI ? 1 : 0,
  // The CLI bundles e2e/analysis.spec.ts compares the browser's results with.
  globalSetup: "./e2e/global-setup.ts",
  // Tests against the real OpenNeuro run only with LIVE=1.
  grepInvert: process.env.LIVE ? undefined : /@live/,
  use: { baseURL: origin },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: origin,
    env: perf ? { DDALAB_ISOLATE: "1" } : {},
    reuseExistingServer: false,
  },
  // The full Chromium build draws WebGL on the GPU; the default headless shell renders it in software.
  projects: perf
    ? ["perf", "bench"].map((name) => ({
        name,
        testMatch: new RegExp(`${name}\\.spec\\.ts`),
        use: { ...devices["Desktop Chrome"], channel: "chromium", deviceScaleFactor: 2 },
      }))
    : [
        { name: "chromium", use: devices["Desktop Chrome"], testIgnore: /(perf|bench)\.spec\.ts/ },
        { name: "firefox", use: devices["Desktop Firefox"], testIgnore: /(perf|bench)\.spec\.ts/ },
        { name: "webkit", use: devices["Desktop Safari"], testIgnore: /(perf|bench)\.spec\.ts/ },
      ],
});
